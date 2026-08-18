/**
 * Browser Adapter — compatibility layer for Chrome, Firefox, and Edge.
 * Normalizes browser-specific globals so the extension can initialize without
 * reloading when the runtime exposes only `browser.*` instead of `chrome.*`.
 */

export function getBrowserAPI() {
  if (typeof globalThis.browser !== 'undefined' && globalThis.browser) {
    return globalThis.browser;
  }

  if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome) {
    return globalThis.chrome;
  }

  return {};
}

export function getStorageLocal() {
  const api = getBrowserAPI();
  return api.storage?.local ?? api.storage ?? null;
}

export function getStorageSession() {
  const api = getBrowserAPI();
  const sessionStore = api.storage?.session ?? null;

  if (sessionStore) {
    return sessionStore;
  }

  return api.storage?.local ?? null;
}

export function ensureBrowserCompat() {
  const api = getBrowserAPI();

  if (api && typeof globalThis.chrome === 'undefined') {
    globalThis.chrome = api;
  }

  return api;
}

const browserAPI = {
  tabs: getBrowserAPI().tabs ?? null,
  windows: getBrowserAPI().windows ?? null,
  storage: getBrowserAPI().storage ?? null,
  idle: getBrowserAPI().idle ?? null,
  alarms: getBrowserAPI().alarms ?? null,
  runtime: getBrowserAPI().runtime ?? null,

  /**
   * Get the active tab in the currently focused window.
   * @returns {Promise<chrome.tabs.Tab|null>}
   */
  async getActiveTab() {
    const api = getBrowserAPI();
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
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
    const api = getBrowserAPI();
    try {
      return await api.tabs.query({});
    } catch {
      return [];
    }
  },

  /**
   * Get the currently focused window.
   * @returns {Promise<chrome.windows.Window|null>}
   */
  async getFocusedWindow() {
    const api = getBrowserAPI();
    try {
      const win = await api.windows.getCurrent();
      return win && win.focused ? win : null;
    } catch {
      return null;
    }
  },

  /**
   * Check if any browser window is currently focused.
   * @returns {Promise<boolean>}
   */
  async isAnyWindowFocused() {
    const api = getBrowserAPI();
    try {
      const win = await api.windows.getLastFocused();
      return win ? win.focused : false;
    } catch {
      return false;
    }
  }
};

ensureBrowserCompat();

export default browserAPI;
