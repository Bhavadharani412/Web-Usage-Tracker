/**
 * Session Tracker — state machine for tracking active usage time.
 *
 * States: INACTIVE → TRACKING → PAUSED → TRACKING
 *
 * Uses event timestamps (not running timers) to calculate duration.
 * Sessions are flush-on-end: active time is computed and stored
 * when a session ends. Active session state is checkpointed to storage
 * on every state change to survive service worker suspension.
 */

import { getDateString, splitSessionSegmentsByDay, splitSegmentByDay } from '../utils/time-format.js';
import { updateDailyUsage, getActiveSessionCheckpoint, persistActiveSessionCheckpoint, clearActiveSessionCheckpoint } from '../storage/storage.js';

/** @enum {string} */
export const TrackingState = {
  INACTIVE: 'INACTIVE',
  TRACKING: 'TRACKING',
  PAUSED: 'PAUSED'
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
 */

class Tracker {
  constructor() {
    /** @type {TrackingState} */
    this.state = TrackingState.INACTIVE;

    /** @type {Session|null} */
    this.currentSession = null;

    /** @type {number|null} - Timestamp when tracking was last paused */
    this.pausedAt = null;

    /** @type {boolean} */
    this.isInitialized = false;
  }

  /**
   * Initialize tracker — restore active session checkpoint if service worker was suspended.
   */
  async init() {
    if (this.isInitialized) return;
    try {
      const checkpoint = await getActiveSessionCheckpoint();
      if (checkpoint && checkpoint.currentSession && checkpoint.state) {
        this.currentSession = checkpoint.currentSession;
        this.state = checkpoint.state;
        this.pausedAt = checkpoint.pausedAt || null;

        // Verify if the tab is still open/valid
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
          await this.endSession();
        } else {
          console.log('[WebTrack] Active session restored from checkpoint for tab:', this.currentSession.tabId);
        }
      }
      this.isInitialized = true;
    } catch (e) {
      console.error('[WebTrack] Failed to restore active session checkpoint:', e);
    }
  }

  /**
   * Start tracking a new tab.
   * @param {number} tabId
   * @param {Object} classification - From classifier.classify()
   */
  async startSession(tabId, classification) {
    // End any existing session first
    if (this.currentSession) {
      await this.endSession();
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
  }

  /**
   * End the current session and flush accumulated time to storage (splitting across midnight if needed).
   * @returns {Promise<number>} Seconds tracked in this session
   */
  async endSession() {
    if (!this.currentSession) return 0;

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

    await clearActiveSessionCheckpoint();

    // Flush to storage if there was meaningful active time
    if (activeSeconds >= 1 && session.categoryId && session.categoryId !== 'browser' && session.categoryId !== 'unknown') {
      await this._flushToStorage(session, activeSeconds);
    }

    return activeSeconds;
  }

  /**
   * Pause tracking (e.g., user idle, window lost focus).
   */
  async pause() {
    if (this.state !== TrackingState.TRACKING || !this.currentSession) return;

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
  }

  /**
   * Resume tracking after pause.
   */
  async resume() {
    if (this.state !== TrackingState.PAUSED || !this.currentSession) return;

    this.currentSession.startTime = Date.now();
    this.state = TrackingState.TRACKING;
    this.pausedAt = null;

    await this._persistCheckpoint();
  }

  /**
   * Get the current tracking state info.
   * @returns {{ state: TrackingState, tabId: number|null, activeSeconds: number, category: string|null, categoryId: string|null, icon: string|null }}
   */
  getStatus() {
    return {
      state: this.state,
      tabId: this.currentSession?.tabId || null,
      activeSeconds: this._calculateActiveTime(),
      category: this.currentSession?.category || null,
      categoryId: this.currentSession?.categoryId || null,
      icon: this.currentSession?.icon || null
    };
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
   * Persist state machine checkpoint.
   * @private
   */
  async _persistCheckpoint() {
    if (this.state === TrackingState.INACTIVE || !this.currentSession) {
      await clearActiveSessionCheckpoint();
    } else {
      await persistActiveSessionCheckpoint({
        state: this.state,
        currentSession: this.currentSession,
        pausedAt: this.pausedAt
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
      const endMs = startMs + (fallbackTotalSeconds * 1000);
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
