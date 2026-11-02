# WebTrack Engineering Baseline Audit
**Authoritative Standards:** [AGENTS.md](../../AGENTS.md)  
**Date:** November 2026  
**Git Branch:** `feature/webtrack-production-hardening`  
**Base Commit:** `e9be77e` (docs(diagnostics): document health diagnostics, test coverage, and benchmark results)

---

## 1. Executive Summary

This audit establishes the pre-implementation baseline across the WebTrack repository for the coordinated release covering **Issues #5, #6, #7, and #8**. Issue #4 (*Local Extension Health Diagnostics & Quantifiable Metrics*) was previously completed, verified, and closed.

The baseline audit confirms that while the core extension architecture (Manifest V3, event-driven tracking, session checkpointing, URL classification) is solid, significant gaps exist in:
1. **Event concurrency and serialization** (Issue #6): Asynchronous tab events interleave, risking duplicate sessions and state desynchronization.
2. **Storage write amplification** (Issue #5): Every tab state mutation synchronously triggers individual storage calls without batching or coalescing.
3. **Adaptive cleanup intelligence** (Issue #8): Tab decisions are persisted but completely ignored by the cleanup candidate ranking engine.
4. **End-to-end browser ground-truth accuracy** (Issue #7): Existing benchmarks use mocked timers and synthetic events; real-browser multi-run accuracy benchmarks are missing.

---

## 2. Issue Status & Scope Verification

| Issue | Title | Status | Baseline Findings |
|---|---|---|---|
| **#4** | Local Extension Health Diagnostics & Quantifiable Metrics | **Closed / Verified** | Completed in commits `270d04f` to `e9be77e`. Implements bounded 100-event rolling buffer, p50/p95 latency percentiles, SW recovery tracking, and Playwright verification. 10 unit/integration tests and 5 Playwright tests pass cleanly. |
| **#5** | Storage Batching & Stale Tab Lifecycle | **Pending Implementation** | No write coalescing. Rapid tab switching triggers direct storage writes on every event. Stale tab reconciliation only runs on service worker startup. Baseline coverage: 53.81% line, 57.14% branch. |
| **#6** | Tracker State Machine & Concurrency Safety | **Pending Implementation** | `tracker.js` lacks an event serialization queue; rapid concurrent async calls (`startSession`, `pause`, `resume`, `endSession`) race. State transitions are implicit without validation guards or checkpoint versioning. Baseline coverage: 82.18% line, 59.52% branch. |
| **#7** | Ground-Truth Active-Time Accuracy | **Pending Implementation** | Existing benchmarks (`tests/benchmarks.test.mjs`) verify stopwatch math and forced suspension in Node mocks, but lack multi-run real-browser ground-truth benchmarks against an independent timer with MAE/MedAE calculations. |
| **#8** | Decision-Weighted Cleanup Suggestions | **Pending Implementation** | `src/cleanup/suggestions.js` and `tab-manager.js:getInactiveTabs` do not incorporate decision history. No keep-ratio calculation, no sample thresholds, and no batched domain statistics. |

---

## 3. Detailed Baseline Code Analysis

### 3.1 Tracker State Machine & Concurrency (`src/background/tracker.js`)
- **State Machine Definition:** Three states (`INACTIVE`, `TRACKING`, `PAUSED`). Transitions are enforced via ad-hoc `if (this.state !== ...)` checks rather than an explicit transition table.
- **Concurrency Defect:** `startSession(tabId, classification)` is an `async` function. When invoked, it calls `await this.endSession()`. During this asynchronous tick, incoming events (e.g. `onTabActivated` from another tab or `onWindowFocusChanged`) execute in parallel. This creates a race condition where multiple active sessions can be instantiated or cleared out of order.
- **Checkpoint Versioning Defect:** Checkpoints stored in `chrome.storage.session` do not contain a monotonic sequence number or version tag. An older asynchronous checkpoint write could overwrite a newer one.
- **Idempotency Defect:** Invoking `startSession` repeatedly for the same active tab tears down and restarts the session, causing artificial session fragmentation and unnecessary storage flushes.

### 3.2 Storage Layer & Lifecycle (`src/storage/storage.js`, `tab-manager.js`)
- **Write Amplification:**
  - `persistTabInactive(tabId, timestamp)` executes an individual async write to `chrome.storage.session` on every background tab creation or deactivation.
  - In a workload of 1,000 rapid tab-switch events, 2,000 distinct storage write operations are executed.
  - No write coalescing or debouncing window exists.
- **Data Consistency:** Writes are not buffered in an in-memory dirty cache. A `get()` issued immediately after a pending `set()` before Chrome's callback fires can read stale data.
- **Tab Lifecycle Reconciliation:**
  - `tabManager.init()` queries `chrome.tabs.query({})` and prunes stale tab keys from session storage, but this reconciliation occurs only once at startup.
  - If browser API calls fail (`chrome.tabs.query` error), tabManager does not implement conservative fallback handling.

### 3.3 Cleanup Suggestions (`src/cleanup/suggestions.js`, `src/storage/storage.js`)
- **Decision Storage:** `recordTabDecision()` and `getTabDecisions()` exist and persist up to 500 decisions (`{ domain, action, timestamp }`).
- **Missing Integration:** `tabManager.getInactiveTabs()` filters tabs purely on inactivity duration and static settings (`ignorePinnedTabs`, `ignoreAudibleTabs`, `protectedDomains`). It never consults decision history.
- **Performance Risk:** A naive implementation would query storage per tab ($O(T \times S)$). The required target is $O(T + D)$ using batched domain aggregation.
- **Safety Defaults:** Must enforce `minDecisionSample` (default: 5) and `keepRatioThreshold` (default: 80%), with strict precedence for `protectedDomains` (zero false suppression).

### 3.4 Browser Accuracy & Testing Infrastructure
- **Existing Test Runner:** Node.js native test runner (`node:test`) running 25 unit/integration tests and 5 Playwright UI tests.
- **Test Execution Time:** 25 unit tests execute in ~280ms.
- **Playwright Status:** Playwright 1.64.1 is installed and operational with local Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`).
- **Gaps:** Need a dedicated real-browser multi-run benchmark (`tests/playwright/browser-accuracy.benchmark.mjs`) executing at least 10 controlled runs (90s scenarios) measuring absolute error, MAE, median absolute error, and percentage error against external ground-truth timestamps.

---

## 4. Pre-Implementation Baseline Metrics

| Metric | Current Baseline | Target | Status |
|---|---|---|---|
| **Duplicate Active Sessions** | Risk present under concurrent async calls | 0 | Unmet (Issue #6) |
| **Stale Checkpoint Overwrites** | Risk present (unversioned writes) | 0 | Unmet (Issue #6) |
| **Storage Writes (1,000 Switch Events)** | 2,000 writes (1 per event) | $\le 1,300$ writes ( $\ge 35\%$ reduction) | Unmet (Issue #5) |
| **Storage Data Loss** | 0 | 0 | Maintained |
| **Stale References After Reconciliation** | 0 at startup; unmanaged at runtime | 0 | Unmet (Issue #5) |
| **Decision-Weighted Cleanup** | Not implemented (0% integration) | $O(T+D)$ batched scoring, $\ge 80\%$ keep ratio | Unmet (Issue #8) |
| **Protected-Domain False Suppression** | N/A (unranked) | 0 false suppressions | Unmet (Issue #8) |
| **Tracker Line Coverage** | 82.18% | $\ge 90.00\%$ | Unmet (Issue #6) |
| **Tracker Branch Coverage** | 59.52% | $\ge 85.00\%$ | Unmet (Issue #6) |
| **Storage Line Coverage** | 53.81% | $\ge 85.00\%$ | Unmet (Issue #5) |
| **Storage Branch Coverage** | 57.14% | $\ge 80.00\%$ | Unmet (Issue #5) |
| **Ground-Truth MAE (90s scenario)** | Not measured in real browser | $< 5.0\text{s}$ | Unmet (Issue #7) |
| **Ground-Truth Median Absolute Error** | Not measured in real browser | $< 2.0\text{s}$ | Unmet (Issue #7) |
| **Valid Browser Accuracy Runs** | 0 | $\ge 10$ runs | Unmet (Issue #7) |

---

## 5. Architectural Invariants to Maintain
1. **Manifest V3 Compliance:** Service worker lifespan is ephemeral; all critical in-progress tracking state must be checkpointed to survive suspension.
2. **Local-First Privacy:** Zero telemetry, no external HTTP requests, and strict sanitization of URLs/titles in diagnostics.
3. **Backward Compatibility:** Existing schema (`SCHEMA_VERSION = 1`) and storage keys (`wt_settings`, `wt_daily_YYYY-MM-DD`, `wt_tab_decisions`, `wt_diagnostics`) must remain fully compatible.
4. **Non-Destructive Cleanup:** WebTrack suggests cleanup; tabs are never closed automatically without explicit user confirmation.
