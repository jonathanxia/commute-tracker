// Seed loading.
//
// The real trips live in seed.local.json, which is gitignored — the app is
// published on public GitHub Pages and those rows carry real dates and times of
// day. On Pages the fetch 404s, the app starts empty, and the data reaches the
// phone via Backup JSON → Restore instead.

import { dateStrToTs, dowOf } from './format.js';
import { SEGMENT_TYPES, tripFromDurations } from './store.js';

/**
 * Turn one row of the source table into a trip with real timestamps.
 *
 * The subtlety: the recorded door2door totals were summed from unrounded
 * durations, so they don't always equal the sum of the 2dp segment values —
 * five of the eight seed rows are off by 0.01. Laying segments out from the
 * printed durations alone would export a total that disagrees with the source
 * table.
 *
 * So we spread the discrepancy evenly across that trip's segments. Each shift
 * is under 0.0034 min, comfortably below the 0.005 that would flip any
 * individual segment's own 2dp rounding, so every segment still exports its
 * stated value AND the total now exports its stated value too.
 */
export function rowToTrip(row) {
  const order = Array.isArray(row.order) && row.order.length
    ? row.order.filter((t) => SEGMENT_TYPES.includes(t))
    : SEGMENT_TYPES;

  const present = order
    .map((type) => ({ type, minutes: row[type] }))
    .filter((d) => d.minutes != null && Number.isFinite(Number(d.minutes)))
    .map((d) => ({ type: d.type, minutes: Number(d.minutes) }));

  const stated = row.door2door;
  if (stated != null && present.length) {
    const sum = present.reduce((acc, d) => acc + d.minutes, 0);
    const shift = (Number(stated) - sum) / present.length;
    for (const d of present) d.minutes += shift;
  }

  const [hh, mm] = String(row.depart).split(':').map(Number);
  const depart_ts = dateStrToTs(row.date) + (hh * 60 + mm) * 60000;

  return tripFromDurations({
    date: row.date,
    depart_ts,
    direction: row.direction,
    gmaps_pred_min: row.gmaps_pred ?? null,
    durations: present,
    incomplete: row.incomplete === true,
  });
}

export function rowsToTrips(rows) {
  return rows.map(rowToTrip);
}

/** Returns the parsed seed file, or null when it isn't deployed. */
export async function fetchSeed(url = 'seed.local.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.rows) ? data : null;
  } catch {
    return null;
  }
}

/** Sanity check used by the verifier: does the file's own dow match its date? */
export function rowIssues(rows) {
  const issues = [];
  rows.forEach((row, i) => {
    if (row.dow && dowOf(row.date) !== row.dow) {
      issues.push(`row ${i + 1}: date ${row.date} is a ${dowOf(row.date)}, file says ${row.dow}`);
    }
  });
  return issues;
}
