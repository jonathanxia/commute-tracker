// Round-trip check: do the seed rows survive being turned into timestamped
// trips and read back out as the values the app displays and exports?
//
// This is the highest-value test in the project. It catches the two things that
// silently corrupt the data: door2door totals that were summed before rounding
// (five of the eight rows disagree with the sum of their own printed segments),
// and HH:MM times that must round to the nearest minute rather than truncate
// (four rows break if you truncate).
//
// It reads tripView directly. There is no CSV layer any more — JSON is the only
// export format, and the numbers below are exactly what lands in it.
//
// Shared by tools/verify-seed.mjs (node) and verify.html (browser).

import { rowsToTrips, rowIssues } from '../js/seed.js';
import { chronological, columnTypes, segmentLabel, tripView } from '../js/store.js';
import { fmtClock, fmtMin, fmtSigned } from '../js/format.js';

const LEAD = ['trip', 'date', 'dow', 'depart', 'direction', 'gmaps_pred', 'arrive'];
const TAIL = ['door2door', 'drive_residual'];

/** The values the app derives for a trip, in a fixed order for comparison. */
function actualCells(trip, n, segments) {
  const v = tripView(trip, n);
  return [
    String(v.n),
    v.date,
    v.dow,
    fmtClock(v.depart_ts),
    v.direction,
    v.gmaps_pred_min == null ? '' : String(v.gmaps_pred_min),
    fmtClock(v.arrive_ts),
    ...segments.map((t) => fmtMin(v.min[t])),
    fmtMin(v.door2door),
    fmtSigned(v.drive_residual),
  ];
}

/** The same values as the source table states them. */
function expectedCells(row, n, segments) {
  return [
    String(n),
    row.date,
    row.dow,
    row.depart,
    row.direction,
    row.gmaps_pred == null ? '' : String(row.gmaps_pred),
    row.arrive || '',
    ...segments.map((t) => (row[t] == null ? '' : fmtMin(Number(row[t])))),
    row.door2door == null ? '' : fmtMin(Number(row.door2door)),
    row.drive_residual || '',
  ];
}

export function runVerification(seed) {
  const rows = seed.rows;
  const failures = [];
  const notes = rowIssues(rows).map((m) => ({ kind: 'note', message: m }));

  const trips = chronological(rowsToTrips(rows));
  const segments = columnTypes(trips);
  const header = [...LEAD, ...segments.map(segmentLabel), ...TAIL];
  const actual = trips.map((trip, i) => actualCells(trip, i + 1, segments));

  if (actual.length !== rows.length) {
    failures.push({
      row: '—',
      column: 'row count',
      expected: String(rows.length),
      actual: String(actual.length),
    });
  }

  rows.forEach((row, i) => {
    const exp = expectedCells(row, i + 1, segments);
    const act = actual[i] || [];
    exp.forEach((want, c) => {
      const got = act[c] ?? '';
      if (got !== want) {
        failures.push({
          row: i + 1,
          column: header[c],
          expected: want === '' ? '(blank)' : want,
          actual: got === '' ? '(blank)' : got,
        });
      }
    });
  });

  return {
    pass: failures.length === 0,
    failures,
    notes,
    checked: rows.length * header.length,
    header,
    actual,
    trips,
  };
}

export function formatReport(result) {
  const lines = [];
  for (const n of result.notes) lines.push(`note: ${n.message}`);
  if (result.pass) {
    lines.push(`PASS — ${result.checked} values match the seed table exactly.`);
  } else {
    lines.push(`FAIL — ${result.failures.length} of ${result.checked} values differ:`);
    for (const f of result.failures) {
      lines.push(`  row ${f.row} · ${f.column}: expected ${f.expected}, got ${f.actual}`);
    }
  }
  return lines.join('\n');
}
