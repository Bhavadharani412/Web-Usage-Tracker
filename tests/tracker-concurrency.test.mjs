/**
 * Concurrency, State Machine & Lifecycle Hardening Tests for Tracker (Issue #6).
 *
 * Verifies:
 * - Deterministic state machine & transitions
 * - Serialized execution queue & race condition prevention
 * - Duplicate session prevention (invariant: at most 1 active session)
 * - Stale checkpoint protection with monotonic versioning
 * - Idempotent event handling (duplicate start, pause, resume)
 * - Rapid tab activation & concurrency stress
 * - Invalid transition safety
 * - Service-worker suspension & corrupted checkpoint recovery
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupChromeMock } from './mock-chrome.mjs';

const mockEnv = setupChromeMock();

const { Tracker, TrackingState, VALID_TRANSITIONS } = await import('../src/background/tracker.js');
const {
  persistActiveSessionCheckpoint,
  getActiveSessionCheckpoint,
  clearActiveSessionCheckpoint,
  getLastAcknowledgedCheckpointVersion,
  resetCheckpointVersionGuard
} = await import('../src/storage/storage.js');
const { default: diagnostics } = await import('../src/utils/diagnostics.js');

const sampleSiteA = {
  domain: 'github.com',
  hostname: 'github.com',
  category: 'GitHub',
  categoryId: 'github',
  pageType: 'Repository',
  icon: '🐙',
  isInternal: false
};

const sampleSiteB = {
  domain: 'leetcode.com',
  hostname: 'leetcode.com',
  category: 'LeetCode',
  categoryId: 'leetcode',
  pageType: 'Problems',
  icon: '💻',
  isInternal: false
};

const sampleSiteC = {
  domain: 'docs.google.com',
  hostname: 'docs.google.com',
  category: 'Google Docs',
  categoryId: 'google-docs',
  pageType: 'Document',
  icon: '📄',
  isInternal: false
};

test('Issue #6 — Valid Transitions Matrix and Explicit State Machine', async () => {
  mockEnv.reset();
  resetCheckpointVersionGuard();
  const tracker = new Tracker();

  // 1. Initial State: INACTIVE
  assert.equal(tracker.state, TrackingState.INACTIVE);
  assert.equal(tracker.getActiveSessionCount(), 0);

  // 2. INACTIVE -> TRACKING (Valid)
  await tracker.startSession(1, sampleSiteA);
  assert.equal(tracker.state, TrackingState.TRACKING);
  assert.equal(tracker.getActiveSessionCount(), 1);
  assert.equal(tracker.getStatus().tabId, 1);

  // 3. TRACKING -> PAUSED (Valid)
  await tracker.pause();
  assert.equal(tracker.state, TrackingState.PAUSED);
  assert.equal(tracker.getActiveSessionCount(), 0);

  // 4. PAUSED -> TRACKING (Valid via resume)
  await tracker.resume();
  assert.equal(tracker.state, TrackingState.TRACKING);
  assert.equal(tracker.getActiveSessionCount(), 1);

  // 5. TRACKING -> INACTIVE (Valid via endSession)
  const activeSeconds = await tracker.endSession();
  assert.equal(tracker.state, TrackingState.INACTIVE);
  assert.equal(tracker.getActiveSessionCount(), 0);
  assert.equal(tracker.getStatus().tabId, null);

  // 6. PAUSED -> INACTIVE (Valid via endSession while paused)
  await tracker.startSession(2, sampleSiteB);
  await tracker.pause();
  assert.equal(tracker.state, TrackingState.PAUSED);
  await tracker.endSession();
  assert.equal(tracker.state, TrackingState.INACTIVE);
  assert.equal(tracker.getActiveSessionCount(), 0);
});

test('Issue #6 — Invalid State Transitions Handled Safely Without Throwing', async () => {
  mockEnv.reset();
  resetCheckpointVersionGuard();
  const tracker = new Tracker();

  // Attempt pause while INACTIVE (Invalid: INACTIVE -> PAUSED)
  await tracker.pause();
  assert.equal(tracker.state, TrackingState.INACTIVE);
  assert.equal(tracker.getActiveSessionCount(), 0);

  // Attempt resume while INACTIVE (Invalid: INACTIVE -> TRACKING via resume)
  await tracker.resume();
  assert.equal(tracker.state, TrackingState.INACTIVE);
  assert.equal(tracker.getActiveSessionCount(), 0);

  // Attempt endSession while INACTIVE (Safe no-op returning 0)
  const endedSeconds = await tracker.endSession();
  assert.equal(endedSeconds, 0);
  assert.equal(tracker.state, TrackingState.INACTIVE);

  // Start session and test invalid transition directly
  await tracker.startSession(10, sampleSiteA);
  assert.equal(tracker.state, TrackingState.TRACKING);

  // Direct invalid transition check
  const invalidResult = tracker._validateTransition(TrackingState.INACTIVE, TrackingState.PAUSED);
  assert.equal(invalidResult, false);

  await tracker.endSession();
});

test('Issue #6 — Idempotent Event Handling (No Session Tear-Down on Duplicate Events)', async () => {
  mockEnv.reset();
  resetCheckpointVersionGuard();
  const tracker = new Tracker();

  await tracker.startSession(101, sampleSiteA);
  assert.equal(tracker.state, TrackingState.TRACKING);
  const initialStartTime = tracker.currentSession.startTime;
  const initialVersion = tracker.checkpointVersion;

  // Duplicate startSession for the SAME active tab and category
  await tracker.startSession(101, sampleSiteA);
  assert.equal(tracker.state, TrackingState.TRACKING);
  assert.equal(tracker.currentSession.startTime, initialStartTime, 'Start time must not reset on duplicate start');
  assert.equal(tracker.checkpointVersion, initialVersion, 'Checkpoint version must not bump on redundant start');

  // Duplicate pause while already PAUSED
  await tracker.pause();
  assert.equal(tracker.state, TrackingState.PAUSED);
  const pauseVersion = tracker.checkpointVersion;

  await tracker.pause(); // Redundant second pause
  assert.equal(tracker.state, TrackingState.PAUSED);
  assert.equal(tracker.checkpointVersion, pauseVersion, 'Redundant pause must be a no-op');

  // Duplicate resume while already TRACKING
  await tracker.resume();
  assert.equal(tracker.state, TrackingState.TRACKING);
  const resumeVersion = tracker.checkpointVersion;

  await tracker.resume(); // Redundant second resume
  assert.equal(tracker.state, TrackingState.TRACKING);
  assert.equal(tracker.checkpointVersion, resumeVersion, 'Redundant resume must be a no-op');

  await tracker.endSession();
});

test('Issue #6 — Rapid Tab Activation & Concurrency Stress Test', async () => {
  mockEnv.reset();
  resetCheckpointVersionGuard();
  const tracker = new Tracker();

  // Simulate 50 concurrent startSession invocations arriving in parallel
  const tabs = [
    { id: 1, site: sampleSiteA },
    { id: 2, site: sampleSiteB },
    { id: 3, site: sampleSiteC }
  ];

  const concurrentPromises = [];
  for (let i = 0; i < 50; i++) {
    const tabInfo = tabs[i % tabs.length];
    concurrentPromises.push(tracker.startSession(tabInfo.id, tabInfo.site));
  }

  // Await all concurrent invocations
  await Promise.all(concurrentPromises);

  // Invariant 1: Exactly 1 valid active session exists at the end
  assert.equal(tracker.getActiveSessionCount(), 1);
  assert.equal(tracker.state, TrackingState.TRACKING);

  // Invariant 2: Current tab matches the last enqueued operation
  const lastTabInfo = tabs[49 % tabs.length];
  assert.equal(tracker.getStatus().tabId, lastTabInfo.id);
  assert.equal(tracker.getStatus().categoryId, lastTabInfo.site.categoryId);

  // Clean up
  await tracker.endSession();
  assert.equal(tracker.getActiveSessionCount(), 0);
});

test('Issue #6 — Interleaved Concurrent Tab Switches, Focus Blurs, and Resumes', async () => {
  mockEnv.reset();
  resetCheckpointVersionGuard();
  const tracker = new Tracker();

  // Concurrently dispatch startSession, pause, resume, startSession in interleaved order
  const actions = [
    tracker.startSession(1, sampleSiteA),
    tracker.pause(),
    tracker.resume(),
    tracker.startSession(2, sampleSiteB),
    tracker.pause(),
    tracker.startSession(3, sampleSiteC),
    tracker.pause(),
    tracker.resume()
  ];

  await Promise.all(actions);

  // State should be deterministically TRACKING Tab 3
  assert.equal(tracker.state, TrackingState.TRACKING);
  assert.equal(tracker.getActiveSessionCount(), 1);
  assert.equal(tracker.getStatus().tabId, 3);
  assert.equal(tracker.getStatus().categoryId, sampleSiteC.categoryId);

  await tracker.endSession();
});

test('Issue #6 — Monotonic Checkpoint Versioning & Stale Overwrite Protection', async () => {
  mockEnv.reset();
  resetCheckpointVersionGuard();

  // 1. Persist checkpoint version 5
  await persistActiveSessionCheckpoint({
    version: 5,
    state: TrackingState.TRACKING,
    currentSession: { tabId: 42, categoryId: 'github' },
    pausedAt: null,
    timestamp: Date.now()
  });

  assert.equal(getLastAcknowledgedCheckpointVersion(), 5);
  let stored = await getActiveSessionCheckpoint();
  assert.equal(stored.version, 5);
  assert.equal(stored.currentSession.tabId, 42);

  // 2. Attempt to persist older checkpoint version 3 (stale write)
  await persistActiveSessionCheckpoint({
    version: 3,
    state: TrackingState.TRACKING,
    currentSession: { tabId: 999, categoryId: 'stale' },
    pausedAt: null,
    timestamp: Date.now() - 1000
  });

  // Stale write MUST BE REJECTED
  assert.equal(getLastAcknowledgedCheckpointVersion(), 5);
  stored = await getActiveSessionCheckpoint();
  assert.equal(stored.version, 5, 'Stored checkpoint version must remain 5');
  assert.equal(stored.currentSession.tabId, 42, 'Stored tabId must not be overwritten by stale checkpoint');

  // 3. Persist newer checkpoint version 6 (accepted)
  await persistActiveSessionCheckpoint({
    version: 6,
    state: TrackingState.PAUSED,
    currentSession: { tabId: 43, categoryId: 'leetcode' },
    pausedAt: Date.now(),
    timestamp: Date.now()
  });

  assert.equal(getLastAcknowledgedCheckpointVersion(), 6);
  stored = await getActiveSessionCheckpoint();
  assert.equal(stored.version, 6);
  assert.equal(stored.currentSession.tabId, 43);

  // Clean up
  await clearActiveSessionCheckpoint();
  assert.equal(getLastAcknowledgedCheckpointVersion(), 0);
});

test('Issue #6 — Service Worker Suspension Recovery with Tab Liveness Check', async () => {
  mockEnv.reset();
  resetCheckpointVersionGuard();

  // Test Case A: Tab remains open during SW suspension -> restored cleanly
  const trackerA = new Tracker();
  await trackerA.startSession(555, sampleSiteA);
  const versionA = trackerA.checkpointVersion;

  // Simulate SW restart
  const trackerRecoveredA = new Tracker();
  await trackerRecoveredA.init();

  assert.equal(trackerRecoveredA.state, TrackingState.TRACKING);
  assert.equal(trackerRecoveredA.getStatus().tabId, 555);
  assert.ok(trackerRecoveredA.checkpointVersion >= versionA);
  await trackerRecoveredA.endSession();

  // Test Case B: Tab was closed in browser while worker was suspended
  mockEnv.reset();
  resetCheckpointVersionGuard();

  // Manually configure chrome.tabs.get to return null for closed tab 777
  const originalGet = chrome.tabs.get;
  chrome.tabs.get = (tabId, cb) => {
    chrome.runtime.lastError = { message: 'Tab does not exist' };
    cb(null);
    chrome.runtime.lastError = null;
  };

  await persistActiveSessionCheckpoint({
    version: 1,
    state: TrackingState.TRACKING,
    currentSession: {
      tabId: 777,
      categoryId: 'github',
      category: 'GitHub',
      icon: '🐙',
      pageType: 'Repo',
      domain: 'github.com',
      startTime: Date.now() - 3000,
      accumulatedSeconds: 5,
      startDate: '2026-11-02',
      segments: []
    },
    pausedAt: null
  });

  const trackerRecoveredB = new Tracker();
  await trackerRecoveredB.init();

  // Closed tab should have triggered session clean end during init
  assert.equal(trackerRecoveredB.state, TrackingState.INACTIVE);
  assert.equal(trackerRecoveredB.getActiveSessionCount(), 0);

  // Restore mock
  chrome.tabs.get = originalGet;
});

test('Issue #6 — Corrupted or Null Checkpoint During Worker Restart Handles Gracefully', async () => {
  mockEnv.reset();
  resetCheckpointVersionGuard();

  // Write corrupt/invalid object to session storage
  await mockEnv.sessionStorage.set('wt_active_session', { corrupt: 'payload_without_state' });

  const tracker = new Tracker();
  await tracker.init();

  assert.equal(tracker.state, TrackingState.INACTIVE);
  assert.equal(tracker.getActiveSessionCount(), 0);
  assert.equal(tracker.isInitialized, true);
});

test('Issue #6 — Consecutive startSession with Same Tab When Paused Resumes Cleanly', async () => {
  mockEnv.reset();
  resetCheckpointVersionGuard();
  const tracker = new Tracker();

  await tracker.startSession(200, sampleSiteA);
  assert.equal(tracker.state, TrackingState.TRACKING);

  await tracker.pause();
  assert.equal(tracker.state, TrackingState.PAUSED);

  // startSession called for the same tab/category while paused -> should resume cleanly
  await tracker.startSession(200, sampleSiteA);
  assert.equal(tracker.state, TrackingState.TRACKING);
  assert.equal(tracker.getStatus().tabId, 200);

  await tracker.endSession();
});
