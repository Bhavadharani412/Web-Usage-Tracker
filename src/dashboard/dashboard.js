/**
 * Dashboard JS — renders Today, Weekly, Tab Hygiene, and Settings tabs.
 */

import { formatDuration, formatDate, formatDateFull, getDateString, getDayName, percentChange } from '../utils/time-format.js';
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
  setupNavigation();
  await loadTodayTab();
  setupSettings();
});

// ─── Navigation ────────────────────────────────────────────

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.tab-panel');

  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      const tabName = item.dataset.tab;

      // Update active nav
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // Show panel with animation
      panels.forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
      });

      const panel = document.getElementById(`panel${capitalize(tabName)}`);
      if (panel) {
        panel.style.display = 'block';
        // Trigger reflow for animation
        void panel.offsetHeight;
        panel.classList.add('active');
      }

      // Load data for the tab
      switch (tabName) {
        case 'today':
          await loadTodayTab();
          break;
        case 'weekly':
          await loadWeeklyTab();
          break;
        case 'hygiene':
          await loadHygieneTab();
          break;
        case 'settings':
          await loadSettings();
          break;
      }
    });
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Today Tab ─────────────────────────────────────────────

async function loadTodayTab() {
  const response = await sendMessage({ type: 'GET_TODAY_USAGE' });
  const statusResponse = await sendMessage({ type: 'GET_TRACKER_STATUS' });

  // Set date
  document.getElementById('todayDate').textContent = formatDateFull(new Date());

  if (!response?.success) return;

  const daily = response.data;
  const status = statusResponse?.data;

  // Stats
  document.getElementById('todayTotalTime').textContent = formatDuration(daily.totalActiveSeconds);
  document.getElementById('todaySiteCount').textContent = Object.keys(daily.websites || {}).filter(k => daily.websites[k] > 0 && k !== 'browser' && k !== 'unknown').length;
  document.getElementById('todayTabCount').textContent = status?.openTabs || 0;

  // Website list
  renderTodayWebsites(daily);
}

function renderTodayWebsites(daily) {
  const container = document.getElementById('todayWebsites');
  const websites = daily.websites || {};

  const sorted = Object.entries(websites)
    .filter(([id, seconds]) => seconds > 0 && id !== 'browser' && id !== 'unknown')
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🌐</span>
        <p>No activity recorded yet today.</p>
        <p style="margin-top: 6px; font-size: 12px; color: var(--text-muted);">
          Start browsing and your usage will appear here.
        </p>
      </div>
    `;
    return;
  }

  const maxTime = sorted[0][1];

  container.innerHTML = sorted.map(([categoryId, seconds], index) => {
    const name = daily.websiteNames?.[categoryId] || categoryId;
    const icon = daily.websiteIcons?.[categoryId] || '🌐';
    const barWidth = Math.max(2, Math.round((seconds / maxTime) * 100));

    return `
      <div class="website-row">
        <span class="website-rank">${index + 1}</span>
        <span class="website-row-icon">${icon}</span>
        <div class="website-row-info">
          <div class="website-row-name">${escapeHtml(name)}</div>
          <div class="website-row-bar">
            <div class="website-row-bar-fill" style="width: ${barWidth}%"></div>
          </div>
        </div>
        <span class="website-row-time">${formatDuration(seconds)}</span>
      </div>
    `;
  }).join('');
}

// ─── Weekly Tab ────────────────────────────────────────────

async function loadWeeklyTab() {
  const response = await sendMessage({ type: 'GET_WEEKLY_DATA' });

  if (!response?.success) return;

  const { current, previous, weekRange } = response.data;

  // Date range header
  const startDate = new Date(weekRange.startStr + 'T00:00:00');
  const endDate = new Date(weekRange.endStr + 'T00:00:00');
  document.getElementById('weeklyDateRange').textContent =
    `${formatDate(startDate)} – ${formatDate(endDate)}, ${endDate.getFullYear()}`;

  // Stats
  document.getElementById('weeklyTotalTime').textContent = formatDuration(current.totalActiveSeconds);

  const daysWithData = current.dailyBreakdown.filter(d => d.totalSeconds > 0).length;
  const avgSeconds = daysWithData > 0 ? Math.round(current.totalActiveSeconds / daysWithData) : 0;
  document.getElementById('weeklyAvgTime').textContent = formatDuration(avgSeconds) + '/day';

  const change = percentChange(current.totalActiveSeconds, previous.totalActiveSeconds);
  const changeEl = document.getElementById('weeklyChange');
  if (change !== null) {
    const sign = change >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${change}%`;
    changeEl.style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
  } else {
    changeEl.textContent = '—';
    changeEl.style.color = 'var(--text-muted)';
  }

  // Daily chart
  renderDailyChart(current.dailyBreakdown);

  // Top websites with comparison
  renderWeeklyWebsites(current.websites, previous.websites);

  // Insights
  renderInsights(current, previous);
}

