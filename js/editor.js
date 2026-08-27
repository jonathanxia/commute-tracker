// Trip detail / editor, and the manual-entry form.
//
// Editing raw timestamps is a hard requirement, not a nice-to-have, so both the
// boundaries and the duration are directly editable on every segment. Segments
// are independent (start, end) pairs: changing one boundary never rewrites a
// neighbour's, because a gap can be real and an edited boundary must survive.

import {
  DIRECTIONS,
  DRIVE_KEY,
  segmentLabel,
  segmentTypes,
  sequenceFor,
  createSegment,
  createTrip,
  door2doorMin,
  driveMin,
  isIncomplete,
  residualMin,
  segDurationMin,
  segmentIssues,
  tripFromDurations,
  guessDirection,
} from './store.js';
import { dateKey, dowOf, fmtClock, fmtClockTyped, fmtMin, fmtMinHuman, fmtSigned, parseClockStr, tsAtClock, dateStrToTs } from './format.js';
import { h } from './dom.js';
import { commuteTypePicker, go, render, state, toast, upsertTrip } from './app.js';

function field(label, input) {
  return h('label', { class: 'field grow' }, h('span', { class: 'field-label' }, label), input);
}

/**
 * Typed time-of-day field. Deliberately a plain text input, not a native time
 * picker: the picker wheels commit whatever value the scroll lands on
 * mid-gesture, and can't take seconds. Accepts anything parseClockStr does.
 * The day half of the timestamp comes from anchorTs() at parse time.
 *
 * apply(ts) receives the new timestamp (null when cleared, if allowClear) and
 * is responsible for committing. Unreadable text marks the field and commits
 * nothing, so a typo can be fixed in place instead of clobbering the value.
 */
function timeField(label, ts, anchorTs, apply, { allowClear = false } = {}) {
  return field(
    label,
    h('input', {
      class: 'input-sm',
      type: 'text',
      // decimal, not numeric: the iOS digit pad has no colon, so the period is
      // the only separator reachable from it — parseClockStr reads 8.45 as
      // 8:45, and bare digits (845, 84530) need no separator at all.
      inputmode: 'decimal',
      autocomplete: 'off',
      enterkeyhint: 'done',
      placeholder: '845 or 8.45',
      value: fmtClockTyped(ts),
      onchange: (e) => {
        const raw = e.target.value.trim();
        e.target.classList.remove('invalid');
        if (raw === '') {
          if (allowClear) apply(null);
          else e.target.value = fmtClockTyped(ts);
          return;
        }
        const clockMs = parseClockStr(raw);
        if (clockMs == null) {
          e.target.classList.add('invalid');
          toast(`Couldn't read “${raw}” as a time — try 845 or 8.45`);
          return;
        }
        apply(tsAtClock(anchorTs(), clockMs));
      },
    }),
  );
}

function directionToggle(value, onChange) {
  return h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Direction' },
    ...DIRECTIONS.map((d) =>
      h(
        'button',
        { type: 'button', 'data-dir': d, 'aria-pressed': String(value === d), onclick: () => onChange(d) },
        d === 'east' ? '→ East' : '← West',
      ),
    ),
  );
}

function statRow(trip) {
  const d2d = door2doorMin(trip);
  const res = residualMin(trip);
  return h(
    'div',
    { class: 'stat-row' },
    h(
      'div',
      { class: 'stat' },
      h('div', { class: 'k' }, 'Door to door'),
      h('div', { class: 'v num' }, d2d == null ? '—' : fmtMinHuman(d2d)),
    ),
    h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Drive'), h('div', { class: 'v num' }, fmtMinHuman(driveMin(trip)))),
    h(
      'div',
      { class: 'stat' },
      h('div', { class: 'k' }, 'vs Google'),
      h('div', { class: `v num ${res == null ? '' : res > 0 ? 'pos' : 'neg'}` }, res == null ? '—' : fmtSigned(res)),
    ),
  );
}

/**
 * @param {object} trip
 * @param {{mode:'draft'|'saved', onChange:Function, onSave?:Function, onDiscard?:Function, onDelete?:Function}} opts
 */
