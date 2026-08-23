// Model, derivations and persistence.
//
// The one rule everything else hangs off: timestamps (epoch ms) are the only
// source of truth. Nothing here ever persists an elapsed counter, because iOS
// suspends the app when the phone is locked and a counter would freeze or drift.
// Every duration is a subtraction, evaluated lazily at read time.

import { dateKey, dowOf } from './format.js';

// The segment vocabulary is user data, not a constant. The table columns, the
// manual-entry fields, the relabel pills and the export all generate from it, so
// adding a type is one action in the UI rather than an edit in every consumer.
//
// One name per type, used everywhere. `key` is derived from that name once, at
// creation, and is never shown or typed — it exists only so renaming a type
// doesn't have to rewrite every stored trip.
export const BUILTIN_TYPES = [
  { key: 'walk_to_car', label: 'Walk to car' },
  { key: 'garage_wait', label: 'Garage wait' },
  { key: 'drive', label: 'Drive' },
  { key: 'walk_to_dest', label: 'Walk to dest' },
  // Recorded and exported like any other segment, but excluded from
  // door-to-door by default: a coffee stop shouldn't make the commute look slow.
  { key: 'pause', label: 'Pause', exclude: true },
];

/**
 * The one key the app reasons about semantically: drive_residual is defined as
 * this segment minus the Google prediction, and two charts plot it. It can be
 * relabelled freely but never deleted, or that metric loses its meaning.
 */
export const DRIVE_KEY = 'drive';

export const BUILTIN_SEQUENCES = {
  east: ['walk_to_car', 'drive', 'walk_to_dest'],
  west: ['walk_to_car', 'garage_wait', 'drive', 'walk_to_dest'],
};

/**
 * Commute types: a trip-level category, distinct from segment types. Same
 * pattern — one typed name, a derived stable key, editable at runtime.
 */
export const BUILTIN_COMMUTE_TYPES = [
  { key: 'full_driving', label: 'Full Driving' },
  { key: 'ferry', label: 'Ferry' },
  { key: 'bus_commute', label: 'Bus Commute' },
];

export const DIRECTIONS = ['east', 'west'];

export const DIRECTION_LABELS = {
  east: 'East — home → office',
  west: 'West — office → home',
};

export const KEYS = {
  trips: 'ct.trips.v1',
  active: 'ct.active.v1',
  prefs: 'ct.prefs.v1',
  types: 'ct.types.v1',
  sequences: 'ct.sequences.v1',
  commuteTypes: 'ct.commute_types.v1',
};

/** "garage_wait" -> "Garage wait". Fallback label for a key with no definition. */
export function humanizeKey(key) {
  const s = String(key).replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Segment';
}

/** "Toll booth wait!" -> "toll_booth_wait". Keys are snake_case and ASCII-safe. */
export function slugifyKey(label) {
  return (
    String(label)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'segment'
  );
}

let typesCache = null;

export function loadTypes() {
  if (typesCache) return typesCache;
  const raw = readJSON(KEYS.types, null);
  const source = Array.isArray(raw) && raw.length ? raw : BUILTIN_TYPES;
  const seen = new Set();
  const list = [];
  for (const t of source) {
    if (!t || typeof t.key !== 'string' || !t.key || seen.has(t.key)) continue;
    seen.add(t.key);
    const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : humanizeKey(t.key);
    list.push({ key: t.key, label, exclude: t.exclude === true });
  }
  // The drive type is load-bearing; re-add it if a bad edit or an old backup
  // dropped it, rather than letting residuals silently go blank forever.
  if (!seen.has(DRIVE_KEY)) list.push({ ...BUILTIN_TYPES.find((t) => t.key === DRIVE_KEY) });
  typesCache = list;
  return typesCache;
}

export function saveTypes(list) {
  typesCache = null;
  return writeJSON(KEYS.types, list);
}

export function segmentTypes() {
  return loadTypes().map((t) => t.key);
}

export function segmentLabel(key) {
  return loadTypes().find((t) => t.key === key)?.label ?? humanizeKey(key);
}

