// Commute Logger — app shell, routing, the lap flow, History, export/backup.
//
// The lap flow is the reason this app exists, so it gets the simplest possible
// interaction: one big button, one tap per transition, every tap writing an
// absolute timestamp to storage before anything else happens.

import {
  DIRECTIONS,
  DIRECTION_LABELS,
  DRIVE_KEY,
  loadSequences,
  loadTypes,
  saveSequences,
  saveTypes,
  segmentLabel,
  segmentTypes,
  sequenceFor,
  slugifyKey,
  createSegment,
  createTrip,
  door2doorMin,
  driveMin,
  guessDirection,
  isIncomplete,
  loadActive,
  loadPrefs,
  loadTrips,
  newestFirst,
  requestPersistence,
  residualMin,
  saveActive,
  savePrefs,
  saveTrips,
  normalizeTrip,
} from './store.js';
import { fetchSeed, rowsToTrips } from './seed.js';
import { longCSV, wideCSV } from './csv.js';
import { dateKey, fmtElapsed, fmtMin, fmtMinHuman, fmtSigned, dowOf, fmtClock } from './format.js';
import { $, clear, h, mount } from './dom.js';
import { renderTripEditor, renderManualAdd } from './editor.js';
import { renderDataView } from './table.js';

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

export const state = {
  trips: [],
  active: null, // { trip, queue, index, finished }
  prefs: loadPrefs(),
  route: { name: 'track' },
  tick: null,
};

export function commitTrips() {
  saveTrips(state.trips);
}

export function upsertTrip(trip) {
  const i = state.trips.findIndex((t) => t.id === trip.id);
  if (i === -1) state.trips.push(trip);
  else state.trips[i] = trip;
  commitTrips();
}

export function deleteTrip(id) {
  state.trips = state.trips.filter((t) => t.id !== id);
  commitTrips();
}

export function updatePrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  savePrefs(state.prefs);
}

export function go(route) {
  state.route = route;
  // #app is the scroll container now, not the window.
  const pane = $('#app');
  if (pane) pane.scrollTop = 0;
  render();
}

// ---------------------------------------------------------------------------
// toast
// ---------------------------------------------------------------------------

let toastTimer = null;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.dataset.show = 'false';
  }, 2200);
}

// ---------------------------------------------------------------------------
// lap flow
// ---------------------------------------------------------------------------

// If a trip were ever auto-started from GPS, this is the seam: a geofence exit
// around home/office would call startTrip() with the crossing timestamp instead
// of Date.now(). Deliberately not implemented — trips are started by hand.
function startTrip() {
  const now = Date.now();
  const direction = guessDirection(now);
  const queue = [...sequenceFor(direction)];
  const trip = createTrip({ depart_ts: now, direction, date: dateKey(now) });
  trip.segments = [createSegment(queue[0], now, null)];
  state.active = { trip, queue, index: 0, finished: false };
  saveActive(state.active);
  go({ name: 'track' });
}

/** Close the running segment and open the next one at the same instant. */
function lap() {
  const s = state.active;
  if (!s || s.finished) return;
  const now = Date.now();
  const current = s.trip.segments[s.trip.segments.length - 1];
  if (current) current.end_ts = now;

  if (s.index + 1 < s.queue.length) {
    s.index += 1;
    s.trip.segments.push(createSegment(s.queue[s.index], now, null));
    saveActive(s);
    render();
  } else {
    finishTrip();
  }
}

/** Close whatever is running and move to review. Never discards anything. */
function finishTrip() {
  const s = state.active;
  if (!s) return;
  const now = Date.now();
  const current = s.trip.segments[s.trip.segments.length - 1];
  if (current && current.end_ts == null) current.end_ts = now;
  // Anything still queued behind us simply never happened — absent, not zero.
  s.queue = s.queue.slice(0, s.index + 1);
  s.finished = true;
  saveActive(s);
  go({ name: 'review' });
}

function saveDraft() {
  const s = state.active;
  if (!s) return;
  upsertTrip(normalizeTrip(s.trip));
  state.active = null;
  saveActive(null);
  toast('Trip saved');
  go({ name: 'history' });
}

function discardDraft() {
  if (!confirm('Discard this trip? The timings will be lost.')) return;
  state.active = null;
  saveActive(null);
  go({ name: 'track' });
}