export function renderTripEditor(trip, opts) {
  const commit = () => {
    opts.onChange();
    render();
  };

  const issues = segmentIssues(trip);

  return h(
    'div',
    { class: 'stack' },

    opts.mode === 'draft'
      ? h(
          'div',
          { class: 'banner' },
          h('span', { class: 'grow' }, 'Not saved yet — check the segments, then save.'),
        )
      : null,

    statRow(trip),

    h(
      'div',
      { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Trip'),
      h(
        'div',
        { class: 'seg-grid', style: { marginTop: '10px' } },
        field(
          'Date',
          h('input', {
            class: 'input-sm',
            type: 'date',
            value: trip.date,
            onchange: (e) => {
              // Moving the date moves every timestamp with it. The time fields
              // are clock-only, so this is the one control that owns the day;
              // timestamps left behind on the old day would be invisible.
              if (e.target.value) {
                const delta = dateStrToTs(e.target.value) - dateStrToTs(trip.date);
                trip.date = e.target.value;
                if (delta) {
                  if (trip.depart_ts != null) trip.depart_ts += delta;
                  for (const s of trip.segments) {
                    if (s.start_ts != null) s.start_ts += delta;
                    if (s.end_ts != null) s.end_ts += delta;
                  }
                }
              }
              commit();
            },
          }),
        ),
        field(
          'Google says (min)',
          h('input', {
            class: 'input-sm',
            type: 'number',
            inputmode: 'decimal',
            step: '0.01',
            placeholder: '—',
            value: trip.gmaps_pred_min ?? '',
            onchange: (e) => {
              const v = e.target.value.trim();
              trip.gmaps_pred_min = v === '' ? null : Number(v);
              commit();
            },
          }),
        ),
        h(
          'div',
          { class: 'full' },
          timeField(
            'Departed',
            trip.depart_ts,
            () => trip.depart_ts ?? dateStrToTs(trip.date),
            (ts) => {
              trip.depart_ts = ts;
              trip.date = dateKey(ts);
              commit();
            },
          ),
        ),
        h('div', { class: 'full row wrap' }, directionToggle(trip.direction, (d) => {
          trip.direction = d;
          commit();
        })),
        h(
          'div',
          { class: 'full' },
          h('div', { class: 'field-label', style: { marginBottom: '6px' } }, 'Commute type'),
          commuteTypePicker(trip.commute_type, (key) => {
            trip.commute_type = key;
            commit();
          }),
        ),
        h(
          'label',
          { class: 'full row', style: { gap: '10px' } },
          h('input', {
            type: 'checkbox',
            checked: trip.incomplete === true,
            onchange: (e) => {
              trip.incomplete = e.target.checked;
              commit();
            },
          }),
          h(
            'span',
            { class: 'grow' },
            h('span', null, 'Not fully recorded'),
            h(
              'span',
              { class: 'muted', style: { display: 'block', fontSize: '12px' } },
              'Arrival and door-to-door export blank, so an incomplete trip never looks like a complete one.',
            ),
          ),
        ),
      ),
    ),

    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'row-between' },
        h('div', { class: 'eyebrow' }, `Segments (${trip.segments.length})`),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, `arrive ${fmtClock(trip.segments.at(-1)?.end_ts) || '—'}`),
      ),
      h('div', { style: { marginTop: '10px' } }, ...trip.segments.map((seg, i) => segmentEditor(trip, seg, i, commit))),
      issues.length
        ? h(
            'div',
            { class: 'issue' },
            ...issues.map((iss) =>
              h(
                'div',
                null,
                iss.kind === 'depart'
                  ? `First segment starts ${fmtMinHuman(Math.abs(iss.deltaMs) / 60000)} ${iss.deltaMs > 0 ? 'after' : 'before'} departure.`
                  : `${iss.kind === 'gap' ? 'Gap' : 'Overlap'} of ${fmtMinHuman(Math.abs(iss.deltaMs) / 60000)} before segment ${iss.index + 1}.`,
              ),
            ),
            h('div', { class: 'muted', style: { marginTop: '2px' } }, 'Left as-is — segments are independent, so this may be intentional.'),
          )
        : null,
      h(
        'button',
        {
          class: 'btn btn-ghost btn-block',
          type: 'button',
          style: { marginTop: '10px' },
          onclick: () => {
            const prev = trip.segments.at(-1);
            const start = prev?.end_ts ?? trip.depart_ts;
            const used = new Set(trip.segments.map((s) => s.type));
            const type = segmentTypes().find((t) => !used.has(t)) || DRIVE_KEY;
            trip.segments.push(createSegment(type, start, start));
            commit();
          },
        },
        '+ Add segment',
      ),
    ),

    opts.mode === 'draft'
      ? h(
          'div',
          { class: 'stack' },
          h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: opts.onSave }, 'Save trip'),
          h('button', { class: 'btn btn-ghost btn-block btn-danger', type: 'button', onclick: opts.onDiscard }, 'Discard'),
        )
      : h('button', { class: 'btn btn-ghost btn-block btn-danger', type: 'button', onclick: opts.onDelete }, 'Delete trip'),
  );
}

