import test from 'node:test';
import assert from 'node:assert/strict';
import { setupChromeMock } from './mock-chrome.mjs';

setupChromeMock();

const { classify } = await import('../src/clustering/classifier.js');
const { parseUrl, domainToDisplayName, isInternalUrl } = await import('../src/clustering/domain-normalizer.js');

test('URL Classifier — Table Tests for Site Rules & Page Types', () => {
  const testCases = [
    {
      url: 'https://leetcode.com/problems/two-sum',
      expectedCategory: 'LeetCode',
      expectedCategoryId: 'leetcode',
      expectedPageType: 'Problems',
      expectedDomain: 'leetcode.com'
    },
    {
      url: 'https://github.com/facebook/react/pulls',
      expectedCategory: 'GitHub',
      expectedCategoryId: 'github',
      expectedPageType: 'Pull Requests',
      expectedDomain: 'github.com'
    },
    {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      expectedCategory: 'YouTube',
      expectedCategoryId: 'youtube',
      expectedPageType: 'Watch',
      expectedDomain: 'youtube.com'
    },
    {
      url: 'https://stackoverflow.com/questions/123456/example',
      expectedCategory: 'Stack Overflow',
      expectedCategoryId: 'stack-overflow',
      expectedPageType: 'Questions',
      expectedDomain: 'stackoverflow.com'
    },
    {
      url: 'https://news.ycombinator.com/item?id=3000000',
      expectedCategory: 'Ycombinator',
      expectedCategoryId: 'ycombinator-com',
      expectedDomain: 'ycombinator.com'
    }
  ];

  for (const tc of testCases) {
    const result = classify(tc.url);
    assert.equal(result.category, tc.expectedCategory, `Failed category for ${tc.url}`);
    assert.equal(result.categoryId, tc.expectedCategoryId, `Failed categoryId for ${tc.url}`);
    assert.equal(result.domain, tc.expectedDomain, `Failed domain for ${tc.url}`);
    if (tc.expectedPageType) {
      assert.equal(result.pageType, tc.expectedPageType, `Failed pageType for ${tc.url}`);
    }
    assert.equal(result.isInternal, false);
  }
});

test('URL Classifier — Google Subdomain Splitting', () => {
  const testCases = [
    { url: 'https://mail.google.com/mail/u/0/#inbox', expectedCategory: 'Gmail', expectedIcon: '📧' },
    { url: 'https://docs.google.com/document/d/123/edit', expectedCategory: 'Google Docs', expectedIcon: '📄' },
    { url: 'https://drive.google.com/drive/my-drive', expectedCategory: 'Google Drive', expectedIcon: '💾' },
    { url: 'https://calendar.google.com/calendar/r', expectedCategory: 'Google Calendar', expectedIcon: '📅' },
    { url: 'https://meet.google.com/abc-defg-hij', expectedCategory: 'Google Meet', expectedIcon: '📹' }
  ];

  for (const tc of testCases) {
    const result = classify(tc.url);
    assert.equal(result.category, tc.expectedCategory, `Failed Google subdomain for ${tc.url}`);
    assert.equal(result.icon, tc.expectedIcon, `Failed icon for ${tc.url}`);
  }
});

test('URL Classifier — Unknown Domains & Fallback', () => {
  const result = classify('https://my-custom-startup-tool.io/dashboard');
  assert.equal(result.domain, 'my-custom-startup-tool.io');
  assert.equal(result.category, 'My Custom Startup Tool');
  assert.equal(result.categoryId, 'my-custom-startup-tool-io');
  assert.equal(result.pageType, 'Other');
  assert.equal(result.isInternal, false);
});

test('URL Classifier — Internal Browser Pages & Edge Cases', () => {
  assert.equal(classify('chrome://extensions').category, 'Browser');
  assert.equal(classify('chrome://extensions').isInternal, true);
  assert.equal(classify('about:blank').category, 'Browser');
  assert.equal(classify('chrome-extension://xyz/index.html').category, 'Browser');

  assert.equal(classify('').category, 'Unknown');
  assert.equal(classify(null).category, 'Unknown');
  assert.equal(classify(undefined).category, 'Unknown');
});