function relabelCurrent(type) {
  const s = state.active;
  if (!s) return;
  s.trip.segments[s.trip.segments.length - 1].type = type;
  s.queue[s.index] = type;
  saveActive(s);
  render();
}

function setQueue(queue) {
  const s = state.active;
  s.queue = queue;
  saveActive(s);
  render();
}

// ---------------------------------------------------------------------------
// Track view
// ---------------------------------------------------------------------------

function directionToggle(value, onChange) {
  return h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Direction' },
    ...DIRECTIONS.map((d) =>
      h(
        'button',
        {
          type: 'button',
          'data-dir': d,
          'aria-pressed': String(value === d),
          onclick: () => onChange(d),
        },
        d === 'east' ? '→ East' : '← West',
      ),
    ),
  );
}

function trackView() {
  if (!state.active) {
    const guess = guessDirection();
    return h(
      'div',
      { class: 'track-idle' },
      h(
        'button',
        { class: 'btn btn-primary big-start', onclick: startTrip },
        h('span', null, 'Start trip'),
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Next trip'),
        h(
          'div',
          { class: 'row', style: { marginTop: '8px' } },
          h('div', { class: `dir-pill dir-${guess}` }, guess === 'east' ? '→' : '←'),
          h(
            'div',
            { class: 'grow' },
            h('div', null, guess === 'east' ? 'Home → office' : 'Office → home'),
            h(
              'div',
              { class: 'muted', style: { fontSize: '12.5px' } },
              `${sequenceFor(guess).length} segments · guessed from the clock, change it after you start`,
            ),
          ),
        ),
      ),
      state.trips.length
        ? h(
            'div',
            { class: 'card' },
            h('div', { class: 'eyebrow' }, 'Last trip'),
            lastTripSummary(),
          )
        : null,
    );
  }

  const s = state.active;
  const current = s.trip.segments[s.trip.segments.length - 1];
  const isFinal = s.index === s.queue.length - 1;

  return h(
    'div',
    { class: 'stack' },
    // Direction + prediction stay reachable during the trip: both are optional
    // at start so that starting is always one tap.
    h(
      'div',
      { class: 'card card-tight' },
      h(
        'div',
        { class: 'row wrap' },
        directionToggle(s.trip.direction, (d) => {
          s.trip.direction = d;
          saveActive(s);
          render();
        }),
        h(
          'label',
          { class: 'field grow', style: { minWidth: '120px' } },
          h('span', { class: 'field-label' }, 'Google says (min)'),
          h('input', {
            class: 'input-sm',
            type: 'number',
            inputmode: 'decimal',
            step: '1',
            placeholder: '—',
            value: s.trip.gmaps_pred_min ?? '',
            oninput: (e) => {
              const v = e.target.value.trim();
              s.trip.gmaps_pred_min = v === '' ? null : Number(v);
              saveActive(s);
            },
          }),
        ),
      ),
    ),

    h(
      'div',
      { class: 'card', style: { textAlign: 'center', paddingTop: '20px', paddingBottom: '18px' } },
      h('div', { class: 'eyebrow' }, `Segment ${s.index + 1} of ${s.queue.length}`),
      h('div', { class: 'now-label', style: { marginTop: '6px' } }, segmentLabel(current.type)),
      h('div', { class: 'now-elapsed', id: 'elapsed', style: { marginTop: '10px' } }, '0:00'),
      h(
        'div',
        { class: 'muted', style: { fontSize: '12.5px', marginTop: '8px' } },
        `started ${fmtClock(current.start_ts)} · departed ${fmtClock(s.trip.depart_ts)}`,
      ),
      // Relabel-on-the-fly: one tap, no menu.
      h(
        'div',
        { class: 'row wrap gap-sm', style: { justifyContent: 'center', marginTop: '12px' } },
        ...segmentTypes().map((t) =>
          h(
            'button',
            {
              class: 'chip',
              type: 'button',
              'aria-pressed': String(t === current.type),
              onclick: () => relabelCurrent(t),
            },
            segmentLabel(t),
          ),
        ),
      ),
    ),

    h(
      'button',
      {
        class: 'lap-btn',
        type: 'button',
        'data-final': String(isFinal),
        onclick: lap,
      },
      isFinal ? 'FINISH' : 'LAP',
    ),

    h(
      'div',
      { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Sequence'),
      h(
        'div',
        { class: 'queue', style: { marginTop: '8px' } },
        ...s.queue.map((type, i) =>
          h(
            'div',
            {
              class: 'queue-item',
              'data-state': i < s.index ? 'done' : i === s.index ? 'current' : 'next',
            },
            h('span', { class: 'queue-badge' }),
            h('span', { class: 'grow' }, segmentLabel(type)),
            i < s.index
              ? h(
                  'span',
                  { class: 'num muted', style: { fontSize: '13px' } },
                  fmtMinHuman((s.trip.segments[i].end_ts - s.trip.segments[i].start_ts) / 60000),
                )
              : null,
            i > s.index
              ? h(
                  'button',
                  {
                    class: 'btn btn-ghost btn-icon',
                    type: 'button',
                    'aria-label': `Remove ${segmentLabel(type)}`,
                    onclick: () => setQueue(s.queue.filter((_, j) => j !== i)),
                  },
                  '×',
                )
              : null,
          ),
        ),
      ),
      h(
        'div',
        { class: 'row wrap gap-sm', style: { marginTop: '10px' } },
        h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Add:'),
        ...segmentTypes().map((t) =>
          h(
            'button',
            { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => setQueue([...s.queue, t]) },
            `+ ${segmentLabel(t)}`,
          ),
        ),
      ),
    ),

    h(
      'button',
      { class: 'btn btn-ghost btn-block', type: 'button', onclick: finishTrip },
      'End trip here',
    ),
    h(
      'button',
      { class: 'btn btn-ghost btn-block btn-danger', type: 'button', onclick: discardDraft },
      'Discard trip',
    ),
  );
}

function lastTripSummary() {
  const trip = newestFirst(state.trips)[0];
  const d2d = door2doorMin(trip);
  const res = residualMin(trip);
  return h(
    'div',
    { class: 'stat-row', style: { marginTop: '10px' } },
    h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Door to door'), h('div', { class: 'v num' }, d2d == null ? '—' : fmtMinHuman(d2d))),
    h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Drive'), h('div', { class: 'v num' }, fmtMinHuman(driveMin(trip)))),
    h(
      'div',
      { class: 'stat' },
      h('div', { class: 'k' }, 'vs Google'),
      h('div', { class: `v num ${res == null ? '' : res > 0 ? 'pos' : 'neg'}` }, res == null ? '—' : fmtSigned(res)),
    ),
  );
}

/** Cosmetic only — the saved data is always timestamps, never this counter. */
function startTicker() {
  stopTicker();
  state.tick = setInterval(paintElapsed, 1000);
  paintElapsed();
}

function stopTicker() {
  if (state.tick) clearInterval(state.tick);
  state.tick = null;
}

function paintElapsed() {
  const el = document.getElementById('elapsed');
  if (!el || !state.active) return;
  const seg = state.active.trip.segments[state.active.trip.segments.length - 1];
  if (!seg || seg.start_ts == null) return;
  // Recomputed from the stored timestamp every tick, so being suspended for
  // twenty minutes shows twenty minutes rather than a frozen counter.
  el.textContent = fmtElapsed(Date.now() - seg.start_ts);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function backupIsStale() {
  const { lastBackupAt, backupNagDismissedAt } = state.prefs;
  if (!state.trips.length) return false;
  const now = Date.now();
  if (backupNagDismissedAt && now - backupNagDismissedAt < 3 * 24 * 3600 * 1000) return false;
  if (!lastBackupAt) return state.trips.length >= 10;
  const since = state.trips.filter((t) => t.depart_ts > lastBackupAt).length;
  return since >= 10 || now - lastBackupAt > 14 * 24 * 3600 * 1000;
}

function historyView() {
  const trips = newestFirst(state.trips);
  return h(
    'div',
    null,
    backupIsStale()
      ? h(
          'div',
          { class: 'banner' },
          h('span', { class: 'grow' }, 'No recent backup. Phone storage can be cleared by iOS.'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go({ name: 'backup' }) }, 'Back up'),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              onclick: () => {
                updatePrefs({ backupNagDismissedAt: Date.now() });
                render();
              },
            },
            'Later',
          ),
        )
      : null,

    h(
      'div',
      { class: 'row', style: { marginBottom: '12px' } },
      h('button', { class: 'btn grow', type: 'button', onclick: () => go({ name: 'manual' }) }, '+ Past trip'),
      h('button', { class: 'btn grow', type: 'button', onclick: () => go({ name: 'backup' }) }, 'Export'),
      h('button', { class: 'btn grow', type: 'button', onclick: () => go({ name: 'segments' }) }, 'Segments'),
    ),

    trips.length
      ? h('div', null, ...trips.map(tripRow))
      : h('div', { class: 'empty' }, 'No trips yet. Tap Track to log one, or add a past trip.'),
  );
}

