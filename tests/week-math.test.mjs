import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDateString,
  getWeekRange,
  getPreviousWeekRange,
  getDateRange,
  percentChange,
  splitSegmentByDay,
  splitSessionSegmentsByDay
} from '../src/utils/time-format.js';

test('Time Format Utils — Date & Week Calculations', () => {
  // Test Monday-based week range calculation for a known date: Tuesday Oct 6, 2026
  const targetDate = new Date('2026-10-06T12:00:00');
  const range = getWeekRange(targetDate);

  assert.equal(range.startStr, '2026-10-05', 'Monday should be 2026-10-05');
  assert.equal(range.endStr, '2026-10-11', 'Sunday should be 2026-10-11');

  // Test previous week range
  const prevRange = getPreviousWeekRange(targetDate);
  assert.equal(prevRange.startStr, '2026-09-28');
  assert.equal(prevRange.endStr, '2026-10-04');

  // Test getDateRange
  const dates = getDateRange('2026-10-05', '2026-10-07');
  assert.deepEqual(dates, ['2026-10-05', '2026-10-06', '2026-10-07']);
});

test('Session Splitting Across Midnight — splitSegmentByDay', () => {
  // Session starts at 23:50:00 on Oct 5 and ends at 00:20:00 on Oct 6 (30 mins = 1800s)
  const startTime = new Date('2026-10-05T23:50:00').getTime();
  const endTime = new Date('2026-10-06T00:20:00').getTime();

  const splits = splitSegmentByDay(startTime, endTime);

  assert.equal(splits['2026-10-05'], 600, 'Oct 5 should receive 10 mins (600s)');
  assert.equal(splits['2026-10-06'], 1200, 'Oct 6 should receive 20 mins (1200s)');
});

test('Session Splitting Across Multiple Paused Segments — splitSessionSegmentsByDay', () => {
  const seg1 = {
    start: new Date('2026-10-05T23:45:00').getTime(),
    end: new Date('2026-10-06T00:15:00').getTime()
  };
  const seg2 = {
    start: new Date('2026-10-06T00:30:00').getTime(),
    end: new Date('2026-10-06T01:00:00').getTime()
  };

  const splits = splitSessionSegmentsByDay([seg1, seg2]);

  assert.equal(splits['2026-10-05'], 900, 'Oct 5 should receive 15 mins (900s)');
  assert.equal(splits['2026-10-06'], 900 + 1800, 'Oct 6 should receive 15 mins + 30 mins (2700s)');
});

test('Week-over-Week Math — Partial Week Like-for-Like Comparison', () => {
  // Scenario: Today is Tuesday (2 elapsed days in current week: Mon, Tue)
  const currentWeekDays = [
    { date: '2026-10-05', totalSeconds: 3600 }, // Mon: 1h
    { date: '2026-10-06', totalSeconds: 3600 }, // Tue: 1h
    { date: '2026-10-07', totalSeconds: 0 },    // Wed
    { date: '2026-10-08', totalSeconds: 0 },    // Thu
    { date: '2026-10-09', totalSeconds: 0 },    // Fri
    { date: '2026-10-10', totalSeconds: 0 },    // Sat
    { date: '2026-10-11', totalSeconds: 0 }     // Sun
  ];

  const previousWeekDays = [
    { date: '2026-09-28', totalSeconds: 1800 }, // Mon: 0.5h
    { date: '2026-09-29', totalSeconds: 1800 }, // Tue: 0.5h
    { date: '2026-09-30', totalSeconds: 7200 }, // Wed: 2h
    { date: '2026-10-01', totalSeconds: 7200 }, // Thu: 2h
    { date: '2026-10-02', totalSeconds: 7200 }, // Fri: 2h
    { date: '2026-10-03', totalSeconds: 3600 }, // Sat: 1h
    { date: '2026-10-04', totalSeconds: 3600 }  // Sun: 1h
  ];

  // Old naive comparison (comparing 2 days of 7200s vs full week of 32400s) -> -78% (FLAWED)
  const naiveTotalCurrent = currentWeekDays.reduce((a, b) => a + b.totalSeconds, 0);
  const naiveTotalPrevious = previousWeekDays.reduce((a, b) => a + b.totalSeconds, 0);
  const naiveChange = percentChange(naiveTotalCurrent, naiveTotalPrevious);
  assert.equal(naiveChange, -78);

  // New like-for-like comparison (comparing Mon-Tue current week 7200s vs Mon-Tue previous week 3600s)
  const elapsedCount = 2;
  const currentElapsed = currentWeekDays.slice(0, elapsedCount).reduce((a, b) => a + b.totalSeconds, 0);
  const previousSameDays = previousWeekDays.slice(0, elapsedCount).reduce((a, b) => a + b.totalSeconds, 0);
  const correctChange = percentChange(currentElapsed, previousSameDays);

  assert.equal(correctChange, +100, 'Current week Mon-Tue (7200s) is +100% vs previous week Mon-Tue (3600s)');
});
