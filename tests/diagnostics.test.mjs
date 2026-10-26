import test from 'node:test';
import assert from 'node:assert/strict';
import { setupChromeMock } from './mock-chrome.mjs';

const mockEnv = setupChromeMock();

const {
  DiagnosticsManager,
  MAX_BUFFER_SIZE,
  DIAGNOSTICS_STORAGE_KEY,
  sanitizeText,
  calculatePercentile
} = await import('../src/utils/diagnostics.js');

test('Diagnostics — sanitizeText strips URLs, domains, and sensitive information', () => {
  const urlSample = 'Visited https://sub.example.com/secret/path?token=12345 in browser';
  const sanitizedUrl = sanitizeText(urlSample);
  assert.equal(sanitizedUrl.includes('https://'), false);
  assert.equal(sanitizedUrl.includes('secret/path'), false);
  assert.equal(sanitizedUrl.includes('token=12345'), false);
  assert.ok(sanitizedUrl.includes('[redacted_url]'));

  const domainSample = 'Failed connecting to api.analytics-tracker.org/v1';
  const sanitizedDomain = sanitizeText(domainSample);
  assert.equal(sanitizedDomain.includes('api.analytics-tracker.org'), false);
  assert.ok(sanitizedDomain.includes('[redacted_domain]'));
});

test('Diagnostics — calculatePercentile computes accurate p50 and p95 values', () => {
  // Empty array
  assert.equal(calculatePercentile([], 50), null);
  assert.equal(calculatePercentile([], 95), null);

  // Single sample
  assert.equal(calculatePercentile([10.5], 50), 10.5);
  assert.equal(calculatePercentile([10.5], 95), 10.5);

  // Odd number of samples
  const oddSamples = [10, 20, 30, 40, 50];
  assert.equal(calculatePercentile(oddSamples, 50), 30);

  // 100 uniform samples from 1 to 100
  const hundredSamples = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(calculatePercentile(hundredSamples, 50), 50.5);
  assert.equal(calculatePercentile(hundredSamples, 95), 95.05);

  // Invalid/negative inputs ignored
  assert.equal(calculatePercentile([-5, NaN, 10, 20], 50), 15);
});

test('Diagnostics — Rolling buffer enforces 100 entries capacity and FIFO eviction', async () => {
  mockEnv.reset();
  const mgr = new DiagnosticsManager();
  await mgr.init();

  assert.equal(mgr.buffer.length, 0);

  // Add 150 events
  for (let i = 1; i <= 150; i++) {
    mgr.recordEvent({
      type: 'test_event',
      outcome: 'info',
      details: `Event index ${i}`
    });
  }

  // Buffer must strictly cap at 100
  assert.equal(mgr.buffer.length, MAX_BUFFER_SIZE);
  assert.equal(mgr.buffer.length, 100);

  // The first 50 events must have been evicted, oldest remaining is Event 51
  assert.equal(mgr.buffer[0].details, 'Event index 51');
  assert.equal(mgr.buffer[99].details, 'Event index 150');

  // getRecentEvents returns newest first
  const recent = mgr.getRecentEvents(5);
  assert.equal(recent.length, 5);
  assert.equal(recent[0].details, 'Event index 150');
  assert.equal(recent[4].details, 'Event index 146');
});

test('Diagnostics — Recovery success rate calculation including zero-attempts case', async () => {
  mockEnv.reset();
  const mgr = new DiagnosticsManager();
  await mgr.init();

  // Initial state: 0 attempts
  let metrics = mgr.getHealthMetrics();
  assert.equal(metrics.recovery.hasData, false);
  assert.equal(metrics.recovery.rate, null);
  assert.equal(metrics.recovery.total, 0);
  assert.equal(metrics.recovery.successful, 0);

  // 1 successful recovery
  mgr.recordRecoveryAttempt(true, 'Worker woke up and tab active');
  metrics = mgr.getHealthMetrics();
  assert.equal(metrics.recovery.hasData, true);
  assert.equal(metrics.recovery.rate, 100);
  assert.equal(metrics.recovery.total, 1);
  assert.equal(metrics.recovery.successful, 1);

  // 1 failed recovery
  mgr.recordRecoveryAttempt(false, 'Tab was closed');
  metrics = mgr.getHealthMetrics();
  assert.equal(metrics.recovery.hasData, true);
  assert.equal(metrics.recovery.rate, 50.0);
  assert.equal(metrics.recovery.total, 2);
  assert.equal(metrics.recovery.successful, 1);

  // 2 more successful recoveries -> 3/4 = 75%
  mgr.recordRecoveryAttempt(true);
  mgr.recordRecoveryAttempt(true);
  metrics = mgr.getHealthMetrics();
  assert.equal(metrics.recovery.rate, 75.0);
});