function renderDailyChart(dailyBreakdown) {
  const container = document.getElementById('dailyChart');
  const maxSeconds = Math.max(...dailyBreakdown.map(d => d.totalSeconds), 1);
  const todayStr = getDateString();

  container.innerHTML = dailyBreakdown.map(day => {
    const barWidth = Math.max(1, Math.round((day.totalSeconds / maxSeconds) * 100));
    const dayName = getDayName(day.date);
    const isToday = day.date === todayStr;

    return `
      <div class="chart-row ${isToday ? 'today' : ''}">
        <span class="chart-day">${dayName}</span>
        <div class="chart-bar-container">
          <div class="chart-bar-fill" style="width: ${barWidth}%"></div>
        </div>
        <span class="chart-time">${formatDuration(day.totalSeconds)}</span>
      </div>
    `;
  }).join('');
}

function renderWeeklyWebsites(currentWebsites, previousWebsites) {
  const container = document.getElementById('weeklyWebsites');

  const sorted = Object.entries(currentWebsites)
    .sort((a, b) => b[1].seconds - a[1].seconds)
    .slice(0, 10);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📈</span>
        <p>No weekly data yet. Keep browsing!</p>
      </div>
    `;
    return;
  }

  const maxTime = sorted[0][1].seconds;

  container.innerHTML = sorted.map(([categoryId, data], index) => {
    const prevSeconds = previousWebsites[categoryId]?.seconds || 0;
    const change = percentChange(data.seconds, prevSeconds);
    const barWidth = Math.max(2, Math.round((data.seconds / maxTime) * 100));

    let changeHtml = '';
    if (change !== null) {
      const sign = change >= 0 ? '+' : '';
      const cls = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';
      changeHtml = `<span class="website-row-change ${cls}">${sign}${change}%</span>`;
    } else if (prevSeconds === 0 && data.seconds > 0) {
      changeHtml = `<span class="website-row-change positive">New</span>`;
    }

    return `
      <div class="website-row">
        <span class="website-rank">${index + 1}</span>
        <span class="website-row-icon">${data.icon}</span>
        <div class="website-row-info">
          <div class="website-row-name">${escapeHtml(data.name)}</div>
          <div class="website-row-bar">
            <div class="website-row-bar-fill" style="width: ${barWidth}%"></div>
          </div>
        </div>
        <span class="website-row-time">${formatDuration(data.seconds)}</span>
        ${changeHtml}
      </div>
    `;
  }).join('');
}

function renderInsights(current, previous) {
  const card = document.getElementById('insightsCard');
  const container = document.getElementById('weeklyInsights');

  const insights = [];

  // Top website insight
  const topSite = Object.entries(current.websites)
    .sort((a, b) => b[1].seconds - a[1].seconds)[0];

  if (topSite) {
    const [, data] = topSite;
    insights.push({
      icon: data.icon,
      text: `You spent <strong>${formatDuration(data.seconds)}</strong> on ${data.name} this week.`
    });

    // Comparison with previous week
    const prevSeconds = previous.websites[topSite[0]]?.seconds || 0;
    if (prevSeconds > 0) {
      const diff = data.seconds - prevSeconds;
      const direction = diff > 0 ? 'more' : 'less';
      insights.push({
        icon: diff > 0 ? '📈' : '📉',
        text: `That's <strong>${formatDuration(Math.abs(diff))}</strong> ${direction} than last week.`
      });
    }
  }

  // Highest usage day
  const peakDay = current.dailyBreakdown
    .filter(d => d.totalSeconds > 0)
    .sort((a, b) => b.totalSeconds - a.totalSeconds)[0];

  if (peakDay) {
    const dayName = getDayName(peakDay.date);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const fullDay = fullDays[days.indexOf(dayName)] || dayName;

    insights.push({
      icon: '📅',
      text: `<strong>${fullDay}</strong> was your highest-usage day with <strong>${formatDuration(peakDay.totalSeconds)}</strong> of active web time.`
    });
  }

  // Average daily usage
  const daysWithData = current.dailyBreakdown.filter(d => d.totalSeconds > 0).length;
  if (daysWithData > 0) {
    const avg = Math.round(current.totalActiveSeconds / daysWithData);
    insights.push({
      icon: '⏱',
      text: `Your average daily web usage was <strong>${formatDuration(avg)}</strong>.`
    });
  }

  // Decreased usage sites
  for (const [categoryId, data] of Object.entries(current.websites)) {
    const prev = previous.websites[categoryId]?.seconds || 0;
    if (prev > 0) {
      const change = percentChange(data.seconds, prev);
      if (change !== null && change <= -15) {
        insights.push({
          icon: '📉',
          text: `${data.name} usage decreased by <strong>${Math.abs(change)}%</strong>.`
        });
        break; // Only show one decrease insight
      }
    }
  }

  if (insights.length > 0) {
    card.style.display = 'block';
    container.innerHTML = insights.map(({ icon, text }) => `
      <div class="insight-item">
        <span class="insight-icon">${icon}</span>
        <div class="insight-text">${text}</div>
      </div>
    `).join('');
  } else {
    card.style.display = 'none';
  }
}

