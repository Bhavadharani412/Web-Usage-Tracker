/**
 * Storage Layer — wrapper around chrome.storage.local.
 * All persistent data flows through this module.
 */

import { DEFAULT_SETTINGS, createDailyUsage, SCHEMA_VERSION } from './schema.js';
import { getDateString } from '../utils/time-format.js';

const KEYS = {
  SETTINGS: 'wt_settings',
  DAILY_PREFIX: 'wt_daily_',
  TAB_DECISIONS: 'wt_tab_decisions',
  WEEKLY_STATS: 'wt_weekly_stats'
};

/**
 * Get a value from chrome.storage.local.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function get(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] || null);
    });
  });
}

/**
 * Set a value in chrome.storage.local.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
async function set(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

/**
 * Get multiple values from chrome.storage.local.
 * @param {string[]} keys
 * @returns {Promise<Object>}
 */
async function getMultiple(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result);
    });
  });
}

// ─── Settings ──────────────────────────────────────────────

/**
 * Get user settings, merged with defaults.
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const stored = await get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Save user settings (partial update).
 * @param {Object} updates
 * @returns {Promise<void>}
 */
export async function saveSettings(updates) {
  const current = await getSettings();
  const merged = { ...current, ...updates, schemaVersion: SCHEMA_VERSION };
  await set(KEYS.SETTINGS, merged);
}

// ─── Daily Usage ───────────────────────────────────────────

/**
 * Get daily usage for a specific date.
 * @param {string} [dateStr] - e.g. "2026-08-17", defaults to today
 * @returns {Promise<Object>}
 */
export async function getDailyUsage(dateStr) {
  const date = dateStr || getDateString();
  const key = KEYS.DAILY_PREFIX + date;
  const stored = await get(key);
  return stored || createDailyUsage(date);
}

/**
 * Save daily usage for a specific date.
 * @param {string} dateStr
 * @param {Object} data
 * @returns {Promise<void>}
 */
export async function saveDailyUsage(dateStr, data) {
  const key = KEYS.DAILY_PREFIX + dateStr;
  await set(key, data);
}

/**
 * Update daily usage for today with incremental changes.
 * @param {Function} updateFn - Receives current data, should return updated data
 * @returns {Promise<Object>} Updated daily usage
 */
export async function updateTodayUsage(updateFn) {
  const today = getDateString();
  const current = await getDailyUsage(today);
  const updated = updateFn(current);
  await saveDailyUsage(today, updated);
  return updated;
}

/**
 * Get daily usage for a range of dates.
 * @param {string[]} dates - Array of date strings
 * @returns {Promise<Object[]>}
 */
export async function getMultipleDailyUsage(dates) {
  const keys = dates.map(d => KEYS.DAILY_PREFIX + d);
  const result = await getMultiple(keys);

  return dates.map(d => {
    const key = KEYS.DAILY_PREFIX + d;
    return result[key] || createDailyUsage(d);
  });
}

// ─── Tab Decisions ─────────────────────────────────────────

/**
 * Get tab cleanup decision history.
 * @returns {Promise<Object[]>}
 */
export async function getTabDecisions() {
  const stored = await get(KEYS.TAB_DECISIONS);
  return stored || [];
}

/**
 * Record a tab cleanup decision.
 * @param {Object} decision - { domain, action, timestamp }
 * @returns {Promise<void>}
 */
export async function recordTabDecision(decision) {
  const decisions = await getTabDecisions();
  decisions.push(decision);

  // Keep only last 500 decisions to prevent unbounded growth
  const trimmed = decisions.slice(-500);
  await set(KEYS.TAB_DECISIONS, trimmed);
}

/**
 * Get decision stats for a domain.
 * @param {string} domain
 * @returns {Promise<{ keepCount: number, closeCount: number, total: number }>}
 */
export async function getDomainDecisionStats(domain) {
  const decisions = await getTabDecisions();
  const domainDecisions = decisions.filter(d => d.domain === domain);

  return {
    keepCount: domainDecisions.filter(d => d.action === 'keep').length,
    closeCount: domainDecisions.filter(d => d.action === 'close').length,
    total: domainDecisions.length
  };
}

// ─── Weekly Stats ──────────────────────────────────────────

/**
 * Get weekly stats (tab hygiene metrics).
 * @returns {Promise<Object>}
 */
export async function getWeeklyStats() {
  const stored = await get(KEYS.WEEKLY_STATS);
  return stored || {
    totalSuggested: 0,
    totalAccepted: 0,
    totalRejected: 0,
    peakOpenTabs: 0,
    avgOpenTabs: 0,
    longestInactiveSeconds: 0
  };
}

/**
 * Update weekly stats.
 * @param {Object} updates
 * @returns {Promise<void>}
 */
export async function updateWeeklyStats(updates) {
  const current = await getWeeklyStats();
  await set(KEYS.WEEKLY_STATS, { ...current, ...updates });
}

// ─── Tab Inactivity Persistence ────────────────────────────
// chrome.storage.session survives Manifest V3 service-worker restarts
// during the current browser session.
//
// The queue is important: without it, two simultaneous operations can do:
//
// get old data
// modify separately
// save separately
//
// causing one tab's inactivity data to overwrite another's.

const SESSION_KEY = 'wt_tab_inactivity';

let inactivityWriteQueue = Promise.resolve();

/**
 * Serialize changes to the inactivity map.
 */
function enqueueInactivityMutation(mutator) {
  inactivityWriteQueue = inactivityWriteQueue.then(async () => {
    const result = await chrome.storage.session.get(SESSION_KEY);

    const current = {
      ...(result[SESSION_KEY] || {})
    };

    mutator(current);

    await chrome.storage.session.set({
      [SESSION_KEY]: current
    });
  });

  return inactivityWriteQueue;
}

/**
 * Get all persisted inactivity timestamps.
 *
 * @returns {Promise<Object>}
 * { [tabId]: timestampMs }
 */
export async function getTabInactivity() {
  const result = await chrome.storage.session.get(SESSION_KEY);

  return result[SESSION_KEY] || {};
}

/**
 * Mark a tab as inactive.
 *
 * @param {number} tabId
 * @param {number} timestamp
 */
export function persistTabInactive(tabId, timestamp) {
  return enqueueInactivityMutation((current) => {
    current[String(tabId)] = timestamp;
  });
}

/**
 * Remove a tab's inactivity record.
 *
 * @param {number} tabId
 */
export function clearTabInactive(tabId) {
  return enqueueInactivityMutation((current) => {
    delete current[String(tabId)];
  });
}

/**
 * Remove multiple inactivity records.
 *
 * @param {number[]} tabIds
 */
export function clearTabsInactive(tabIds) {
  return enqueueInactivityMutation((current) => {
    for (const tabId of tabIds) {
      delete current[String(tabId)];
    }
  });
}

// ─── Data Management ───────────────────────────────────────

/**
 * Clear all extension data.
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  return new Promise((resolve) => {
    chrome.storage.local.clear(() => {
      // Also clear session-stored inactivity timestamps
      chrome.storage.session.remove(SESSION_KEY, resolve);
    });
  });
}

/**
 * Get approximate storage usage in bytes.
 * @returns {Promise<number>}
 */
export async function getStorageUsage() {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      resolve(bytes);
    });
  });
}
