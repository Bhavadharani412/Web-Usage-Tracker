/**
 * Decision-Weighted Cleanup Suggestions Tests (Issue #8).
 *
 * Verifies:
 * - Deterministic decision weighting
 * - Batched domain aggregation O(D)
 * - Candidate ranking & filtering O(T + D)
 * - Protected domain precedence (zero false suppression of protected domains)
 * - Insufficient history safeguard (no suppression if sample < minDecisionSample)
 * - High keep ratio suppression (>= keepRatioThreshold)
 * - Mixed decision scoring & ranking
 * - Missing/new domain defaults
 * - Invalid settings fallback
 * - Large candidate list performance scaling O(T + D)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupChromeMock } from './mock-chrome.mjs';

const mockEnv = setupChromeMock();

const {
  aggregateDomainDecisions,
  rankCleanupCandidates,
  DEFAULT_DECISION_WEIGHTS,
  getCleanupCandidates,
  closeTabs,
  keepTabs
} = await import('../src/cleanup/suggestions.js');

test('Issue #8 — Batched Decision Aggregation in O(D)', () => {
  const decisions = [
    { domain: 'github.com', action: 'keep', timestamp: 100 },
    { domain: 'github.com', action: 'keep', timestamp: 200 },
    { domain: 'github.com', action: 'close', timestamp: 300 },
    { domain: 'leetcode.com', action: 'keep', timestamp: 400 },
    { domain: 'reddit.com', action: 'close', timestamp: 500 },
    { domain: 'reddit.com', action: 'close', timestamp: 600 }
  ];

  const statsMap = aggregateDomainDecisions(decisions);

  assert.equal(statsMap.size, 3);

  const gh = statsMap.get('github.com');
  assert.equal(gh.keepCount, 2);
  assert.equal(gh.closeCount, 1);
  assert.equal(gh.total, 3);
  assert.equal(Number(gh.keepRatio.toFixed(4)), Number((2 / 3).toFixed(4)));

  const reddit = statsMap.get('reddit.com');
  assert.equal(reddit.keepCount, 0);
  assert.equal(reddit.closeCount, 2);
  assert.equal(reddit.total, 2);
  assert.equal(reddit.keepRatio, 0);
});

test('Issue #8 — Sufficient Keep History Triggers Suppression (>= 80% with >= 5 samples)', () => {
  const candidates = [
    { browserTabId: 1, domain: 'github.com', title: 'GitHub PR', inactiveSince: 1000 },
    { browserTabId: 2, domain: 'reddit.com', title: 'Reddit Feed', inactiveSince: 1000 }
  ];

  // 10 decisions for github.com: 9 keep, 1 close -> keepRatio = 90% (>= 80% threshold, sample 10 >= 5)
  // 6 decisions for reddit.com: 1 keep, 5 close -> keepRatio = 16.7%
  const decisions = [
    { domain: 'github.com', action: 'keep' },
    { domain: 'github.com', action: 'keep' },
    { domain: 'github.com', action: 'keep' },
    { domain: 'github.com', action: 'keep' },
    { domain: 'github.com', action: 'keep' },
    { domain: 'github.com', action: 'keep' },
    { domain: 'github.com', action: 'keep' },
    { domain: 'github.com', action: 'keep' },
    { domain: 'github.com', action: 'keep' },
    { domain: 'github.com', action: 'close' },

    { domain: 'reddit.com', action: 'close' },
    { domain: 'reddit.com', action: 'close' },
    { domain: 'reddit.com', action: 'close' },
    { domain: 'reddit.com', action: 'close' },
    { domain: 'reddit.com', action: 'close' },
    { domain: 'reddit.com', action: 'keep' }
  ];

  const ranked = rankCleanupCandidates(candidates, decisions, {
    minDecisionSample: 5,
    keepRatioThreshold: 0.80
  });

  // github.com must be suppressed from cleanup suggestions!
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].domain, 'reddit.com');
  assert.equal(ranked[0].browserTabId, 2);
});

test('Issue #8 — Insufficient Decision Sample (< 5) Does NOT Suppress (No False Suppression)', () => {
  const candidates = [
    { browserTabId: 10, domain: 'stackoverflow.com', title: 'StackOverflow Question', inactiveSince: 1000 }
  ];

  // Only 3 decisions (all keep: 100% keep ratio, but sample 3 < minSample 5)
  const decisions = [
    { domain: 'stackoverflow.com', action: 'keep' },
    { domain: 'stackoverflow.com', action: 'keep' },
    { domain: 'stackoverflow.com', action: 'keep' }
  ];

  const ranked = rankCleanupCandidates(candidates, decisions, {
    minDecisionSample: 5,
    keepRatioThreshold: 0.80
  });

  // Must NOT be suppressed due to insufficient evidence!
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].domain, 'stackoverflow.com');
  assert.equal(ranked[0].totalDecisions, 3);
});

test('Issue #8 — Strict Protected Domain Precedence (Zero False Suppression)', () => {
  const candidates = [
    { browserTabId: 21, domain: 'docs.google.com', title: 'Google Docs Budget', inactiveSince: 500 },
    { browserTabId: 22, domain: 'gmail.com', title: 'Gmail Inbox', inactiveSince: 600 },
    { browserTabId: 23, domain: 'news.ycombinator.com', title: 'Hacker News', inactiveSince: 700 }
  ];

  // Even if user closed docs.google.com 20 times in the past!
  const decisions = [];
  for (let i = 0; i < 20; i++) {
    decisions.push({ domain: 'docs.google.com', action: 'close' });
    decisions.push({ domain: 'gmail.com', action: 'close' });
  }

  const ranked = rankCleanupCandidates(candidates, decisions, {
    protectedDomains: ['docs.google.com', 'gmail.com', 'mail.google.com'],
    minDecisionSample: 5,
    keepRatioThreshold: 0.80
  });

  // Protected domains docs.google.com and gmail.com MUST be filtered out regardless of close history!
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].domain, 'news.ycombinator.com');
});

test('Issue #8 — Deterministic Scoring and Priority Ranking', () => {
  const now = Date.now();
  const candidates = [
    { browserTabId: 1, domain: 'neutral.com', inactiveSince: now - 300000 },
    { browserTabId: 2, domain: 'frequently-closed.com', inactiveSince: now - 100000 },
    { browserTabId: 3, domain: 'occasionally-kept.com', inactiveSince: now - 200000 }
  ];

  const decisions = [
    // frequently-closed.com: 5 closes, 0 keeps -> ratio = 0%
    { domain: 'frequently-closed.com', action: 'close' },
    { domain: 'frequently-closed.com', action: 'close' },
    { domain: 'frequently-closed.com', action: 'close' },
    { domain: 'frequently-closed.com', action: 'close' },
    { domain: 'frequently-closed.com', action: 'close' },

    // occasionally-kept.com: 3 keeps, 3 closes -> ratio = 50%
    { domain: 'occasionally-kept.com', action: 'keep' },
    { domain: 'occasionally-kept.com', action: 'keep' },
    { domain: 'occasionally-kept.com', action: 'keep' },
    { domain: 'occasionally-kept.com', action: 'close' },
    { domain: 'occasionally-kept.com', action: 'close' },
    { domain: 'occasionally-kept.com', action: 'close' }
  ];

  const ranked = rankCleanupCandidates(candidates, decisions, { minDecisionSample: 5 });

  assert.equal(ranked.length, 3);
  // Frequently-closed should be ranked first (lowest decisionScore)
  assert.equal(ranked[0].domain, 'frequently-closed.com');
  assert.ok(ranked[0].decisionScore < ranked[1].decisionScore || ranked[0].decisionScore < 0);
});

test('Issue #8 — Missing History and Invalid Settings Safe Defaults', () => {
  // Empty or invalid inputs must not throw
  assert.deepEqual(rankCleanupCandidates([], []), []);
  assert.deepEqual(rankCleanupCandidates(null, null), []);

  const candidates = [
    { browserTabId: 99, domain: 'brandnewdomain.org', inactiveSince: 500 }
  ];

  // Invalid thresholds passed (e.g. negative or out of bounds)
  const ranked = rankCleanupCandidates(candidates, [], {
    minDecisionSample: -10, // Invalid -> default 5
    keepRatioThreshold: 2.5 // Invalid -> default 0.80
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].domain, 'brandnewdomain.org');
  assert.equal(ranked[0].totalDecisions, 0);
  assert.equal(ranked[0].keepRatio, 0);
});

test('Issue #8 — Batched Large Candidate Scaling Test O(T + D)', () => {
  // Create 500 tabs across 100 unique domains
  const LARGE_TAB_COUNT = 500;
  const UNIQUE_DOMAINS = 100;

  const candidates = [];
  for (let i = 0; i < LARGE_TAB_COUNT; i++) {
    const domainIdx = i % UNIQUE_DOMAINS;
    candidates.push({
      browserTabId: i + 1,
      domain: `site-${domainIdx}.com`,
      title: `Page ${i}`,
      inactiveSince: 1000 + i,
      isPinned: false,
      isAudible: false
    });
  }

  // Create 1,000 decisions across those domains
  const decisions = [];
  for (let i = 0; i < 1000; i++) {
    const domainIdx = i % UNIQUE_DOMAINS;
    decisions.push({
      domain: `site-${domainIdx}.com`,
      action: domainIdx < 10 ? 'keep' : 'close', // First 10 domains are 100% keep
      timestamp: Date.now() + i
    });
  }

  const startTime = performance.now();
  const ranked = rankCleanupCandidates(candidates, decisions, {
    minDecisionSample: 5,
    keepRatioThreshold: 0.80
  });
  const durationMs = performance.now() - startTime;

  // 10 domains * 5 tabs each = 50 tabs should be suppressed
  // 500 - 50 = 450 tabs returned
  assert.equal(ranked.length, 450);

  // Performance invariant: O(T + D) must run in under 50ms for 1,500 total elements
  console.log(`\n--- Decision Weighting Scale Test O(T + D) ---`);
  console.log(`Candidate Tabs (T)     : ${LARGE_TAB_COUNT}`);
  console.log(`Decision Records (D)   : ${decisions.length}`);
  console.log(`Execution Duration     : ${durationMs.toFixed(3)} ms`);
  console.log(`Suppressed Tabs Count  : ${LARGE_TAB_COUNT - ranked.length}`);
  console.log(`----------------------------------------------\n`);

  assert.ok(durationMs < 50.0, `Scale test must execute in < 50ms, took ${durationMs.toFixed(3)}ms`);
});

test('Issue #8 — UI Helper Functions (getCleanupCandidates, closeTabs, keepTabs)', async () => {
  mockEnv.reset();

  // Test when chrome.runtime.sendMessage returns candidates
  chrome.runtime.sendMessage = (msg, cb) => {
    if (msg.type === 'GET_INACTIVE_TABS') {
      cb({ success: true, data: [{ browserTabId: 10, domain: 'test.com' }] });
    } else if (msg.type === 'CLOSE_TABS' || msg.type === 'KEEP_TABS') {
      cb({ success: true });
    } else {
      cb({ success: false });
    }
  };

  const candidates = await getCleanupCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].domain, 'test.com');

  const closeResult = await closeTabs([10]);
  assert.equal(closeResult, true);

  const keepResult = await keepTabs([10]);
  assert.equal(keepResult, true);

  // Fallback branch: response without success
  chrome.runtime.sendMessage = (msg, cb) => cb({ success: false });
  const emptyCandidates = await getCleanupCandidates();
  assert.deepEqual(emptyCandidates, []);

  const closeFail = await closeTabs([10]);
  assert.equal(closeFail, false);
  const keepFail = await keepTabs([10]);
  assert.equal(keepFail, false);

  // chrome.runtime.sendMessage absent branch
  const origSendMessage = chrome.runtime.sendMessage;
  delete chrome.runtime.sendMessage;
  const noApiCandidates = await getCleanupCandidates();
  assert.deepEqual(noApiCandidates, []);
  chrome.runtime.sendMessage = origSendMessage;

  // Options branch: ignorePinnedTabs = false and edge cases in aggregateDomainDecisions / rankCleanupCandidates
  const edgeDecisions = aggregateDomainDecisions('not-an-array');
  assert.equal(edgeDecisions.size, 0);

  const mixedInvalidDecisions = aggregateDomainDecisions([
    null,
    { domain: 123, action: 'keep' },
    { domain: '   ', action: 'keep' },
    { domain: 'valid.com', action: 'unknown_action' }
  ]);
  assert.equal(mixedInvalidDecisions.get('valid.com').total, 0);
  assert.equal(mixedInvalidDecisions.get('valid.com').keepRatio, 0);

  const preAggregatedMap = aggregateDomainDecisions([
    { domain: 'sub.example.com', action: 'keep' },
    { domain: 'sub.example.com', action: 'keep' },
    { domain: 'sub.example.com', action: 'keep' },
    { domain: 'sub.example.com', action: 'keep' },
    { domain: 'sub.example.com', action: 'keep' }
  ]);

  const mixedCandidates = [
    null,
    { browserTabId: 50, domain: 'example.com', isPinned: true, isAudible: true, inactiveSince: 100 },
    { browserTabId: 51, domain: 'example.com', isPinned: true, isAudible: false, inactiveSince: 150 },
    { browserTabId: 52, domain: 'example.com', isPinned: false, isAudible: true, inactiveSince: 160 },
    { browserTabId: 53, domain: 'internal', isInternal: true, inactiveSince: 170 },
    { browserTabId: 54, domain: '', hostname: 'sub.example.com', inactiveSince: 180 },
    { browserTabId: 55, domain: 'notime1.com' },
    { browserTabId: 56, domain: 'notime2.com' }
  ];

  // Filter with default pinned/audible protection and pre-aggregated Map
  const filteredDefault = rankCleanupCandidates(mixedCandidates, preAggregatedMap, {
    protectedDomains: null
  });
  assert.equal(filteredDefault.length, 2); // Only 55 and 56 remain (50,51,52 pinned/audible, 53 internal, 54 suppressed via hostname)

  const rankedWithPinned = rankCleanupCandidates(
    [{ browserTabId: 50, domain: 'example.com', isPinned: true, isAudible: true, inactiveSince: 100 }],
    [],
    {
      ignorePinnedTabs: false,
      ignoreAudibleTabs: false
    }
  );
  assert.equal(rankedWithPinned.length, 1);
});
