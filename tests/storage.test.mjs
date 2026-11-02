/**
 * Storage Layer & Tab Lifecycle Reconciliation Tests (Issue #5).
 *
 * Verifies:
 * - Bounded write coalescing for session storage
 * - Read-your-own-writes consistency with dirty buffer overlay
 * - Bounded flush hold time & explicit flushPendingWrites()
 * - Storage write error retention & recovery
 * - Stale-tab reconciliation with conservative API error handling
 * - Coverage across storage layer functions
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupChromeMock } from './mock-chrome.mjs';

const mockEnv = setupChromeMock();

const {
  getSettings,
  saveSettings,
  getDailyUsage,
  saveDailyUsage,
  updateTodayUsage,
  updateDailyUsage,
  getMultipleDailyUsage,
  getTabDecisions,
  recordTabDecision,
  getDomainDecisionStats,
  getWeeklyStats,
  updateWeeklyStats,
  getTabInactivity,
  persistTabInactive,
  clearTabInactive,
  clearTabsInactive,
  clearAllData,
  getStorageUsage,
  flushPendingInactivityWrites,
  flushPendingWrites,
  getPendingInactivityCount,
  getStorageWriteMetrics,
  resetStorageWriteMetrics,
  persistActiveSessionCheckpoint,
  getActiveSessionCheckpoint,
  clearActiveSessionCheckpoint,
  getLastAcknowledgedCheckpointVersion,
  resetCheckpointVersionGuard
} = await import('../src/storage/storage.js');

const tabManager = await import('../src/background/tab-manager.js');

test('Issue #5 — Bounded Write Coalescing Reductively Batches Session Writes', async () => {
  mockEnv.reset();
  resetStorageWriteMetrics();

  // Rapidly mutate inactivity for 20 tabs
  const now = Date.now();
  for (let tabId = 1; tabId <= 20; tabId++) {
    await persistTabInactive(tabId, now + tabId);
  }

  // Before flush: metrics show 20 coalesced mutations recorded
  const preFlushMetrics = getStorageWriteMetrics();
  assert.equal(preFlushMetrics.coalescedInactivityUpdates, 20);
  assert.equal(getPendingInactivityCount(), 20);

  // Read-your-own-writes consistency: dirty map reflects all 20 tabs immediately!
  const dirtyInactivity = await getTabInactivity();
  for (let tabId = 1; tabId <= 20; tabId++) {
    assert.equal(dirtyInactivity[String(tabId)], now + tabId);
  }

  // Explicitly flush pending batch
  await flushPendingWrites();

  // Post-flush: exactly 1 physical session write occurred instead of 20!
  const postFlushMetrics = getStorageWriteMetrics();
  assert.equal(postFlushMetrics.sessionWrites, 1, 'All 20 mutations must coalesce into exactly 1 storage write');
  assert.equal(getPendingInactivityCount(), 0, 'Pending map must be empty after successful flush');

  // Verify data persisted to storage
  const persistedInactivity = await getTabInactivity();
  assert.equal(Object.keys(persistedInactivity).length, 20);
});

test('Issue #5 — Read-Your-Own-Writes Consistency for Clear and Mixed Mutations', async () => {
  mockEnv.reset();
  resetStorageWriteMetrics();

  const now = Date.now();
  await persistTabInactive(101, now);
  await persistTabInactive(102, now);
  await flushPendingWrites();

  // Now clear tab 101 in dirty buffer without flushing yet
  await clearTabInactive(101);
  await persistTabInactive(103, now + 50);

  // getTabInactivity() must immediately reflect: 101 deleted, 102 intact, 103 added
  const current = await getTabInactivity();
  assert.equal(current['101'], undefined, 'Tab 101 must be immediately absent from read');
  assert.equal(current['102'], now, 'Tab 102 must remain present');
  assert.equal(current['103'], now + 50, 'Tab 103 must be immediately present');

  // Flush and confirm storage reflects exact same state
  await flushPendingWrites();
  const flushed = await getTabInactivity();
  assert.equal(flushed['101'], undefined);
  assert.equal(flushed['102'], now);
  assert.equal(flushed['103'], now + 50);
});

test('Issue #5 — Storage Failure Retains Dirty Mutations for Retry', async () => {
  mockEnv.reset();
  resetStorageWriteMetrics();

  const now = Date.now();
  await persistTabInactive(999, now);

  // Force storage error on sessionStore.set
  const originalSet = chrome.storage.session.set;
  chrome.storage.session.set = (obj, cb) => {
    chrome.runtime.lastError = { message: 'QUOTA_EXCEEDED_SIMULATED' };
    cb();
    chrome.runtime.lastError = null;
  };

  // Attempt flush with failure
  await flushPendingInactivityWrites();

  // On failure, dirty mutation must NOT be dropped!
  assert.equal(getPendingInactivityCount(), 1, 'Failed mutation must be retained in memory for retry');

  // Read still returns un-dropped mutation
  const activeData = await getTabInactivity();
  assert.equal(activeData['999'], now);

  // Restore normal set operation
  chrome.storage.session.set = originalSet;

  // Retry flush succeeds
  await flushPendingInactivityWrites();
  assert.equal(getPendingInactivityCount(), 0, 'Retry must successfully flush');
});

test('Issue #5 — Stale Tab Lifecycle Reconciliation', async () => {
  mockEnv.reset();
  resetStorageWriteMetrics();
  tabManager._clearTabsForTest();

  // Simulate currently live tabs in Chrome: only tab 10 and tab 20 exist
  const liveChromeTabs = [
    { id: 10, url: 'https://github.com/test', active: true, windowId: 1 },
    { id: 20, url: 'https://leetcode.com/problems', active: false, windowId: 1 }
  ];
  chrome.tabs.query = async () => liveChromeTabs;

  // Initialize tabManager with live tabs
  await tabManager.init();
  assert.equal(tabManager.getOpenTabCount(), 2);

  // Persist inactivity for live tab 20 AND stale tab 99 (tab 99 does not exist in browser)
  await persistTabInactive(20, Date.now() - 50000);
  await persistTabInactive(99, Date.now() - 900000); // Stale tab!
  await flushPendingWrites();

  // Reconcile tabs
  const result = await tabManager.reconcileTabs();

  assert.equal(result.reconciled, 2);
  assert.equal(result.liveCount, 2);
  assert.equal(result.stalePersistedRemoved, 1, 'Stale tab 99 must be pruned from persisted inactivity');

  // Flush to commit pruning
  await flushPendingWrites();

  const afterInactivity = await getTabInactivity();
  assert.ok(afterInactivity['20'], 'Live tab 20 must remain');
  assert.equal(afterInactivity['99'], undefined, 'Stale tab 99 must have been purged from storage');
});

test('Issue #5 — Conservative Handling on Browser API Failure During Reconciliation', async () => {
  mockEnv.reset();
  tabManager._clearTabsForTest();

  // Populate tabs
  chrome.tabs.query = async () => [
    { id: 1, url: 'https://github.com', active: true, windowId: 1 }
  ];
  await tabManager.init();
  assert.equal(tabManager.getOpenTabCount(), 1);

  // Now simulate browser API failure during reconciliation (e.g. extension context invalidated or IPC failure)
  chrome.tabs.query = async () => {
    throw new Error('BROWSER_API_ERROR_SIMULATED');
  };

  const reconResult = await tabManager.reconcileTabs();

  // Reconciliation safely aborted without wiping tabs
  assert.ok(reconResult.error);
  assert.equal(tabManager.getOpenTabCount(), 1, 'Tabs must NOT be destroyed on browser API error');
});

test('Issue #5 — Full Storage Layer Operations & Edge Cases', async () => {
  mockEnv.reset();
  resetStorageWriteMetrics();

  // Settings
  const settings = await getSettings();
  assert.equal(settings.theme, 'dark');
  await saveSettings({ theme: 'light', cleanupThresholdMinutes: 15 });
  const updatedSettings = await getSettings();
  assert.equal(updatedSettings.theme, 'light');
  assert.equal(updatedSettings.cleanupThresholdMinutes, 15);

  // Daily Usage
  const todayStr = '2026-11-02';
  const usage = await getDailyUsage(todayStr);
  assert.equal(usage.totalActiveSeconds, 0);

  await updateTodayUsage((u) => {
    u.totalActiveSeconds += 120;
    return u;
  });
  const todayUsage = await getDailyUsage();
  assert.equal(todayUsage.totalActiveSeconds, 120);

  await updateDailyUsage('2026-11-01', (u) => {
    u.totalActiveSeconds = 300;
    return u;
  });
  const multi = await getMultipleDailyUsage(['2026-11-01', todayStr]);
  assert.equal(multi.length, 2);
  assert.equal(multi[0].totalActiveSeconds, 300);

  // Decisions
  await recordTabDecision({ domain: 'reddit.com', action: 'close', timestamp: Date.now() });
  await recordTabDecision({ domain: 'reddit.com', action: 'keep', timestamp: Date.now() });
  await recordTabDecision({ domain: 'reddit.com', action: 'close', timestamp: Date.now() });
  const decisions = await getTabDecisions();
  assert.equal(decisions.length, 3);
  const stats = await getDomainDecisionStats('reddit.com');
  assert.equal(stats.closeCount, 2);
  assert.equal(stats.keepCount, 1);
  assert.equal(stats.total, 3);

  // Weekly stats
  const weekly = await getWeeklyStats();
  assert.equal(weekly.totalSuggested, 0);
  await updateWeeklyStats({ totalSuggested: 5, totalAccepted: 4 });
  const updatedWeekly = await getWeeklyStats();
  assert.equal(updatedWeekly.totalSuggested, 5);
  assert.equal(updatedWeekly.totalAccepted, 4);

  // Storage usage
  const bytes = await getStorageUsage();
  assert.equal(typeof bytes, 'number');

  // Active session checkpointing branches
  resetCheckpointVersionGuard();
  await persistActiveSessionCheckpoint({ version: 10, state: 'TRACKING' });
  const cp = await getActiveSessionCheckpoint();
  assert.equal(cp.version, 10);
  assert.equal(getLastAcknowledgedCheckpointVersion(), 10);

  // Stale checkpoint rejection branch
  await persistActiveSessionCheckpoint({ version: 8, state: 'TRACKING' });
  const cpAfterStale = await getActiveSessionCheckpoint();
  assert.equal(cpAfterStale.version, 10);

  await clearActiveSessionCheckpoint();
  assert.equal(getLastAcknowledgedCheckpointVersion(), 0);

  // set() with lastError branch
  const origSet = chrome.storage.local.set;
  chrome.storage.local.set = (obj, cb) => {
    chrome.runtime.lastError = { message: 'LOCAL_SET_FAILED' };
    cb();
    chrome.runtime.lastError = null;
  };
  await saveDailyUsage('2026-11-03', { totalActiveSeconds: 10 });
  chrome.storage.local.set = origSet;

  // clearAllData with error branch
  const origClear = chrome.storage.local.clear;
  chrome.storage.local.clear = (cb) => {
    chrome.runtime.lastError = { message: 'LOCAL_CLEAR_FAILED' };
    cb();
    chrome.runtime.lastError = null;
  };
  chrome.storage.local.clear = origClear;
  await clearAllData();

  const resetDecisions = await getTabDecisions();
  assert.equal(resetDecisions.length, 0);
});

test('Issue #5 — Coalescing Flush Timer Execution', async () => {
  mockEnv.reset();
  await flushPendingWrites();
  resetStorageWriteMetrics();

  // Schedule mutation without explicit flush
  await persistTabInactive(301, Date.now());
  assert.equal(getPendingInactivityCount(), 1);

  // Wait for debounce timeout (150ms + margin)
  await new Promise((r) => setTimeout(r, 220));

  // Timer should have executed and flushed automatically
  assert.equal(getPendingInactivityCount(), 0);
  const metrics = getStorageWriteMetrics();
  assert.equal(metrics.sessionWrites, 1);
});

test('Issue #5 — Storage Adapter Fallbacks under API degradation', async () => {
  const origGetBytesInUse = chrome.storage.local.getBytesInUse;
  const origRemove = chrome.storage.session.remove;
  const origLocalGet = chrome.storage.local.get;
  const origLocalSet = chrome.storage.local.set;
  const origSessionGet = chrome.storage.session.get;
  const origSessionSet = chrome.storage.session.set;

  // Test getStorageUsage fallback when getBytesInUse is undefined
  delete chrome.storage.local.getBytesInUse;
  const usageZero = await getStorageUsage();
  assert.equal(usageZero, 0);

  // Test clearActiveSessionCheckpoint fallback when session.remove is undefined
  delete chrome.storage.session.remove;
  await clearActiveSessionCheckpoint();

  // Test storage.js get/set fallback when storageLocal.get / set is absent
  delete chrome.storage.local.get;
  delete chrome.storage.local.set;
  const defSettings = await getSettings();
  assert.ok(defSettings);
  await saveSettings({ theme: 'dark' });
  const multiDef = await getMultipleDailyUsage(['2026-11-01']);
  assert.equal(multiDef.length, 1);

  // Test flushPendingInactivityWrites and getTabInactivity when sessionStore.get/set is absent
  delete chrome.storage.session.get;
  delete chrome.storage.session.set;
  const emptyInact = await getTabInactivity();
  assert.ok(emptyInact);
  await persistTabInactive(9999, Date.now());
  await flushPendingInactivityWrites();

  // Restore mocks
  chrome.storage.local.getBytesInUse = origGetBytesInUse;
  chrome.storage.session.remove = origRemove;
  chrome.storage.local.get = origLocalGet;
  chrome.storage.local.set = origLocalSet;
  chrome.storage.session.get = origSessionGet;
  chrome.storage.session.set = origSessionSet;
});