// ─── Tab Hygiene Tab ───────────────────────────────────────

async function loadHygieneTab() {
  const response = await sendMessage({ type: 'GET_TAB_HYGIENE' });

  if (response?.success) {
    const data = response.data;
    document.getElementById('hygieneAvgTabs').textContent = data.avgOpenTabs || data.currentOpenTabs || '—';
    document.getElementById('hygieneClosedTabs').textContent = data.tabsClosedViaSuggestions || 0;
    document.getElementById('hygieneAcceptRate').textContent = data.acceptanceRate > 0 ? `${data.acceptanceRate}%` : '—';
    document.getElementById('hygieneLongest').textContent = data.longestInactiveSeconds > 0
      ? formatDuration(data.longestInactiveSeconds)
      : '—';
  }

  // Load current inactive tabs
  const candidates = await getCleanupCandidates();
  const container = document.getElementById('hygieneCleanup');

  renderCleanupList(container, candidates, {
    onCloseSelected: async (tabIds) => {
      await closeTabs(tabIds);
      await loadHygieneTab();
    },
    onKeepSelected: async (tabIds) => {
      await keepTabs(tabIds);
      await loadHygieneTab();
    }
  });
}

// ─── Settings Tab ──────────────────────────────────────────

async function loadSettings() {
  const response = await sendMessage({ type: 'GET_SETTINGS' });
  if (!response?.success) return;

  const settings = response.data;

  // Tracking
  document.getElementById('settingTracking').checked = settings.trackingEnabled;
  document.getElementById('settingIdleThreshold').value = settings.idleThresholdSeconds;

  // Cleanup
  document.getElementById('settingCleanupThreshold').value = settings.cleanupThresholdMinutes;
  document.getElementById('settingIgnorePinned').checked = settings.ignorePinnedTabs;
  document.getElementById('settingIgnoreAudible').checked = settings.ignoreAudibleTabs;

  // Protected domains
  renderProtectedDomains(settings.protectedDomains || []);

  // Storage usage
  try {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      const kb = Math.round(bytes / 1024);
      const mb = (bytes / (1024 * 1024)).toFixed(2);
      document.getElementById('storageUsed').textContent =
        bytes > 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
    });
  } catch {
    document.getElementById('storageUsed').textContent = 'Unable to calculate';
  }
}

