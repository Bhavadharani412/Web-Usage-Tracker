import test from 'node:test';
import assert from 'node:assert/strict';
import { setupChromeMock } from './mock-chrome.mjs';

const mockEnv = setupChromeMock();

const { default: tracker, TrackingState } = await import('../src/background/tracker.js');
const { getDailyUsage } = await import('../src/storage/storage.js');
const { getDateString } = await import('../src/utils/time-format.js');

test('Tracker State Machine — basic lifecycle (start, pause, resume, end)', async () => {
  mockEnv.reset();
  
  // 1. Initial state
  assert.equal(tracker.state, TrackingState.INACTIVE);
  assert.equal(tracker.getStatus().state, TrackingState.INACTIVE);

  const sampleClassification = {
    domain: 'leetcode.com',
    hostname: 'leetcode.com',
    category: 'LeetCode',
    categoryId: 'leetcode',
    pageType: 'Problems',
    icon: '💻',
    isInternal: false
  };

  // 2. Start session
  await tracker.startSession(101, sampleClassification);
  assert.equal(tracker.state, TrackingState.TRACKING);
  assert.equal(tracker.getStatus().tabId, 101);
  assert.equal(tracker.getStatus().category, 'LeetCode');

  // Verify checkpoint was written to session storage
  const checkpoint = mockEnv.sessionStorage.get('wt_active_session');
  assert.ok(checkpoint);
  assert.equal(checkpoint.state, TrackingState.TRACKING);
  assert.equal(checkpoint.currentSession.tabId, 101);

  // 3. Pause session
  await tracker.pause();
  assert.equal(tracker.state, TrackingState.PAUSED);
  const pausedCheckpoint = mockEnv.sessionStorage.get('wt_active_session');
  assert.equal(pausedCheckpoint.state, TrackingState.PAUSED);

  // 4. Resume session
  await tracker.resume();
  assert.equal(tracker.state, TrackingState.TRACKING);

  // 5. End session
  const trackedSeconds = await tracker.endSession();
  assert.equal(tracker.state, TrackingState.INACTIVE);
  assert.equal(tracker.getStatus().state, TrackingState.INACTIVE);

  // Verify checkpoint was cleared
  const clearedCheckpoint = mockEnv.sessionStorage.get('wt_active_session');
  assert.equal(clearedCheckpoint, undefined);
});

test('Tracker — Service Worker Forced Suspension & Recovery', async () => {
  mockEnv.reset();

  const classification = {
    domain: 'github.com',
    hostname: 'github.com',
    category: 'GitHub',
    categoryId: 'github',
    pageType: 'Repository',
    icon: '🐙',
    isInternal: false
  };

  // Start tracking session at tab 202
  await tracker.startSession(202, classification);
  assert.equal(tracker.state, TrackingState.TRACKING);

  // Simulate Service Worker termination / process kill:
  // In-memory singleton state is lost
  tracker.currentSession = null;
  tracker.state = TrackingState.INACTIVE;
  tracker.isInitialized = false;

  // Verify memory was cleared
  assert.equal(tracker.getStatus().state, TrackingState.INACTIVE);

  // Worker restarts and calls tracker.init()
  await tracker.init();

  // Verify active session was fully recovered from checkpoint!
  assert.equal(tracker.state, TrackingState.TRACKING);
  assert.equal(tracker.getStatus().tabId, 202);
  assert.equal(tracker.getStatus().category, 'GitHub');

  // Clean up
  await tracker.endSession();
});
