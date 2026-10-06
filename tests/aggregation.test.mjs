import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateWeekly } from '../src/background/aggregation.js';

test('Aggregation — aggregateWeekly calculates correct totals & breakdowns', () => {
  const dailyRecords = [
    {
      date: '2026-10-05',
      totalActiveSeconds: 3600,
      websites: { leetcode: 1800, github: 1800 },
      websiteNames: { leetcode: 'LeetCode', github: 'GitHub' },
      websiteIcons: { leetcode: '💻', github: '🐙' },
      tabsOpened: 5,
      tabsClosed: 2,
      cleanupSuggested: 3,
      cleanupAccepted: 2,
      cleanupRejected: 1,
      peakOpenTabs: 10
    },
    {
      date: '2026-10-06',
      totalActiveSeconds: 5400,
      websites: { leetcode: 3600, youtube: 1800 },
      websiteNames: { leetcode: 'LeetCode', youtube: 'YouTube' },
      websiteIcons: { leetcode: '💻', youtube: '📺' },
      tabsOpened: 3,
      tabsClosed: 4,
      cleanupSuggested: 2,
      cleanupAccepted: 2,
      cleanupRejected: 0,
      peakOpenTabs: 12
    }
  ];

  const weekly = aggregateWeekly(dailyRecords);

  assert.equal(weekly.totalActiveSeconds, 9000);
  assert.equal(weekly.tabsOpened, 8);
  assert.equal(weekly.tabsClosed, 6);
  assert.equal(weekly.cleanupAccepted, 4);
  assert.equal(weekly.peakOpenTabs, 12);

  // Websites aggregation
  assert.equal(weekly.websites.leetcode.seconds, 5400);
  assert.equal(weekly.websites.github.seconds, 1800);
  assert.equal(weekly.websites.youtube.seconds, 1800);

  // Daily breakdown
  assert.equal(weekly.dailyBreakdown.length, 2);
  assert.equal(weekly.dailyBreakdown[0].totalSeconds, 3600);
  assert.equal(weekly.dailyBreakdown[1].totalSeconds, 5400);
});
