/**
 * Data Schema — default structures for all stored data.
 */

export const SCHEMA_VERSION = 1;

/**
 * Default settings.
 */
export const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,

  // Tracking
  trackingEnabled: true,
  idleThresholdSeconds: 120,        // 2 minutes — pause tracking after this

  // Tab cleanup
  cleanupEnabled: true,
  cleanupThresholdMinutes: 10,      // Suggest cleanup after 10 min inactive
  ignorePinnedTabs: true,
  ignoreProtectedTabs: true,
  ignoreAudibleTabs: true,

  // Protected domains — never suggest closing these
  protectedDomains: [
    'gmail.com',
    'mail.google.com',
    'calendar.google.com',
    'docs.google.com'
  ],

  // UI
  theme: 'dark'
};

/**
 * Create a new TabInstance.
 * @param {Object} tab - Chrome tab object
 * @param {Object} classification - From classifier.classify()
 * @returns {Object}
 */
export function createTabInstance(tab, classification) {
  const now = Date.now();
  return {
    id: `tab-${tab.id}-${now}`,
    browserTabId: tab.id,
    windowId: tab.windowId,

    url: tab.url || '',
    domain: classification.domain,
    hostname: classification.hostname,
    title: tab.title || '',
    favicon: tab.favIconUrl || '',

    categoryId: classification.categoryId,
    category: classification.category,
    pageType: classification.pageType,
    icon: classification.icon,

    createdAt: now,
    lastActivatedAt: now,
    lastDeactivatedAt: null,

    activeTimeToday: 0,      // seconds
    totalActiveTime: 0,      // seconds

    inactiveSince: null,     // timestamp when tab became inactive
    isPinned: tab.pinned || false,
    isProtected: false,
    isAudible: tab.audible || false,
    isClosed: false
  };
}

/**
 * Create a default DailyUsage record.
 * @param {string} date - e.g. "2026-08-17"
 * @returns {Object}
 */
export function createDailyUsage(date) {
  return {
    date,
    totalActiveSeconds: 0,
    websites: {},             // categoryId → seconds
    websiteNames: {},         // categoryId → display name
    websiteIcons: {},         // categoryId → emoji icon
    pageTypes: {},            // categoryId → { pageType: seconds }
    tabsOpened: 0,
    tabsClosed: 0,
    cleanupSuggested: 0,
    cleanupAccepted: 0,
    cleanupRejected: 0,
    peakOpenTabs: 0
  };
}

/**
 * Create a default tab decision history entry.
 * @param {string} domain
 * @param {string} action - 'close' or 'keep'
 * @returns {Object}
 */
export function createTabDecision(domain, action) {
  return {
    domain,
    action,
    timestamp: Date.now()
  };
}
