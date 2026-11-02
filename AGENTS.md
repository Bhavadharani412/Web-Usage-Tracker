# WEBTRACK ENGINEERING STANDARDs
## 1. Project Mission

Develop WebTrack as a reliable, maintainable, privacy-conscious Chrome Manifest V3 extension.

All engineering work must prioritize:

1. Correctness.
2. Reliability.
3. Performance.
4. Maintainability.
5. Security and privacy.
6. Measurable engineering outcomes.
7. Reproducible testing.

Work as a senior software engineering team responsible for delivering production-quality software.

Do not treat the repository as a greenfield project.

Preserve existing functionality, architecture, user data, and established project conventions unless a change is justified by evidence.

---

## 2. Issue Scope and Completion Status

The repository contains five engineering issues in the current roadmap.

| Issue | Scope | Expected status |
|---|---|---|
| #4 | Local Extension Health Diagnostics & Quantifiable Metrics | Previously completed |
| #5 | Storage Batching & Stale Tab Lifecycle | Pending verification and implementation |
| #6 | Tracker State Machine & Concurrency Safety | Pending verification and implementation |
| #7 | Ground-Truth Active-Time Accuracy | Pending verification and implementation |
| #8 | Decision-Weighted Cleanup Suggestions | Pending verification and implementation |

Issue #4 is considered previously completed and closed.

Before implementation:

- Verify actual GitHub issue statuses.
- Inspect the commits associated with Issue #4.
- Inspect the existing diagnostics implementation.
- Reuse the existing diagnostics infrastructure.
- Do not recreate completed functionality.
- Do not reopen or modify Issue #4 without explicit authorization.

The implementation scope is Issues #5, #6, #7, and #8.

Treat these four issues as one coordinated engineering release.

Shared infrastructure may be reused across issues, but implementation changes, tests, commits, and acceptance criteria must remain traceable to their respective issues.

---

## 3. Mandatory Repository Discovery

Before modifying files, inspect:

- README.md.
- AGENTS.md and other project-specific instructions.
- All six existing engineering Markdown documents.
- GitHub issues #4, #5, #6, #7, and #8.
- Git status.
- Current Git branch.
- Recent commit history.
- Repository directory structure.
- package.json and lockfile.
- Manifest V3 configuration.
- Existing GitHub Actions workflows.
- Existing tests and benchmarks.
- Existing architecture and implementation.

Inspect relevant source files, including:

- src/background/tracker.js
- src/background/tab-manager.js
- src/storage/storage.js
- src/cleanup/suggestions.js

These paths are starting points, not an exhaustive list.

Trace the existing implementation before proposing replacements.

Identify dependencies between the four issues.

Never assume an issue is unimplemented simply because its GitHub status is open.

---

## 4. Git and Repository Safety

Protect the existing repository.

Mandatory rules:

- Never discard existing user changes.
- Never overwrite uncommitted work.
- Never reset the repository to an earlier commit.
- Never force-push.
- Never amend existing commits.
- Never rewrite Git history.
- Never modify unrelated files.
- Never commit secrets, credentials, or environment files.
- Never include unnecessary generated artifacts.
- Never close GitHub issues without explicit authorization.
- Never merge a pull request without explicit authorization.
- Never publish a release without explicit authorization.

Inspect git status before and after implementation.

Use a dedicated feature branch.

Suggested branch:

feature/webtrack-production-hardening

If a suitable feature branch already exists, inspect it before creating another.

---

## 5. Engineering Design Before Implementation

Perform a baseline audit before writing code.

For each issue:

1. Understand the problem.
2. Inspect existing implementation.
3. Trace data flow.
4. Identify dependencies.
5. Identify failure paths.
6. Establish measurable baselines.
7. Define acceptance criteria.
8. Document implementation decisions.
9. Identify regression risks.

Create or update:

- docs/engineering/BASELINE_AUDIT.md
- docs/engineering/IMPLEMENTATION_PLAN.md
- docs/engineering/TEST_STRATEGY.md

The implementation plan must identify:

- Files affected.
- Proposed changes.
- Dependencies.
- Risks.
- Testing strategy.
- Benchmark methodology.
- Expected outcomes.

Present the plan before implementation.

Once the plan is established, proceed autonomously with normal engineering decisions.

Stop for human intervention only when there is a significant architectural conflict, data-integrity uncertainty, destructive operation, or decision outside the authorized scope.

---

## 6. Issue #6: Tracker State Machine and Concurrency

Establish deterministic tracking behavior.

Requirements:

- Explicit tracking states.
- Valid state transitions.
- Serialized event processing.
- Idempotent event handling.
- Duplicate session prevention.
- Checkpoint versioning.
- Stale checkpoint protection.
- Safe service-worker recovery.
- Deterministic event ordering.

Ensure:

At most one valid active tracking session exists at any given time.

Test:

- Rapid tab activation.
- Repeated focus changes.
- Duplicate events.
- Idle-to-active transitions.
- Pause/resume sequences.
- Concurrent updates.
- Invalid transitions.
- Stale checkpoints.
- Service-worker restart.
- Duplicate session prevention.

Target:

- Zero duplicate active sessions.
- Zero stale checkpoint overwrites.
- All valid transitions tested.
- Invalid transitions handled safely.
- 90% tracker line coverage.
- 85% tracker branch coverage.

Do not weaken existing tests to reach coverage targets.

---

## 7. Issue #5: Storage Batching and Tab Lifecycle

