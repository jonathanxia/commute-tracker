// Commute Logger — app shell, routing, the lap flow, History, export/backup.
//
// The lap flow is the reason this app exists, so it gets the simplest possible
// interaction: one big button, one tap per transition, every tap writing an
// absolute timestamp to storage before anything else happens.

import {
  DIRECTIONS,
  DIRECTION_LABELS,
  DRIVE_KEY,
  addCommuteType,
  commuteTypeLabel,
  loadCommuteTypes,
  loadSequences,
  loadTypes,
  saveCommuteTypes,
  saveSequences,
  saveTypes,
  addType,
  predictNextType,
  segmentLabel,
  segmentTypes,
  sequenceFor,
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
import { dateKey, fmtElapsed, fmtMin, fmtMinHuman, fmtSigned, dowOf, fmtClock } from './format.js';
import { $, clear, h, mount } from './dom.js';
import { renderTripEditor, renderManualAdd } from './editor.js';
import { renderDataView } from './table.js';

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

export const BUILD = 'v10';

export const state = {
  trips: [],
  active: null, // { trip, finished }
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
  const trip = createTrip({ depart_ts: now, direction, date: dateKey(now) });
  trip.segments = [createSegment(sequenceFor(direction)[0], now, null)];
  state.active = { trip, finished: false };
  saveActive(state.active);
  go({ name: 'track' });
}

/**
 * Close the running segment and open the next one at the same instant.
 *
 * Lap never ends the trip and never runs out — tap it as many times as the trip
 * actually has transitions. The new segment gets a guessed type immediately, and
 * you correct it with the pills whenever you like: the timestamp was locked at
 * the tap, so labelling it thirty seconds later costs nothing.
 */
function lap() {
  const s = state.active;
  if (!s || s.finished) return;
  const now = Date.now();
  const current = s.trip.segments[s.trip.segments.length - 1];
  if (current) current.end_ts = now;
  s.trip.segments.push(createSegment(predictNextType(s.trip, s.trip.direction), now, null));
  saveActive(s);
  render();
}

/** Close whatever is running and move to review. Never discards anything. */
function endTrip() {
  const s = state.active;
  if (!s) return;
  const now = Date.now();
  const current = s.trip.segments[s.trip.segments.length - 1];
  if (current && current.end_ts == null) current.end_ts = now;
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
  const done = s.trip.segments.slice(0, -1);

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
      h('div', { class: 'eyebrow' }, `Segment ${s.trip.segments.length} · running`),
      h('div', { class: 'now-label', style: { marginTop: '6px' } }, segmentLabel(current.type)),
      h('div', { class: 'now-elapsed', id: 'elapsed', style: { marginTop: '10px' } }, '0:00'),
      h(
        'div',
        { class: 'muted', style: { fontSize: '12.5px', marginTop: '8px' } },
        `started ${fmtClock(current.start_ts)} · departed ${fmtClock(s.trip.depart_ts)}`,
      ),
    ),

    h(
      'div',
      { class: 'card card-tight' },
      h('div', { class: 'field-label', style: { marginBottom: '7px' } }, 'Commute type'),
      commuteTypePicker(s.trip.commute_type, (key) => {
        s.trip.commute_type = key;
        saveActive(s);
        render();
      }),
    ),

    // The type menu for whatever is running right now. Always visible, so
    // there is never a hidden mode — tap a pill and the current segment
    // becomes that. Timestamps are untouched by relabelling.
    typePicker(current.type, (t) => {
      current.type = t;
      saveActive(s);
      render();
    }),

    // Two buttons, always. Lap never runs out and never ends the trip.
    h('button', { class: 'lap-btn', type: 'button', onclick: lap }, 'LAP'),
    h('button', { class: 'end-btn', type: 'button', onclick: endTrip }, 'END TRIP'),

    done.length
      ? h(
          'div',
          { class: 'card' },
          h('div', { class: 'eyebrow' }, `Recorded (${done.length})`),
          h(
            'div',
            { class: 'queue', style: { marginTop: '8px' } },
            ...done.map((seg, i) =>
              h(
                'div',
                { class: 'queue-item', 'data-state': 'done' },
                h('span', { class: 'queue-badge' }),
                h('span', { class: 'grow' }, `${i + 1}. ${segmentLabel(seg.type)}`),
                h(
                  'span',
                  { class: 'num', style: { fontSize: '13px' } },
                  fmtMinHuman((seg.end_ts - seg.start_ts) / 60000),
                ),
              ),
            ),
          ),
          h(
            'div',
            { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } },
            'Anything mislabelled is fixable on the review screen after you end the trip.',
          ),
        )
      : null,

    h(
      'button',
      { class: 'btn btn-ghost btn-block btn-danger', type: 'button', onclick: discardDraft },
      'Discard trip',
    ),
  );
}

