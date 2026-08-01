// Model, derivations and persistence.
//
// DOM-free on purpose: tools/verify-seed.mjs imports this outside a browser to
// prove the CSV export reproduces the seed table.
//
// The one rule everything else hangs off: timestamps (epoch ms) are the only
// source of truth. Nothing here ever persists an elapsed counter, because iOS
// suspends the app when the phone is locked and a counter would freeze or drift.
// Every duration is a subtraction, evaluated lazily at read time.

import { dateKey, dowOf } from './format.js';

export const SEGMENT_TYPES = ['walk_to_car', 'garage_wait', 'drive', 'walk_to_dest'];

export const SEGMENT_LABELS = {
  walk_to_car: 'Walk to car',
  garage_wait: 'Garage wait',
  drive: 'Drive',
  walk_to_dest: 'Walk to dest',
};

export const SEGMENT_SHORT = {
  walk_to_car: 'walk→car',
  garage_wait: 'garage',
  drive: 'drive',
  walk_to_dest: 'walk→dest',
};

export const DIRECTIONS = ['east', 'west'];

export const DIRECTION_LABELS = {
  east: 'East — home → office',
  west: 'West — office → home',
};

// Defaults only. Every trip can add, remove, reorder and relabel segments; the
// app must never assume a fixed count or layout.
export const DEFAULT_SEQUENCE = {
  east: ['walk_to_car', 'drive', 'walk_to_dest'],
  west: ['walk_to_car', 'garage_wait', 'drive', 'walk_to_dest'],
};

export const KEYS = {
  trips: 'ct.trips.v1',
  active: 'ct.active.v1',
  prefs: 'ct.prefs.v1',
};

// ---------------------------------------------------------------------------
// ids + construction
// ---------------------------------------------------------------------------

let counter = 0;
export function uid(prefix = 't') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Before ~13:00 the commute is eastbound (morning, home → office). */
export function guessDirection(ts = Date.now()) {
  return new Date(ts).getHours() < 13 ? 'east' : 'west';
}

export function createTrip({
  depart_ts = Date.now(),
  direction = guessDirection(depart_ts),
  gmaps_pred_min = null,
  date = dateKey(depart_ts),
  segments = [],
  incomplete = false,
} = {}) {
  return {
    id: uid('t'),
    date,
    direction,
    depart_ts,
    gmaps_pred_min,
    incomplete,
    segments: segments.map(normalizeSegment),
  };
}

export function createSegment(type, start_ts, end_ts = null) {
  return { id: uid('s'), type, start_ts, end_ts };
}

