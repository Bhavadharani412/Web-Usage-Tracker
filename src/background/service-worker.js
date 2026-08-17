/**
 * Service Worker — main entry point for the background process.
 *
 * Wires up all event listeners and initializes modules.
 * This is registered in manifest.json as the service worker.
 */

import * as tabManager from './tab-manager.js';
import * as idleManager from './idle-manager.js';
import * as aggregation from './aggregation.js';
import tracker from './tracker.js';
import { getSettings, getDailyUsage, getMultipleDailyUsage, updateTodayUsage, saveSettings, recordTabDecision, getDomainDecisionStats, getWeeklyStats } from '../storage/storage.js';
import { getDateString, getWeekRange, getPreviousWeekRange, getDateRange } from '../utils/time-format.js';
import { aggregateWeekly } from './aggregation.js';

// ─── Initialization ────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[WebTrack] Installed:', details.reason);
  await initialize();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[WebTrack] Browser started');
  await initialize();
});

async function initialize() {
  try {
    await tabManager.init();
    await idleManager.init();
    await aggregation.init();
    console.log('[WebTrack] Initialized successfully');
  } catch (e) {
    console.error('[WebTrack] Initialization error:', e);
  }
}

// Self-init in case service worker restarts
initialize();

// ─── Tab Events ────────────────────────────────────────────

chrome.tabs.onActivated.addListener((activeInfo) => {
  tabManager.onTabActivated(activeInfo);
});

