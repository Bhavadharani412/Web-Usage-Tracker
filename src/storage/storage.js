/**
 * Storage Layer — Wrapper around chrome.storage.local and chrome.storage.session.
 *
 * Requirements:
 * - Bounded write coalescing for session and local storage
 * - Deterministic update ordering
 * - Read-your-own-writes dirty caching
 * - Explicit flush behavior (flushPendingWrites)
 * - Safe error recovery with diagnostics recording
 * - Stale checkpoint protection with monotonic version guard
 */

import { DEFAULT_SETTINGS, createDailyUsage, SCHEMA_VERSION } from './schema.js';
import { getDateString } from '../utils/time-format.js';
import { getStorageLocal, getStorageSession, getBrowserAPI } from '../utils/browser-adapter.js';
import diagnostics, { DIAGNOSTICS_STORAGE_KEY } from '../utils/diagnostics.js';

const storageLocal = getStorageLocal();
const storageSession = getStorageSession();

const KEYS = {
  SETTINGS: 'wt_settings',
  DAILY_PREFIX: 'wt_daily_',
  TAB_DECISIONS: 'wt_tab_decisions',
  WEEKLY_STATS: 'wt_weekly_stats'
};

// ─── Storage Write Metrics ─────────────────────────────────

let storageWriteMetrics = {
  localWrites: 0,
  sessionWrites: 0,
  coalescedInactivityUpdates: 0,
  coalescedUsageUpdates: 0
};

/**
 * Get current storage write counts and metrics.
 * @returns {{ localWrites: number, sessionWrites: number, coalescedInactivityUpdates: number, coalescedUsageUpdates: number }}
 */
export function getStorageWriteMetrics() {
  return { ...storageWriteMetrics };
}

/**
 * Reset storage write metrics counter.
 */
export function resetStorageWriteMetrics() {
  storageWriteMetrics = {
    localWrites: 0,
    sessionWrites: 0,
    coalescedInactivityUpdates: 0,
    coalescedUsageUpdates: 0
  };
}

// ─── Basic Local Storage Access ────────────────────────────

/**
 * Get a value from chrome.storage.local.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function get(key) {
  return new Promise((resolve) => {
    if (!storageLocal?.get) {
      resolve(null);
      return;
    }

    storageLocal.get([key], (result) => {
      resolve(result?.[key] ?? null);
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
    if (!storageLocal?.set) {
      resolve();
      return;
    }

    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    storageLocal.set({ [key]: value }, () => {
      storageWriteMetrics.localWrites += 1;
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
      const api = getBrowserAPI();
      const lastError = api?.runtime?.lastError || (typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null);

      if (key !== DIAGNOSTICS_STORAGE_KEY) {
        if (lastError) {
          diagnostics.recordStorageWrite(durationMs, false, lastError.message || 'STORAGE_SET_ERROR');
          diagnostics.recordRuntimeError('STORAGE_ERROR', lastError.message || 'Failed writing to chrome.storage.local', `storage-set-${key}`);
        } else {
          diagnostics.recordStorageWrite(durationMs, true);
        }
      }

      resolve();
    });
  });
}

/**
 * Get multiple values from chrome.storage.local.
 * @param {string[]} keys
 * @returns {Promise<Object>}
 */