function normalizeSegment(seg) {
  return {
    id: seg.id || uid('s'),
    type: SEGMENT_TYPES.includes(seg.type) ? seg.type : 'drive',
    start_ts: numOrNull(seg.start_ts),
    end_ts: numOrNull(seg.end_ts),
  };
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Defensive normalisation on load, so a hand-edited backup can't wedge the app. */
export function normalizeTrip(trip) {
  const depart_ts = numOrNull(trip.depart_ts) ?? Date.now();
  return {
    id: trip.id || uid('t'),
    date: typeof trip.date === 'string' && trip.date ? trip.date : dateKey(depart_ts),
    direction: DIRECTIONS.includes(trip.direction) ? trip.direction : guessDirection(depart_ts),
    depart_ts,
    gmaps_pred_min: numOrNull(trip.gmaps_pred_min),
    incomplete: trip.incomplete === true,
    segments: Array.isArray(trip.segments) ? trip.segments.map(normalizeSegment) : [],
  };
}

/**
 * Build a trip from ordered typed durations, laying segments out contiguously
 * from depart_ts. Shared by manual entry and by the seed loader so both produce
 * an identical internal shape.
 *
 * `minutes: null` means the segment is ABSENT (didn't happen / wasn't recorded)
 * and no segment is emitted. `minutes: 0` means it happened and measured ~nil,
 * and emits a real segment of zero duration. These are different facts and the
 * CSV renders them differently (blank vs 0.00).
 */
export function tripFromDurations({
  date,
  depart_ts,
  direction,
  gmaps_pred_min = null,
  durations = [],
  incomplete = false,
}) {
  let cursor = depart_ts;
  const segments = [];
  for (const { type, minutes } of durations) {
    if (minutes == null || !Number.isFinite(Number(minutes))) continue;
    const ms = Math.round(Number(minutes) * 60000);
    segments.push(createSegment(type, cursor, cursor + ms));
    cursor += ms;
  }
  return {
    ...createTrip({ depart_ts, direction, gmaps_pred_min, date, incomplete }),
    segments,
  };
}

// ---------------------------------------------------------------------------
// derivations — nothing below is ever stored
// ---------------------------------------------------------------------------

export function segDurationMs(seg) {
  if (!seg || seg.start_ts == null || seg.end_ts == null) return null;
  return seg.end_ts - seg.start_ts;
}

export function segDurationMin(seg) {
  const ms = segDurationMs(seg);
  return ms == null ? null : ms / 60000;
}

/**
 * A trip is incomplete when it was explicitly marked so, or when a segment is
 * still open. This is a stored boolean rather than something inferred from
 * which segment types are present, because no structural rule separates seed
 * trip 1 (a complete 3-segment eastbound trip with no garage wait) from seed
 * trip 8 (a westbound trip whose final walk was never recorded).
 */
export function isIncomplete(trip) {
  if (!trip) return true;
  if (trip.incomplete === true) return true;
  if (!trip.segments.length) return true;
  return trip.segments.some((s) => s.start_ts == null || s.end_ts == null);
}

/** Arrival is the last segment's end. Blank for an incomplete trip. */
export function arriveTs(trip) {
  if (isIncomplete(trip)) return null;
  return trip.segments[trip.segments.length - 1].end_ts;
}

/**
 * Sum of every recorded segment. Blank for an incomplete trip — we never emit a
 * total that looks complete but isn't.
 */
export function door2doorMin(trip) {
  if (isIncomplete(trip)) return null;
  return trip.segments.reduce((acc, s) => acc + segDurationMin(s), 0);
}

/**
 * Total minutes across every segment of a type, or null when the type is absent.
 * Summed rather than first-match because reordering lets a trip legitimately
 * carry two waits.
 */
export function minutesByType(trip, type) {
  let total = null;
  for (const seg of trip.segments) {
    if (seg.type !== type) continue;
    const min = segDurationMin(seg);
    if (min == null) continue;
    total = (total ?? 0) + min;
  }
  return total;
}

export function driveMin(trip) {
  return minutesByType(trip, 'drive');
}

/** drive − gmaps_pred. Derived at read time; never stored on the trip. */
export function residualMin(trip) {
  const drive = driveMin(trip);
  if (drive == null || trip.gmaps_pred_min == null) return null;
  return drive - trip.gmaps_pred_min;
}

/** Minutes of wall clock the trip spans, used only for display sanity. */
export function spanMin(trip) {
  const end = arriveTs(trip);
  return end == null ? null : (end - trip.depart_ts) / 60000;
}

/**
 * Non-contiguous boundaries between consecutive segments. Surfaced to the user
 * as a note; never auto-corrected, because a gap can be a real pause and the
 * boundary may have been edited deliberately.
 */
export function segmentIssues(trip) {
  const issues = [];
  for (let i = 1; i < trip.segments.length; i += 1) {
    const prev = trip.segments[i - 1];
    const cur = trip.segments[i];
    if (prev.end_ts == null || cur.start_ts == null) continue;
    const delta = cur.start_ts - prev.end_ts;
    if (Math.abs(delta) >= 1000) {
      issues.push({ index: i, deltaMs: delta, kind: delta > 0 ? 'gap' : 'overlap' });
    }
  }
  if (trip.segments.length) {
    const first = trip.segments[0];
    if (first.start_ts != null && Math.abs(first.start_ts - trip.depart_ts) >= 1000) {
      issues.push({
        index: 0,
        deltaMs: first.start_ts - trip.depart_ts,
        kind: 'depart',
      });
    }
  }
  return issues;
}

/** Everything the table, charts and CSV read. One place, so they can't diverge. */
export function tripView(trip, index = null) {
  return {
    trip,
    id: trip.id,
    n: index,
    date: trip.date,
    dow: dowOf(trip.date),
    depart_ts: trip.depart_ts,
    direction: trip.direction,
    gmaps_pred_min: trip.gmaps_pred_min,
    arrive_ts: arriveTs(trip),
    walk_to_car: minutesByType(trip, 'walk_to_car'),
    garage_wait: minutesByType(trip, 'garage_wait'),
    drive: minutesByType(trip, 'drive'),
    walk_to_dest: minutesByType(trip, 'walk_to_dest'),
    door2door: door2doorMin(trip),
    drive_residual: residualMin(trip),
    incomplete: isIncomplete(trip),
  };
}

/** Oldest first — trip numbers in the CSV follow chronological order. */
export function chronological(trips) {
  return [...trips].sort((a, b) => a.depart_ts - b.depart_ts);
}

/** Newest first — how History reads. */
export function newestFirst(trips) {
  return [...trips].sort((a, b) => b.depart_ts - a.depart_ts);
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

const memory = new Map();

function backing() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem(KEYS.prefs);
      return localStorage;
    }
  } catch {
    /* Safari private mode, or node. Fall through to memory. */
  }
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
}

