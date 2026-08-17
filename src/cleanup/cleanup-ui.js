/**
 * Cleanup UI — shared rendering logic for tab cleanup review interface.
 */

import { formatDuration } from '../utils/time-format.js';

/**
 * Render cleanup candidates into a container element.
 * @param {HTMLElement} container
 * @param {Object[]} candidates - Array of tab instances
 * @param {Object} callbacks - { onClose, onKeep, onCloseSelected, onKeepSelected }
 */
export function renderCleanupList(container, candidates, callbacks = {}) {
  container.innerHTML = '';

  if (candidates.length === 0) {
    container.innerHTML = `
      <div class="cleanup-empty">
        <span class="cleanup-empty-icon">✨</span>
        <p>All tabs are actively in use!</p>
      </div>
    `;
    return;
  }

  // Header
  const header = document.createElement('div');
  header.className = 'cleanup-header';
  header.innerHTML = `
    <div class="cleanup-header-text">
      <span class="cleanup-icon">🧹</span>
      <span>${candidates.length} tab${candidates.length !== 1 ? 's' : ''} haven't been used recently</span>
    </div>
    <label class="cleanup-select-all">
      <input type="checkbox" id="selectAll" checked>
      <span>Select all</span>
    </label>
  `;
  container.appendChild(header);

  // Tab list
  const list = document.createElement('div');
  list.className = 'cleanup-list';

  for (const tab of candidates) {
    const now = Date.now();
    const inactiveSeconds = tab.inactiveSince
      ? Math.floor((now - tab.inactiveSince) / 1000)
      : 0;

    const item = document.createElement('div');
    item.className = 'cleanup-item';
    item.dataset.tabId = tab.browserTabId;

    item.innerHTML = `
      <label class="cleanup-item-check">
        <input type="checkbox" class="tab-checkbox" data-tab-id="${tab.browserTabId}" checked>
      </label>
      <div class="cleanup-item-info">
        <div class="cleanup-item-title">${escapeHtml(tab.title || tab.url || 'Untitled')}</div>
        <div class="cleanup-item-meta">
          <span class="cleanup-item-icon">${tab.icon || '🌐'}</span>
          <span class="cleanup-item-domain">${escapeHtml(tab.category || tab.domain)}</span>
          <span class="cleanup-item-time">· ${formatDuration(inactiveSeconds)} inactive</span>
        </div>
      </div>
    `;

    list.appendChild(item);
  }

  container.appendChild(list);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'cleanup-actions';
  actions.innerHTML = `
    <button class="btn btn-close" id="closeSelected">
      <span>Close selected</span>
    </button>
    <button class="btn btn-keep" id="keepSelected">
      <span>Keep selected</span>
    </button>
  `;
  container.appendChild(actions);

  // Wire up events
  const selectAllCheckbox = container.querySelector('#selectAll');
  const checkboxes = container.querySelectorAll('.tab-checkbox');

  selectAllCheckbox?.addEventListener('change', (e) => {
    checkboxes.forEach(cb => cb.checked = e.target.checked);
  });

  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecked = Array.from(checkboxes).every(c => c.checked);
      const someChecked = Array.from(checkboxes).some(c => c.checked);
      if (selectAllCheckbox) {
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      }
    });
  });

  container.querySelector('#closeSelected')?.addEventListener('click', () => {
    const selectedIds = getSelectedTabIds(container);
    if (selectedIds.length > 0 && callbacks.onCloseSelected) {
      callbacks.onCloseSelected(selectedIds);
    }
  });

  container.querySelector('#keepSelected')?.addEventListener('click', () => {
    const selectedIds = getSelectedTabIds(container);
    if (selectedIds.length > 0 && callbacks.onKeepSelected) {
      callbacks.onKeepSelected(selectedIds);
    }
  });
}

/**
 * Get the tab IDs of selected checkboxes.
 * @param {HTMLElement} container
 * @returns {number[]}
 */
function getSelectedTabIds(container) {
  const checked = container.querySelectorAll('.tab-checkbox:checked');
  return Array.from(checked).map(cb => parseInt(cb.dataset.tabId));
}

/**
 * Escape HTML to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