async function getMultiple(keys) {
  return new Promise((resolve) => {
    if (!storageLocal?.get) {
      resolve({});
      return;
    }

    storageLocal.get(keys, (result) => {
      resolve(result || {});
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
 * Update daily usage for a specific date with incremental changes.
 * @param {string} dateStr
 * @param {Function} updateFn - Receives current data, should return updated data
 * @returns {Promise<Object>} Updated daily usage
 */
export async function updateDailyUsage(dateStr, updateFn) {
  const current = await getDailyUsage(dateStr);
  const updated = updateFn(current);
  await saveDailyUsage(dateStr, updated);
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

// ─── Bounded Inactivity Write Coalescing (Issue #5) ────────
//
// In-memory dirty buffer coalesces rapid mutations within a bounded
// time window (COALESCE_DEBOUNCE_MS = 150ms, MAX_HOLD_TIME_MS = 800ms).
// Provides read-your-own-writes consistency via dirty overlays.

const SESSION_KEY = 'wt_tab_inactivity';

/** @type {Map<string, number|null>} tabIdStr -> timestampMs (null = deleted) */
const pendingInactivityMutations = new Map();

let inactivityFlushTimeout = null;
let inactivityFirstMutationTime = null;
let isFlushingInactivity = false;
let inactivityFlushPromise = null;

const COALESCE_DEBOUNCE_MS = 150;
const MAX_HOLD_TIME_MS = 800;

/**
 * Get count of currently pending un-flushed inactivity writes.
 * @returns {number}
 */
export function getPendingInactivityCount() {
  return pendingInactivityMutations.size;
}

/**
 * Flush all pending coalesced inactivity writes immediately to chrome.storage.session.
 * Safe flush behavior returning a Promise that resolves when data is persisted.
 * @returns {Promise<void>}
 */
export async function flushPendingInactivityWrites() {
  if (inactivityFlushTimeout) {
    clearTimeout(inactivityFlushTimeout);
    inactivityFlushTimeout = null;
  }
  inactivityFirstMutationTime = null;

  if (pendingInactivityMutations.size === 0) {
    return;
  }

  if (isFlushingInactivity && inactivityFlushPromise) {
    return inactivityFlushPromise;
  }

  isFlushingInactivity = true;
  inactivityFlushPromise = (async () => {
    try {
      const sessionStore = getStorageSession();
      if (!sessionStore?.get || !sessionStore?.set) {
        pendingInactivityMutations.clear();
        return;
      }

      // Snapshot the current pending mutations to apply
      const batchEntries = Array.from(pendingInactivityMutations.entries());

      const result = await new Promise((resolve) => sessionStore.get(SESSION_KEY, resolve));
      const current = { ...(result?.[SESSION_KEY] || {}) };

      // Apply batch mutations
      for (const [tabIdStr, timestampOrNull] of batchEntries) {
        if (timestampOrNull === null) {
          delete current[tabIdStr];
        } else {
          current[tabIdStr] = timestampOrNull;
        }
      }

      const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

      await new Promise((resolve, reject) => {
        sessionStore.set({ [SESSION_KEY]: current }, () => {
          const api = getBrowserAPI();
          const lastError = api?.runtime?.lastError || (typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null);
          if (lastError) {
            reject(new Error(lastError.message || 'SESSION_STORAGE_SET_ERROR'));
          } else {
            resolve();
          }
        });
      });

      storageWriteMetrics.sessionWrites += 1;
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
      diagnostics.recordStorageWrite(durationMs, true);

      // Clean flushed entries from pending map (only if not re-mutated during async set)
      for (const [tabIdStr, timestampOrNull] of batchEntries) {
        if (pendingInactivityMutations.get(tabIdStr) === timestampOrNull) {
          pendingInactivityMutations.delete(tabIdStr);
        }
      }
    } catch (err) {
      // Retain pending mutations on failure for retry
      diagnostics.recordStorageWrite(0, false, err?.message || 'SESSION_FLUSH_ERROR');
      diagnostics.recordRuntimeError('STORAGE_FLUSH_ERROR', err?.message || 'Failed writing coalesced inactivity batch');
      console.warn('[WebTrack] Failed to flush coalesced inactivity batch, retaining pending entries for retry:', err);
    } finally {
      isFlushingInactivity = false;
      inactivityFlushPromise = null;
    }
  })();

  return inactivityFlushPromise;
}

/**
 * Flush all pending coalesced writes across all storage layers.
 * Call this prior to worker suspension, session completion, or teardown.
 * @returns {Promise<void>}
 */
export async function flushPendingWrites() {
  await flushPendingInactivityWrites();
}

/**
 * Schedule a bounded flush for inactivity mutations.
 * Enforces debounce window and hard upper bound on holding time.
 */
function scheduleInactivityFlush() {
  const now = Date.now();
  if (!inactivityFirstMutationTime) {
    inactivityFirstMutationTime = now;
  }

  const elapsedSinceFirst = now - inactivityFirstMutationTime;

  if (inactivityFlushTimeout) {
    clearTimeout(inactivityFlushTimeout);
    inactivityFlushTimeout = null;
  }

  if (elapsedSinceFirst >= MAX_HOLD_TIME_MS) {
    // Hard upper bound reached — force flush immediately
    flushPendingInactivityWrites();
  } else {
    // Coalesce within debounce window, bounded by remaining max hold
    const remainingHold = Math.max(0, MAX_HOLD_TIME_MS - elapsedSinceFirst);
    const delay = Math.min(COALESCE_DEBOUNCE_MS, remainingHold);
    inactivityFlushTimeout = setTimeout(() => {
      inactivityFlushTimeout = null;
      flushPendingInactivityWrites();
    }, delay);
  }
}

/**
 * Get all persisted inactivity timestamps with read-your-own-writes consistency.
 * Merges persisted storage data with in-memory dirty buffer.
 *
 * @returns {Promise<Object>} { [tabId]: timestampMs }
 */
export async function getTabInactivity() {
  const sessionStore = getStorageSession();
  let baseData = {};

  if (sessionStore?.get) {
    const result = await new Promise((resolve) => sessionStore.get(SESSION_KEY, resolve));
    baseData = { ...(result?.[SESSION_KEY] || {}) };
  }

  // Overlay un-flushed in-memory pending mutations (read-your-own-writes guarantee)
  for (const [tabIdStr, val] of pendingInactivityMutations.entries()) {
    if (val === null) {
      delete baseData[tabIdStr];
    } else {
      baseData[tabIdStr] = val;
    }
  }

  return baseData;
}

/**
 * Mark a tab as inactive.
 * Bounded coalesced write.
 * @param {number} tabId
 * @param {number} timestamp
 * @returns {Promise<void>}
 */
export function persistTabInactive(tabId, timestamp) {
  storageWriteMetrics.coalescedInactivityUpdates += 1;
  pendingInactivityMutations.set(String(tabId), timestamp);
  scheduleInactivityFlush();
  return Promise.resolve();
}

/**
 * Remove a tab's inactivity record.
 * Bounded coalesced write.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export function clearTabInactive(tabId) {
  storageWriteMetrics.coalescedInactivityUpdates += 1;
  pendingInactivityMutations.set(String(tabId), null);
  scheduleInactivityFlush();
  return Promise.resolve();
}

/**
 * Remove multiple inactivity records.
 * Bounded coalesced write.
 * @param {number[]} tabIds
 * @returns {Promise<void>}
 */
export function clearTabsInactive(tabIds) {
  storageWriteMetrics.coalescedInactivityUpdates += tabIds.length;
  for (const tabId of tabIds) {
    pendingInactivityMutations.set(String(tabId), null);
  }
  scheduleInactivityFlush();
  return Promise.resolve();
}

// ─── Data Management ───────────────────────────────────────

/**
 * Clear all extension data.
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  // Clear in-memory dirty buffers and timers
  if (inactivityFlushTimeout) {
    clearTimeout(inactivityFlushTimeout);
    inactivityFlushTimeout = null;
  }
  pendingInactivityMutations.clear();
  inactivityFirstMutationTime = null;

  return new Promise((resolve) => {
    const sessionStore = getStorageSession();
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const finish = () => {
      storageWriteMetrics.localWrites += 1;
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
      const api = getBrowserAPI();
      const lastError = api?.runtime?.lastError || (typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null);
      if (lastError) {
        diagnostics.recordStorageWrite(durationMs, false, lastError.message || 'STORAGE_CLEAR_ERROR');
      } else {
        diagnostics.recordStorageWrite(durationMs, true);
      }
      resolve();
    };

    if (!storageLocal?.clear) {
      if (sessionStore?.remove) {
        sessionStore.remove(SESSION_KEY, finish);
      } else {
        finish();
      }
      return;
    }

    storageLocal.clear(() => {
      if (sessionStore?.remove) {
        sessionStore.remove(SESSION_KEY, finish);
      } else {
        finish();
      }
    });
  });
}

/**
 * Get approximate storage usage in bytes.
 * @returns {Promise<number>}
 */
export async function getStorageUsage() {
  return new Promise((resolve) => {
    if (!storageLocal?.getBytesInUse) {
      resolve(0);
      return;
    }

    storageLocal.getBytesInUse(null, (bytes) => {
      resolve(bytes || 0);
    });
  });
}

// ─── Active Session Checkpointing ─────────────────────────

const ACTIVE_SESSION_KEY = 'wt_active_session';
let lastAcknowledgedCheckpointVersion = 0;

/**
 * Get current acknowledged checkpoint version (for tests).
 * @returns {number}
 */
export function getLastAcknowledgedCheckpointVersion() {
  return lastAcknowledgedCheckpointVersion;
}

/**
 * Reset checkpoint version guard (for tests).
 */
export function resetCheckpointVersionGuard() {
  lastAcknowledgedCheckpointVersion = 0;
}

/**
 * Get checkpointed active session state from session storage.
 * @returns {Promise<Object|null>}
 */
export async function getActiveSessionCheckpoint() {
  const sessionStore = getStorageSession();
  if (!sessionStore?.get) return null;
  return new Promise((resolve) => {
    sessionStore.get(ACTIVE_SESSION_KEY, (result) => {
      resolve(result?.[ACTIVE_SESSION_KEY] ?? null);
    });
  });
}

/**
 * Persist active session checkpoint to session storage.
 * Enforces monotonic version check to reject stale checkpoint overwrites.
 * @param {Object} checkpoint - { version, state, currentSession, pausedAt, timestamp }
 * @returns {Promise<void>}
 */
export async function persistActiveSessionCheckpoint(checkpoint) {
  const sessionStore = getStorageSession();
  if (!sessionStore?.set) return;

  if (checkpoint && typeof checkpoint.version === 'number') {
    if (checkpoint.version < lastAcknowledgedCheckpointVersion) {
      diagnostics.recordEvent({
        type: 'stale_checkpoint_rejected',
        outcome: 'warning',
        durationMs: 0,
        details: `Rejected stale checkpoint version ${checkpoint.version} (last acknowledged: ${lastAcknowledgedCheckpointVersion})`
      });
      return;
    }
    lastAcknowledgedCheckpointVersion = checkpoint.version;
  }

  return new Promise((resolve) => {
    sessionStore.set({ [ACTIVE_SESSION_KEY]: checkpoint }, () => {
      storageWriteMetrics.sessionWrites += 1;
      resolve();
    });
  });
}

/**
 * Clear checkpointed active session from session storage.
 * @returns {Promise<void>}
 */
export async function clearActiveSessionCheckpoint() {
  const sessionStore = getStorageSession();
  lastAcknowledgedCheckpointVersion = 0;
  if (!sessionStore?.remove && !sessionStore?.set) return;
  return new Promise((resolve) => {
    if (sessionStore.remove) {
      sessionStore.remove(ACTIVE_SESSION_KEY, () => {
        storageWriteMetrics.sessionWrites += 1;
        resolve();
      });
    } else {
      sessionStore.set({ [ACTIVE_SESSION_KEY]: null }, () => {
        storageWriteMetrics.sessionWrites += 1;
        resolve();
      });
    }
  });
}
