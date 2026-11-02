/**
 * Session Tracker — Deterministic state machine for tracking active usage time.
 *
 * States: INACTIVE ⇄ TRACKING ⇄ PAUSED
 *
 * Requirements:
 * - Deterministic state machine with explicit transitions
 * - Serialized event queue for concurrency safety
 * - Idempotent event handling (duplicate session prevention)
 * - Monotonic checkpoint versioning & stale write protection
 * - Safe service-worker recovery with tab liveness check
 * - Midnight session splitting for calendar-day accuracy
 */

import { getDateString, splitSessionSegmentsByDay, splitSegmentByDay } from '../utils/time-format.js';
import {
  updateDailyUsage,
  getActiveSessionCheckpoint,
  persistActiveSessionCheckpoint,
  clearActiveSessionCheckpoint
} from '../storage/storage.js';
import diagnostics from '../utils/diagnostics.js';

/** @enum {string} */
export const TrackingState = {
  INACTIVE: 'INACTIVE',
  TRACKING: 'TRACKING',
  PAUSED: 'PAUSED'
};

/**
 * Valid state transitions table.
 * @type {Record<TrackingState, TrackingState[]>}
 */
export const VALID_TRANSITIONS = {
  [TrackingState.INACTIVE]: [TrackingState.TRACKING],
  [TrackingState.TRACKING]: [TrackingState.PAUSED, TrackingState.INACTIVE, TrackingState.TRACKING],
  [TrackingState.PAUSED]: [TrackingState.TRACKING, TrackingState.INACTIVE]
};

/**
 * @typedef {Object} SessionSegment
 * @property {number} start - Timestamp in ms
 * @property {number} end - Timestamp in ms
 */

/**
 * @typedef {Object} Session
 * @property {number} tabId - Browser tab ID
 * @property {string} categoryId - Website category ID
 * @property {string} category - Display name
 * @property {string} icon - Emoji icon
 * @property {string} pageType - Page type
 * @property {string} domain - Domain
 * @property {number} startTime - Timestamp when tracking started
 * @property {number} accumulatedSeconds - Seconds accumulated in this session
 * @property {string} startDate - Date string when session started
 * @property {SessionSegment[]} segments - Continuous active intervals
 * @property {SessionSegment[]} [allSegments] - Final segments on flush
 */

export class Tracker {
  constructor() {
    /** @type {TrackingState} */
    this.state = TrackingState.INACTIVE;

    /** @type {Session|null} */
    this.currentSession = null;

    /** @type {number|null} - Timestamp when tracking was last paused */
    this.pausedAt = null;

    /** @type {boolean} */
    this.isInitialized = false;

    /** @type {number} Monotonically increasing checkpoint version */
    this.checkpointVersion = 0;

    /** @type {Promise<any>} FIFO serialized execution queue */
    this._queue = Promise.resolve();
  }

  /**
   * Enqueue an operation onto the serialized promise chain.
   * Guarantees all state transitions execute sequentially without concurrency races.
   * @template T
   * @param {() => Promise<T>|T} operation
   * @returns {Promise<T>}
   * @private
   */
  _enqueue(operation) {
    const next = this._queue.then(async () => {
      return await operation();
    });

    // Keep queue alive even if an individual operation rejects
    this._queue = next.catch((err) => {
      diagnostics.recordRuntimeError('TRACKER_QUEUE_ERROR', err?.message || 'Tracker operation failed');
      console.error('[WebTrack] Tracker queue operation error:', err);
    });

    return next;
  }

