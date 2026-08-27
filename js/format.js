// Formatting helpers. DOM-free on purpose so the seed verifier can import this
// outside a browser.

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

/** Clock time for the typed time fields: HH:MM, with :SS only when nonzero. */
export function fmtClockTyped(ts) {
  if (ts == null || !Number.isFinite(ts)) return '';
  const d = new Date(Math.round(ts / 1000) * 1000);
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getSeconds() ? `${base}:${pad(d.getSeconds())}` : base;
}

/**
 * Lenient typed clock time -> ms since local midnight, or null if unreadable.
 * Accepts "8:45", "08:45:30", "845", "84530", "8.45", "8 45", "8:45pm", "845a".
 * Bare 1–2 digits are an hour on the dot ("8" -> 08:00).
 */
export function parseClockStr(value) {
  if (value == null) return null;
  let s = String(value).trim().toLowerCase();
  const ampm = s.match(/\s*([ap])\.?m?\.?$/);
  if (ampm) s = s.slice(0, ampm.index).trim();
  let h, m, sec = 0;
  const parts = s.match(/^(\d{1,2})[:. ](\d{1,2})(?:[:. ](\d{1,2}))?$/);
  if (parts) {
    [h, m, sec] = [+parts[1], +parts[2], +(parts[3] ?? 0)];
  } else if (/^\d{1,6}$/.test(s)) {
    if (s.length <= 2) [h, m] = [+s, 0];
    else if (s.length <= 4) [h, m] = [+s.slice(0, -2), +s.slice(-2)];
    else [h, m, sec] = [+s.slice(0, -4), +s.slice(-4, -2), +s.slice(-2)];
  } else return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm[1] === 'p' && h !== 12) h += 12;
    else if (ampm[1] === 'a' && h === 12) h = 0;
  }
  if (h > 23 || m > 59 || sec > 59) return null;
  return ((h * 60 + m) * 60 + sec) * 1000;
}

/** The timestamp at clockMs past local midnight on the same day as anchorTs. */
export function tsAtClock(anchorTs, clockMs) {
  const d = new Date(anchorTs);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + clockMs;
}
