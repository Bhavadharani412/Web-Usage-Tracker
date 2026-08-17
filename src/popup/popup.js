/**
 * Popup JS — loads today's usage data and renders the compact dashboard.
 */

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
  await loadTodayUsage();
  await loadInactiveTabs();
  setupEventListeners();

  // Auto-refresh every 30 seconds
  setInterval(async () => {
    await loadTodayUsage();
    await loadInactiveTabs();
  }, 30000);
});

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
      <div class="website-item" style="animation-delay: ${index * 0.05}s">
        <span class="website-icon">${icon}</span>
        <div class="website-info">
          <div class="website-name">${escapeHtml(name)}</div>
          <div class="website-bar-container">
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
      <div class="website-item" style="justify-content: center; cursor: pointer;" id="showMoreSites">
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
      <p>Loading usage data...</p>
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
  // Open dashboard
  document.getElementById('openDashboard')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html') });
    window.close();
  });

  // Inactive tabs button
  document.getElementById('inactiveBtn')?.addEventListener('click', async () => {
    const cleanupSection = document.getElementById('cleanupSection');
    const inactiveSection = document.getElementById('inactiveSection');

    if (cleanupSection.style.display === 'none') {
      // Show cleanup panel
      const candidates = await getCleanupCandidates();
      cleanupSection.style.display = 'block';
      inactiveSection.style.display = 'none';

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
    }
  });
}

async function refreshAfterCleanup() {
  const cleanupSection = document.getElementById('cleanupSection');
  const inactiveSection = document.getElementById('inactiveSection');

  // Refresh candidates
  const candidates = await getCleanupCandidates();

  if (candidates.length === 0) {
    cleanupSection.style.display = 'none';
    inactiveSection.style.display = 'none';
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
