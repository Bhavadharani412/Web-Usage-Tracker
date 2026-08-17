/**
 * Time formatting utilities.
 * All durations are stored and passed as seconds internally.
 */

/**
 * Format seconds into human-readable duration string.
 * @param {number} totalSeconds
 * @returns {string} e.g. "2h 14m", "58m", "< 1m"
 */
export function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) return '0m';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours === 0 && minutes === 0) return '< 1m';
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Format seconds into short compact form for tight UI.
 * @param {number} totalSeconds
 * @returns {string} e.g. "2h14m", "58m"
 */
export function formatDurationCompact(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) return '0m';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours === 0 && minutes === 0) return '<1m';
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes}m`;
}

/**
 * Format a Date into a short display string.
 * @param {Date} date
 * @returns {string} e.g. "Aug 17"
 */
export function formatDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Format a Date into a full display string.
 * @param {Date} date
 * @returns {string} e.g. "Aug 17, 2026"
 */
export function formatDateFull(date) {
  return `${formatDate(date)}, ${date.getFullYear()}`;
}

/**
 * Get ISO date string for storage keys.
 * @param {Date} [date]
 * @returns {string} e.g. "2026-08-17"
 */
export function getDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get the Monday-based week range containing the given date.
 * @param {Date} [date]
 * @returns {{ start: Date, end: Date, startStr: string, endStr: string }}
 */
export function getWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  // Adjust so Monday = 0
  const diff = day === 0 ? 6 : day - 1;

  const start = new Date(d);
  start.setDate(d.getDate() - diff);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return {
    start,
    end,
    startStr: getDateString(start),
    endStr: getDateString(end)
  };
}

/**
 * Get the previous week's range.
 * @param {Date} [date]
 * @returns {{ start: Date, end: Date, startStr: string, endStr: string }}
 */
export function getPreviousWeekRange(date = new Date()) {
  const d = new Date(date);
  d.setDate(d.getDate() - 7);
  return getWeekRange(d);
}

/**
 * Get an array of date strings for a range.
 * @param {string} startStr - e.g. "2026-08-11"
 * @param {string} endStr - e.g. "2026-08-17"
 * @returns {string[]}
 */
export function getDateRange(startStr, endStr) {
  const dates = [];
  const current = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');

  while (current <= end) {
    dates.push(getDateString(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Get day-of-week name from a date string.
 * @param {string} dateStr - e.g. "2026-08-17"
 * @returns {string} e.g. "Mon"
 */
export function getDayName(dateStr) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = new Date(dateStr + 'T00:00:00');
  return days[d.getDay()];
}

/**
 * Calculate percentage change between two values.
 * @param {number} current
 * @param {number} previous
 * @returns {number|null} Percentage change, or null if previous is 0
 */
export function percentChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}
