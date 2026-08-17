/**
 * Tab Manager — tracks individual tab instances and their inactivity.
 *
 * Listens to Chrome tab events and maintains an in-memory map of all
 * tracked tabs. Coordinates with the Tracker for active time tracking
 * and exposes inactivity data for the cleanup engine.
 */

import { classify } from '../clustering/classifier.js';
import { createTabInstance } from '../storage/schema.js';
import { isInternalUrl, isNewTabUrl } from '../clustering/domain-normalizer.js';
import tracker from './tracker.js';
import { getSettings } from '../storage/storage.js';

/**
 * In-memory map of tracked tabs.
 * Key: browserTabId (number)
 * Value: TabInstance object
 * @type {Map<number, Object>}
 */
const tabs = new Map();

/** @type {number|null} Currently active tab ID */
let activeTabId = null;

/** @type {number|null} Currently focused window ID */
let focusedWindowId = null;

/** @type {boolean} Whether Chrome is currently focused */
let isBrowserFocused = true;

/** @type {boolean} Whether user is idle */
let isUserIdle = false;

/**
 * Initialize tab manager — scan existing tabs and start listening.
 */
export async function init() {
  // Load existing tabs
  try {
    const existingTabs = await chrome.tabs.query({});
    for (const tab of existingTabs) {
      trackTab(tab);
    }

    // Find the active tab in the focused window
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active) {
      activeTabId = active.id;
      await activateTab(active.id);
    }

    // Get focused window
    const focusedWin = await chrome.windows.getLastFocused();
    if (focusedWin) {
      focusedWindowId = focusedWin.id;
      isBrowserFocused = focusedWin.focused;
    }
  } catch (e) {
    console.error('[TabManager] Init error:', e);
  }
}

/**
 * Add a tab to the tracking map.
 * @param {chrome.tabs.Tab} tab
 */
function trackTab(tab) {
  if (!tab || !tab.id) return;

  const url = tab.url || tab.pendingUrl || '';
  if (isInternalUrl(url) && !isNewTabUrl(url)) return;

  const classification = classify(url);
  const instance = createTabInstance(tab, classification);
  tabs.set(tab.id, instance);
}

/**
 * Activate a tab — start tracking time for it.
 * @param {number} tabId
 */
export async function activateTab(tabId) {
  const now = Date.now();

  // Deactivate previous tab
  if (activeTabId !== null && activeTabId !== tabId) {
    deactivateTab(activeTabId, now);
  }

  activeTabId = tabId;

  const instance = tabs.get(tabId);
  if (!instance) return;

  instance.lastActivatedAt = now;
  instance.inactiveSince = null;

  // Start tracking if browser is focused and user is not idle
  if (isBrowserFocused && !isUserIdle && !instance.isInternal) {
    const classification = classify(instance.url);
    if (!classification.isInternal) {
      tracker.startSession(tabId, classification);
    }
  }
}

/**
 * Deactivate a tab — stop tracking, start inactivity timer.
 * @param {number} tabId
 * @param {number} [now]
 */
function deactivateTab(tabId, now = Date.now()) {
  const instance = tabs.get(tabId);
  if (!instance) return;

  instance.lastDeactivatedAt = now;
  instance.inactiveSince = now;

  // End session if this was the tracked tab
  if (tracker.getStatus().tabId === tabId) {
    tracker.endSession();
  }
}

/**
 * Handle tab creation.
 * @param {chrome.tabs.Tab} tab
 */
export function onTabCreated(tab) {
  trackTab(tab);
}

/**
 * Handle tab activation (user switched to this tab).
 * @param {{ tabId: number, windowId: number }} info
 */
export async function onTabActivated(info) {
  // Update the tab instance if we don't have it yet
  if (!tabs.has(info.tabId)) {
    try {
      const tab = await chrome.tabs.get(info.tabId);
      trackTab(tab);
    } catch {
      // Tab might have been removed
      return;
    }
  }

  await activateTab(info.tabId);
}

/**
 * Handle tab update (URL change, title change, etc).
 * @param {number} tabId
 * @param {Object} changeInfo
 * @param {chrome.tabs.Tab} tab
 */
