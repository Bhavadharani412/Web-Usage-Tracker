/**
 * Diagnostics Manager — Local Extension Health Diagnostics & Observability.
 *
 * Maintains a bounded local rolling buffer of at most 100 entries.
 * Calculates health metrics:
 * - Service worker recovery success rate
 * - Storage write latency (p50 & p95)
 * - Runtime error counts without double-counting
 *
 * Privacy Guarantees:
 * - 100% local (stored in chrome.storage.local).
 * - No browsing URLs, page content, page titles, or user data recorded.
 * - Zero external network requests or telemetry.
 */

import { getStorageLocal } from './browser-adapter.js';

export const MAX_BUFFER_SIZE = 100;
export const MAX_LATENCY_SAMPLES = 200;
export const DIAGNOSTICS_STORAGE_KEY = 'wt_diagnostics';

/**
 * Strips URLs, domain names, query strings, and sensitive substrings from strings.
 * @param {string} text
 * @returns {string} Sanitized string
 */
export function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    // Strip full URLs (http, https, chrome-extension, etc.)
    .replace(/(?:https?|ftp|chrome|chrome-extension):\/\/[^\s/$.?#].[^\s]*/gi, '[redacted_url]')
    // Strip common domain patterns like example.com/path
    .replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?/gi, '[redacted_domain]')
    // Clean trailing/excessive whitespace
    .trim();
}

/**
 * Calculate the given percentile (0 - 100) for a numeric array.
 * Uses linear interpolation between closest ranks.
 *
 * @param {number[]} samples
 * @param {number} percentile (e.g. 50 for median, 95 for p95)
 * @returns {number|null} Calculated percentile value, or null if no samples exist.
 */
export function calculatePercentile(samples, percentile) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return null;
  }

  const valid = samples.filter((n) => typeof n === 'number' && !Number.isNaN(n) && n >= 0);
  if (valid.length === 0) {
    return null;
  }

  const sorted = [...valid].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return Number(sorted[0].toFixed(2));
  }

  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return Number(sorted[lower].toFixed(2));
  }

  const interpolated = sorted[lower] * (1 - weight) + sorted[upper] * weight;
  return Number(interpolated.toFixed(2));
}

export class DiagnosticsManager {
  constructor() {
    /** @type {Array<Object>} Rolling event buffer (capped at MAX_BUFFER_SIZE) */
    this.buffer = [];

    /** @type {number[]} Recent storage write latency samples in ms */
    this.writeLatencies = [];

    /** @type {{ totalAttempts: number, successfulRecoveries: number }} */
    this.recoveryStats = {
      totalAttempts: 0,
      successfulRecoveries: 0
    };

    /** @type {number} Consolidated runtime error count */
    this.runtimeErrorCount = 0;

    /** @type {Set<string>} Deduplication cache for error occurrences */
    this._recentErrorKeys = new Set();

    /** @type {boolean} Flag indicating whether state has been loaded from storage */
    this.isInitialized = false;

    /** @type {boolean} Internal reentrancy guard for storage operations */
    this._isPersisting = false;
  }

  /**
   * Initialize and hydrate diagnostics state from chrome.storage.local.
   * Gracefully handles empty, missing, or corrupted stored data.
   */
  async init() {
    if (this.isInitialized) return;

    try {
      const storage = getStorageLocal();
      if (!storage?.get) {
        this.isInitialized = true;
        return;
      }

      const stored = await new Promise((resolve) => {
        try {
          storage.get([DIAGNOSTICS_STORAGE_KEY], (res) => {
            resolve(res?.[DIAGNOSTICS_STORAGE_KEY]);
          });
        } catch {
          resolve(null);
        }
      });

      if (stored && typeof stored === 'object') {
        // Hydrate buffer safely
        if (Array.isArray(stored.buffer)) {
          this.buffer = stored.buffer
            .filter((item) => item && typeof item === 'object' && typeof item.type === 'string')
            .slice(-MAX_BUFFER_SIZE);
        }

        // Hydrate latencies safely
        if (Array.isArray(stored.writeLatencies)) {
          this.writeLatencies = stored.writeLatencies
            .filter((n) => typeof n === 'number' && !Number.isNaN(n) && n >= 0)
            .slice(-MAX_LATENCY_SAMPLES);
        }

        // Hydrate recovery stats safely
        if (stored.recoveryStats && typeof stored.recoveryStats === 'object') {
          const attempts = Number(stored.recoveryStats.totalAttempts) || 0;
          const successes = Number(stored.recoveryStats.successfulRecoveries) || 0;
          this.recoveryStats = {
            totalAttempts: Math.max(0, attempts),
            successfulRecoveries: Math.max(0, Math.min(successes, attempts))
          };
        }

        // Hydrate error count safely
        if (typeof stored.runtimeErrorCount === 'number' && !Number.isNaN(stored.runtimeErrorCount)) {
          this.runtimeErrorCount = Math.max(0, stored.runtimeErrorCount);
        }
      }
    } catch (err) {
      console.warn('[WebTrack] Diagnostics init failed, resetting to clean state:', err);
      this._resetInMemoryState();
    } finally {
      this.isInitialized = true;
    }
  }