function tripRow(trip) {
  const d2d = door2doorMin(trip);
  const res = residualMin(trip);
  const incomplete = isIncomplete(trip);
  return h(
    'button',
    { class: 'trip-row', type: 'button', onclick: () => go({ name: 'trip', id: trip.id }) },
    h('span', { class: `dir-pill dir-${trip.direction}` }, trip.direction === 'east' ? '→' : '←'),
    h(
      'span',
      { class: 'grow' },
      h(
        'span',
        { style: { display: 'block', fontWeight: '650' } },
        `${dowOf(trip.date)} ${trip.date.slice(5)}`,
        h('span', { class: 'muted', style: { fontWeight: '400' } }, `  ${fmtClock(trip.depart_ts)}`),
      ),
      h(
        'span',
        { class: 'muted', style: { fontSize: '12.5px' } },
        `drive ${fmtMinHuman(driveMin(trip))}`,
        res == null ? '' : ` · ${fmtSigned(res)} vs Google`,
      ),
      incomplete ? h('span', { class: 'pill-warn', style: { marginTop: '5px', display: 'inline-block' } }, 'incomplete') : null,
    ),
    h(
      'span',
      { class: 'trip-metric' },
      h('b', null, d2d == null ? '—' : d2d.toFixed(0)),
      h('span', null, d2d == null ? 'no total' : 'min'),
    ),
  );
}

