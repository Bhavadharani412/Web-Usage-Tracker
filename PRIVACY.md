# Privacy Policy & Security Architecture — WebTrack

> **WebTrack is 100% private, local-first, and zero-telemetry.**

This document outlines the privacy commitments, architecture, and explicit permission justifications for the WebTrack Chrome extension.

---

## Core Privacy Commitments

1. **100% Local Processing & Storage**  
   All website classification, session tracking, daily statistics, and tab hygiene metrics are computed and stored entirely on your local device inside your browser (`chrome.storage.local` and `chrome.storage.session`).

2. **Zero External Network Requests**  
   WebTrack does not contain any remote API endpoints, server connections, tracking scripts, or analytics services. It functions completely offline.

3. **No Domain/URL Leakage**  
   WebTrack does not transmit your browsing history, page contents, keystrokes, form entries, or search queries anywhere.

4. **Transparent Data Management**  
   You retain full ownership and control of your data. You can inspect or clear all stored usage data at any time via **Dashboard → Settings → Clear all data**.

---

## Permission Justification

Manifest V3 requires extensions to explicitly request permissions. Here is why WebTrack requests each permission:

| Permission | Purpose & Scope | Justification |
| :--- | :--- | :--- |
| `tabs` | Read tab URLs, titles, and active status | **Required for core functionality:**<br>1. Identifies the domain/category of the active tab to measure time.<br>2. Tracks tab activation and deactivation timestamps to suggest inactive tabs for cleanup.<br>*(URLs are processed locally by the classifier engine; raw URLs are never sent off-device or stored beyond domain-level aggregation).* |
| `storage` | Store local configuration and usage metrics | **Required for persistence:**<br>Stores settings, daily/weekly aggregated usage summaries (`chrome.storage.local`), and active session checkpoints (`chrome.storage.session`) so state survives service-worker suspensions. |
| `idle` | Detect system idle status | **Required for accurate time measurement:**<br>Detects when you walk away from your keyboard/mouse so active tracking automatically pauses. |
| `alarms` | Schedule background periodic flushes & maintenance | **Required for data integrity:**<br>Fires every 5 minutes to flush in-progress tracking time to storage and hourly to clean up retention records. |

---

## Data Architecture & Retention

- **Granularity:** WebTrack aggregates time at the **domain** and **website category** level (e.g., `LeetCode`, `GitHub`, `Gmail`).
- **Retention:** Usage data is retained locally for up to **90 days** to power weekly trend reports. Older records are automatically pruned.
- **Service Worker Suspension Survival:** Active tracking sessions checkpoint state to `chrome.storage.session` on every state transition. If Chrome suspends the background service worker, un-flushed time is preserved with zero data loss.
