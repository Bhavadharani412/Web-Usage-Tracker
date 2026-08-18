import test from 'node:test';
import assert from 'node:assert/strict';

const browser = {
  tabs: { query: async () => [], get: async () => null },
  windows: { getCurrent: async () => ({ focused: true }), getLastFocused: async () => ({ focused: true }), WINDOW_ID_NONE: -1 },
  storage: {
    local: { get: (keys, cb) => cb({}), set: (_obj, cb) => cb && cb(), remove: (_key, cb) => cb && cb() },
    session: null
  },
  runtime: { getURL: (p) => p },
  idle: { setDetectionInterval: () => {}, queryState: (_t, cb) => cb('active') },
  alarms: { create: () => {}, onAlarm: { addListener: () => {} } }
};

globalThis.browser = browser;
globalThis.chrome = undefined;

const { getBrowserAPI, getStorageSession } = await import('../src/utils/browser-adapter.js');

test('browser API compatibility layer exposes browser and storage fallbacks', () => {
  const api = getBrowserAPI();
  assert.ok(api);
  assert.equal(api.runtime, browser.runtime);
  assert.equal(api.storage, browser.storage);
  assert.equal(getStorageSession(), browser.storage.local);
  assert.ok(getStorageSession().get);
});