function segmentEditor(trip, seg, i, commit) {
  const dur = segDurationMin(seg);
  const move = (delta) => {
    const j = i + delta;
    if (j < 0 || j >= trip.segments.length) return;
    [trip.segments[i], trip.segments[j]] = [trip.segments[j], trip.segments[i]];
    commit();
  };

  return h(
    'div',
    { class: 'seg-edit' },
    h(
      'div',
      { class: 'row gap-sm' },
      h(
        'select',
        {
          class: 'input-sm grow',
          onchange: (e) => {
            seg.type = e.target.value;
            commit();
          },
        },
        // An orphan type (deleted, or from another device's backup) still needs
        // an option, or opening the editor would silently retype the segment.
        ...[...new Set([...segmentTypes(), seg.type])].map((t) =>
          h('option', { value: t, selected: t === seg.type }, segmentLabel(t)),
        ),
      ),
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }, '↑'),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-icon',
          type: 'button',
          'aria-label': 'Move down',
          disabled: i === trip.segments.length - 1,
          onclick: () => move(1),
        },
        '↓',
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-icon',
          type: 'button',
          'aria-label': 'Delete segment',
          onclick: () => {
            trip.segments.splice(i, 1);
            commit();
          },
        },
        '×',
      ),
    ),
    h(
      'div',
      { class: 'seg-grid' },
      timeField(
        'Start',
        seg.start_ts,
        () => seg.start_ts ?? trip.segments[i - 1]?.end_ts ?? trip.depart_ts ?? dateStrToTs(trip.date),
        (ts) => {
          seg.start_ts = ts;
          commit();
        },
        { allowClear: true },
      ),
      timeField(
        'End',
        seg.end_ts,
        // Anchored to the START's day, not the end's own: with the roll-forward
        // below, retyping a sane time always heals an end stranded on the wrong
        // day, instead of sticking there.
        () => seg.start_ts ?? seg.end_ts ?? trip.depart_ts ?? dateStrToTs(trip.date),
        (ts) => {
          // A clock time earlier than the start reads as crossing midnight.
          if (ts != null && seg.start_ts != null && ts < seg.start_ts) ts += 86400000;
          seg.end_ts = ts;
          commit();
        },
        { allowClear: true },
      ),
      h(
        'div',
        { class: 'full row gap-sm' },
        field(
          'Duration (min)',
          h('input', {
            class: 'input-sm',
            type: 'number',
            inputmode: 'decimal',
            step: '0.01',
            value: dur == null ? '' : fmtMin(dur),
            onchange: (e) => {
              const v = e.target.value.trim();
              if (v === '' || seg.start_ts == null) return;
              // Only this segment's end moves. The next segment keeps its own
              // start, which is what makes an edited boundary survive.
              seg.end_ts = seg.start_ts + Math.round(Number(v) * 60000);
              commit();
            },
          }),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// manual entry
// ---------------------------------------------------------------------------

/**
 * "7 min walking, 33 driving, 2 waiting" — type the durations, get a trip with
 * synthesized contiguous timestamps. Leaving a field empty means that segment
 * is absent; typing 0 means it happened and measured ~nil.
 */
export function renderManualAdd() {
  const now = new Date();
  const draft = {
    date: dateKey(now.getTime()),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    direction: guessDirection(now.getTime()),
    gmaps: '',
    incomplete: false,
    durations: Object.fromEntries(segmentTypes().map((k) => [k, ''])),
  };

  const root = h('div', { class: 'stack' });

  const rerender = () => {
    root.replaceChildren(...body());
  };

  /**
   * The direction's default sequence first, then any other type you actually
   * filled in — so a segment that isn't normally part of this direction still
   * gets recorded, in a sensible place, without needing the editor afterwards.
   */
  /** Which duration fields to show, and in what order. */
  const fieldOrder = () => {
    const base = sequenceFor(draft.direction);
    return [...base, ...segmentTypes().filter((k) => !base.includes(k))];
  };

  const orderFor = () => {
    const base = sequenceFor(draft.direction);
    const extras = segmentTypes().filter((k) => !base.includes(k) && draft.durations[k] !== '');
    if (!extras.length) return base;
    // Anything extra lands just before the final segment, which is where an
    // unexpected wait almost always happened.
    return [...base.slice(0, -1), ...extras, ...base.slice(-1)];
  };

  const create = () => {
    const clockMs = parseClockStr(draft.time);
    if (clockMs == null) {
      toast('Set a departure time');
      return;
    }
    const depart_ts = dateStrToTs(draft.date) + clockMs;
    const durations = orderFor()
      .map((type) => ({ type, minutes: draft.durations[type] === '' ? null : Number(draft.durations[type]) }))
      .filter((d) => d.minutes != null && Number.isFinite(d.minutes));

    if (!durations.length) {
      toast('Add at least one duration');
      return;
    }

    const trip = tripFromDurations({
      date: draft.date,
      depart_ts,
      direction: draft.direction,
      gmaps_pred_min: draft.gmaps === '' ? null : Number(draft.gmaps),
      durations,
      incomplete: draft.incomplete,
    });
    upsertTrip(trip);
    toast('Trip added');
    go({ name: 'trip', id: trip.id });
  };

  function body() {
    return [
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'eyebrow' }, 'When'),
        h(
          'div',
          { class: 'seg-grid', style: { marginTop: '10px' } },
          field(
            'Date',
            h('input', {
              class: 'input-sm',
              type: 'date',
              value: draft.date,
              onchange: (e) => {
                draft.date = e.target.value;
              },
            }),
          ),
          field(
            'Departed',
            h('input', {
              class: 'input-sm',
              type: 'text',
              inputmode: 'decimal', // digit pad has no colon; 845 and 8.45 both parse
              autocomplete: 'off',
              enterkeyhint: 'done',
              placeholder: '845 or 8.45',
              value: draft.time,
              onchange: (e) => {
                draft.time = e.target.value.trim();
                e.target.classList.toggle('invalid', draft.time !== '' && parseClockStr(draft.time) == null);
              },
            }),
          ),
          h('div', { class: 'full row wrap' }, directionToggle(draft.direction, (d) => {
            draft.direction = d;
            rerender();
          })),
          field(
            'Google says (min)',
            h('input', {
              class: 'input-sm',
              type: 'number',
              inputmode: 'decimal',
              step: '0.01',
              placeholder: '—',
              value: draft.gmaps,
              onchange: (e) => {
                draft.gmaps = e.target.value.trim();
              },
            }),
          ),
        ),
      ),

      h(
        'div',
        { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Durations (minutes)'),
        h(
          'div',
          { class: 'muted', style: { fontSize: '12.5px', margin: '6px 0 4px' } },
          'Leave blank if it did not happen or was not recorded. Type 0 if it happened and was negligible — those are different things and the CSV keeps them apart.',
        ),
        // A field for every type, not just the ones in this direction's default
        // sequence — otherwise a type you just added would have nowhere to go.
        // The direction's own segments come first; the rest follow.
        ...fieldOrder().map((type) =>
          h(
            'div',
            { style: { marginTop: '8px' } },
            field(
              segmentLabel(type),
              h('input', {
                class: 'input-sm',
                type: 'number',
                inputmode: 'decimal',
                step: '0.01',
                placeholder: 'blank = absent',
                value: draft.durations[type],
                onchange: (e) => {
                  draft.durations[type] = e.target.value.trim();
                },
              }),
            ),
          ),
        ),
        h(
          'label',
          { class: 'row', style: { gap: '10px', marginTop: '14px' } },
          h('input', {
            type: 'checkbox',
            checked: draft.incomplete,
            onchange: (e) => {
              draft.incomplete = e.target.checked;
            },
          }),
          h('span', { class: 'grow' }, 'Not fully recorded'),
        ),
      ),

      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: create }, 'Add trip'),
    ];
  }

  rerender();
  return root;
}