  /**
   * Validate state transition against the valid transitions table.
   * @param {TrackingState} fromState
   * @param {TrackingState} toState
   * @returns {boolean}
   * @private
   */
  _validateTransition(fromState, toState) {
    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed || !allowed.includes(toState)) {
      const msg = `Illegal state transition attempted: ${fromState} -> ${toState}`;
      diagnostics.recordRuntimeError('INVALID_STATE_TRANSITION', msg);
      console.warn(`[WebTrack] ${msg}`);
      return false;
    }
    return true;
  }

  /**
   * Initialize tracker — restore active session checkpoint if service worker was suspended.
   * Serialized via operation queue.
   * @returns {Promise<void>}
   */
  async init() {
    return this._enqueue(async () => {
      if (this.isInitialized) return;

      try {
        const checkpoint = await getActiveSessionCheckpoint();
        if (checkpoint && checkpoint.currentSession && checkpoint.state) {
          if (typeof checkpoint.version === 'number' && checkpoint.version > this.checkpointVersion) {
            this.checkpointVersion = checkpoint.version;
          }

          this.currentSession = checkpoint.currentSession;
          this.state = checkpoint.state;
          this.pausedAt = checkpoint.pausedAt || null;

          // Verify if the tab is still open/valid in browser
          let isTabLive = false;
          if (typeof chrome !== 'undefined' && chrome.tabs?.get && this.currentSession.tabId) {
            try {
              const tab = await new Promise((resolve) => {
                chrome.tabs.get(this.currentSession.tabId, (t) => {
                  if (chrome.runtime?.lastError) resolve(null);
                  else resolve(t);
                });
              });
              if (tab) {
                isTabLive = true;
              }
            } catch {
              isTabLive = false;
            }
          } else {
            isTabLive = true;
          }

          if (!isTabLive) {
            // Tab closed during worker suspension -> end session cleanly
            diagnostics.recordRecoveryAttempt(false, 'Tab closed during worker suspension');
            await this._endSessionInternal();
          } else {
            diagnostics.recordRecoveryAttempt(true, 'Active session restored from checkpoint');
            console.log('[WebTrack] Active session restored from checkpoint for tab:', this.currentSession.tabId);
          }
        }
        this.isInitialized = true;
      } catch (e) {
        diagnostics.recordRecoveryAttempt(false, 'Failed to restore active session checkpoint');
        diagnostics.recordRuntimeError('SW_RECOVERY_ERROR', e?.message || 'Checkpoint recovery failed');
        console.error('[WebTrack] Failed to restore active session checkpoint:', e);
        this.isInitialized = true;
      }
    });
  }

  /**
   * Start tracking a new tab.
   * Serialized and idempotent: duplicate activations for the same active tab/category are ignored.
   * Ensures at most one valid active tracking session exists at any given time.
   * @param {number} tabId
   * @param {Object} classification - From classifier.classify()
   * @returns {Promise<void>}
   */
  async startSession(tabId, classification) {
    return this._enqueue(async () => {
      // 1. Idempotency Check:
      // If already tracking this exact tab and category, ignore redundant start event
      if (
        this.state === TrackingState.TRACKING &&
        this.currentSession &&
        this.currentSession.tabId === tabId &&
        this.currentSession.categoryId === classification.categoryId
      ) {
        return;
      }

      // If paused on the same tab and category, simply resume
      if (
        this.state === TrackingState.PAUSED &&
        this.currentSession &&
        this.currentSession.tabId === tabId &&
        this.currentSession.categoryId === classification.categoryId
      ) {
        await this._resumeInternal();
        return;
      }

      // 2. Validate transition
      if (!this._validateTransition(this.state, TrackingState.TRACKING)) {
        return;
      }

      // 3. End any existing active or paused session before starting a new one
      if (this.currentSession) {
        await this._endSessionInternal();
      }

      const now = Date.now();
      this.currentSession = {
        tabId,
        categoryId: classification.categoryId,
        category: classification.category,
        icon: classification.icon,
        pageType: classification.pageType,
        domain: classification.domain,
        startTime: now,
        accumulatedSeconds: 0,
        startDate: getDateString(),
        segments: []
      };

      this.state = TrackingState.TRACKING;
      this.pausedAt = null;

      await this._persistCheckpoint();
    });
  }

  /**
   * End the current session and flush accumulated time to storage (splitting across midnight if needed).
   * Serialized via operation queue.
   * @returns {Promise<number>} Seconds tracked in this session
   */
  async endSession() {
    return this._enqueue(async () => {
      return await this._endSessionInternal();
    });
  }

  /**
   * Internal implementation of session termination.
   * @returns {Promise<number>}
   * @private
   */
  async _endSessionInternal() {
    if (!this.currentSession) {
      this.state = TrackingState.INACTIVE;
      this.pausedAt = null;
      return 0;
    }

    if (!this._validateTransition(this.state, TrackingState.INACTIVE)) {
      return 0;
    }

    const session = this.currentSession;
    const activeSeconds = this._calculateActiveTime();

    // Gather all active segments
    const allSegments = [...(session.segments || [])];
    if (this.state === TrackingState.TRACKING && session.startTime) {
      const now = Date.now();
      if (now > session.startTime) {
        allSegments.push({ start: session.startTime, end: now });
      }
    }
    session.allSegments = allSegments;

    // Reset state & clear session storage checkpoint
    this.currentSession = null;
    this.state = TrackingState.INACTIVE;
    this.pausedAt = null;

    await this._persistCheckpoint();

    // Flush to storage if there was meaningful active time
    if (activeSeconds >= 1 && session.categoryId && session.categoryId !== 'browser' && session.categoryId !== 'unknown') {
      await this._flushToStorage(session, activeSeconds);
    }

    return activeSeconds;
  }

  /**
   * Pause tracking (e.g. user idle, window lost focus).
   * Serialized and idempotent: duplicate pause while already paused is safely ignored.
   * @returns {Promise<void>}
   */
  async pause() {
    return this._enqueue(async () => {
      // Idempotent: already paused
      if (this.state === TrackingState.PAUSED) {
        return;
      }

      if (this.state !== TrackingState.TRACKING || !this.currentSession) {
        // Safe rejection for illegal transition (e.g. INACTIVE -> PAUSED)
        this._validateTransition(this.state, TrackingState.PAUSED);
        return;
      }

      const now = Date.now();
      const elapsed = Math.max(0, Math.floor((now - this.currentSession.startTime) / 1000));
      this.currentSession.accumulatedSeconds += elapsed;

      if (!this.currentSession.segments) {
        this.currentSession.segments = [];
      }
      this.currentSession.segments.push({ start: this.currentSession.startTime, end: now });

      this.pausedAt = now;
      this.state = TrackingState.PAUSED;

      await this._persistCheckpoint();
    });
  }

  /**
   * Resume tracking after pause.
   * Serialized and idempotent: duplicate resume while already tracking is safely ignored.
   * @returns {Promise<void>}
   */
  async resume() {
    return this._enqueue(async () => {
      await this._resumeInternal();
    });
  }

  /**
   * Internal resume implementation.
   * @private
   */
  async _resumeInternal() {
    // Idempotent: already tracking
    if (this.state === TrackingState.TRACKING) {
      return;
    }

    if (this.state !== TrackingState.PAUSED || !this.currentSession) {
      // Safe rejection for illegal transition (e.g. INACTIVE -> TRACKING via resume)
      this._validateTransition(this.state, TrackingState.TRACKING);
      return;
    }

    this.currentSession.startTime = Date.now();
    this.state = TrackingState.TRACKING;
    this.pausedAt = null;

    await this._persistCheckpoint();
  }

  /**
   * Get the current tracking state info.
   * Synchronous inspection.
   * @returns {{ state: TrackingState, tabId: number|null, activeSeconds: number, category: string|null, categoryId: string|null, icon: string|null, version: number }}
   */
  getStatus() {
    return {
      state: this.state,
      tabId: this.currentSession?.tabId || null,
      activeSeconds: this._calculateActiveTime(),
      category: this.currentSession?.category || null,
      categoryId: this.currentSession?.categoryId || null,
      icon: this.currentSession?.icon || null,
      version: this.checkpointVersion
    };
  }

  /**
   * Check if there is an active tracking session.
   * Ensures at most 1 active session exists.
   * @returns {number} 1 if tracking, 0 otherwise
   */
  getActiveSessionCount() {
    return this.state === TrackingState.TRACKING && this.currentSession ? 1 : 0;
  }

  /**
   * Calculate total active seconds for the current session.
   * @returns {number}
   * @private
   */
  _calculateActiveTime() {
    if (!this.currentSession) return 0;

    let total = this.currentSession.accumulatedSeconds || 0;

    if (this.state === TrackingState.TRACKING && this.currentSession.startTime) {
      const elapsed = Math.max(0, Math.floor((Date.now() - this.currentSession.startTime) / 1000));
      total += elapsed;
    }

    return total;
  }

  /**
   * Persist state machine checkpoint with monotonic version incrementing.
   * Prevents stale checkpoint overwrites.
   * @private
   */
  async _persistCheckpoint() {
    this.checkpointVersion += 1;

    if (this.state === TrackingState.INACTIVE || !this.currentSession) {
      await clearActiveSessionCheckpoint();
    } else {
      await persistActiveSessionCheckpoint({
        version: this.checkpointVersion,
        state: this.state,
        currentSession: this.currentSession,
        pausedAt: this.pausedAt,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Flush session time to storage, splitting time correctly per calendar day.
   * @param {Session & { allSegments?: SessionSegment[] }} session
   * @param {number} fallbackTotalSeconds
   * @private
   */
  async _flushToStorage(session, fallbackTotalSeconds = 0) {
    let daySplits = splitSessionSegmentsByDay(session.allSegments || []);

    // Fallback if no segments present
    if (Object.keys(daySplits).length === 0 && fallbackTotalSeconds >= 1) {
      const startMs = session.startTime || Date.now();
      const endMs = startMs + fallbackTotalSeconds * 1000;
      daySplits = splitSegmentByDay(startMs, endMs);
    }

    // Flush allocated seconds to each corresponding day
    for (const [dateStr, activeSeconds] of Object.entries(daySplits)) {
      if (activeSeconds < 1) continue;

      await updateDailyUsage(dateStr, (daily) => {
        daily.totalActiveSeconds += activeSeconds;

        if (!daily.websites[session.categoryId]) {
          daily.websites[session.categoryId] = 0;
        }
        daily.websites[session.categoryId] += activeSeconds;

        daily.websiteNames[session.categoryId] = session.category;
        daily.websiteIcons[session.categoryId] = session.icon;

        if (!daily.pageTypes[session.categoryId]) {
          daily.pageTypes[session.categoryId] = {};
        }
        if (!daily.pageTypes[session.categoryId][session.pageType]) {
          daily.pageTypes[session.categoryId][session.pageType] = 0;
        }
        daily.pageTypes[session.categoryId][session.pageType] += activeSeconds;

        return daily;
      });
    }
  }
}

// Singleton
const tracker = new Tracker();
export default tracker;
