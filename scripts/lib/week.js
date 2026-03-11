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
 * Get the Friday–Thursday editorial window for a given ISO week and year.
 * @param {number} weekNum — ISO week number
 * @param {number} year — ISO year
 * @returns {{ start: string, end: string }} — 'YYYY-MM-DD' for Friday and Thursday
 */
export function getWeekWindow(weekNum, year) {
  // Start from Jan 4 of the given year (always in ISO week 1)
  const jan4 = new Date(year, 0, 4);
  const week1Start = startOfISOWeek(jan4);
  // Add (weekNum - 1) weeks to get to the target week's Monday
  const targetMonday = addWeeks(week1Start, weekNum - 1);
  // Friday = Monday - 3 days (previous week's Friday)
  const friday = new Date(targetMonday);
  friday.setDate(targetMonday.getDate() - 3);
  // Thursday = Monday + 3 days
  const thursday = new Date(targetMonday);
  thursday.setDate(targetMonday.getDate() + 3);

  return {
    start: fmt(friday),
    end: fmt(thursday),
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
