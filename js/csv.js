// CSV generation. DOM-free so the seed verifier can import it under node.

import { chronological, columnTypes, segDurationMin, tripView } from './store.js';
import { fmtClock, fmtMin, fmtSigned } from './format.js';

/** Columns before and after the per-segment block. */
const LEAD_COLUMNS = ['trip', 'date', 'dow', 'depart', 'direction', 'gmaps_pred', 'arrive'];
const TAIL_COLUMNS = ['door2door', 'drive_residual'];

/**
 * The wide header for a given set of trips.
 *
 * The segment block is generated from the current vocabulary plus any type the
 * data itself still uses, so adding a segment type adds a column and deleting
 * one does not drop already-recorded data. Read this file by header name rather
 * than by position — the column count is no longer fixed.
 */
export function wideColumns(trips = []) {
  return [...LEAD_COLUMNS, ...columnTypes(trips), ...TAIL_COLUMNS];
}

function escapeCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows) {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\n') + '\n';
}

/**
 * One row per trip, human-scannable.
 *
 * Blank is not zero anywhere in here: a blank segment cell means the segment
 * did not happen or was not recorded, while "0.00" means it happened and
 * measured ~nil. door2door and arrive go blank on an incomplete trip rather
 * than emitting a total that looks complete.
 *
 * Trip numbers are assigned chronologically over whatever set is passed in, so
 * a filtered export numbers 1..n over the filtered rows.
 */
export function wideRows(trips) {
  const types = columnTypes(trips);
  return chronological(trips).map((trip, i) => {
    const v = tripView(trip, i + 1);
    return [
      v.n,
      v.date,
      v.dow,
      fmtClock(v.depart_ts),
      v.direction,
      v.gmaps_pred_min == null ? '' : String(v.gmaps_pred_min),
      fmtClock(v.arrive_ts),
      ...types.map((key) => fmtMin(v.min[key])),
      fmtMin(v.door2door),
      fmtSigned(v.drive_residual),
    ];
  });
}

export function wideCSV(trips) {
  return toCSV([wideColumns(trips), ...wideRows(trips)]);
}

/**
 * Long format: one row per segment, with raw timestamps. Lossless — this is the
 * one that can rebuild the data, where the wide CSV rounds to 2dp.
 */
export function longCSV(trips) {
  const rows = [['trip_id', 'trip', 'type', 'start_ts', 'end_ts', 'duration_min']];
  chronological(trips).forEach((trip, i) => {
    trip.segments.forEach((seg) => {
      rows.push([
        trip.id,
        i + 1,
        seg.type,
        seg.start_ts ?? '',
        seg.end_ts ?? '',
        fmtMin(segDurationMin(seg)),
      ]);
    });
  });
  return toCSV(rows);
}
