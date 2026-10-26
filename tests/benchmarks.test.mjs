import test from 'node:test';
import assert from 'node:assert/strict';
import { setupChromeMock } from './mock-chrome.mjs';

const mockEnv = setupChromeMock();

const { default: tracker, TrackingState } = await import('../src/background/tracker.js');

test('Benchmark 1 — Stopwatch Timestamp Accuracy & Drift Benchmark', async () => {
  mockEnv.reset();

  const classification = {
    domain: 'leetcode.com',
    hostname: 'leetcode.com',
    category: 'LeetCode',
    categoryId: 'leetcode',
    pageType: 'Problems',
    icon: '💻',
    isInternal: false
  };

  const simulatedStartTime = Date.now();
  await tracker.startSession(501, classification);

  // Simulate elapsed active time by manipulating currentSession.startTime
  const elapsedSimulatedMs = 300 * 1000; // 300 seconds (5 minutes)
  tracker.currentSession.startTime = Date.now() - elapsedSimulatedMs;

  const status = tracker.getStatus();
  const calculatedSeconds = status.activeSeconds;
  const expectedSeconds = 300;

  const errorSeconds = Math.abs(calculatedSeconds - expectedSeconds);
  const errorPercent = (errorSeconds / expectedSeconds) * 100;

  console.log(`\n--- Stopwatch Benchmark ---`);
  console.log(`Expected Duration  : ${expectedSeconds}s`);
  console.log(`Calculated Duration: ${calculatedSeconds}s`);
  console.log(`Absolute Error     : ${errorSeconds}s`);
  console.log(`Relative Error     : ${errorPercent.toFixed(4)}%`);
  console.log(`---------------------------\n`);

  assert.equal(errorSeconds, 0, 'Timestamp tracking must produce 0 seconds of time drift');

  await tracker.endSession();
});

test('Benchmark 2 — Service Worker Forced Suspension Benchmark', async () => {
  mockEnv.reset();

  const classification = {
    domain: 'github.com',
    hostname: 'github.com',
    category: 'GitHub',
    categoryId: 'github',
    pageType: 'Pull Requests',
    icon: '🐙',
    isInternal: false
  };

  const startTime = Date.now() - (120 * 1000); // Session started 120 seconds ago

  // 1. Session starts at T - 120s
  await tracker.startSession(707, classification);
  tracker.currentSession.startTime = startTime;
  await tracker._persistCheckpoint();

  // 2. Simulate forced Chrome service worker suspension at T - 60s
  // Memory state is lost when Chrome terminates idle service worker process
  tracker.currentSession = null;
  tracker.state = TrackingState.INACTIVE;
  tracker.isInitialized = false;

  // 3. Worker process wakes up (e.g. on user tab switch or alarm) at T = 0s
  await tracker.init();

  // 4. End session and calculate total active time
  const totalActiveSeconds = tracker._calculateActiveTime();
  const expectedActiveSeconds = 120;

  const errorSeconds = Math.abs(totalActiveSeconds - expectedActiveSeconds);
  const errorPercent = (errorSeconds / expectedActiveSeconds) * 100;

  console.log(`\n--- Forced SW Suspension Benchmark ---`);
  console.log(`Suspension Timeline  : Session started 120s ago, SW suspended 60s ago, recovered at T=0s`);
  console.log(`Expected Active Time : ${expectedActiveSeconds}s`);
  console.log(`Recovered Active Time: ${totalActiveSeconds}s`);
  console.log(`Un-flushed Time Lost : ${errorSeconds}s`);
  console.log(`Suspension Error Rate: ${errorPercent.toFixed(4)}%`);
  console.log(`-------------------------------------\n`);

  assert.equal(errorSeconds, 0, 'Forced suspension recovery must preserve active session time with 0s data loss');

  await tracker.endSession();
});

test('Benchmark 3 — Diagnostics Instrumentation Overhead & Buffer Capacity Benchmark', async () => {
  mockEnv.reset();
  const { default: diagnostics, MAX_BUFFER_SIZE } = await import('../src/utils/diagnostics.js');
  await diagnostics.clearDiagnostics();

  const WORKLOAD_COUNT = 1000;

  // 1. Measure baseline loop overhead (uninstrumented state transition computation)
  const baselineStart = performance.now();
  for (let i = 0; i < WORKLOAD_COUNT; i++) {
    const ts = Date.now();
    const duration = Math.max(0, ts - (ts - 100));
  }
  const baselineEnd = performance.now();
  const baselineTotalMs = baselineEnd - baselineStart;

  // 2. Measure instrumented workload (1,000 diagnostic events with latency recording and rolling buffer eviction)
  const instrumentedStart = performance.now();
  for (let i = 0; i < WORKLOAD_COUNT; i++) {
    const writeDuration = 1.0 + (i % 10) * 0.25; // 1.0ms - 3.25ms realistic storage latency distribution
    diagnostics.recordStorageWrite(writeDuration, true);
    diagnostics.recordEvent({
      type: 'workload_event',
      outcome: 'info',
      durationMs: writeDuration,
      details: `Workload iteration ${i}`
    });
  }
  const instrumentedEnd = performance.now();
  const instrumentedTotalMs = instrumentedEnd - instrumentedStart;

  const totalOverheadMs = Math.max(0, instrumentedTotalMs - baselineTotalMs);
  const overheadPerEventUs = ((totalOverheadMs / WORKLOAD_COUNT) * 1000); // in microseconds
  const overheadPerEventMs = totalOverheadMs / WORKLOAD_COUNT;

  const metrics = diagnostics.getHealthMetrics();

  console.log(`\n--- Diagnostics Instrumentation Benchmark ---`);
  console.log(`Events Processed       : ${WORKLOAD_COUNT}`);
  console.log(`Baseline Duration      : ${baselineTotalMs.toFixed(3)} ms`);
  console.log(`Instrumented Duration  : ${instrumentedTotalMs.toFixed(3)} ms`);
  console.log(`Total Overhead         : ${totalOverheadMs.toFixed(3)} ms`);
  console.log(`Overhead Per Event     : ${overheadPerEventUs.toFixed(2)} µs (${overheadPerEventMs.toFixed(4)} ms)`);
  console.log(`Buffer Retained / Cap  : ${metrics.buffer.retainedEvents} / ${metrics.buffer.capacity}`);
  console.log(`Storage Latency p50    : ${metrics.latency.p50} ms`);
  console.log(`Storage Latency p95    : ${metrics.latency.p95} ms`);
  console.log(`---------------------------------------------\n`);

  // Assertions
  assert.equal(diagnostics.buffer.length, MAX_BUFFER_SIZE, 'Buffer must never exceed 100 entries');
  assert.equal(metrics.buffer.retainedEvents, 100, 'Retained events must be capped at 100');
  assert.ok(metrics.latency.hasData, 'Latency data must be present');
  assert.ok(metrics.latency.p50 > 0, 'p50 latency must be positive');
  assert.ok(metrics.latency.p95 >= metrics.latency.p50, 'p95 latency must be >= p50 latency');

  // Verify privacy: verify no event in buffer contains URLs or domains
  for (const event of diagnostics.buffer) {
    assert.equal(typeof event.details, 'string');
    assert.equal(event.details.includes('http://'), false);
    assert.equal(event.details.includes('https://'), false);
  }
});