let creatingCommuteType = false;
let newCommuteDraft = '';

/**
 * Commute-type chips: which kind of commute this was. Tapping the selected one
 * clears it, so "not categorised" stays reachable without a separate control.
 */
export function commuteTypePicker(selected, onPick) {
  if (creatingCommuteType) {
    return h(
      'div',
      { class: 'row gap-sm' },
      h('input', {
        class: 'input-sm grow',
        id: 'new-commute-input',
        placeholder: 'e.g. Ferry',
        value: newCommuteDraft,
        oninput: (e) => {
          newCommuteDraft = e.target.value;
        },
      }),
      h(
        'button',
        {
          class: 'btn btn-sm btn-primary',
          type: 'button',
          onclick: () => {
            const key = addCommuteType(newCommuteDraft);
            creatingCommuteType = false;
            newCommuteDraft = '';
            if (key) onPick(key);
            else render();
          },
        },
        'Add',
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => {
            creatingCommuteType = false;
            newCommuteDraft = '';
            render();
          },
        },
        'Cancel',
      ),
    );
  }
  return h(
    'div',
    { class: 'row wrap gap-sm' },
    ...loadCommuteTypes().map((t) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(t.key === selected),
          onclick: () => onPick(t.key === selected ? null : t.key),
        },
        t.label,
      ),
    ),
    h(
      'button',
      {
        class: 'chip chip-new',
        type: 'button',
        onclick: () => {
          creatingCommuteType = true;
          newCommuteDraft = '';
          render();
        },
      },
      '+ New',
    ),
  );
}

// Inline new-type entry state for the recorder's picker.
let creatingType = false;
let newTypeDraft = '';

/**
 * The segment-type menu: every type as a pill, plus inline creation.
 *
 * Creating a type here is the same action as creating one on the management
 * screen — same key derivation, same storage — so a type invented mid-commute
 * is a first-class type everywhere afterwards.
 */
function typePicker(selected, onPick) {
  if (creatingType) {
    return h(
      'div',
      { class: 'card card-tight' },
      h('div', { class: 'eyebrow' }, 'New segment type'),
      h(
        'div',
        { class: 'row gap-sm', style: { marginTop: '8px' } },
        h('input', {
          class: 'input-sm grow',
          id: 'new-type-input',
          placeholder: 'e.g. Toll booth',
          value: newTypeDraft,
          autofocus: true,
          oninput: (e) => {
            newTypeDraft = e.target.value;
          },
          onkeydown: (e) => {
            if (e.key === 'Enter') e.target.blur(), commitNewType(onPick);
          },
        }),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => commitNewType(onPick) }, 'Add'),
        h(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onclick: () => {
              creatingType = false;
              newTypeDraft = '';
              render();
            },
          },
          'Cancel',
        ),
      ),
    );
  }

  return h(
    'div',
    { class: 'card card-tight' },
    h(
      'div',
      { class: 'row wrap gap-sm' },
      ...segmentTypes().map((t) =>
        h(
          'button',
          {
            class: 'chip chip-lg',
            type: 'button',
            'aria-pressed': String(t === selected),
            onclick: () => onPick(t),
          },
          segmentLabel(t),
        ),
      ),
      h(
        'button',
        {
          class: 'chip chip-lg chip-new',
          type: 'button',
          onclick: () => {
            creatingType = true;
            newTypeDraft = '';
            render();
          },
        },
        '+ New',
      ),
    ),
  );
}

