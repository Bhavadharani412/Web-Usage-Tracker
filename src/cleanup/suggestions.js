/**
 * Cleanup Suggestions Engine — Identifies and ranks inactive tabs for cleanup (Issue #8).
 *
 * Requirements:
 * - Deterministic decision weighting based on past user keep/close actions
 * - Clearly defined keep ratio = keepCount / totalDecisions
 * - Configurable thresholds: minDecisionSample (default: 5), keepRatioThreshold (default: 0.80)
 * - Strict protected domain precedence (zero false suppression of protected domains)
 * - Safe defaults for missing history and insufficient samples (< minDecisionSample)
 * - Batched domain statistics retrieval (O(T + D) complexity; zero per-tab storage reads)
 */

import { DEFAULT_SETTINGS } from '../storage/schema.js';

/**
 * Default decision weighting configuration.
 */
export const DEFAULT_DECISION_WEIGHTS = {
  minDecisionSample: 5,
  keepRatioThreshold: 0.80
};

/**
 * Send a message to the background service worker.
 * @param {Object} message
 * @returns {Promise<Object>}
 */
function sendMessage(message) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      resolve({ success: false, data: [] });
      return;
    }
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

/**
 * Aggregate an array of decision records into a domain summary Map in O(D) time.
 *
 * @param {Array<{ domain: string, action: string, timestamp?: number }>} decisions
 * @returns {Map<string, { keepCount: number, closeCount: number, total: number, keepRatio: number }>}
 */
export function aggregateDomainDecisions(decisions = []) {
  const statsMap = new Map();
  if (!Array.isArray(decisions)) return statsMap;

  for (const decision of decisions) {
    if (!decision || typeof decision.domain !== 'string') continue;
    const domain = decision.domain.toLowerCase().trim();
    if (!domain) continue;

    let entry = statsMap.get(domain);
    if (!entry) {
      entry = { keepCount: 0, closeCount: 0, total: 0, keepRatio: 0 };
      statsMap.set(domain, entry);
    }

    if (decision.action === 'keep') {
      entry.keepCount += 1;
      entry.total += 1;
    } else if (decision.action === 'close') {
      entry.closeCount += 1;
      entry.total += 1;
    }
  }

  for (const entry of statsMap.values()) {
    entry.keepRatio = entry.total > 0 ? entry.keepCount / entry.total : 0;
  }

  return statsMap;
}

/**
 * Filter and rank cleanup candidate tabs applying protected-domain precedence
 * and decision-weighted scoring in O(T + D) time.
 *
 * Invariants:
 * 1. Protected domains, pinned tabs, and audible tabs are NEVER suggested (zero false suppression of protection).
 * 2. Domains with insufficient decision samples (< minDecisionSample) are NOT suppressed (no suppression without evidence).
 * 3. Domains with total >= minDecisionSample and keepRatio >= keepRatioThreshold are suppressed from suggestions.
 * 4. Candidates are ranked by decision score ascending (frequently closed tabs first), then by inactivity duration.
 *
 * @param {Array<Object>} candidates - Candidate tab instances (T)
 * @param {Map<string, Object>|Array<Object>} domainStatsOrDecisions - Pre-aggregated Map or raw decisions Array (D)
 * @param {Object} [options] - Configuration thresholds and overrides
 * @returns {Array<Object & { decisionScore?: number, keepRatio?: number, totalDecisions?: number }>}
 */
export function rankCleanupCandidates(candidates = [], domainStatsOrDecisions = new Map(), options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const minSample =
    typeof options.minDecisionSample === 'number' && options.minDecisionSample >= 1
      ? options.minDecisionSample
      : DEFAULT_DECISION_WEIGHTS.minDecisionSample;

  const keepThreshold =
    typeof options.keepRatioThreshold === 'number' && options.keepRatioThreshold >= 0 && options.keepRatioThreshold <= 1
      ? options.keepRatioThreshold
      : DEFAULT_DECISION_WEIGHTS.keepRatioThreshold;

  const rawProtectedList = options.protectedDomains || DEFAULT_SETTINGS.protectedDomains || [];
  const protectedDomains = new Set(
    rawProtectedList.map((d) => String(d).toLowerCase().trim())
  );

  // Normalize stats to Map in O(D)
  const statsMap =
    domainStatsOrDecisions instanceof Map
      ? domainStatsOrDecisions
      : aggregateDomainDecisions(domainStatsOrDecisions);

  const eligibleCandidates = [];

  // Evaluate candidate tabs in O(T)
  for (const tab of candidates) {
    if (!tab) continue;

    const domain = (tab.domain || '').toLowerCase().trim();
    const hostname = (tab.hostname || '').toLowerCase().trim();

    // ── 1. Strict Protected Domain Precedence ─────────────────
    // Protected domains MUST NEVER appear in suggestions regardless of user history
    if (protectedDomains.has(domain) || protectedDomains.has(hostname)) {
      continue;
    }

    if (options.ignorePinnedTabs !== false && tab.isPinned) continue;
    if (options.ignoreAudibleTabs !== false && tab.isAudible) continue;
    if (tab.isInternal) continue;

    // ── 2. Decision Weighting Evaluation ──────────────────────
    const stats = statsMap.get(domain) || statsMap.get(hostname);

    let keepRatio = 0;
    let totalDecisions = 0;
    let isSuppressed = false;
    let decisionScore = 0; // Negative = prioritized for close, Positive = preferred keep

    if (stats && typeof stats.total === 'number') {
      totalDecisions = stats.total;
      keepRatio = stats.keepRatio;

      // Rule: Only suppress if total decisions meet or exceed minimum sample threshold
      if (totalDecisions >= minSample) {
        if (keepRatio >= keepThreshold) {
          isSuppressed = true; // User consistently keeps tabs from this domain -> suppress
        } else {
          // Weighting score: scale by close frequency
          decisionScore = (keepRatio - 0.5) * 10;
        }
      }
    }

    if (isSuppressed) {
      continue;
    }

    eligibleCandidates.push({
      ...tab,
      decisionScore,
      keepRatio,
      totalDecisions
    });
  }

  // ── 3. Deterministic Ranking ──────────────────────────────
  // Primary sort: decisionScore ascending (frequently closed tabs first)
  // Secondary sort: inactiveSince ascending (longest inactive first)
  return eligibleCandidates.sort((a, b) => {
    if (a.decisionScore !== b.decisionScore) {
      return a.decisionScore - b.decisionScore;
    }
    return (a.inactiveSince || 0) - (b.inactiveSince || 0);
  });
}

/**
 * Get cleanup candidates from the background service worker.
 * @returns {Promise<Object[]>}
 */
export async function getCleanupCandidates() {
  const response = await sendMessage({ type: 'GET_INACTIVE_TABS' });
  if (response?.success) {
    return response.data || [];
  }
  return [];
}

/**
 * Close selected tabs.
 * @param {number[]} tabIds
 * @returns {Promise<boolean>}
 */
export async function closeTabs(tabIds) {
  const response = await sendMessage({ type: 'CLOSE_TABS', tabIds });
  return response?.success || false;
}

/**
 * Keep selected tabs (reset inactivity timer).
 * @param {number[]} tabIds
 * @returns {Promise<boolean>}
 */
export async function keepTabs(tabIds) {
  const response = await sendMessage({ type: 'KEEP_TABS', tabIds });
  return response?.success || false;
}