// ---------------------------------------------------------------------------
// segment types + default sequences
// ---------------------------------------------------------------------------

/** How many recorded segments use a type. Deleting one in use would lose data. */
function typeUsage(key) {
  return state.trips.reduce((n, t) => n + t.segments.filter((s) => s.type === key).length, 0);
}

let newTypeLabel = '';

function segmentsView() {
  const types = loadTypes();
  const sequences = loadSequences();

  const commitTypes = (list) => {
    saveTypes(list);
    render();
  };
  const commitSeq = (next) => {
    saveSequences(next);
    render();
  };

  const addType = () => {
    const label = newTypeLabel.trim();
    if (!label) return toast('Give it a name first');
    let key = slugifyKey(label);
    const taken = new Set(types.map((t) => t.key));
    if (taken.has(key)) {
      let i = 2;
      while (taken.has(`${key}_${i}`)) i += 1;
      key = `${key}_${i}`;
    }
    newTypeLabel = '';
    commitTypes([...types, { key, label, short: label.toLowerCase() }]);
    toast(`Added "${label}"`);
  };

  return h(
    'div',
    { class: 'stack' },

    h(
      'div',
      { class: 'card' },
      h('div', { class: 'eyebrow' }, `Segment types (${types.length})`),
      h(
        'div',
        { class: 'muted', style: { fontSize: '12.5px', margin: '6px 0 12px' } },
        'Name is what you see while lapping; column is the CSV and table header. ' +
          'Renaming never touches a stored trip — trips reference a fixed key, not the name.',
      ),
      ...types.map((t) => {
        const usage = typeUsage(t.key);
        const isDrive = t.key === DRIVE_KEY;
        return h(
          'div',
          { class: 'seg-edit' },
          h(
            'div',
            { class: 'row-between' },
            h('code', { class: 'muted', style: { fontSize: '11.5px' } }, t.key),
            h(
              'span',
              { class: 'muted', style: { fontSize: '11.5px' } },
              usage ? `${usage} recorded` : 'unused',
            ),
          ),
          h(
            'div',
            { class: 'seg-grid' },
            field(
              'Name',
              h('input', {
                class: 'input-sm',
                value: t.label,
                onchange: (e) => {
                  const v = e.target.value.trim();
                  if (!v) return render();
                  commitTypes(types.map((x) => (x.key === t.key ? { ...x, label: v } : x)));
                },
              }),
            ),
            field(
              'Column',
              h('input', {
                class: 'input-sm',
                value: t.short,
                onchange: (e) => {
                  const v = e.target.value.trim();
                  if (!v) return render();
                  commitTypes(types.map((x) => (x.key === t.key ? { ...x, short: v } : x)));
                },
              }),
            ),
          ),
          h(
            'div',
            { class: 'row', style: { marginTop: '8px' } },
            isDrive
              ? h(
                  'span',
                  { class: 'muted grow', style: { fontSize: '12px' } },
                  'Kept: “vs Google” is defined as this segment minus the prediction.',
                )
              : h(
                  'button',
                  {
                    class: 'btn btn-ghost btn-sm btn-danger',
                    type: 'button',
                    onclick: () => {
                      if (usage) {
                        toast(`Used by ${usage} segment${usage > 1 ? 's' : ''} — can't delete`);
                        return;
                      }
                      if (!confirm(`Delete the "${t.label}" segment type?`)) return;
                      saveSequences({
                        east: sequences.east.filter((k) => k !== t.key),
                        west: sequences.west.filter((k) => k !== t.key),
                      });
                      commitTypes(types.filter((x) => x.key !== t.key));
                      toast('Type deleted');
                    },
                  },
                  'Delete',
                ),
          ),
        );
      }),
      h(
        'div',
        { class: 'row gap-sm', style: { marginTop: '12px' } },
        h('input', {
          class: 'input-sm grow',
          placeholder: 'New type, e.g. Toll booth',
          value: newTypeLabel,
          oninput: (e) => {
            newTypeLabel = e.target.value;
          },
        }),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: addType }, 'Add'),
      ),
    ),

    ...DIRECTIONS.map((dir) => sequenceCard(dir, sequences, commitSeq)),
  );
}

