/**
 * URL Classifier — classifies URLs into categories and page types.
 * Combines domain-normalizer and site-rules.
 */

import { parseUrl, domainToDisplayName, isInternalUrl, isNewTabUrl } from './domain-normalizer.js';
import { getSiteRule, matchPageType } from './site-rules.js';

/**
 * @typedef {Object} Classification
 * @property {string} domain - Registrable domain (e.g. "leetcode.com")
 * @property {string} hostname - Full hostname without www (e.g. "leetcode.com")
 * @property {string} category - Category/display name (e.g. "LeetCode")
 * @property {string} categoryId - Normalized category ID for storage keys
 * @property {string} pageType - Page type within the category (e.g. "Problems")
 * @property {string} icon - Emoji icon for the category
 * @property {boolean} isInternal - Whether this is a browser internal page
 */

/**
 * Classify a URL into a website category and page type.
 * @param {string} urlStr
 * @returns {Classification}
 */
export function classify(urlStr) {
  // Default for empty/invalid URLs
  const defaultResult = {
    domain: '',
    hostname: '',
    category: 'Unknown',
    categoryId: 'unknown',
    pageType: 'Other',
    icon: '🌐',
    isInternal: true
  };

  if (!urlStr) return defaultResult;

  // Check for internal URLs
  if (isInternalUrl(urlStr) || isNewTabUrl(urlStr)) {
    return {
      ...defaultResult,
      category: 'Browser',
      categoryId: 'browser',
      icon: '🔧'
    };
  }

  const parsed = parseUrl(urlStr);
  if (!parsed) return defaultResult;

  const { hostname, domain, subdomain, pathname } = parsed;

  // Try to find a site rule
  const rule = getSiteRule(domain);

  if (rule) {
    // Handle split subdomains (e.g., Google services)
    if (rule.splitSubdomains && rule.subdomains && subdomain) {
      const subdomainName = rule.subdomains[subdomain];
      if (subdomainName) {
        return {
          domain,
          hostname,
          category: subdomainName,
          categoryId: toCategoryId(subdomainName),
          pageType: 'Main',
          icon: getSubdomainIcon(subdomain, domain),
          isInternal: false
        };
      }
    }

    // Standard site rule classification
    const pageType = matchPageType(pathname, rule.pageTypes);

    return {
      domain,
      hostname,
      category: rule.name,
      categoryId: toCategoryId(rule.name),
      pageType,
      icon: rule.icon || '🌐',
      isInternal: false
    };
  }

  // Default: use registrable domain as category
  const displayName = domainToDisplayName(domain);

  return {
    domain,
    hostname,
    category: displayName,
    categoryId: toCategoryId(domain),
    pageType: 'Other',
    icon: '🌐',
    isInternal: false
  };
}

/**
 * Convert a display name to a storage-safe category ID.
 * @param {string} name
 * @returns {string}
 */
function toCategoryId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Get icon for known Google subdomains.
 * @param {string} subdomain
 * @param {string} domain
 * @returns {string}
 */
function getSubdomainIcon(subdomain, domain) {
  if (domain !== 'google.com') return '🌐';

  const icons = {
    'mail': '📧',
    'docs': '📄',
    'drive': '💾',
    'calendar': '📅',
    'meet': '📹',
    'sheets': '📊',
    'slides': '📽️',
    'forms': '📋',
    'photos': '📸',
    'maps': '🗺️',
    'translate': '🌍',
    'news': '📰',
    'classroom': '🎓',
    'colab': '🧪'
  };

  return icons[subdomain] || '🔍';
}
