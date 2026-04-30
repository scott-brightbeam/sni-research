/**
 * week.js — ISO week utilities for SNI Research Tool
 *
 * Fixes the broken getWeekNumber() in report.js (naive day-of-year / 7 math)
 * with proper ISO 8601 week calculation using date-fns.
 *
 * ISO weeks: Monday is day 1. Week 1 contains January 4th.
 * Dec 29-31 can be ISO Week 1 of the next year.
 */

import { getISOWeek, getISOWeekYear, startOfISOWeek, endOfISOWeek, isValid, parseISO, addWeeks, startOfYear } from 'date-fns';

/**
 * Get the ISO week number for a date string.
 * @param {string} dateStr — 'YYYY-MM-DD'
 * @returns {number} ISO week number (1-53)
 */
export function getISOWeekNumber(dateStr) {
  const d = parseISO(dateStr);
  if (!isValid(d)) throw new Error(`Invalid date string: "${dateStr}"`);
  return getISOWeek(d);
}

/**
 * Get the ISO year for a date string.
 * Important: ISO year can differ from calendar year at boundaries.
 * e.g. Dec 31, 2025 → ISO Week 1 of 2026
 * @param {string} dateStr — 'YYYY-MM-DD'
 * @returns {number} ISO year
 */
export function getISOYearForWeek(dateStr) {
  const d = parseISO(dateStr);
  if (!isValid(d)) throw new Error(`Invalid date string: "${dateStr}"`);
  return getISOWeekYear(d);
}

/**
 * Get the Saturday–Friday editorial window for a given ISO week and year.
 *
 * CHANGED Apr 2026: window was Friday–Thursday (drafting Thursday 14:00,
 * publishing Thursday). Now Saturday–Friday (drafting Friday 16:00,
 * publishing Saturday dawn). The longer tail lets us catch Thursday-evening
 * and Friday-morning announcements that previously missed the cut.
 *
 * Convention: "Week N" refers to ISO week N; the editorial window is the
 * seven days ending on the Friday of that ISO week. So ISO Week 18 (Mon
 * 27 Apr 2026 – Sun 3 May 2026) has editorial window Sat 25 Apr – Fri 1 May.
 *
 * @param {number} weekNum — ISO week number
 * @param {number} year — ISO year
 * @returns {{ start: string, end: string }} — 'YYYY-MM-DD' for Saturday and Friday
 */
export function getWeekWindow(weekNum, year) {
  // Start from Jan 4 of the given year (always in ISO week 1)
  const jan4 = new Date(year, 0, 4);
  const week1Start = startOfISOWeek(jan4);
  // Add (weekNum - 1) weeks to get to the target week's Monday
  const targetMonday = addWeeks(week1Start, weekNum - 1);
  // Saturday = Monday - 2 days (previous week's Saturday)
  const saturday = new Date(targetMonday);
  saturday.setDate(targetMonday.getDate() - 2);
  // Friday = Monday + 4 days
  const friday = new Date(targetMonday);
  friday.setDate(targetMonday.getDate() + 4);

  return {
    start: fmt(saturday),
    end: fmt(friday),
  };
}

/**
 * Get current ISO week and year.
 * @returns {{ week: number, year: number }}
 */
export function getCurrentWeek() {
  const now = new Date();
  return {
    week: getISOWeek(now),
    year: getISOWeekYear(now),
  };
}

/** Format Date → 'YYYY-MM-DD' */
function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