test('Diagnostics — Runtime error count tracks without double-counting', async () => {
  mockEnv.reset();
  const mgr = new DiagnosticsManager();
  await mgr.init();

  assert.equal(mgr.getHealthMetrics().runtimeErrors.count, 0);

  // First error with explicit dedupe key
  const counted1 = mgr.recordRuntimeError('STORAGE_ERROR', 'Quota reached', 'key-1');
  assert.equal(counted1, true);
  assert.equal(mgr.getHealthMetrics().runtimeErrors.count, 1);

  // Duplicate error with same key should be ignored
  const countedDuplicate = mgr.recordRuntimeError('STORAGE_ERROR', 'Quota reached', 'key-1');
  assert.equal(countedDuplicate, false);
  assert.equal(mgr.getHealthMetrics().runtimeErrors.count, 1);

  // Different error counted
  const counted2 = mgr.recordRuntimeError('TAB_ERROR', 'Tab removed', 'key-2');
  assert.equal(counted2, true);
  assert.equal(mgr.getHealthMetrics().runtimeErrors.count, 2);
});

test('Diagnostics — Privacy boundary: no URLs, titles, or browsing contents', async () => {
  mockEnv.reset();
  const mgr = new DiagnosticsManager();
  await mgr.init();

  mgr.recordEvent({
    type: 'sw_recovery',
    details: 'User navigated to https://private-intranet.company.internal/dashboard?user=alice',
    errorCode: 'ERR_FAILED_https://secret.com'
  });

  const event = mgr.buffer[0];
  assert.equal(event.details.includes('https://'), false);
  assert.equal(event.details.includes('alice'), false);
  assert.equal(event.errorCode.includes('https://'), false);
  assert.equal(event.errorCode.includes('secret.com'), false);
});

test('Diagnostics — Corrupted or missing storage data recovers gracefully', async () => {
  mockEnv.reset();

  // Seed storage with malformed / corrupted data
  mockEnv.localStorage.set(DIAGNOSTICS_STORAGE_KEY, {
    buffer: 'not an array - corrupted',
    writeLatencies: null,
    recoveryStats: 'invalid',
    runtimeErrorCount: 'NaN'
  });

  const mgr = new DiagnosticsManager();
  await mgr.init();

  // Must cleanly recover without crashing
  const metrics = mgr.getHealthMetrics();
  assert.equal(metrics.buffer.retainedEvents, 0);
  assert.equal(metrics.recovery.hasData, false);
  assert.equal(metrics.latency.hasData, false);
  assert.equal(metrics.runtimeErrors.count, 0);
});

test('Diagnostics — Clear diagnostic history resets state cleanly', async () => {
  mockEnv.reset();
  const mgr = new DiagnosticsManager();
  await mgr.init();

  mgr.recordEvent({ type: 'test', outcome: 'info' });
  mgr.recordRecoveryAttempt(true);
  mgr.recordStorageWrite(12.4, true);
  mgr.recordRuntimeError('ERR', 'details', 'k1');

  assert.equal(mgr.buffer.length > 0, true);
  assert.equal(mgr.getHealthMetrics().recovery.hasData, true);

  await mgr.clearDiagnostics();

  const metrics = mgr.getHealthMetrics();
  assert.equal(metrics.recovery.hasData, false);
  assert.equal(metrics.latency.hasData, false);
  assert.equal(metrics.runtimeErrors.count, 0);
  // Only the reset notice event exists in buffer
  assert.equal(mgr.buffer.length, 1);
  assert.equal(mgr.buffer[0].type, 'diagnostics_cleared');
});

test('Diagnostics — Storage layer writes record write latency and error metrics', async () => {
  mockEnv.reset();
  const { default: defaultDiag } = await import('../src/utils/diagnostics.js');
  const { saveDailyUsage } = await import('../src/storage/storage.js');

  await defaultDiag.clearDiagnostics();

  // Perform a storage write
  await saveDailyUsage('2026-10-26', { date: '2026-10-26', totalActiveSeconds: 120 });

  let metrics = defaultDiag.getHealthMetrics();
  assert.equal(metrics.latency.hasData, true);
  assert.ok(metrics.latency.sampleCount >= 1);
  assert.ok(metrics.latency.p50 >= 0);
  assert.ok(metrics.latency.p95 >= 0);

  // Simulate chrome.runtime.lastError on storage write
  globalThis.chrome.runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM quota exceeded' };
  await saveDailyUsage('2026-10-27', { date: '2026-10-27', totalActiveSeconds: 50 });
  globalThis.chrome.runtime.lastError = null;

  metrics = defaultDiag.getHealthMetrics();
  assert.ok(metrics.runtimeErrors.count >= 1);

  const recent = defaultDiag.getRecentEvents(5);
  const errorEvent = recent.find(e => e.type === 'storage_write_error');
  assert.ok(errorEvent);
  assert.equal(errorEvent.outcome, 'failure');
});