chrome.tabs.onCreated.addListener((tab) => {
  tabManager.onTabCreated(tab);
  // Update tab count in daily usage
  updateTodayUsage((daily) => {
    daily.tabsOpened = (daily.tabsOpened || 0) + 1;
    return daily;
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  tabManager.onTabUpdated(tabId, changeInfo, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabManager.onTabRemoved(tabId);
  // Update tab count in daily usage
  updateTodayUsage((daily) => {
    daily.tabsClosed = (daily.tabsClosed || 0) + 1;
    return daily;
  });
});

// ─── Window Events ─────────────────────────────────────────

chrome.windows.onFocusChanged.addListener((windowId) => {
  tabManager.onWindowFocusChanged(windowId);
});

// ─── Idle Events ───────────────────────────────────────────

chrome.idle.onStateChanged.addListener((newState) => {
  tabManager.onIdleStateChanged(newState);
});

// ─── Alarm Events ──────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  aggregation.onAlarm(alarm);
});

// ─── Message Handler (popup/dashboard communication) ───────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_TODAY_USAGE': {
      const today = getDateString();
      const daily = await getDailyUsage(today);

      // Add live tracking data
      const status = tracker.getStatus();
      if (status.state !== 'INACTIVE' && status.categoryId) {
        // Add in-progress session time to the response
        const liveDaily = { ...daily };
        liveDaily.totalActiveSeconds += status.activeSeconds;

        if (!liveDaily.websites[status.categoryId]) {
          liveDaily.websites[status.categoryId] = 0;
        }
        liveDaily.websites[status.categoryId] += status.activeSeconds;

        if (status.category) {
          liveDaily.websiteNames[status.categoryId] = status.category;
        }
        if (status.icon) {
          liveDaily.websiteIcons[status.categoryId] = status.icon;
        }

        return { success: true, data: liveDaily };
      }

      return { success: true, data: daily };
    }

    case 'GET_WEEKLY_DATA': {
      const weekRange = getWeekRange();
      const prevWeekRange = getPreviousWeekRange();

      const dates = getDateRange(weekRange.startStr, weekRange.endStr);
      const prevDates = getDateRange(prevWeekRange.startStr, prevWeekRange.endStr);

      const [currentRecords, prevRecords] = await Promise.all([
        getMultipleDailyUsage(dates),
        getMultipleDailyUsage(prevDates)
      ]);

      const currentWeek = aggregateWeekly(currentRecords);
      const prevWeek = aggregateWeekly(prevRecords);

      return {
        success: true,
        data: {
          current: currentWeek,
          previous: prevWeek,
          weekRange,
          prevWeekRange
        }
      };
    }

    case 'GET_INACTIVE_TABS': {
      const settings = await getSettings();
      const inactiveTabs = await tabManager.getInactiveTabs(settings.cleanupThresholdMinutes);
      return { success: true, data: inactiveTabs };
    }

    case 'CLOSE_TABS': {
      const { tabIds } = message;
      for (const tabId of tabIds) {
        try {
          const instance = tabManager.getAllTrackedTabs().find(t => t.browserTabId === tabId);
          if (instance) {
            await recordTabDecision({
              domain: instance.domain,
              action: 'close',
              timestamp: Date.now()
            });
          }
          await chrome.tabs.remove(tabId);
        } catch (e) {
          console.warn('[WebTrack] Failed to close tab:', tabId, e);
        }
      }

      // Update daily cleanup stats
      await updateTodayUsage((daily) => {
        daily.cleanupAccepted = (daily.cleanupAccepted || 0) + tabIds.length;
        return daily;
      });

      return { success: true };
    }

    case 'KEEP_TABS': {
      const { tabIds: keepIds } = message;
      for (const tabId of keepIds) {
        const instance = tabManager.getAllTrackedTabs().find(t => t.browserTabId === tabId);
        if (instance) {
          // Reset inactivity timer
          instance.inactiveSince = Date.now();
          await recordTabDecision({
            domain: instance.domain,
            action: 'keep',
            timestamp: Date.now()
          });
        }
      }

      await updateTodayUsage((daily) => {
        daily.cleanupRejected = (daily.cleanupRejected || 0) + keepIds.length;
        return daily;
      });

      return { success: true };
    }

    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { success: true, data: settings };
    }

    case 'SAVE_SETTINGS': {
      await saveSettings(message.settings);

      // Update idle threshold if changed
      if (message.settings.idleThresholdSeconds) {
        idleManager.setThreshold(message.settings.idleThresholdSeconds);
      }

      return { success: true };
    }

    case 'GET_TRACKER_STATUS': {
      return {
        success: true,
        data: {
          ...tracker.getStatus(),
          openTabs: tabManager.getOpenTabCount()
        }
      };
    }

    case 'GET_TAB_HYGIENE': {
      const today = getDateString();
      const weekRange = getWeekRange();
      const dates = getDateRange(weekRange.startStr, weekRange.endStr);
      const records = await getMultipleDailyUsage(dates);

      let totalSuggested = 0;
      let totalAccepted = 0;
      let totalRejected = 0;
      let peakTabs = 0;
      let tabCountSum = 0;
      let daysWithData = 0;

      for (const record of records) {
        totalSuggested += record.cleanupSuggested || 0;
        totalAccepted += record.cleanupAccepted || 0;
        totalRejected += record.cleanupRejected || 0;
        if (record.peakOpenTabs > peakTabs) {
          peakTabs = record.peakOpenTabs;
        }
        if (record.totalActiveSeconds > 0) {
          tabCountSum += record.peakOpenTabs || 0;
          daysWithData++;
        }
      }

      // Find longest inactive tab currently
      const settings = await getSettings();
      const inactiveTabs = await tabManager.getInactiveTabs(0);
      let longestInactive = 0;
      const now = Date.now();
      for (const tab of inactiveTabs) {
        if (tab.inactiveSince) {
          const inactive = Math.floor((now - tab.inactiveSince) / 1000);
          if (inactive > longestInactive) longestInactive = inactive;
        }
      }

      return {
        success: true,
        data: {
          avgOpenTabs: daysWithData > 0 ? Math.round((tabCountSum / daysWithData) * 10) / 10 : tabManager.getOpenTabCount(),
          tabsClosedViaSuggestions: totalAccepted,
          acceptanceRate: (totalAccepted + totalRejected) > 0
            ? Math.round((totalAccepted / (totalAccepted + totalRejected)) * 100)
            : 0,
          longestInactiveSeconds: longestInactive,
          currentOpenTabs: tabManager.getOpenTabCount()
        }
      };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}