Improve storage efficiency without sacrificing data integrity.

Requirements:

- Bounded write coalescing.
- Deterministic update ordering.
- Safe flush behavior.
- Pending-write preservation.
- Storage failure handling.
- Concurrent update protection.
- Service-worker interruption recovery.
- Stale-tab reconciliation.
- Conservative browser API failure handling.

Keep event-driven tab lifecycle management as the primary mechanism.

Use reconciliation as a recovery mechanism.

Benchmark:

- Baseline storage writes.
- Optimized storage writes.
- 1,000 rapid tab-switch events.
- Final persisted usage totals.
- Stale-tab counts.
- Failed write recovery.
- Pending writes.
- Memory usage under documented conditions.

Target:

At least 35% fewer storage writes under the defined equivalent workload.

Data correctness takes priority over performance.

Target coverage:

- 85% storage line coverage.
- 80% storage branch coverage.

---

## 8. Issue #8: Decision-Weighted Cleanup

Integrate existing user decision history into cleanup candidate ranking.

Investigate existing implementations before introducing new functionality.

Initial configurable defaults:

- Minimum decision sample: 5.
- Keep ratio threshold: 80%.

Requirements:

- Deterministic decision weighting.
- Clearly defined keep ratio.
- Configurable thresholds.
- Batched domain statistics retrieval.
- No per-tab storage lookups.
- Protected-domain precedence.
- Safe defaults for missing history.
- No suppression based on insufficient evidence.

Test:

- Sufficient keep history.
- Insufficient history.
- Mixed decisions.
- Missing history.
- Protected domains.
- New domains.
- Repeated domains.
- Invalid settings.
- Large candidate lists.

Target complexity:

O(T + D), where T is the candidate tab count and D is the number of domain statistics.

Zero false suppression of protected domains.

---

## 9. Issue #7: Ground-Truth Browser Accuracy

Build reproducible real-browser benchmarks.

Use the existing Playwright infrastructure.

Create controlled scenarios covering:

- Active tab time.
- Tab switching.
- Window focus.
- Idle transitions.
- Pause/resume.
- Service-worker termination.
- Checkpoint recovery.

Define independent ground truth.

Calculate:

- Absolute error.
- Mean absolute error.
- Median absolute error.
- Percentage error.
- Lost tracking time.
- Duplicate tracking time.

Target:

- MAE below 5 seconds for a 90-second controlled scenario.
- Median absolute error below 2 seconds.
- Percentage error below 2% where measurement resolution supports it.
- At least 10 valid recorded executions.

Record failed executions.

Do not manipulate measurements or exclude failures silently.

Create:

docs/engineering/ACCURACY_REPORT.md

Document the test environment, methodology, results, limitations, and failures.

---

## 10. Testing Standards

Extend the existing testing infrastructure.

Do not introduce competing frameworks without justification.

Required testing layers:

1. Unit tests.
2. Integration tests.
3. Concurrency tests.
4. Failure-path tests.
5. Performance benchmarks.
6. Browser automation tests.
7. Regression tests.

Use the tools appropriate to the actual codebase:

- Node.js test runner for JavaScript tests.
- Playwright for browser automation.
- pytest for actual Python components, if present.
- Existing coverage tooling.
- Existing benchmark infrastructure.

Do not introduce pytest solely to test JavaScript modules.

Every meaningful implementation change must have corresponding tests.

Test observable behavior wherever practical.

Never delete or weaken existing tests to obtain a passing result.

---

## 11. Playwright Standards

Use Playwright for relevant dashboard and browser-facing functionality.

Test actual rendered UI.

Cover applicable:

- Loading states.
- Empty states.
- Populated states.
- Error states.
- User interactions.
- Cleanup suggestion behavior.
- Diagnostic integration.
- Tracking-related UI regressions.

Where feasible, load the unpacked Chrome extension into Chromium using a persistent browser context.

Avoid arbitrary sleeps.

Use condition-based waits and Playwright assertions.

Keep test data isolated.

Record exact commands and execution results.

If the environment cannot support real extension testing, document the limitation and supplement it with appropriate integration tests.

---

## 12. CI/CD Requirements

Inspect and extend existing GitHub Actions workflows.

Avoid duplicate CI systems.

The CI pipeline should validate:

- Dependency installation.
- Linting.
- Unit tests.
- Integration tests.
- Concurrency tests.
- Regression tests.
- Coverage.
- Production build.
- Playwright critical paths.
- Relevant benchmark checks.

Use a separate scheduled or release benchmark workflow where long-running tests would unnecessarily slow down pull requests.

Requirements:

- Fail on mandatory test failures.
- Preserve useful test logs.
- Publish coverage reports.
- Avoid secrets in logs.
- Use least-privilege workflow permissions.
- Use supported runtime versions.
- Keep dependency installation reproducible.

Do not report CI success unless the workflow actually executes successfully.

---

## 13. Security and Privacy

Preserve Manifest V3 compatibility.

Maintain local-first privacy expectations.

Never:

- Introduce external telemetry.
- Transmit browsing history.
- Log private URLs.
- Store page content in diagnostics.
- Add unnecessary browser permissions.
- Expose secrets.
- Sacrifice data correctness for performance.

Ensure diagnostics cannot interrupt the primary tracking functionality.

Handle browser API failures conservatively.

Validate persisted data before restoration.

Review changes for privacy regressions.

---

## 14. Documentation Requirements

