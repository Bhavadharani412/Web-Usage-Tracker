/**
 * Popup JS — loads today's usage data and renders the compact dashboard.
 * Also handles first-time onboarding overlay (wt_onboarding_seen flag).
 */

import '../utils/browser-adapter.js';
import { formatDuration } from '../utils/time-format.js';
import { getCleanupCandidates, closeTabs, keepTabs } from '../cleanup/suggestions.js';
import { renderCleanupList } from '../cleanup/cleanup-ui.js';

// ─── Message Helper ────────────────────────────────────────

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

// ─── Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initOnboarding();
  await loadTodayUsage();
  await loadInactiveTabs();
  setupEventListeners();

  // Auto-refresh every 30 seconds
  setInterval(async () => {
    await loadTodayUsage();
    await loadInactiveTabs();
  }, 30000);
});

// ─── Onboarding ────────────────────────────────────────────

async function initOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;

  const result = await chrome.storage.local.get('wt_onboarding_seen');
  if (!result.wt_onboarding_seen) {
    overlay.classList.remove('hidden');
    // Trap focus inside the overlay
    const gotItBtn = document.getElementById('onboardingGotIt');
    gotItBtn?.focus();
  }
}

function dismissOnboarding() {
  chrome.storage.local.set({ wt_onboarding_seen: true });
  const overlay = document.getElementById('onboardingOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

// ─── Today's Usage ─────────────────────────────────────────

async function loadTodayUsage() {
  const response = await sendMessage({ type: 'GET_TODAY_USAGE' });
  const statusResponse = await sendMessage({ type: 'GET_TRACKER_STATUS' });

  if (!response?.success) {
    showEmptyState();
    return;
  }

  const daily = response.data;
  const status = statusResponse?.data;

  // Update tracking status indicator
  updateTrackingStatus(status);

  // Update total time
  const todayTotal = document.getElementById('todayTotal');
  todayTotal.textContent = formatDuration(daily.totalActiveSeconds);

  // Render website list
  renderWebsites(daily);
}

function updateTrackingStatus(status) {
  const statusEl = document.getElementById('trackingStatus');
  if (!statusEl) return;

  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');

  if (!status) {
    dot.className = 'status-dot';
    text.textContent = 'Idle';
    return;
  }

  switch (status.state) {
    case 'TRACKING':
      dot.className = 'status-dot active';
      text.textContent = 'Tracking';
      break;
    case 'PAUSED':
      dot.className = 'status-dot paused';
      text.textContent = 'Paused';
      break;
    default:
      dot.className = 'status-dot';
      text.textContent = 'Idle';
  }
}

function renderWebsites(daily) {
  const container = document.getElementById('websitesList');
  const websites = daily.websites || {};

  // Sort by time descending
  const sorted = Object.entries(websites)
    .filter(([id, seconds]) => seconds > 0 && id !== 'browser' && id !== 'unknown')
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="websites-empty">
        <span class="websites-empty-icon">🌐</span>
        <p>No browsing activity yet today.</p>
        <p style="margin-top: 4px; font-size: 11px; color: var(--text-muted);">
          Start browsing and your usage will appear here.
        </p>
      </div>
    `;
    return;
  }

  const maxTime = sorted[0][1];
  const topItems = sorted.slice(0, 8); // Show top 8

  container.innerHTML = topItems.map(([categoryId, seconds], index) => {
    const name = daily.websiteNames?.[categoryId] || categoryId;
    const icon = daily.websiteIcons?.[categoryId] || '🌐';
    const barWidth = Math.max(2, Math.round((seconds / maxTime) * 100));

    return `
      <div class="website-item" style="animation-delay: ${index * 0.04}s">
        <span class="website-icon" aria-hidden="true">${icon}</span>
        <div class="website-info">
          <div class="website-name">${escapeHtml(name)}</div>
          <div class="website-bar-container" role="progressbar" aria-valuenow="${barWidth}" aria-valuemin="0" aria-valuemax="100">
            <div class="website-bar" style="width: ${barWidth}%"></div>
          </div>
        </div>
        <span class="website-time">${formatDuration(seconds)}</span>
      </div>
    `;
  }).join('');

  // If there are more websites, show a count
  if (sorted.length > 8) {
    container.innerHTML += `
      <div class="website-item" style="justify-content: center;" id="showMoreSites">
        <span style="font-size: 12px; color: var(--text-muted);">
          + ${sorted.length - 8} more sites
        </span>
      </div>
    `;
  }
}

function showEmptyState() {
  const container = document.getElementById('websitesList');
  container.innerHTML = `
    <div class="websites-empty">
      <span class="websites-empty-icon">📊</span>
      <p>Loading usage data…</p>
    </div>
  `;
}

// ─── Inactive Tabs ─────────────────────────────────────────

async function loadInactiveTabs() {
  const candidates = await getCleanupCandidates();
  const section = document.getElementById('inactiveSection');
  const text = document.getElementById('inactiveText');

  if (candidates.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  text.textContent = `${candidates.length} inactive tab${candidates.length !== 1 ? 's' : ''}`;
}

// ─── Event Listeners ───────────────────────────────────────

function setupEventListeners() {
  // Onboarding "Got it"
  document.getElementById('onboardingGotIt')?.addEventListener('click', dismissOnboarding);

  // Keyboard: close onboarding with Escape
  document.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('onboardingOverlay');
    if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
      dismissOnboarding();
    }
  });

  // Open dashboard
  document.getElementById('openDashboard')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html') });
    window.close();
  });

  // Inactive tabs button
  const inactiveBtn = document.getElementById('inactiveBtn');
  inactiveBtn?.addEventListener('click', async () => {
    const cleanupSection = document.getElementById('cleanupSection');
    const inactiveSection = document.getElementById('inactiveSection');
    const isOpen = cleanupSection.style.display !== 'none';

    if (!isOpen) {
      // Show cleanup panel
      const candidates = await getCleanupCandidates();
      cleanupSection.style.display = 'block';
      inactiveSection.style.display = 'none';
      inactiveBtn.setAttribute('aria-expanded', 'true');

      renderCleanupList(cleanupSection, candidates, {
        onCloseSelected: async (tabIds) => {
          await closeTabs(tabIds);
          await refreshAfterCleanup();
        },
        onKeepSelected: async (tabIds) => {
          await keepTabs(tabIds);
          await refreshAfterCleanup();
        }
      });
    } else {
      cleanupSection.style.display = 'none';
      inactiveSection.style.display = 'block';
      inactiveBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

async function refreshAfterCleanup() {
  const cleanupSection = document.getElementById('cleanupSection');
  const inactiveSection = document.getElementById('inactiveSection');
  const inactiveBtn = document.getElementById('inactiveBtn');

  // Refresh candidates
  const candidates = await getCleanupCandidates();

  if (candidates.length === 0) {
    cleanupSection.style.display = 'none';
    inactiveSection.style.display = 'none';
    inactiveBtn?.setAttribute('aria-expanded', 'false');
  } else {
    renderCleanupList(cleanupSection, candidates, {
      onCloseSelected: async (tabIds) => {
        await closeTabs(tabIds);
        await refreshAfterCleanup();
      },
      onKeepSelected: async (tabIds) => {
        await keepTabs(tabIds);
        await refreshAfterCleanup();
      }
    });
  }

  // Also refresh today's usage
  await loadTodayUsage();
}

// ─── Utility ───────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