/** The segment order preloaded when you start a trip in this direction. */
function sequenceCard(dir, sequences, commitSeq) {
  const seq = sequences[dir];
  const unused = segmentTypes().filter((k) => !seq.includes(k));

  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= seq.length) return;
    const next = [...seq];
    [next[i], next[j]] = [next[j], next[i]];
    commitSeq({ ...sequences, [dir]: next });
  };

  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'eyebrow' }, `${DIRECTION_LABELS[dir]} — default sequence`),
    h(
      'div',
      { class: 'muted', style: { fontSize: '12.5px', margin: '6px 0 10px' } },
      'Only a starting point. You can still add, drop and reorder segments on any individual trip.',
    ),
    h(
      'div',
      { class: 'queue' },
      ...seq.map((key, i) =>
        h(
          'div',
          { class: 'queue-item', 'data-state': 'next' },
          h('span', { class: 'queue-badge' }),
          h('span', { class: 'grow' }, segmentLabel(key)),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-icon',
              type: 'button',
              'aria-label': 'Move up',
              disabled: i === 0,
              onclick: () => move(i, -1),
            },
            '↑',
          ),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-icon',
              type: 'button',
              'aria-label': 'Move down',
              disabled: i === seq.length - 1,
              onclick: () => move(i, 1),
            },
            '↓',
          ),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-icon',
              type: 'button',
              'aria-label': 'Remove',
              disabled: seq.length === 1,
              onclick: () => commitSeq({ ...sequences, [dir]: seq.filter((_, j) => j !== i) }),
            },
            '×',
          ),
        ),
      ),
    ),
    unused.length
      ? h(
          'div',
          { class: 'row wrap gap-sm', style: { marginTop: '10px' } },
          h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Add:'),
          ...unused.map((key) =>
            h(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                onclick: () => commitSeq({ ...sequences, [dir]: [...seq, key] }),
              },
              `+ ${segmentLabel(key)}`,
            ),
          ),
        )
      : null,
  );
}

function field(label, input) {
  return h('label', { class: 'field grow' }, h('span', { class: 'field-label' }, label), input);
}

// ---------------------------------------------------------------------------
// export + backup
// ---------------------------------------------------------------------------

/**
 * Hand the bytes to the OS. A web app can't write to disk itself — iOS performs
 * the write after you pick a destination in the share sheet.
 */
