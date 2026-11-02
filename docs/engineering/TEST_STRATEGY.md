# WebTrack Engineering Test Strategy
**Authoritative Standards:** [AGENTS.md](../../AGENTS.md)  
**Scope:** Issues #5, #6, #7, #8 Verification

---

## 1. Testing Philosophy & Standards

In accordance with [AGENTS.md](../../AGENTS.md), testing must be reproducible, quantifiable, and non-destructive. Never delete or weaken existing tests to obtain a passing result. Test observable behavior wherever practical.

The test infrastructure leverages:
- **Node.js Native Test Runner (`node:test`)**: High performance, zero runtime overhead for JavaScript unit, integration, and concurrency tests.
- **Node.js Native Coverage (`--experimental-test-coverage`)**: Detailed line and branch coverage reporting without external dependencies.
- **Playwright**: Real-browser automation in Chromium/Chrome for UI surface verification and ground-truth timing benchmarks.

---

## 2. Testing Layers & Test Suite Structure

| Layer | Focus Area | Target File(s) | Primary Purpose |
|---|---|---|---|
| **Layer 1: Unit Tests** | Classifier, Week Math, Time Format, Diagnostics | `tests/classifier.test.mjs`<br>`tests/week-math.test.mjs`<br>`tests/aggregation.test.mjs`<br>`tests/diagnostics.test.mjs`<br>`tests/browser-compat.test.mjs` | Mathematical correctness, URL classification, edge cases, date math, diagnostic calculations. |
| **Layer 2: Tracker & Concurrency** | State Machine, Event Serialization, Checkpointing | `tests/tracker.test.mjs`<br>`tests/tracker-concurrency.test.mjs` | State transitions, race conditions, rapid activations, duplicate sessions, stale checkpoints, SW recovery. |
| **Layer 3: Storage & Batching** | Coalescing, Cache Consistency, Reconciliation | `tests/storage.test.mjs` | Write coalescing, dirty-read consistency, bounded flush, storage failure handling, stale-tab reconciliation. |
| **Layer 4: Decision Weighting** | Cleanup Candidate Scoring & Precedence | `tests/cleanup-suggestions.test.mjs` | $O(T+D)$ scoring, keep ratio, sample threshold, protected domains precedence, edge cases. |
| **Layer 5: Synthetic Benchmarks** | Stopwatch, SW Suspension, Storage Write Reduction | `tests/benchmarks.test.mjs` | Drift verification, 0s suspension loss, $\ge 35\%$ storage write reduction under 1,000 switch events. |
| **Layer 6: Browser UI Tests** | Rendered Dashboard & Cleanup Interaction | `tests/playwright/dashboard-diagnostics.test.mjs` | Live DOM rendering, privacy boundaries, interactive controls, error resilience. |
| **Layer 7: Ground-Truth Accuracy** | Real-Browser Controlled Timing Benchmark | `tests/playwright/browser-accuracy.benchmark.mjs` | $\ge 10$ runs of 90s controlled timeline, MAE $< 5\text{s}$, MedAE $< 2\text{s}$, error percentage $< 2\%$. |

---

## 3. Concurrency & Concurrency-Safety Test Matrix (Issue #6)

| Scenario | Simulated Condition | Expected Invariant |
|---|---|---|
| **Rapid Tab Activation** | 50 asynchronous `startSession` calls fired in parallel | Exactly 1 active session survives; no duplicate sessions ($N_{\text{active}} \le 1$). |
| **Repeated Focus Changes** | Alternating window blur/focus events interleaved with tab activation | States transition strictly between `TRACKING` $\leftrightarrow$ `PAUSED` without illegal state transitions. |
| **Idempotent Activations** | 10 repeated `startSession` calls for the currently active tab | No session restart, no redundant storage flushes, elapsed time continues linearly. |
| **Stale Checkpoint Rejection** | Older checkpoint version attempted while newer version exists | Monotonic version check discards stale write; latest checkpoint preserved. |
| **Suspension Recovery Race** | `init()` invoked simultaneously with incoming `onTabActivated` | Initializer runs to completion before event processing starts via serialization queue. |
| **Illegal State Transitions** | `pause()` while `INACTIVE`, `resume()` while `INACTIVE` | Safely ignored with diagnostic error logged; no unhandled rejections or crashes. |

---

## 4. Storage Optimization & Lifecycle Matrix (Issue #5)