  /**
   * Reset in-memory state.
   * @private
   */
  _resetInMemoryState() {
    this.buffer = [];
    this.writeLatencies = [];
    this.recoveryStats = { totalAttempts: 0, successfulRecoveries: 0 };
    this.runtimeErrorCount = 0;
    this._recentErrorKeys.clear();
  }

  /**
   * Persist current diagnostics state to chrome.storage.local safely.
   * Guarded against recursion and failures.
   * @private
   */
  async _persist() {
    if (this._isPersisting) return;
    this._isPersisting = true;

    try {
      const storage = getStorageLocal();
      if (!storage?.set) return;

      const payload = {
        buffer: this.buffer.slice(-MAX_BUFFER_SIZE),
        writeLatencies: this.writeLatencies.slice(-MAX_LATENCY_SAMPLES),
        recoveryStats: { ...this.recoveryStats },
        runtimeErrorCount: this.runtimeErrorCount,
        lastUpdated: Date.now()
      };

      await new Promise((resolve) => {
        try {
          storage.set({ [DIAGNOSTICS_STORAGE_KEY]: payload }, () => resolve());
        } catch {
          resolve();
        }
      });
    } catch {
      // Diagnostic persistence failures must never break the extension
    } finally {
      this._isPersisting = false;
    }
  }

  /**
   * Record a general diagnostic event into the rolling buffer.
   * Enforces buffer cap (max 100 entries) and privacy sanitization.
   *
   * @param {Object} eventData
   * @param {string} eventData.type - Event category
   * @param {string} [eventData.outcome='info'] - 'success' | 'failure' | 'info'
   * @param {number} [eventData.durationMs] - Optional duration
   * @param {string} [eventData.details] - Sanitized details
   * @param {string} [eventData.errorCode] - Sanitized error code
   * @returns {Object} Stored event
   */
  recordEvent(eventData) {
    if (!eventData || typeof eventData !== 'object') {
      return null;
    }

    const type = sanitizeText(String(eventData.type || 'unknown'));
    const outcome = ['success', 'failure', 'info'].includes(eventData.outcome)
      ? eventData.outcome
      : 'info';

    const event = {
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      timestamp: Date.now(),
      outcome,
      details: sanitizeText(eventData.details || ''),
      errorCode: sanitizeText(eventData.errorCode || '')
    };

    if (typeof eventData.durationMs === 'number' && !Number.isNaN(eventData.durationMs)) {
      event.durationMs = Number(eventData.durationMs.toFixed(2));
    }

    this.buffer.push(event);

    // Enforce rolling buffer cap
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }

    // Async persist without blocking caller
    this._persist().catch(() => {});