function commitNewType(onPick) {
  const key = addType(newTypeDraft);
  creatingType = false;
  newTypeDraft = '';
  if (!key) return render();
  onPick(key);
  toast('Type added');
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

/**
 * Measured geometry, printed in the History footer.
 *
 * iOS standalone mode cannot be reproduced in a desktop browser — there is no
 * way to emulate the safe-area insets or the web view's actual bounds. So the
 * app measures itself: if `view` height is smaller than `screen` height while
 * the safe insets read 0, the viewport is not covering the screen and anything
 * pinned to the bottom will float above it.
 */
function layoutReport() {
  let top = 0;
  let bottom = 0;
  try {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
      'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    top = Math.round(parseFloat(cs.paddingTop) || 0);
    bottom = Math.round(parseFloat(cs.paddingBottom) || 0);
    probe.remove();
  } catch {
    /* measurement is best-effort */
  }
  const standalone =
    (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
  return (
    `build ${BUILD} · view ${window.innerWidth}×${window.innerHeight} · ` +
    `screen ${screen.width}×${screen.height} · safe ${top}/${bottom} · ` +
    (standalone ? 'standalone' : 'browser')
  );
}

/**
 * Decide whether the web view actually reaches under the status bar.
 *
 * On the phone this reads: view 430x873, screen 430x932, safe 59/34 — the
 * viewport is already inset by exactly the top inset, yet env() still reports
 * 59. Padding by env() as well would waste 59pt at the top of every screen.
 */
function syncInsetCompensation() {
  const coversScreen = window.innerHeight >= (screen.height || window.innerHeight) - 1;
  document.documentElement.dataset.insetTop = String(!coversScreen);
  // The footer diagnostic is measured at render time, so re-render it once the
  // viewport settles — otherwise it can report numbers from mid-layout.
  if (state.route.name === 'history') render();
}

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

    // Build marker plus measured layout. iOS standalone mode can't be reproduced
    // in a desktop browser, so the app reports its own geometry instead: a stale
    // cache or a viewport that doesn't cover the screen is then visible at a
    // glance rather than something to guess at.
    h(
      'div',
      { class: 'muted', style: { fontSize: '10.5px', textAlign: 'center', padding: '14px 0 2px', lineHeight: '1.5' } },
      layoutReport(),
    ),
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

  const add = () => {
    const label = newTypeLabel.trim();
    if (!label) return toast('Give it a name first');
    newTypeLabel = '';
    addType(label);
    render();
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
        'One name each — it is the pill while lapping, the table header and the CSV header. ' +
          'Renaming never touches a stored trip.',
      ),
      ...types.map((t) => {
        const usage = typeUsage(t.key);
        const isDrive = t.key === DRIVE_KEY;
        return h(
          'div',
          { class: 'seg-edit' },
          h(
            'div',
            { class: 'row gap-sm' },
            h('input', {
              class: 'input-sm grow',
              value: t.label,
              'aria-label': 'Segment name',
              onchange: (e) => {
                const v = e.target.value.trim();
                if (!v) return render();
                commitTypes(types.map((x) => (x.key === t.key ? { ...x, label: v } : x)));
              },
            }),
            h(
              'span',
              { class: 'muted', style: { fontSize: '11.5px', whiteSpace: 'nowrap' } },
              usage ? `${usage} recorded` : 'unused',
            ),
          ),
          h(
            'label',
            { class: 'row', style: { gap: '10px', marginTop: '10px' } },
            h('input', {
              type: 'checkbox',
              checked: t.exclude === true,
              onchange: (e) =>
                commitTypes(
                  types.map((x) => (x.key === t.key ? { ...x, exclude: e.target.checked } : x)),
                ),
            }),
            h(
              'span',
              { class: 'grow', style: { fontSize: '13.5px' } },
              h('span', null, 'Leave out of door-to-door'),
              h(
                'span',
                { class: 'muted', style: { display: 'block', fontSize: '12px' } },
                'Still recorded and still gets its own CSV column — just not counted in the total.',
              ),
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
        h('button', { class: 'btn btn-sm', type: 'button', onclick: add }, 'Add'),
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

/**
 * The one export format. JSON is the actual data — lossless, with raw
 * timestamps and the vocabularies needed to read it back. Anything tabular is
 * one line of pandas away, so there is no second format to keep in sync.
 */
export function exportPayload(trips) {
  return {
    app: 'commute-logger',
    version: 3,
    exported_at: Date.now(),
    types: loadTypes(),
    commute_types: loadCommuteTypes(),
    sequences: loadSequences(),
    trips,
  };
}

export function exportTrips(trips, { label = 'commutes' } = {}) {
  return shareOrDownload(
    `${label}-${stamp()}.json`,
    'application/json',
    JSON.stringify(exportPayload(trips), null, 2),
  );
}

function backupView() {
  const trips = state.trips;
  const jsonText = () => JSON.stringify(exportPayload(trips), null, 2);
  const markBackedUp = () => updatePrefs({ lastBackupAt: Date.now(), backupNagDismissedAt: null });

  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Export'),
      h(
        'div',
        { class: 'muted', style: { fontSize: '13px', margin: '6px 0 12px' } },
        'JSON is the only format, because it is the actual data: raw timestamps, ' +
          'nothing rounded, plus the segment and commute vocabularies needed to read it. ' +
          'Anything tabular is one line of pandas away.',
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
              const how = await exportTrips(trips, { label: 'commute-backup' });
              if (how === 'cancelled') return;
              markBackedUp();
              toast(how === 'shared' ? 'Shared' : 'Downloaded');
              render();
            },
          },
          'Export JSON',
        ),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              if (await copyText(jsonText())) {
                markBackedUp();
                toast('Copied');
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

    h(
      'div',
      { class: 'card' },
      h('div', { class: 'eyebrow' }, 'App version'),
      h(
        'div',
        { class: 'muted', style: { fontSize: '13px', margin: '6px 0 12px' } },
        `Running ${BUILD}. The app updates itself on launch when it has signal; ` +
          'this forces the check now.',
      ),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            try {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map((r) => r.update()));
              await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
              toast('Reloading…');
              setTimeout(() => location.reload(), 400);
            } catch {
              toast('Update check failed');
            }
          },
        },
        'Check for updates',
      ),
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
    if (Array.isArray(parsed?.commute_types) && parsed.commute_types.length) {
      const byKey = new Map(loadCommuteTypes().map((t) => [t.key, t]));
      for (const t of parsed.commute_types) {
        if (t?.key && !byKey.has(t.key)) byKey.set(t.key, t);
      }
      saveCommuteTypes([...byKey.values()]);
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
  syncInsetCompensation();
  window.addEventListener('resize', syncInsetCompensation);
  window.addEventListener('orientationchange', syncInsetCompensation);

  // A suspended app comes back with a stale readout; repaint on resume.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) paintElapsed();
  });

  // Insecure origins (a plain LAN http:// server) have no service worker. The
  // app still works there, just without offline caching.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    try {
      // Cache-first means a launch shows the OLD files while the new ones
      // download, so without this the app takes two launches to update and
      // looks stuck on a stale build. The worker calls skipWaiting(), so a new
      // version activates during this session; when it takes control, reload
      // once so the running page is actually the version in the cache.
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        location.reload();
      });
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.update().catch(() => {});
    } catch {
      /* not fatal */
    }
  }
}

boot();
