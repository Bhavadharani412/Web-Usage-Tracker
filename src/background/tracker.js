/**
 * Session Tracker — state machine for tracking active usage time.
 *
 * States: INACTIVE → TRACKING → PAUSED → TRACKING
 *
 * Uses event timestamps (not running timers) to calculate duration.
 * Sessions are flush-on-end: active time is computed and stored
 * when a session ends rather than ticking every second.
 */

import { getDateString } from '../utils/time-format.js';
import { updateTodayUsage } from '../storage/storage.js';

/** @enum {string} */
export const TrackingState = {
  INACTIVE: 'INACTIVE',
  TRACKING: 'TRACKING',
  PAUSED: 'PAUSED'
};

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
 */

class Tracker {
  constructor() {
    /** @type {TrackingState} */
    this.state = TrackingState.INACTIVE;

    /** @type {Session|null} */
    this.currentSession = null;

    /** @type {number|null} - Timestamp when tracking was last paused */
    this.pausedAt = null;
  }

  /**
   * Start tracking a new tab.
   * @param {number} tabId
   * @param {Object} classification - From classifier.classify()
   */
  startSession(tabId, classification) {
    // End any existing session first
    if (this.currentSession) {
      this.endSession();
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
      startDate: getDateString()
    };

    this.state = TrackingState.TRACKING;
    this.pausedAt = null;
  }

  /**
   * End the current session and flush accumulated time to storage.
   * @returns {Promise<number>} Seconds tracked in this session
   */
  async endSession() {
    if (!this.currentSession) return 0;

    // Calculate final active time
    const activeSeconds = this._calculateActiveTime();
    const session = this.currentSession;

    // Reset state
    this.currentSession = null;
    this.state = TrackingState.INACTIVE;
    this.pausedAt = null;

    // Flush to storage if there was meaningful time
    if (activeSeconds >= 1 && session.categoryId && session.categoryId !== 'browser' && session.categoryId !== 'unknown') {
      await this._flushToStorage(session, activeSeconds);
    }

    return activeSeconds;
  }

  /**
   * Pause tracking (e.g., user idle, window lost focus).
   */
  pause() {
    if (this.state !== TrackingState.TRACKING || !this.currentSession) return;

    const now = Date.now();

    // Accumulate time up to pause point
    const elapsed = Math.floor((now - this.currentSession.startTime) / 1000);
    this.currentSession.accumulatedSeconds += elapsed;

    this.pausedAt = now;
    this.state = TrackingState.PAUSED;
  }

  /**
   * Resume tracking after pause.
   */
  resume() {
    if (this.state !== TrackingState.PAUSED || !this.currentSession) return;

    // Reset start time to now (we already accumulated pre-pause time)
    this.currentSession.startTime = Date.now();
    this.state = TrackingState.TRACKING;
    this.pausedAt = null;
  }

  /**
   * Get the current tracking state info.
   * @returns {{ state: TrackingState, tabId: number|null, activeSeconds: number, category: string|null }}
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

    let total = this.currentSession.accumulatedSeconds;

    // If currently tracking (not paused), add elapsed time since last start
    if (this.state === TrackingState.TRACKING) {
      const elapsed = Math.floor((Date.now() - this.currentSession.startTime) / 1000);
      total += elapsed;
    }

    return total;
  }

  /**
   * Flush session time to daily storage.
   * @param {Session} session
   * @param {number} activeSeconds
   * @private
   */
  async _flushToStorage(session, activeSeconds) {
    const today = getDateString();

    // If the session started on a different day, split time
    // For simplicity in MVP, assign all time to today
    await updateTodayUsage((daily) => {
      daily.totalActiveSeconds += activeSeconds;

      // Add to website total
      if (!daily.websites[session.categoryId]) {
        daily.websites[session.categoryId] = 0;
      }
      daily.websites[session.categoryId] += activeSeconds;

      // Store display name and icon
      daily.websiteNames[session.categoryId] = session.category;
      daily.websiteIcons[session.categoryId] = session.icon;

      // Add to page type breakdown
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

// Singleton
const tracker = new Tracker();
export default tracker;