| Scenario | Workload | Success Metric |
|---|---|---|
| **Rapid Tab Switches** | 1,000 rapid deactivation/activation events | Storage writes reduced by at least 35% compared to unbatched baseline ($\le 1,300$ writes). |
| **Read-Your-Own-Writes** | Write key, immediately read key before flush | Returns pending dirty value with 100% fidelity. |
| **Bounded Flush Hold** | Continuous stream of mutations | All pending mutations flushed within maximum hold time ($1,000\text{ms}$). |
| **Explicit Flush on Session End** | Call `endSession()` with unflushed storage queue | Queue flushed immediately before `endSession` resolves. |
| **Storage Error Recovery** | Injected storage runtime error | Failed writes retained in pending queue, retried on next flush, logged to diagnostics. |
| **Stale Tab Reconciliation** | Tracked tabs with closed browser tabs | Stale tab keys pruned from `tabs` Map and session storage; zero stale references remaining. |
| **API Error Conservatism** | `chrome.tabs.query` rejects | Reconciliation safely aborts; no valid tabs destroyed. |

---

## 5. Decision-Weighted Cleanup Matrix (Issue #8)

| Scenario | Input Condition | Expected Decision Outcome |
|---|---|---|
| **Sufficient Keep History** | 10 decisions: 9 keep, 1 close (keep ratio = 90%) | Tab suppressed from cleanup candidates (keep ratio $\ge 80\%$). |
| **Mixed Decision History** | 10 decisions: 5 keep, 5 close (keep ratio = 50%) | Tab retained as cleanup candidate; ranked by inactivity. |
| **Insufficient Sample** | 3 decisions: 3 keep, 0 close (keep ratio = 100%) | Tab retained as cleanup candidate (sample $< 5$, no false suppression). |
| **Protected Domain** | Domain in `settings.protectedDomains` (e.g. `docs.google.com`) | Always filtered out; 0 false suppression of protected domains regardless of history. |
| **Pinned / Audible Tabs** | Pinned or audible tab with close decisions | Filtered out by protection rules before ranking. |
| **Missing History** | Domain never seen before in decisions | Default behavior: eligible for cleanup. |
| **Batched Scale Test** | 500 candidate tabs across 100 unique domains | $O(T + D)$ complexity verified: execution completed in $< 10\text{ms}$ with single storage query. |

---

## 6. Real-Browser Accuracy Benchmark Specification (Issue #7)

### 6.1 Controlled Scenario (90-Second Timeline)
```text
T=00s: [Phase 1] Navigate Tab 1 (Site A), active & focused.
T=30s: [Phase 2] Switch to Tab 2 (Site B), active & focused.
T=55s: [Phase 3] Blur browser window (User away / inactive).
T=70s: [Phase 4] Focus browser window, resume Tab 1.
T=90s: [End] Collect tracked usage vs external stopwatch truth.
```

### 6.2 Ground Truth & Error Metric Formulas
- **Ground Truth Baseline:** High-resolution timers (`performance.now()`) managed independently by test runner.
- **Run Error:**
  $$\text{Absolute Error}_i = |T_{\text{tracked}, i} - T_{\text{truth}, i}|$$
- **Mean Absolute Error (MAE):**
  $$\text{MAE} = \frac{1}{N} \sum_{i=1}^{N} \text{Absolute Error}_i$$
- **Median Absolute Error (MedAE):**
  $$\text{MedAE} = \text{median}(\{\text{Absolute Error}_1, \dots, \text{Absolute Error}_N\})$$
- **Percentage Error:**
  $$\text{Percentage Error}_i = \frac{\text{Absolute Error}_i}{T_{\text{truth}, i}} \times 100\%$$
- **Requirements:**
  - Valid Runs ($N$): $\ge 10$ executions.
  - Target MAE: $< 5.0\text{s}$.
  - Target MedAE: $< 2.0\text{s}$.
  - Percentage Error: $< 2.0\%$.

---

## 7. Coverage Enforcement Targets

| Module | Line Coverage Target | Branch Coverage Target |
|---|---|---|
| `src/background/tracker.js` | $\ge 90.00\%$ | $\ge 85.00\%$ |
| `src/storage/storage.js` | $\ge 85.00\%$ | $\ge 80.00\%$ |
| `src/cleanup/suggestions.js` | $\ge 90.00\%$ | $\ge 85.00\%$ |
| `src/background/tab-manager.js` | $\ge 85.00\%$ | $\ge 80.00\%$ |
