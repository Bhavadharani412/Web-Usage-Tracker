/**
 * Browser Adapter — thin compatibility layer for cross-browser extension APIs.
 * Currently targets Chrome. Future: add Firefox `browser.*` mapping.
 */

const browserAPI = {
  tabs: typeof chrome !== 'undefined' ? chrome.tabs : null,
  windows: typeof chrome !== 'undefined' ? chrome.windows : null,
  storage: typeof chrome !== 'undefined' ? chrome.storage : null,
  idle: typeof chrome !== 'undefined' ? chrome.idle : null,
  alarms: typeof chrome !== 'undefined' ? chrome.alarms : null,
  runtime: typeof chrome !== 'undefined' ? chrome.runtime : null,

  /**
   * Get the active tab in the currently focused window.
   * @returns {Promise<chrome.tabs.Tab|null>}
   */
  async getActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch {
      return null;
    }
  },

  /**
   * Get all open tabs across all windows.
   * @returns {Promise<chrome.tabs.Tab[]>}
   */
  async getAllTabs() {
    try {
      return await chrome.tabs.query({});
    } catch {
      return [];
    }
  },

  /**
   * Get the currently focused window.
   * @returns {Promise<chrome.windows.Window|null>}
   */
  async getFocusedWindow() {
    try {
      const win = await chrome.windows.getCurrent();
      return win && win.focused ? win : null;
    } catch {
      return null;
    }
  },

  /**
   * Check if any Chrome window is currently focused.
   * @returns {Promise<boolean>}
   */
  async isAnyWindowFocused() {
    try {
      const win = await chrome.windows.getLastFocused();
      return win ? win.focused : false;
    } catch {
      return false;
    }
  }
};

export default browserAPI;
