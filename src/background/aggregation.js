/**
 * Aggregation — periodic aggregation and cleanup of tracking data.
 *
 * Uses chrome.alarms to periodically:
 * - Flush any active session time to storage
 * - Update tab hygiene statistics
 * - Clean up old data (retention: 90 days)
 */

import tracker from './tracker.js';
import { getOpenTabCount } from './tab-manager.js';
import { getDailyUsage, saveDailyUsage, updateWeeklyStats } from '../storage/storage.js';
import { getDateString } from '../utils/time-format.js';

const ALARM_PERIODIC = 'wt_periodic_aggregation';
const ALARM_DAILY_RESET = 'wt_daily_reset';
const DATA_RETENTION_DAYS = 90;

/**
 * Initialize aggregation alarms.
 */
export async function init() {
  // Periodic aggregation every 5 minutes
  chrome.alarms.create(ALARM_PERIODIC, {
    periodInMinutes: 5
  });

  // Daily reset check every hour
  chrome.alarms.create(ALARM_DAILY_RESET, {
    periodInMinutes: 60
  });
}

/**
 * Handle alarm triggers.
 * @param {chrome.alarms.Alarm} alarm
 */
export async function onAlarm(alarm) {
  if (alarm.name === ALARM_PERIODIC) {
    await periodicFlush();
  } else if (alarm.name === ALARM_DAILY_RESET) {
    await checkDayRollover();
  }
}

/**
 * Periodic flush — save any in-progress tracking time.
 * This ensures data isn't lost if the service worker is terminated.
 */
async function periodicFlush() {
  const status = tracker.getStatus();

  if (status.state === 'TRACKING' && status.tabId !== null) {
    // Temporarily end and restart the session to flush accumulated time
    const classification = {
      categoryId: status.categoryId,
      category: status.category,
      icon: status.icon,
      pageType: status.pageType || 'Other',
      domain: status.domain || '',
      isInternal: false
    };

    await tracker.endSession();
    tracker.startSession(status.tabId, classification);
  }

  // Update open tab count for hygiene stats
  const openTabs = getOpenTabCount();
  const today = getDateString();
  const daily = await getDailyUsage(today);

  if (openTabs > daily.peakOpenTabs) {
    daily.peakOpenTabs = openTabs;
    await saveDailyUsage(today, daily);
  }
}

/**
 * Check if the day has rolled over and handle any necessary transitions.
 */
async function checkDayRollover() {
  // Clean up old data beyond retention period
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DATA_RETENTION_DAYS);

  // Note: In a production version, we'd iterate stored keys and remove old ones.
  // For MVP, we rely on chrome.storage.local limits being generous enough.
}

/**
 * Calculate weekly aggregated data from daily records.
 * @param {Object[]} dailyRecords - Array of DailyUsage objects
 * @returns {Object} Aggregated weekly data
 */
export function aggregateWeekly(dailyRecords) {
  const result = {
    totalActiveSeconds: 0,
    websites: {},         // categoryId → { seconds, name, icon }
    dailyBreakdown: [],   // Array of { date, totalSeconds }
    tabsOpened: 0,
    tabsClosed: 0,
    cleanupSuggested: 0,
    cleanupAccepted: 0,
    cleanupRejected: 0,
    peakOpenTabs: 0
  };

  for (const daily of dailyRecords) {
    result.totalActiveSeconds += daily.totalActiveSeconds || 0;
    result.tabsOpened += daily.tabsOpened || 0;
    result.tabsClosed += daily.tabsClosed || 0;
    result.cleanupSuggested += daily.cleanupSuggested || 0;
    result.cleanupAccepted += daily.cleanupAccepted || 0;
    result.cleanupRejected += daily.cleanupRejected || 0;

    if ((daily.peakOpenTabs || 0) > result.peakOpenTabs) {
      result.peakOpenTabs = daily.peakOpenTabs;
    }

    // Per-day breakdown
    result.dailyBreakdown.push({
      date: daily.date,
      totalSeconds: daily.totalActiveSeconds || 0
    });

    // Aggregate website time
    for (const [categoryId, seconds] of Object.entries(daily.websites || {})) {
      if (!result.websites[categoryId]) {
        result.websites[categoryId] = {
          seconds: 0,
          name: daily.websiteNames?.[categoryId] || categoryId,
          icon: daily.websiteIcons?.[categoryId] || '🌐'
        };
      }
      result.websites[categoryId].seconds += seconds;
    }
  }

  return result;
}
