/**
 * Domain Normalizer — strips www, extracts registrable domain,
 * handles special subdomain mappings.
 */

/**
 * Normalize a URL into its core domain components.
 * @param {string} urlStr
 * @returns {{ hostname: string, domain: string, subdomain: string, pathname: string } | null}
 */
export function parseUrl(urlStr) {
  try {
    const url = new URL(urlStr);

    // Skip non-http(s) schemes
    if (!url.protocol.startsWith('http')) return null;

    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname;

    // Strip www.
    const cleanHostname = hostname.replace(/^www\./, '');

    // Extract parts
    const parts = cleanHostname.split('.');

    let domain, subdomain;
    if (parts.length >= 2) {
      // Handle common two-part TLDs like .co.uk, .com.au
      const twoPartTLDs = ['co.uk', 'com.au', 'co.in', 'co.jp', 'com.br', 'co.nz', 'org.uk'];
      const lastTwo = parts.slice(-2).join('.');

      if (twoPartTLDs.includes(lastTwo) && parts.length >= 3) {
        domain = parts.slice(-3).join('.');
        subdomain = parts.slice(0, -3).join('.');
      } else {
        domain = parts.slice(-2).join('.');
        subdomain = parts.slice(0, -2).join('.');
      }
    } else {
      domain = cleanHostname;
      subdomain = '';
    }

    return {
      hostname: cleanHostname,
      domain,
      subdomain,
      pathname
    };
  } catch {
    return null;
  }
}

/**
 * Generate a display-friendly name from a domain.
 * @param {string} domain - e.g. "leetcode.com"
 * @returns {string} e.g. "Leetcode"
 */
export function domainToDisplayName(domain) {
  // Remove TLD
  const name = domain.split('.')[0];
  // Capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Check if a URL is a browser internal page that shouldn't be tracked.
 * @param {string} urlStr
 * @returns {boolean}
 */
export function isInternalUrl(urlStr) {
  if (!urlStr) return true;
  const internalPrefixes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'moz-extension://',
    'chrome-search://',
    'devtools://'
  ];
  return internalPrefixes.some(prefix => urlStr.startsWith(prefix));
}

/**
 * Check if a URL is a new tab page.
 * @param {string} urlStr
 * @returns {boolean}
 */
export function isNewTabUrl(urlStr) {
  if (!urlStr) return true;
  return urlStr === 'chrome://newtab/' ||
         urlStr === 'edge://newtab/' ||
         urlStr === 'about:newtab' ||
         urlStr === 'about:blank';
}
