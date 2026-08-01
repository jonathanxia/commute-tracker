// Formatting helpers. DOM-free on purpose so csv.js and the seed verifier can
// import this outside a browser.

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * Clock time as local HH:MM, rounded to the NEAREST minute.
 *
 * Not truncated. The seed table pins this down: trip 6 arrives at 18:57.55 and
 * the spec says 18:58; trip 1 arrives at 10:24.56 and the spec says 10:25.
 * Truncating breaks four of the eight seed rows.
 */
export function fmtClock(ts) {
  if (ts == null || !Number.isFinite(ts)) return '';
  const d = new Date(Math.round(ts / 60000) * 60000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Minutes to 2dp. null/undefined render as blank — blank is not zero. */
export function fmtMin(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toFixed(2);
}

/**
 * Signed minutes to 2dp with an explicit leading +.
 * Never renders "-0.00": a value that rounds to zero is always "+0.00".
 */
export function fmtSigned(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const abs = Math.abs(n).toFixed(2);
  const negative = n < 0 && Number(abs) !== 0;
  return (negative ? '-' : '+') + abs;
}

/** Local YYYY-MM-DD for a timestamp. */
export function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Day-of-week for a YYYY-MM-DD string, parsed as a LOCAL date (not UTC). */
export function dowOf(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  return DOW[new Date(y, m - 1, d).getDay()];
}

/** Midnight local for a YYYY-MM-DD string. */
export function dateStrToTs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Elapsed duration for the cosmetic on-screen readout: M:SS or H:MM:SS. */
export function fmtElapsed(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Minutes as a compact human duration, e.g. 39.87 -> "39m 52s". */
export function fmtMinHuman(min) {
  if (min == null || !Number.isFinite(min)) return '—';
  const total = Math.round(min * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${pad(s)}s`;
}

/** Timestamp -> value for <input type="datetime-local" step="1">. */
export function tsToInput(ts) {
  if (ts == null) return '';
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** <input type="datetime-local"> value -> timestamp. Returns null if unparseable. */
export function inputToTs(value) {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)).getTime();
}
