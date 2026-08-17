/**
 * Cleanup Suggestions Engine — identifies inactive tabs for cleanup.
 *
 * Applies filtering (protected, pinned, audible), user decision history
 * for lightweight learning, and ranks candidates by inactivity duration.
 */

/**
 * Send a message to the background service worker.
 * @param {Object} message
 * @returns {Promise<Object>}
 */
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

/**
 * Get cleanup candidates from the background.
 * @returns {Promise<Object[]>}
 */
export async function getCleanupCandidates() {
  const response = await sendMessage({ type: 'GET_INACTIVE_TABS' });
  if (response?.success) {
    return response.data || [];
  }
  return [];
}

/**
 * Close selected tabs.
 * @param {number[]} tabIds
 * @returns {Promise<boolean>}
 */
export async function closeTabs(tabIds) {
  const response = await sendMessage({ type: 'CLOSE_TABS', tabIds });
  return response?.success || false;
}

/**
 * Keep selected tabs (reset inactivity timer).
 * @param {number[]} tabIds
 * @returns {Promise<boolean>}
 */
export async function keepTabs(tabIds) {
  const response = await sendMessage({ type: 'KEEP_TABS', tabIds });
  return response?.success || false;
}