function setupSettings() {
  // Auto-save on change
  const autoSaveElements = [
    'settingTracking',
    'settingIdleThreshold',
    'settingCleanupThreshold',
    'settingIgnorePinned',
    'settingIgnoreAudible'
  ];

  for (const id of autoSaveElements) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', saveCurrentSettings);
    }
  }

  // Add domain
  document.getElementById('addDomainBtn')?.addEventListener('click', addProtectedDomain);
  document.getElementById('newDomainInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addProtectedDomain();
  });

  // Clear data
  document.getElementById('clearDataBtn')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all tracking data? This cannot be undone.')) {
      await chrome.storage.local.clear();
      showSaveIndicator('Data cleared');
      await loadSettings();
    }
  });
}

async function saveCurrentSettings() {
  const settings = {
    trackingEnabled: document.getElementById('settingTracking').checked,
    idleThresholdSeconds: parseInt(document.getElementById('settingIdleThreshold').value),
    cleanupThresholdMinutes: parseInt(document.getElementById('settingCleanupThreshold').value),
    ignorePinnedTabs: document.getElementById('settingIgnorePinned').checked,
    ignoreAudibleTabs: document.getElementById('settingIgnoreAudible').checked
  };

  await sendMessage({ type: 'SAVE_SETTINGS', settings });
  showSaveIndicator();
}

function renderProtectedDomains(domains) {
  const container = document.getElementById('protectedDomains');
  if (!container) return;

  if (domains.length === 0) {
    container.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">No protected domains</span>';
    return;
  }

  container.innerHTML = domains.map(domain => `
    <div class="domain-tag">
      <span>${escapeHtml(domain)}</span>
      <button class="domain-tag-remove" data-domain="${escapeHtml(domain)}" title="Remove">×</button>
    </div>
  `).join('');

  // Wire remove buttons
  container.querySelectorAll('.domain-tag-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const response = await sendMessage({ type: 'GET_SETTINGS' });
      if (response?.success) {
        const settings = response.data;
        settings.protectedDomains = (settings.protectedDomains || []).filter(d => d !== domain);
        await sendMessage({ type: 'SAVE_SETTINGS', settings: { protectedDomains: settings.protectedDomains } });
        renderProtectedDomains(settings.protectedDomains);
        showSaveIndicator();
      }
    });
  });
}

async function addProtectedDomain() {
  const input = document.getElementById('newDomainInput');
  const domain = input.value.trim().toLowerCase();

  if (!domain) return;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    input.style.borderColor = 'var(--red)';
    setTimeout(() => input.style.borderColor = '', 2000);
    return;
  }

  const response = await sendMessage({ type: 'GET_SETTINGS' });
  if (response?.success) {
    const settings = response.data;
    const domains = settings.protectedDomains || [];

    if (!domains.includes(domain)) {
      domains.push(domain);
      await sendMessage({ type: 'SAVE_SETTINGS', settings: { protectedDomains: domains } });
      renderProtectedDomains(domains);
      showSaveIndicator();
    }

    input.value = '';
  }
}

function showSaveIndicator(text) {
  const indicator = document.getElementById('saveIndicator');
  if (!indicator) return;

  if (text) {
    indicator.innerHTML = `<span>✓ ${text}</span>`;
  } else {
    indicator.innerHTML = '<span>✓ Settings saved</span>';
  }

  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 2000);
}

// ─── Utility ───────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