/** Types flagged this way are recorded and exported but left out of door2door. */
export function typeExcluded(key) {
  return loadTypes().find((t) => t.key === key)?.exclude === true;
}

/**
 * Append a new type, deriving a unique snake_case key from the label.
 * Shared by the recorder's inline creator and the management screen so both
 * produce identical keys.
 */
export function addType(label) {
  const types = loadTypes();
  const clean = String(label).trim();
  if (!clean) return null;
  let key = slugifyKey(clean);
  const taken = new Set(types.map((t) => t.key));
  if (taken.has(key)) {
    let i = 2;
    while (taken.has(`${key}_${i}`)) i += 1;
    key = `${key}_${i}`;
  }
  saveTypes([...types, { key, label: clean, exclude: false }]);
  return key;
}

let commuteCache = null;

export function loadCommuteTypes() {
  if (commuteCache) return commuteCache;
  const raw = readJSON(KEYS.commuteTypes, null);
  const source = Array.isArray(raw) ? raw : BUILTIN_COMMUTE_TYPES;
  const seen = new Set();
  commuteCache = [];
  for (const t of source) {
    if (!t || typeof t.key !== 'string' || !t.key || seen.has(t.key)) continue;
    seen.add(t.key);
    commuteCache.push({
      key: t.key,
      label: typeof t.label === 'string' && t.label.trim() ? t.label.trim() : humanizeKey(t.key),
    });
  }
  return commuteCache;
}

export function saveCommuteTypes(list) {
  commuteCache = null;
  return writeJSON(KEYS.commuteTypes, list);
}

export function commuteTypeLabel(key) {
  if (!key) return '';
  return loadCommuteTypes().find((t) => t.key === key)?.label ?? humanizeKey(key);
}

export function addCommuteType(label) {
  const list = loadCommuteTypes();
  const clean = String(label).trim();
  if (!clean) return null;
  let key = slugifyKey(clean);
  const taken = new Set(list.map((t) => t.key));
  if (taken.has(key)) {
    let i = 2;
    while (taken.has(`${key}_${i}`)) i += 1;
    key = `${key}_${i}`;
  }
  saveCommuteTypes([...list, { key, label: clean }]);
  return key;
}

/**
 * Segment keys to show as columns: the vocabulary, plus any key that actually
 * appears in the data but is no longer defined. A recorded segment must never
 * vanish from an export because its type was deleted or came from a backup made
 * on another device.
 */
export function columnTypes(trips = []) {
  const keys = segmentTypes();
  const known = new Set(keys);
  const extras = [];
  for (const trip of trips) {
    for (const seg of trip.segments || []) {
      if (seg.type && !known.has(seg.type)) {
        known.add(seg.type);
        extras.push(seg.type);
      }
    }
  }
  return [...keys, ...extras];
}

export function loadSequences() {
  const raw = readJSON(KEYS.sequences, null);
  const out = {};
  for (const dir of DIRECTIONS) {
    const seq = Array.isArray(raw?.[dir]) ? raw[dir].filter((k) => typeof k === 'string' && k) : null;
    out[dir] = seq && seq.length ? seq : [...BUILTIN_SEQUENCES[dir]];
  }
  return out;
}

export function saveSequences(seq) {
  return writeJSON(KEYS.sequences, seq);
}

/** Default sequence for a direction, with deleted types dropped. */
export function sequenceFor(direction) {
  const known = new Set(segmentTypes());
  const seq = loadSequences()[direction] || [];
  const filtered = seq.filter((k) => known.has(k));
  return filtered.length ? filtered : [DRIVE_KEY];
}

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
  commute_type = null,
} = {}) {
  return {
    id: uid('t'),
    date,
    direction,
    depart_ts,
    gmaps_pred_min,
    incomplete,
    commute_type,
    segments: segments.map(normalizeSegment),
  };
}

export function createSegment(type, start_ts, end_ts = null) {
  return { id: uid('s'), type, start_ts, end_ts };
}

