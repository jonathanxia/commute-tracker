// Round-trip check: do the seed rows survive being turned into timestamped
// trips and exported back out as the wide CSV?
//
// This is the highest-value test in the project. It catches the two things that
// silently corrupt the export: door2door totals that were summed before
// rounding (five of the eight rows disagree with the sum of their own printed
// segments), and HH:MM times that must round to the nearest minute rather than
// truncate (four rows break if you truncate).
//
// Shared by tools/verify-seed.mjs (node) and verify.html (browser).

import { rowsToTrips, rowIssues } from '../js/seed.js';
import { wideRows, WIDE_COLUMNS } from '../js/csv.js';
import { fmtMin } from '../js/format.js';

const SEGMENTS = ['walk_to_car', 'garage_wait', 'drive', 'walk_to_dest'];

/** The row as the source table states it, rendered into CSV cells. */
function expectedCells(row, n) {
  return [
    String(n),
    row.date,
    row.dow,
    row.depart,
    row.direction,
    row.gmaps_pred == null ? '' : String(row.gmaps_pred),
    row.arrive || '',
    ...SEGMENTS.map((t) => (row[t] == null ? '' : fmtMin(Number(row[t])))),
    row.door2door == null ? '' : fmtMin(Number(row.door2door)),
    row.drive_residual || '',
  ];
}

export function runVerification(seed) {
  const rows = seed.rows;
  const failures = [];
  const notes = rowIssues(rows).map((m) => ({ kind: 'note', message: m }));

  const trips = rowsToTrips(rows);
  const actual = wideRows(trips).map((cells) => cells.map((c) => String(c)));

  if (actual.length !== rows.length) {
    failures.push({
      row: '—',
      column: 'row count',
      expected: String(rows.length),
      actual: String(actual.length),
    });
  }

  rows.forEach((row, i) => {
    const exp = expectedCells(row, i + 1);
    const act = actual[i] || [];
    exp.forEach((want, c) => {
      const got = act[c] ?? '';
      if (got !== want) {
        failures.push({
          row: i + 1,
          column: WIDE_COLUMNS[c],
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
    checked: rows.length * WIDE_COLUMNS.length,
    header: WIDE_COLUMNS,
    actual,
    trips,
  };
}

export function formatReport(result) {
  const lines = [];
  for (const n of result.notes) lines.push(`note: ${n.message}`);
  if (result.pass) {
    lines.push(`PASS — ${result.checked} cells match the seed table exactly.`);
  } else {
    lines.push(`FAIL — ${result.failures.length} of ${result.checked} cells differ:`);
    for (const f of result.failures) {
      lines.push(`  row ${f.row} · ${f.column}: expected ${f.expected}, got ${f.actual}`);
    }
  }
  return lines.join('\n');
}
