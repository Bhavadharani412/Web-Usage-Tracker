/**
 * Site Rules Engine — configurable rules for known websites.
 * Maps domains to display names and classifies URL paths into page types.
 */

/**
 * @typedef {Object} SiteRule
 * @property {string} name - Display name for the website
 * @property {string} [icon] - Emoji icon for the website
 * @property {Object<string, string>} [pageTypes] - Path pattern → page type name mapping
 * @property {Object<string, string>} [subdomains] - Subdomain → separate category mapping
 * @property {boolean} [splitSubdomains] - If true, treat subdomains as separate categories
 */

/** @type {Object<string, SiteRule>} */
const SITE_RULES = {
  'leetcode.com': {
    name: 'LeetCode',
    icon: '🧩',
    pageTypes: {
      '/problems': 'Problems',
      '/contest': 'Contest',
      '/study': 'Study',
      '/explore': 'Explore',
      '/discuss': 'Discuss',
      '/submissions': 'Submissions'
    }
  },

  'github.com': {
    name: 'GitHub',
    icon: '🐙',
    pageTypes: {
      '/pulls': 'Pull Requests',
      '/issues': 'Issues',
      '/actions': 'Actions',
      '/settings': 'Settings',
      '/notifications': 'Notifications',
      '/marketplace': 'Marketplace',
      '/explore': 'Explore',
      '/codespaces': 'Codespaces'
    }
  },

  'youtube.com': {
    name: 'YouTube',
    icon: '📺',
    pageTypes: {
      '/watch': 'Watch',
      '/shorts': 'Shorts',
      '/results': 'Search',
      '/feed/subscriptions': 'Subscriptions',
      '/feed/trending': 'Trending',
      '/playlist': 'Playlist',
      '/@': 'Channel',
      '/channel': 'Channel'
    }
  },

  'google.com': {
    name: 'Google',
    icon: '🔍',
    splitSubdomains: true,
    subdomains: {
      'mail': 'Gmail',
      'docs': 'Google Docs',
      'drive': 'Google Drive',
      'calendar': 'Google Calendar',
      'meet': 'Google Meet',
      'sheets': 'Google Sheets',
      'slides': 'Google Slides',
      'forms': 'Google Forms',
      'photos': 'Google Photos',
      'maps': 'Google Maps',
      'translate': 'Google Translate',
      'news': 'Google News',
      'classroom': 'Google Classroom',
      'colab': 'Google Colab'
    },
    pageTypes: {
      '/search': 'Search',
      '/maps': 'Maps',
      '/images': 'Images'
    }
  },

  'stackoverflow.com': {
    name: 'Stack Overflow',
    icon: '📚',
    pageTypes: {
      '/questions': 'Questions',
      '/tags': 'Tags',
      '/users': 'Users',
      '/search': 'Search'
    }
  },

  'reddit.com': {
    name: 'Reddit',
    icon: '🗣️',
    pageTypes: {
      '/r/': 'Subreddit',
      '/user/': 'User',
      '/search': 'Search'
    }
  },

  'twitter.com': {
    name: 'Twitter / X',
    icon: '🐦',
    pageTypes: {
      '/search': 'Search',
      '/explore': 'Explore',
      '/notifications': 'Notifications',
      '/messages': 'Messages',
      '/home': 'Home'
    }
  },

  'x.com': {
    name: 'Twitter / X',
    icon: '🐦',
    pageTypes: {
      '/search': 'Search',
      '/explore': 'Explore',
      '/notifications': 'Notifications',
      '/messages': 'Messages',
      '/home': 'Home'
    }
  },

  'linkedin.com': {
    name: 'LinkedIn',
    icon: '💼',
    pageTypes: {
      '/feed': 'Feed',
      '/jobs': 'Jobs',
      '/messaging': 'Messaging',
      '/mynetwork': 'Network',
      '/in/': 'Profile'
    }
  },

  'wikipedia.org': {
    name: 'Wikipedia',
    icon: '📖',
    pageTypes: {
      '/wiki/': 'Article'
    }
  },

  'medium.com': {
    name: 'Medium',
    icon: '📝',
    pageTypes: {}
  },

  'notion.so': {
    name: 'Notion',
    icon: '📓',
    pageTypes: {}
  },

  'figma.com': {
    name: 'Figma',
    icon: '🎨',
    pageTypes: {
      '/file': 'File',
      '/proto': 'Prototype'
    }
  },

  'slack.com': {
    name: 'Slack',
    icon: '💬',
    pageTypes: {}
  },

  'discord.com': {
    name: 'Discord',
    icon: '🎮',
    pageTypes: {
      '/channels': 'Channels'
    }
  },

  'netflix.com': {
    name: 'Netflix',
    icon: '🎬',
    pageTypes: {
      '/watch': 'Watching',
      '/browse': 'Browse',
      '/search': 'Search'
    }
  },

  'amazon.com': {
    name: 'Amazon',
    icon: '🛒',
    pageTypes: {
      '/dp/': 'Product',
      '/s': 'Search',
      '/gp/cart': 'Cart',
      '/gp/your-account': 'Account'
    }
  },

  'chatgpt.com': {
    name: 'ChatGPT',
    icon: '🤖',
    pageTypes: {}
  },

  'openai.com': {
    name: 'OpenAI',
    icon: '🤖',
    pageTypes: {}
  },

  'claude.ai': {
    name: 'Claude',
    icon: '🤖',
    pageTypes: {}
  }
};

/**
 * Get the site rule for a domain, if one exists.
 * @param {string} domain - e.g. "leetcode.com"
 * @returns {SiteRule|null}
 */
export function getSiteRule(domain) {
  return SITE_RULES[domain] || null;
}

/**
 * Get all configured site rules.
 * @returns {Object<string, SiteRule>}
 */
export function getAllSiteRules() {
  return { ...SITE_RULES };
}

/**
 * Match a pathname against page type patterns.
 * @param {string} pathname - e.g. "/problems/two-sum"
 * @param {Object<string, string>} pageTypes - Pattern → name mapping
 * @returns {string} Page type name, or "Other"
 */
export function matchPageType(pathname, pageTypes) {
  if (!pageTypes || !pathname) return 'Other';

  for (const [pattern, name] of Object.entries(pageTypes)) {
    if (pathname.startsWith(pattern)) {
      return name;
    }
  }

  return 'Other';
}