export async function onTabUpdated(tabId, changeInfo, tab) {
  // Re-classify on URL change
  if (changeInfo.url) {
    const classification = classify(changeInfo.url);
    const instance = tabs.get(tabId);

    if (instance) {
      // If this is the active tab and URL changed, end old session and start new
      if (tabId === activeTabId && tracker.getStatus().tabId === tabId) {
        await tracker.endSession();

        // Update instance with new classification
        instance.url = changeInfo.url;
        instance.domain = classification.domain;
        instance.hostname = classification.hostname;
        instance.categoryId = classification.categoryId;
        instance.category = classification.category;
        instance.pageType = classification.pageType;
        instance.icon = classification.icon;

        // Start new session with new classification
        if (isBrowserFocused && !isUserIdle && !classification.isInternal) {
          tracker.startSession(tabId, classification);
        }
      } else {
        // Just update the instance metadata
        instance.url = changeInfo.url;
        instance.domain = classification.domain;
        instance.hostname = classification.hostname;
        instance.categoryId = classification.categoryId;
        instance.category = classification.category;
        instance.pageType = classification.pageType;
        instance.icon = classification.icon;
      }
    } else {
      // New tab we haven't seen — track it
      trackTab(tab);
    }
  }

  // Update title
  if (changeInfo.title) {
    const instance = tabs.get(tabId);
    if (instance) {
      instance.title = changeInfo.title;
    }
  }

  // Update pinned status
  if (changeInfo.pinned !== undefined) {
    const instance = tabs.get(tabId);
    if (instance) {
      instance.isPinned = changeInfo.pinned;
    }
  }

  // Update audible status
  if (changeInfo.audible !== undefined) {
    const instance = tabs.get(tabId);
    if (instance) {
      instance.isAudible = changeInfo.audible;
    }
  }
}

/**
 * Handle tab removal.
 * @param {number} tabId
 */
export async function onTabRemoved(tabId) {
  // End session if this was the tracked tab
  if (tracker.getStatus().tabId === tabId) {
    await tracker.endSession();
  }

  const instance = tabs.get(tabId);
  if (instance) {
    instance.isClosed = true;
    instance.lastDeactivatedAt = Date.now();
  }

  tabs.delete(tabId);

  if (activeTabId === tabId) {
    activeTabId = null;
  }
}

/**
 * Handle window focus change.
 * @param {number} windowId - WINDOW_ID_NONE means Chrome lost focus
 */
export async function onWindowFocusChanged(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Chrome lost focus
    isBrowserFocused = false;
    focusedWindowId = null;
    tracker.pause();
  } else {
    // Chrome gained focus
    const wasFocused = isBrowserFocused;
    isBrowserFocused = true;
    focusedWindowId = windowId;

    if (!wasFocused && !isUserIdle) {
      // Find active tab in the now-focused window
      try {
        const [active] = await chrome.tabs.query({ active: true, windowId });
        if (active) {
          activeTabId = active.id;
          const instance = tabs.get(active.id);
          if (instance) {
            instance.inactiveSince = null;
            const classification = classify(instance.url);
            if (!classification.isInternal) {
              tracker.startSession(active.id, classification);
            }
          }
        }
      } catch {
        // Window might have been removed
      }
    }
  }
}

/**
 * Handle idle state change.
 * @param {string} newState - 'active', 'idle', or 'locked'
 */
export function onIdleStateChanged(newState) {
  if (newState === 'active') {
    isUserIdle = false;
    // Resume tracking if browser is focused
    if (isBrowserFocused && activeTabId !== null) {
      const instance = tabs.get(activeTabId);
      if (instance) {
        const classification = classify(instance.url);
        if (!classification.isInternal) {
          tracker.startSession(activeTabId, classification);
        }
      }
    }
  } else {
    // idle or locked
    isUserIdle = true;
    tracker.pause();
  }
}

/**
 * Get all tracked tabs (for cleanup engine).
 * @returns {Object[]}
 */
export function getAllTrackedTabs() {
  return Array.from(tabs.values()).filter(t => !t.isClosed);
}

/**
 * Get inactive tabs that exceed the threshold.
 * @param {number} thresholdMinutes
 * @returns {Object[]}
 */
export async function getInactiveTabs(thresholdMinutes) {
  const now = Date.now();
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const settings = await getSettings();

  return getAllTrackedTabs().filter(tab => {
    // Must be inactive
    if (!tab.inactiveSince) return false;

    // Must exceed threshold
    if ((now - tab.inactiveSince) < thresholdMs) return false;

    // Filter protected tabs
    if (settings.ignorePinnedTabs && tab.isPinned) return false;
    if (settings.ignoreAudibleTabs && tab.isAudible) return false;
    if (settings.protectedDomains.includes(tab.domain)) return false;
    if (settings.protectedDomains.includes(tab.hostname)) return false;

    // Skip internal pages
    if (isInternalUrl(tab.url) || isNewTabUrl(tab.url)) return false;

    return true;
  }).sort((a, b) => a.inactiveSince - b.inactiveSince);  // Longest inactive first
}

/**
 * Get the count of currently open tabs.
 * @returns {number}
 */
export function getOpenTabCount() {
  return tabs.size;
}

/**
 * Get the currently active tab instance.
 * @returns {Object|null}
 */
export function getActiveTabInstance() {
  if (activeTabId === null) return null;
  return tabs.get(activeTabId) || null;
}

/**
 * Check if a specific tab is the currently active one.
 * @param {number} tabId
 * @returns {boolean}
 */
export function isActiveTab(tabId) {
  return activeTabId === tabId;
}
