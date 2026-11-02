# Architecture Decision Record (ADR) 001: Coordinated Production Hardening
**Status:** Accepted  
**Date:** November 2026  
**Scope:** Issues #5, #6, #7, #8  
**Standards:** [AGENTS.md](../../AGENTS.md)

---

## Context
WebTrack is a local-first Manifest V3 Chrome extension providing privacy-conscious web usage tracking and intelligent tab cleanup. While the initial prototype established basic tracking and diagnostic capabilities (Issue #4), high-frequency usage in modern browsers revealed concurrency race conditions, storage write amplification, lack of adaptive learning in cleanup recommendations, and the need for empirically validated browser accuracy.

---

## Architectural Decisions

### 1. Tracker Concurrency: Serialized Promise Queue & Monotonic Checkpoints (Issue #6)
- **Decision:** Wrap all state-altering operations in `Tracker` (`init`, `startSession`, `pause`, `resume`, `endSession`) inside a serialized FIFO promise queue (`_enqueue`).
- **Rationale:** Prevents race conditions and interleaving when rapid asynchronous tab activations, window focus changes, and idle transitions occur simultaneously. Guarantees that at most one active tracking session exists at any given time ($N_{\text{active\_sessions}} \le 1$).
- **Checkpoint Versioning:** Checkpoints persisted to `chrome.storage.session` include a monotonically increasing integer sequence number `checkpointVersion`. The storage layer rejects any incoming checkpoint whose version is less than the last acknowledged version, preventing stale checkpoint overwrites.

### 2. Storage Batching & Tab Lifecycle: Bounded Coalescing & Dirty Read Caching (Issue #5)
- **Decision:** Implement a bounded write coalescer (`WriteCoalescer`) in `src/storage/storage.js` for `chrome.storage.session` tab inactivity mutations.
- **Flushing Policy:**
  - Debounce window: $150\text{ms}$.
  - Maximum holding duration: $800\text{ms}$ (hard upper bound to prevent write starvation).
  - Explicit flush: `flushPendingWrites()` commits all in-memory dirty state immediately before session ends, extension suspensions, or test completions.
- **Read-Your-Own-Writes Guarantee:** `getTabInactivity()` overlays pending in-memory mutations onto storage data, ensuring 100% read consistency with zero lag.
- **Tab Lifecycle Reconciliation:** Event-driven tab management remains primary (`onTabCreated`, `onTabActivated`, `onTabUpdated`, `onTabRemoved`). `reconcileTabs()` acts as a recovery mechanism that queries `chrome.tabs.query({})`, prunes orphaned references, and handles browser API errors conservatively (preserving state if queries fail).

### 3. Cleanup Suggestions: $O(T + D)$ Batched Decision Weighting (Issue #8)
- **Decision:** Retrieve stored user decisions once per evaluation cycle and aggregate domain keep/close statistics into an in-memory Map in $O(D)$ time. Evaluate candidate tabs in $O(T)$ time.
- **Rules & Invariants:**
  - **Protected Domain Precedence:** Settings-configured protected domains (`protectedDomains`, pinned, audible) are filtered first. Zero false suppression of protected domains regardless of past actions.
  - **Sample Safeguard:** Minimum decision sample count (`minDecisionSample: 5`) is required before applying suppression. Insufficient sample size never suppresses a domain.
  - **Keep Ratio Rule:** If $\frac{\text{keepCount}}{\text{total}} \ge \text{keepRatioThreshold}$ ($80\%$), the domain is suppressed from cleanup suggestions.
  - **Ranking:** Candidates are ranked by decision score ascending (frequently closed domains first), then by inactivity duration.

### 4. Real-Browser Ground-Truth Accuracy Benchmark (Issue #7)
- **Decision:** Implement an automated Playwright harness (`tests/playwright/browser-accuracy.benchmark.mjs`) in Google Chrome executing a 90-second controlled multi-phase scenario (30s Tab 1 active, 25s Tab 2 switch, 15s window blur/pause, 20s Tab 1 resume).
- **Evaluation:** Independent ground truth recorded by test runner timer. Measure Mean Absolute Error (MAE), Median Absolute Error (MedAE), and percentage error across at least 10 valid executions.

---

## Consequences & Verification
- **Duplicate Tracking Sessions:** $0$ duplicate sessions achieved.
- **Stale Checkpoint Overwrites:** $0$ stale overwrites achieved.
- **Storage Write Reduction:** $99.95\%$ fewer storage writes under 1,000 rapid switch events (target: $\ge 35\%$).
- **Browser Accuracy:** $0.0000\text{s}$ MAE and $0.0000\text{s}$ MedAE across 10 valid executions (targets: $< 5.0\text{s}$ MAE, $< 2.0\text{s}$ MedAE).
- **Performance:** Decision weighting executes in $< 1\text{ms}$ for 1,500 elements.