    return event;
  }

  /**
   * Record a service worker recovery attempt and outcome.
   *
   * @param {boolean} success - Whether recovery succeeded
   * @param {string} [reason=''] - Sanitized reason or status
   */
  recordRecoveryAttempt(success, reason = '') {
    this.recoveryStats.totalAttempts += 1;
    if (success) {
      this.recoveryStats.successfulRecoveries += 1;
    }

    const sanitizedReason = sanitizeText(reason);
    this.recordEvent({
      type: 'sw_recovery',
      outcome: success ? 'success' : 'failure',
      details: sanitizedReason || (success ? 'Session restored cleanly' : 'Recovery failed'),
      errorCode: success ? '' : (sanitizedReason || 'RECOVERY_FAILED')
    });
  }

  /**
   * Record a storage write duration and status.
   *
   * @param {number} durationMs - Duration of storage write in milliseconds
   * @param {boolean} success - Whether storage operation succeeded
   * @param {string} [errorCode=''] - Sanitized error code if failed
   */
  recordStorageWrite(durationMs, success = true, errorCode = '') {
    if (typeof durationMs === 'number' && !Number.isNaN(durationMs) && durationMs >= 0) {
      this.writeLatencies.push(Number(durationMs.toFixed(2)));
      if (this.writeLatencies.length > MAX_LATENCY_SAMPLES) {
        this.writeLatencies.splice(0, this.writeLatencies.length - MAX_LATENCY_SAMPLES);
      }
    }

    if (!success) {
      this.recordEvent({
        type: 'storage_write_error',
        outcome: 'failure',
        durationMs,
        errorCode: sanitizeText(errorCode || 'STORAGE_WRITE_FAILED'),
        details: 'Local storage write encountered an error'
      });
    }
  }

  /**
   * Record a runtime error occurrence without double counting.
   *
   * @param {string} errorCode - Sanitized error code or category
   * @param {string} [details=''] - Sanitized details
   * @param {string} [dedupeKey=''] - Optional key to prevent double counting
   * @returns {boolean} Whether the error was counted (false if deduplicated)
   */
  recordRuntimeError(errorCode, details = '', dedupeKey = '') {
    const sanitizedCode = sanitizeText(errorCode || 'UNKNOWN_ERROR');
    const sanitizedDetails = sanitizeText(details);

    const key = dedupeKey || `${sanitizedCode}:${sanitizedDetails}:${Math.floor(Date.now() / 1000)}`;
    if (this._recentErrorKeys.has(key)) {
      return false; // Skip double counting
    }

    this._recentErrorKeys.add(key);
    // Keep deduplication set bounded
    if (this._recentErrorKeys.size > 200) {
      const firstKey = this._recentErrorKeys.values().next().value;
      this._recentErrorKeys.delete(firstKey);
    }

    this.runtimeErrorCount += 1;

    this.recordEvent({
      type: 'runtime_error',
      outcome: 'failure',
      errorCode: sanitizedCode,
      details: sanitizedDetails || 'Chrome runtime error occurred'
    });

    return true;
  }

  /**
   * Compute aggregated health metrics for reporting and dashboard display.
   *
   * @returns {Object} Health metrics summary
   */
  getHealthMetrics() {
    const { totalAttempts, successfulRecoveries } = this.recoveryStats;

    // Service Worker Recovery Rate calculation
    let recoveryRate = null;
    if (totalAttempts > 0) {
      recoveryRate = Number(((successfulRecoveries / totalAttempts) * 100).toFixed(1));
    }

    // Storage write latency percentiles
    const p50 = calculatePercentile(this.writeLatencies, 50);
    const p95 = calculatePercentile(this.writeLatencies, 95);

    return {
      recovery: {
        rate: recoveryRate,
        successful: successfulRecoveries,
        total: totalAttempts,
        hasData: totalAttempts > 0
      },
      latency: {
        p50,
        p95,
        sampleCount: this.writeLatencies.length,
        hasData: this.writeLatencies.length > 0
      },
      runtimeErrors: {
        count: this.runtimeErrorCount
      },
      buffer: {
        retainedEvents: this.buffer.length,
        capacity: MAX_BUFFER_SIZE
      }
    };
  }

  /**
   * Retrieve recent diagnostic events.
   *
   * @param {number} [limit=50] - Maximum events to return
   * @returns {Array<Object>} List of recent diagnostic events (newest first)
   */
  getRecentEvents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(limit, MAX_BUFFER_SIZE));
    return [...this.buffer].reverse().slice(0, safeLimit);
  }

  /**
   * Clear all locally persisted and in-memory diagnostic history.
   * Resets metrics and rolling buffer to empty state.
   */
  async clearDiagnostics() {
    this._resetInMemoryState();
    await this._persist();

    // Log the reset event as the first entry
    this.recordEvent({
      type: 'diagnostics_cleared',
      outcome: 'info',
      details: 'Diagnostic history cleared by user'
    });
  }
}

// Global Singleton
const diagnostics = new DiagnosticsManager();
export default diagnostics;