async function shareOrDownload(filename, mime, text) {
  const file = new File([text], filename, { type: mime });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function stamp() {
  const d = new Date();
  return `${dateKey(d.getTime())}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

export function exportTrips(trips, { label = 'commutes' } = {}) {
  return shareOrDownload(`${label}-${stamp()}.csv`, 'text/csv', wideCSV(trips));
}

function backupView() {
  const trips = state.trips;
  // Types and sequences ride along: without them a restore on a fresh device
  // would leave every custom segment orphaned with no definition.
  const jsonText = () =>
    JSON.stringify(
      {
        app: 'commute-logger',
        version: 2,
        exported_at: Date.now(),
        types: loadTypes(),
        sequences: loadSequences(),
        trips,
      },
      null,
      2,
    );

  const markBackedUp = () => updatePrefs({ lastBackupAt: Date.now(), backupNagDismissedAt: null });

  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'eyebrow' }, 'CSV — one row per trip'),
      h(
        'div',
        { class: 'muted', style: { fontSize: '13px', margin: '6px 0 12px' } },
        'The human-scannable format. Rounded to 2 decimals, so it is not a full backup.',
      ),
      h(
        'div',
        { class: 'row wrap gap-sm' },
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onclick: async () => {
              const how = await exportTrips(trips);
              if (how !== 'cancelled') toast(how === 'shared' ? 'Shared' : 'Downloaded');
            },
          },
          'Export CSV',
        ),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: async () => toast((await copyText(wideCSV(trips))) ? 'CSV copied' : 'Copy failed'),
          },
          'Copy CSV',
        ),
        h(
          'button',
          {
            class: 'btn btn-ghost',
            type: 'button',
            onclick: async () => {
              const how = await shareOrDownload(`commutes-segments-${stamp()}.csv`, 'text/csv', longCSV(trips));
              if (how !== 'cancelled') toast(how === 'shared' ? 'Shared' : 'Downloaded');
            },
          },
          'Segment CSV',
        ),
      ),
    ),

    h(
      'div',
      { class: 'card' },
      h('div', { class: 'eyebrow' }, 'JSON backup'),
      h(
        'div',
        { class: 'muted', style: { fontSize: '13px', margin: '6px 0 12px' } },
        'Lossless, with raw timestamps. This is the one that can rebuild everything if iOS clears storage or the home-screen icon is deleted.',
      ),
      h(
        'div',
        { class: 'row wrap gap-sm' },
        h(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onclick: async () => {
              const how = await shareOrDownload(`commute-backup-${stamp()}.json`, 'application/json', jsonText());
              if (how === 'cancelled') return;
              markBackedUp();
              toast('Backed up');
              render();
            },
          },
          'Back up JSON',
        ),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              if (await copyText(jsonText())) {
                markBackedUp();
                toast('Backup copied');
                render();
              } else toast('Copy failed');
            },
          },
          'Copy JSON',
        ),
      ),
      state.prefs.lastBackupAt
        ? h(
            'div',
            { class: 'muted', style: { fontSize: '12px', marginTop: '10px' } },
            `Last backup ${new Date(state.prefs.lastBackupAt).toLocaleString()}`,
          )
        : null,
    ),

    restoreCard(),
  );
}

function restoreCard() {
  let pasted = '';

  const apply = (raw, mode) => {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      toast('That is not valid JSON');
      return;
    }
    const incoming = Array.isArray(parsed) ? parsed : parsed?.trips;
    if (!Array.isArray(incoming) || !incoming.length) {
      toast('No trips found in that file');
      return;
    }
    const normalized = incoming.map(normalizeTrip);

    // Merge the incoming vocabulary by key so restored segments keep their
    // names. Local definitions win on conflict; unknown types are added.
    if (Array.isArray(parsed?.types) && parsed.types.length) {
      const byKey = new Map(loadTypes().map((t) => [t.key, t]));
      for (const t of parsed.types) {
        if (t?.key && !byKey.has(t.key)) byKey.set(t.key, t);
      }
      saveTypes([...byKey.values()]);
    }
    if (mode === 'replace' && parsed?.sequences) saveSequences(parsed.sequences);

    if (mode === 'replace') {
      if (!confirm(`Replace all ${state.trips.length} trips with ${normalized.length} from the backup?`)) return;
      state.trips = normalized;
    } else {
      const byId = new Map(state.trips.map((t) => [t.id, t]));
      for (const t of normalized) byId.set(t.id, t);
      state.trips = [...byId.values()];
    }
    commitTrips();
    toast(`${mode === 'replace' ? 'Replaced' : 'Merged'} — ${state.trips.length} trips`);
    go({ name: 'history' });
  };

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' },
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      apply(await file.text(), 'merge');
      e.target.value = '';
    },
  });

  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'eyebrow' }, 'Restore'),
    h(
      'div',
      { class: 'muted', style: { fontSize: '13px', margin: '6px 0 12px' } },
      'Paste a backup here, or pick the file. Pasting is usually faster on the phone.',
    ),
    fileInput,
    h(
      'div',
      { class: 'row wrap gap-sm', style: { marginBottom: '10px' } },
      h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Choose file…'),
    ),
    h('textarea', {
      placeholder: '{ "trips": [ … ] }',
      oninput: (e) => {
        pasted = e.target.value;
      },
    }),
    h(
      'div',
      { class: 'row wrap gap-sm', style: { marginTop: '10px' } },
      h('button', { class: 'btn', type: 'button', onclick: () => apply(pasted, 'merge') }, 'Merge in'),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => apply(pasted, 'replace') }, 'Replace all'),
    ),
  );
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'track', glyph: '⏱', label: 'Track' },
  { id: 'history', glyph: '☰', label: 'History' },
  { id: 'data', glyph: '◧', label: 'Data' },
];

function header() {
  const r = state.route;
  const titles = {
    track: state.active ? 'Tracking' : 'Commute',
    history: 'History',
    data: 'Data',
    trip: 'Trip',
    manual: 'Add past trip',
    segments: 'Segment types',
    review: 'Review',
    backup: 'Export & backup',
  };
  const showBack = ['trip', 'manual', 'backup', 'segments'].includes(r.name);
  return h(
    'div',
    { class: 'topbar' },
    h(
      'div',
      { class: 'row' },
      showBack
        ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => go({ name: r.name === 'data' ? 'data' : 'history' }) }, '‹ Back')
        : null,
      h('h1', null, titles[r.name] || 'Commute'),
    ),
    r.name === 'history' && state.trips.length
      ? h('span', { class: 'muted', style: { fontSize: '13px' } }, `${state.trips.length} trips`)
      : null,
  );
}

function currentBody() {
  switch (state.route.name) {
    case 'track':
      return trackView();
    case 'history':
      return historyView();
    case 'data':
      return renderDataView();
    case 'manual':
      return renderManualAdd();
    case 'backup':
      return backupView();
    case 'segments':
      return segmentsView();
    case 'review':
      if (!state.active) return trackView();
      return renderTripEditor(state.active.trip, {
        mode: 'draft',
        onChange: () => saveActive(state.active),
        onSave: saveDraft,
        onDiscard: discardDraft,
      });
    case 'trip': {
      const trip = state.trips.find((t) => t.id === state.route.id);
      if (!trip) return h('div', { class: 'empty' }, 'That trip is gone.');
      return renderTripEditor(trip, {
        mode: 'saved',
        onChange: () => commitTrips(),
        onDelete: () => {
          if (!confirm('Delete this trip?')) return;
          deleteTrip(trip.id);
          toast('Trip deleted');
          go({ name: 'history' });
        },
      });
    }
    default:
      return trackView();
  }
}

function renderTabs() {
  const activeTab = ['track', 'review'].includes(state.route.name)
    ? 'track'
    : ['history', 'trip', 'manual', 'backup', 'segments'].includes(state.route.name)
      ? 'history'
      : 'data';
  mount(
    $('#tabbar'),
    ...TABS.map((t) =>
      h(
        'button',
        {
          type: 'button',
          'aria-current': String(t.id === activeTab),
          onclick: () => go({ name: t.id }),
        },
        h('span', { class: 'tab-glyph' }, t.glyph),
        h('span', null, t.label),
        t.id === 'track' && state.active ? h('span', { class: 'dot' }) : null,
      ),
    ),
  );
}

export function render() {
  const app = $('#app');
  mount(app, header(), currentBody());
  renderTabs();

  if (state.active && !state.active.finished && state.route.name === 'track') startTicker();
  else stopTicker();
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

async function boot() {
  state.trips = loadTrips();
  state.active = loadActive();

  // Seed only on a genuinely fresh install, and only once — deleting every trip
  // on purpose should not resurrect them on the next launch.
  if (!state.trips.length && !state.prefs.seeded) {
    const seed = await fetchSeed();
    if (seed) {
      state.trips = rowsToTrips(seed.rows);
      commitTrips();
    }
    updatePrefs({ seeded: true });
  }

  if (state.active) state.route = { name: state.active.finished ? 'review' : 'track' };
  render();

  requestPersistence();

  // A suspended app comes back with a stale readout; repaint on resume.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) paintElapsed();
  });

  // Insecure origins (a plain LAN http:// server) have no service worker. The
  // app still works there, just without offline caching.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch {
      /* not fatal */
    }
  }
}

boot();
