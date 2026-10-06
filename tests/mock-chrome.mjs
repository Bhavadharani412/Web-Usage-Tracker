/**
 * Chrome API Mock for Node.js unit tests.
 */
export function setupChromeMock() {
  const localStorage = new Map();
  const sessionStorage = new Map();

  const chromeMock = {
    tabs: {
      query: async () => [],
      get: async (id, cb) => {
        const tab = { id, active: true };
        if (cb) cb(tab);
        return tab;
      },
      remove: async () => {}
    },
    windows: {
      WINDOW_ID_NONE: -1
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          if (Array.isArray(keys)) {
            for (const k of keys) res[k] = localStorage.get(k);
          } else if (typeof keys === 'string') {
            res[keys] = localStorage.get(keys);
          } else if (keys === null) {
            for (const [k, v] of localStorage.entries()) res[k] = v;
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (obj, cb) => {
          for (const [k, v] of Object.entries(obj)) localStorage.set(k, v);
          if (cb) cb();
          return Promise.resolve();
        },
        clear: (cb) => {
          localStorage.clear();
          if (cb) cb();
          return Promise.resolve();
        }
      },
      session: {
        get: (keys, cb) => {
          const res = {};
          if (Array.isArray(keys)) {
            for (const k of keys) res[k] = sessionStorage.get(k);
          } else if (typeof keys === 'string') {
            res[keys] = sessionStorage.get(keys);
          } else if (keys === null) {
            res[keys] = sessionStorage.get(keys);
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (obj, cb) => {
          for (const [k, v] of Object.entries(obj)) sessionStorage.set(k, v);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (key, cb) => {
          sessionStorage.delete(key);
          if (cb) cb();
          return Promise.resolve();
        },
        clear: (cb) => {
          sessionStorage.clear();
          if (cb) cb();
          return Promise.resolve();
        }
      }
    },
    runtime: {
      getURL: (path) => path,
      lastError: null,
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} }
    },
    idle: {
      setDetectionInterval: () => {},
      onStateChanged: { addListener: () => {} }
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: () => {} }
    }
  };

  globalThis.chrome = chromeMock;
  globalThis.browser = chromeMock;

  return {
    localStorage,
    sessionStorage,
    reset: () => {
      localStorage.clear();
      sessionStorage.clear();
    }
  };
}
