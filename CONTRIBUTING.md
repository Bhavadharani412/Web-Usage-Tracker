# Contributing to WebTrack

Thank you for your interest in contributing to **WebTrack**, a privacy-first Chrome extension that tracks active web usage rather than simply measuring how long browser tabs remain open.

WebTrack is built around event-driven tracking, meaningful usage analytics, local data storage, and user-controlled tab management. Contributions that improve its reliability, usability, accessibility, performance, and privacy are welcome.

Whether you are fixing a bug, improving documentation, or proposing a new feature, this guide will help you get started.

## Table of Contents

- [Ways to Contribute](#ways-to-contribute)
- [Before You Start](#before-you-start)
- [Getting Started](#getting-started)
- [Development Guidelines](#development-guidelines)
- [Testing Your Changes](#testing-your-changes)
- [Commit Guidelines](#commit-guidelines)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Privacy and Security](#privacy-and-security)
- [Reporting Bugs](#reporting-bugs)
- [Community Expectations](#community-expectations)

## Ways to Contribute

You can contribute in several ways:

- **Bug fixes:** Correct inaccurate tracking, incorrect analytics, storage issues, or unexpected browser behavior.
- **Feature improvements:** Enhance usage summaries, website classification, dashboard usability, or tab cleanup suggestions.
- **Performance:** Reduce unnecessary processing and improve resource efficiency.
- **Testing:** Add test cases for tracking transitions, idle detection, tab switching, and data aggregation.
- **Documentation:** Improve setup instructions, explain architectural decisions, or document Chrome API behavior.
- **Accessibility and UI/UX:** Improve keyboard navigation, readability, responsiveness, and accessibility.
- **Privacy and security:** Identify privacy risks and improve local data handling.

For substantial changes, open an issue first to discuss the proposed solution before investing significant development time.

## Before You Start

1. Check the existing issues and pull requests for related work.
2. Review the README and relevant source files to understand the current implementation.
3. Confirm that the proposed change aligns with WebTrack's privacy-first design.
4. For major features or architectural changes, describe the problem, proposed approach, and expected impact in an issue.

Please avoid duplicating existing functionality without a clear reason.

## Getting Started

### Prerequisites

You will need:

- Google Chrome or another compatible Chromium-based browser.
- Git.
- A code editor such as Visual Studio Code.
- Basic knowledge of JavaScript, ES modules, browser APIs, and Chrome extensions.

### 1. Fork the repository

Create your own fork of the repository:

https://github.com/Bhavadharani412/Web-Usage-Tracker

### 2. Clone your fork

Replace `YOUR_USERNAME` with your GitHub username.

```bash
git clone https://github.com/YOUR_USERNAME/Web-Usage-Tracker.git
cd Web-Usage-Tracker
```

### 3. Add the upstream repository

```bash
git remote add upstream https://github.com/Bhavadharani412/Web-Usage-Tracker.git
git remote -v
```

### 4. Create a branch

Use a descriptive branch name based on your contribution.

```bash
git checkout -b fix/idle-tracking
```

Examples:

- `fix/tab-switch-tracking`
- `feat/usage-export`
- `docs/setup-guide`
- `test/usage-aggregation`
- `refactor/domain-classification`

### 5. Load the extension locally

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the project directory containing the extension's `manifest.json`.
5. Open the extension and verify that its existing functionality works.

If the repository's structure or README specifies a different extension directory, select the directory containing the actual `manifest.json` instead.

No backend service or account should be necessary for the extension's core local-first functionality.

## Development Guidelines

### Keep the architecture maintainable

WebTrack uses JavaScript, ES modules, Chrome Manifest V3, browser events, and local persistence.

When contributing:

- Keep responsibilities separated between tracking, tab management, idle detection, classification, aggregation, persistence, and presentation.
- Prefer event-driven state transitions over unnecessary continuously running timers.
- Follow the existing module structure and coding conventions.
- Avoid introducing dependencies when a small, well-tested implementation is sufficient.
- Handle missing, stale, or unavailable browser state gracefully.
- Keep user-facing behavior predictable and document important architectural changes.

### Preserve accurate tracking

Active browsing time must not be confused with the time a tab remains open.

When modifying tracking logic, consider:

- Switching between tabs.
- Switching between browser windows.
- Moving focus to another application.
- Entering and leaving an idle state.
- Closing tabs or browser windows.
- Browser startup, suspension, and service-worker restarts.
- Restoring or recovering persisted tracking state.

Test the relevant transitions rather than validating only the happy path.

### Respect domain classification

WebTrack groups usage by normalized domains and classification rules.

When changing classification logic:

- Preserve consistent domain normalization.
- Avoid accidentally counting the same website as multiple unrelated entries.
- Handle URLs that cannot be classified.
- Keep category assignment predictable.
- Add regression tests for changed rules.

### Follow existing storage conventions

WebTrack uses `chrome.storage.local` for local persistence.

- Reuse the existing storage abstractions and data formats where practical.
- Handle missing or malformed stored values.
- Avoid unnecessary writes and duplicate records.
- Preserve existing user data when changing storage formats.
- Document migration or compatibility requirements when applicable.

## Testing Your Changes

Before submitting a pull request:

1. Reload the unpacked extension in Chrome.
2. Verify the feature or fix manually.
3. Test relevant edge cases and state transitions.
4. Check the extension's service-worker and popup console for errors.
5. Confirm that existing functionality still works.
6. Run any automated tests or validation commands already provided by the repository.

Do not assume that a test command exists. Check the repository's `README.md`, `package.json`, and existing test configuration before running project-specific commands.

If automated tests are not available for the affected functionality, explain the manual validation performed in your pull request.

### Suggested manual checks

| Area | What to verify |
|---|---|
| Active tracking | Time accumulates only when tracking conditions are satisfied. |
| Tab switching | Tracking moves to the appropriate active tab. |
| Idle detection | Tracking pauses during idle periods and resumes correctly. |
| Window focus | Switching away from Chrome does not incorrectly accumulate active time. |
| Persistence | Stored usage survives expected service-worker interruptions. |
| Analytics | Daily and weekly summaries reflect the underlying usage data. |
| Classification | Related URLs are grouped consistently. |
| Tab cleanup | Suggestions are accurate and user-controlled. |
| Privacy | Browsing data is not transmitted to an external service unexpectedly. |

## Commit Guidelines

Use clear, descriptive commit messages. A conventional commit format is encouraged:

```text
type(scope): concise description
```

Examples:

```text
fix(tracking): correct idle-state transitions
feat(analytics): improve weekly usage summaries
test(classification): cover normalized domains
docs(contributing): clarify local setup
refactor(storage): simplify persistence handling
```

Suggested types:

- `feat`: New functionality.
- `fix`: Bug fixes.
- `docs`: Documentation changes.
- `test`: Test-related changes.
- `refactor`: Code restructuring without intended behavior changes.
- `perf`: Performance improvements.
- `style`: Formatting or style-only changes.

Keep commits focused on logically related changes.

## Submitting a Pull Request

### 1. Commit your changes

```bash
git add <changed-files>
git commit -m "fix(tracking): correct idle-state transitions"
```

### 2. Push your branch

```bash
git push -u origin fix/idle-tracking
```

### 3. Open a pull request

Create a pull request against the repository's default branch:

https://github.com/Bhavadharani412/Web-Usage-Tracker/pulls

Include the following information:

- **Problem:** What issue are you addressing?
- **Solution:** What did you change, and why?
- **Testing:** Which tests or manual checks did you perform?
- **Impact:** Does the change affect existing behavior, storage, permissions, or compatibility?
- **Screenshots:** Include them for relevant UI changes.

A good pull request should be focused, understandable, and small enough to review efficiently.

Please link related issues where applicable. Be prepared to discuss feedback and make revisions.

## Privacy and Security

Privacy is a core design principle of WebTrack, not an optional enhancement.

Contributions must preserve the project's local-first approach.

- Do not introduce telemetry, tracking pixels, or undisclosed network requests.
- Do not transmit browsing history or usage data to external servers without an explicitly reviewed design and appropriate user consent.
- Request only the Chrome permissions that are necessary for the feature.
- Do not log sensitive browsing information unnecessarily.
- Avoid collecting or retaining more information than the feature requires.
- Keep tab cleanup suggestions under the user's control. Do not automatically close tabs as a substitute for user approval.
- Explain any changes that affect data retention, storage, permissions, or privacy behavior.

If you discover a security vulnerability, avoid publishing exploit details in a public issue. Contact the repository maintainer privately to coordinate responsible disclosure.

## Reporting Bugs

When opening a bug report, provide enough information for someone else to reproduce the issue.

Include:

- A clear, descriptive title.
- Steps to reproduce the problem.
- Expected behavior.
- Actual behavior.
- Chrome version and operating system.
- Relevant console errors or logs, with sensitive information removed.
- Screenshots or a short recording when useful.

For tracking-related bugs, specify the sequence of events involved, such as switching tabs, becoming idle, or changing application focus.

Before submitting, check whether the issue has already been reported.

## Community Expectations

We want WebTrack to be a welcoming project for contributors of different experience levels.

- Be respectful and constructive.
- Explain technical disagreements with evidence and clear reasoning.
- Give actionable feedback during reviews.
- Be open to suggestions and alternative implementations.
- Credit original work and respect third-party licenses.
- Keep discussions focused on improving the project.

First-time contributions are welcome. You do not need to understand the entire codebase before making a useful improvement.

## Thank You

Every thoughtful contribution helps make WebTrack more accurate, reliable, maintainable, and privacy-conscious.

Thank you for taking the time to improve WebTrack.

**Happy contributing!** 🚀
