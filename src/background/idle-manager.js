/**
 * Idle Manager — monitors user idle/active/locked state.
 *
 * Uses chrome.idle API with a configurable threshold (default 2 min).
 * Notifies tab-manager of state changes to pause/resume tracking.
 */

import { getSettings } from '../storage/storage.js';

/** @type {number} Current idle threshold in seconds */
let currentThreshold = 120; // 2 minutes default

/**
 * Initialize idle detection.
 */
export async function init() {
  const settings = await getSettings();
  currentThreshold = settings.idleThresholdSeconds || 120;

  // Set the idle detection interval
  chrome.idle.setDetectionInterval(currentThreshold);
}

/**
 * Update the idle threshold (e.g., when user changes settings).
 * @param {number} thresholdSeconds
 */
export function setThreshold(thresholdSeconds) {
  currentThreshold = thresholdSeconds;
  chrome.idle.setDetectionInterval(thresholdSeconds);
}

/**
 * Query the current idle state.
 * @returns {Promise<string>} 'active', 'idle', or 'locked'
 */
export async function queryState() {
  return new Promise((resolve) => {
    chrome.idle.queryState(currentThreshold, (state) => {
      resolve(state);
    });
  });
}

/**
 * Get current threshold.
 * @returns {number}
 */
export function getThreshold() {
  return currentThreshold;
}