function readJSON(key, fallback) {
  try {
    const raw = backing().getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    backing().setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // Quota or private mode. Surfaced by the caller rather than swallowed,
    // because silently losing a commute is the worst outcome here.
    console.error('[store] write failed', key, err);
    return false;
  }
}

export function loadTrips() {
  const raw = readJSON(KEYS.trips, []);
  return Array.isArray(raw) ? raw.map(normalizeTrip) : [];
}

export function saveTrips(trips) {
  return writeJSON(KEYS.trips, trips);
}

/**
 * The in-progress session: the trip so far, the planned sequence, which segment
 * is running, and whether it has been finished but not yet saved.
 *
 * Persisted on every single tap. iOS will happily kill a backgrounded web app
 * during a 40-minute drive, and losing a commute to that would defeat the point
 * of the whole app.
 */
export function loadActive() {
  const raw = readJSON(KEYS.active, null);
  if (!raw || !raw.trip) return null;
  return {
    trip: normalizeTrip(raw.trip),
    queue: Array.isArray(raw.queue) ? raw.queue.filter((t) => SEGMENT_TYPES.includes(t)) : [],
    index: Number.isInteger(raw.index) ? raw.index : 0,
    finished: raw.finished === true,
  };
}

export function saveActive(session) {
  if (!session) {
    backing().removeItem(KEYS.active);
    return true;
  }
  return writeJSON(KEYS.active, session);
}

export const DEFAULT_PREFS = {
  columns: [
    'n',
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
  ],
  sort: { key: 'depart_ts', dir: 'desc' },
  filters: { direction: 'all', dows: [], from: '', to: '', incompleteOnly: false },
  chart: 'drive',
  lastBackupAt: null,
  backupNagDismissedAt: null,
  seeded: false,
};

export function loadPrefs() {
  return { ...DEFAULT_PREFS, ...readJSON(KEYS.prefs, {}) };
}

export function savePrefs(prefs) {
  return writeJSON(KEYS.prefs, prefs);
}

/**
 * Ask for the durable storage tier. iOS can evict script-writable storage, and
 * deleting the home-screen icon takes the data with it — this reduces the risk
 * but does not remove it, which is why JSON backup exists.
 */
export async function requestPersistence() {
  try {
    if (navigator?.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}