function normalizeSegment(seg) {
  return {
    id: seg.id || uid('s'),
    // Any slug is accepted. Validating against the current vocabulary would
    // silently rewrite segments restored from a device with custom types.
    type: typeof seg.type === 'string' && seg.type ? seg.type : DRIVE_KEY,
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
    commute_type: typeof trip.commute_type === 'string' && trip.commute_type ? trip.commute_type : null,
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
  commute_type = null,
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
    ...createTrip({ depart_ts, direction, gmaps_pred_min, date, incomplete, commute_type }),
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
 * Door-to-door minutes. Blank for an incomplete trip — we never emit a total
 * that looks complete but isn't.
 *
 * Segment types flagged `exclude` (pause, by default) are skipped, so a trip
 * where you stopped for coffee stays comparable with one where you didn't. That
 * means door2door is NOT always the sum of the segment columns; when an excluded
 * segment is present the columns will add up to more.
 */
export function door2doorMin(trip) {
  if (isIncomplete(trip)) return null;
  return trip.segments.reduce(
    (acc, s) => (typeExcluded(s.type) ? acc : acc + segDurationMin(s)),
    0,
  );
}

/**
 * The type to pre-select for the next segment: the next step in this direction's
 * suggested order, else the first suggested type not used yet. Only a guess —
 * the pills on the recorder are the real control.
 */
export function predictNextType(trip, direction) {
  const seq = sequenceFor(direction);
  const current = trip.segments.at(-1)?.type;
  const i = seq.indexOf(current);
  if (i !== -1 && i + 1 < seq.length) return seq[i + 1];
  const used = new Set(trip.segments.map((s) => s.type));
  return seq.find((k) => !used.has(k)) ?? current ?? seq[0];
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
  return minutesByType(trip, DRIVE_KEY);
}

/** drive − gmaps_pred. Derived at read time; never stored on the trip. */
export function residualMin(trip) {
  const drive = driveMin(trip);
  if (drive == null || trip.gmaps_pred_min == null) return null;
  return drive - trip.gmaps_pred_min;
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

/**
 * Everything the table, charts and CSV read. One place, so they can't diverge.
 *
 * `min` is keyed by segment type and covers every type the trip actually uses,
 * not just the ones currently in the vocabulary — deleting a type must never
 * make an already-recorded segment disappear from a view or an export.
 */
export function tripView(trip, index = null) {
  const min = {};
  for (const key of segmentTypes()) min[key] = minutesByType(trip, key);
  for (const seg of trip.segments) {
    if (!(seg.type in min)) min[seg.type] = minutesByType(trip, seg.type);
  }
  return {
    trip,
    id: trip.id,
    n: index,
    date: trip.date,
    dow: dowOf(trip.date),
    depart_ts: trip.depart_ts,
    direction: trip.direction,
    commute_type: trip.commute_type ?? null,
    commute_type_label: commuteTypeLabel(trip.commute_type),
    gmaps_pred_min: trip.gmaps_pred_min,
    arrive_ts: arriveTs(trip),
    min,
    // The one type with its own semantics, so charts and residuals can rely on it.
    drive: min[DRIVE_KEY] ?? null,
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
 * The in-progress session: the trip so far, and whether it has been ended but
 * not yet saved. There is no planned queue — you lap as many times as you like
 * and label each segment as it happens.
 *
 * Persisted on every single tap. iOS will happily kill a backgrounded web app
 * during a 40-minute drive, and losing a commute to that would defeat the point
 * of the whole app.
 */
export function loadActive() {
  const raw = readJSON(KEYS.active, null);
  if (!raw || !raw.trip) return null;
  return { trip: normalizeTrip(raw.trip), finished: raw.finished === true };
}

export function saveActive(session) {
  if (!session) {
    backing().removeItem(KEYS.active);
    return true;
  }
  return writeJSON(KEYS.active, session);
}

export const DEFAULT_PREFS = {
  // Hidden columns, not visible ones. With an allow-list of visible columns, a
  // newly added segment type would be invisible until you went and ticked it —
  // exactly the papercut this whole refactor exists to remove.
  hiddenColumns: [],
  sort: { key: 'depart_ts', dir: 'desc' },
  filters: { direction: 'all', dows: [], from: '', to: '', incompleteOnly: false, commuteTypes: [] },
  chart: 'drive',
  lastBackupAt: null,
  backupNagDismissedAt: null,
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
