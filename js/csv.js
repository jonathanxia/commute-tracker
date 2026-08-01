// CSV generation. DOM-free so the seed verifier can import it under node.

import { chronological, segDurationMin, tripView } from './store.js';
import { fmtClock, fmtMin, fmtSigned } from './format.js';

/** Wide format: one row per trip. Column order is fixed by the spec. */
export const WIDE_COLUMNS = [
  'trip',
  'date',
  'dow',
  'depart',
  'direction',
  'gmaps_pred',
  'arrive',
  'walk_to_car',
  'garage_wait',
  'drive',
  'walk_to_dest',
  'door2door',
  'drive_residual',
];

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
      fmtMin(v.walk_to_car),
      fmtMin(v.garage_wait),
      fmtMin(v.drive),
      fmtMin(v.walk_to_dest),
      fmtMin(v.door2door),
      fmtSigned(v.drive_residual),
    ];
  });
}

export function wideCSV(trips) {
  return toCSV([WIDE_COLUMNS, ...wideRows(trips)]);
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
