// The Data view: filters, the sortable table with a column picker, and the
// charts. Filters drive the table, the charts and the export from here, so what
// you see is what you get.

import { chronological, columnTypes, loadCommuteTypes, segmentLabel, tripView } from './store.js';
import { dateKey, dowOf, fmtClock, fmtMin, fmtSigned } from './format.js';
import { h } from './dom.js';
import { CHART_KEYS, chartCard, chartWantsSegment } from './charts.js';
import { exportTrips, go, render, state, toast, updatePrefs } from './app.js';

const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Column definitions, used by the table, the card list and the picker.
 * `sort` returns a comparable primitive; null sorts last in both directions so
 * blanks never masquerade as small numbers.
 *
 * The per-segment block in the middle is generated from the vocabulary, in the
 * same order as the CSV, so adding a segment type adds a table column without
 * anyone editing this file.
 */
function buildColumns(trips) {
  const lead = [
    { key: 'n', label: '#', align: 'left', text: (r) => String(r.n), sort: (r) => r.n },
    { key: 'date', label: 'date', align: 'left', text: (r) => r.date, sort: (r) => r.depart_ts },
    { key: 'dow', label: 'dow', align: 'left', text: (r) => r.dow, sort: (r) => DOWS.indexOf(r.dow) },
    { key: 'depart', label: 'depart', text: (r) => fmtClock(r.depart_ts), sort: (r) => r.depart_ts % 86400000 },
    { key: 'direction', label: 'dir', align: 'left', text: (r) => r.direction, sort: (r) => r.direction },
    {
      key: 'commute_type',
      label: 'commute',
      align: 'left',
      text: (r) => r.commute_type_label,
      sort: (r) => r.commute_type_label || null,
    },
    {
      key: 'gmaps_pred',
      label: 'google',
      text: (r) => (r.gmaps_pred_min == null ? '' : String(r.gmaps_pred_min)),
      sort: (r) => r.gmaps_pred_min,
    },
    { key: 'arrive', label: 'arrive', text: (r) => fmtClock(r.arrive_ts), sort: (r) => r.arrive_ts },
  ];

  const segments = columnTypes(trips).map((key) => ({
    key,
    label: segmentLabel(key),
    text: (r) => fmtMin(r.min[key]),
    sort: (r) => r.min[key] ?? null,
  }));

  const tail = [
    { key: 'door2door', label: 'door2door', text: (r) => fmtMin(r.door2door), sort: (r) => r.door2door },
    {
      key: 'drive_residual',
      label: 'vs google',
      text: (r) => fmtSigned(r.drive_residual),
      sort: (r) => r.drive_residual,
      cls: (r) => (r.drive_residual == null ? '' : r.drive_residual > 0 ? 'pos' : 'neg'),
    },
  ];

  return [...lead, ...segments, ...tail];
}

// ── filtering ──────────────────────────────────────────────────────────────

function applyFilters(trips, f) {
  return trips.filter((t) => {
    if (f.direction !== 'all' && t.direction !== f.direction) return false;
    if (f.dows.length && !f.dows.includes(dowOf(t.date))) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.incompleteOnly && !tripView(t).incomplete) return false;
    // '' in the list means "no commute type set", so uncategorised trips stay
    // selectable rather than being invisible once any filter is on.
    if (f.commuteTypes?.length && !f.commuteTypes.includes(t.commute_type || '')) return false;
    return true;
  });
}

// The column set depends on the vocabulary and the data, so it is rebuilt each
// render and shared with the helpers below rather than being a module constant.
let currentColumns = [];
const columnFor = (key) =>
  currentColumns.find((c) => c.key === key) || currentColumns.find((c) => c.key === 'date');

function sortRows(rows, sort) {
  const col = columnFor(sort.key);
  if (!col) return rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = col.sort(a);
    const bv = col.sort(b);
    // Blanks always sink, whichever way the column is sorted.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -sign;
    if (av > bv) return sign;
    return 0;
  });
}

// ── controls ───────────────────────────────────────────────────────────────

function setFilter(patch) {
  updatePrefs({ filters: { ...state.prefs.filters, ...patch } });
  render();
}

/**
 * Date-range presets.
 *
 * Rolling and to-date windows set only `from` and leave `to` open, so a trip
 * logged later today can never fall outside a range that still reads as active.
 * "Last month" is the exception: it is a closed calendar period, so it is
 * bounded at both ends on purpose.
 */
function rangePresets(now = Date.now()) {
  const d = new Date(now);
  const [y, m, day] = [d.getFullYear(), d.getMonth(), d.getDate()];
  const at = (yy, mm, dd) => dateKey(new Date(yy, mm, dd).getTime());
  return [
    { id: 'all', label: 'All time', from: '', to: '' },
    { id: 'last30', label: 'Last 30 days', from: at(y, m, day - 29), to: '' },
    { id: 'month', label: 'This month', from: at(y, m, 1), to: '' },
    // Day 0 of this month is the last day of the previous one.
    { id: 'prevmonth', label: 'Last month', from: at(y, m - 1, 1), to: at(y, m, 0) },
    { id: 'year', label: 'This year', from: at(y, 0, 1), to: '' },
  ];
}

function rangeRow() {
  const f = state.prefs.filters;
  const presets = rangePresets();
  const active = presets.find((p) => p.from === f.from && p.to === f.to);
  return h(
    'div',
    { class: 'row wrap gap-sm', style: { marginBottom: '10px' } },
    h('span', { class: 'field-label', style: { alignSelf: 'center' } }, 'Range'),
    ...presets.map((p) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(active?.id === p.id),
          onclick: () => setFilter({ from: p.from, to: p.to }),
        },
        p.label,
      ),
    ),
    // Only shows when From/To were set by hand to something no preset matches.
    !active ? h('span', { class: 'chip', 'aria-pressed': 'true' }, 'Custom') : null,
  );
}

// Collapsed by default: thirteen column chips and seven day chips would
// otherwise push every actual row below the fold on a phone.
let panelOpen = false;

// Which segment type the spread chart plots.
let chartSegment = 'drive';

function activeFilterCount(f) {
  return (
    (f.direction !== 'all' ? 1 : 0) +
    f.dows.length +
    (f.from ? 1 : 0) +
    (f.to ? 1 : 0) +
    (f.incompleteOnly ? 1 : 0) +
    (f.commuteTypes?.length || 0)
  );
}

function filtersCard() {
  const f = state.prefs.filters;
  const n = activeFilterCount(f);
  const hiddenCols = state.prefs.hiddenColumns.length;

  const toggle = h(
    'button',
    {
      class: 'btn btn-sm grow',
      type: 'button',
      'aria-expanded': String(panelOpen),
      onclick: () => {
        panelOpen = !panelOpen;
        render();
      },
    },
    `${panelOpen ? '▾' : '▸'} Filters & columns`,
    n || hiddenCols
      ? h(
          'span',
          { class: 'chip', style: { minHeight: '20px', padding: '0 7px', fontSize: '11px' } },
          [n ? `${n} filter${n > 1 ? 's' : ''}` : null, hiddenCols ? `${hiddenCols} hidden` : null]
            .filter(Boolean)
            .join(' · '),
        )
      : null,
  );

  if (!panelOpen) return h('div', { class: 'row', style: { marginBottom: '12px' } }, toggle);

  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '12px' } }, toggle),
    h(
      'div',
      { class: 'filters' },
      h(
        'div',
        { class: 'row wrap gap-sm' },
        h(
          'div',
          { class: 'seg' },
          ...[
            ['all', 'All'],
            ['east', '→ East'],
            ['west', '← West'],
          ].map(([v, label]) =>
            h(
              'button',
              {
                type: 'button',
                'data-dir': v === 'all' ? null : v,
                'aria-pressed': String(f.direction === v),
                onclick: () => setFilter({ direction: v }),
              },
              label,
            ),
          ),
        ),
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(f.incompleteOnly),
            onclick: () => setFilter({ incompleteOnly: !f.incompleteOnly }),
          },
          'Incomplete only',
        ),
      ),
      h(
        'div',
        { class: 'row wrap gap-sm' },
        h('span', { class: 'field-label', style: { alignSelf: 'center' } }, 'Commute'),
        ...[...loadCommuteTypes(), { key: '', label: 'Uncategorised' }].map((ct) =>
          h(
            'button',
            {
              class: 'chip',
              type: 'button',
              'aria-pressed': String((f.commuteTypes || []).includes(ct.key)),
              onclick: () => {
                const cur = f.commuteTypes || [];
                setFilter({
                  commuteTypes: cur.includes(ct.key)
                    ? cur.filter((k) => k !== ct.key)
                    : [...cur, ct.key],
                });
              },
            },
            ct.label,
          ),
        ),
      ),
      h(
        'div',
        { class: 'row wrap gap-sm' },
        ...DOWS.map((d) =>
          h(
            'button',
            {
              class: 'chip',
              type: 'button',
              'aria-pressed': String(f.dows.includes(d)),
              onclick: () =>
                setFilter({ dows: f.dows.includes(d) ? f.dows.filter((x) => x !== d) : [...f.dows, d] }),
            },
            d,
          ),
        ),
      ),
      h(
        'div',
        { class: 'row wrap gap-sm' },
        h(
          'label',
          { class: 'field grow' },
          h('span', { class: 'field-label' }, 'From'),
          h('input', { class: 'input-sm', type: 'date', value: f.from, onchange: (e) => setFilter({ from: e.target.value }) }),
        ),
        h(
          'label',
          { class: 'field grow' },
          h('span', { class: 'field-label' }, 'To'),
          h('input', { class: 'input-sm', type: 'date', value: f.to, onchange: (e) => setFilter({ to: e.target.value }) }),
        ),
      ),
    ),

    h(
      'div',
      { class: 'colpicker' },
      h('span', { class: 'field-label', style: { alignSelf: 'center', marginRight: '2px' } }, 'Columns'),
      ...currentColumns.map((c) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(!state.prefs.hiddenColumns.includes(c.key)),
            onclick: () => {
              const hidden = state.prefs.hiddenColumns.includes(c.key)
                ? state.prefs.hiddenColumns.filter((k) => k !== c.key)
                : [...state.prefs.hiddenColumns, c.key];
              updatePrefs({ hiddenColumns: hidden });
              render();
            },
          },
          c.label,
        ),
      ),
    ),
  );
}

// ── table + card list ──────────────────────────────────────────────────────

function sortHeader(col) {
  const sort = state.prefs.sort;
  const active = sort.key === col.key;
  return h(
    'th',
    {
      class: col.align === 'left' ? 'left' : null,
      'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null,
      onclick: () => {
        updatePrefs({
          sort: active ? { key: col.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: 'asc' },
        });
        render();
      },
    },
    col.label + (active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''),
  );
}

function dataTable(rows, cols) {
  return h(
    'div',
    { class: 'card', style: { padding: '4px 0 0' } },
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data' },
        h('thead', null, h('tr', null, ...cols.map(sortHeader))),
        h(
          'tbody',
          null,
          ...rows.map((r) =>
            h(
              'tr',
              { onclick: () => go({ name: 'trip', id: r.id }) },
              ...cols.map((c) => {
                const text = c.text(r);
                return h(
                  'td',
                  { class: [c.align === 'left' ? 'left' : '', c.cls?.(r) || '', text === '' ? 'blank' : ''].filter(Boolean).join(' ') },
                  text === '' ? '·' : text,
                );
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

function cardList(rows, cols) {
  const skip = new Set(['date', 'dow', 'direction', 'n']);
  const rest = cols.filter((c) => !skip.has(c.key));
  return h(
    'div',
    { class: 'card-list' },
    ...rows.map((r) =>
      h(
        'button',
        { class: 'card-row', type: 'button', onclick: () => go({ name: 'trip', id: r.id }) },
        h(
          'div',
          { class: 'row' },
          h('span', { class: `dir-pill dir-${r.direction}`, style: { width: '30px', height: '30px', fontSize: '14px' } }, r.direction === 'east' ? '→' : '←'),
          h(
            'span',
            { class: 'grow' },
            h('b', null, `${r.dow} ${r.date.slice(5)}`),
            h('span', { class: 'muted' }, `  #${r.n}`),
          ),
          r.incomplete ? h('span', { class: 'pill-warn' }, 'incomplete') : null,
        ),
        rest.length
          ? h(
              'div',
              { class: 'kv-grid' },
              ...rest.map((c) => {
                const text = c.text(r);
                return h(
                  'div',
                  { class: 'kv' },
                  h('div', { class: 'k' }, c.label),
                  h('div', { class: `v ${c.cls?.(r) || ''} ${text === '' ? 'blank' : ''}` }, text === '' ? '·' : text),
                );
              }),
            )
          : null,
      ),
    ),
  );
}

// ── summary ────────────────────────────────────────────────────────────────

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summary(rows) {
  const drives = rows.map((r) => r.drive).filter((v) => v != null);
  const residuals = rows.map((r) => r.drive_residual).filter((v) => v != null);
  const medRes = median(residuals);
  return h(
    'div',
    { class: 'stat-row', style: { marginBottom: '12px' } },
    h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Trips'), h('div', { class: 'v num' }, String(rows.length))),
    h(
      'div',
      { class: 'stat' },
      h('div', { class: 'k' }, 'Median drive'),
      h('div', { class: 'v num' }, drives.length ? `${median(drives).toFixed(1)}` : '—'),
    ),
    h(
      'div',
      { class: 'stat' },
      h('div', { class: 'k' }, 'Median vs google'),
      h(
        'div',
        { class: `v num ${medRes == null ? '' : medRes > 0 ? 'pos' : 'neg'}` },
        medRes == null ? '—' : fmtSigned(medRes),
      ),
    ),
  );
}

// Re-render when the layout crosses the table/card breakpoint.
let mqBound = false;
function bindBreakpoint() {
  if (mqBound || typeof matchMedia === 'undefined') return;
  mqBound = true;
  matchMedia('(min-width: 700px)').addEventListener('change', () => {
    if (state.route.name === 'data') render();
  });
}

// ── view ───────────────────────────────────────────────────────────────────

export function renderDataView() {
  bindBreakpoint();
  const f = state.prefs.filters;
  const filtered = applyFilters(state.trips, f);
  // Numbered chronologically over the filtered set, so the on-screen # matches
  // the trip column of an export taken from this view.
  currentColumns = buildColumns(state.trips);
  const rows = sortRows(chronological(filtered).map((t, i) => tripView(t, i + 1)), state.prefs.sort);
  const cols = currentColumns.filter((c) => !state.prefs.hiddenColumns.includes(c.key));
  const wide = typeof matchMedia !== 'undefined' && matchMedia('(min-width: 700px)').matches;

  if (!state.trips.length) {
    return h('div', { class: 'empty' }, 'No trips yet.');
  }

  const filterActive =
    f.direction !== 'all' || f.dows.length > 0 || f.from || f.to || f.incompleteOnly || (f.commuteTypes?.length > 0);

  return h(
    'div',
    null,
    rangeRow(),
    filtersCard(),
    summary(rows),

    h(
      'div',
      { class: 'row wrap gap-sm', style: { marginBottom: '12px' } },
      h(
        'button',
        {
          class: 'btn btn-sm',
          type: 'button',
          onclick: async () => {
            if (!rows.length) return toast('Nothing to export');
            const how = await exportTrips(
              rows.map((r) => r.trip),
              { label: filterActive ? 'commutes-filtered' : 'commutes' },
            );
            if (how !== 'cancelled') toast(`${rows.length} trips ${how === 'shared' ? 'shared' : 'downloaded'}`);
          },
        },
        filterActive ? `Export these ${rows.length}` : 'Export CSV',
      ),
      filterActive
        ? h(
            'button',
            {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              onclick: () =>
                setFilter({ direction: 'all', dows: [], from: '', to: '', incompleteOnly: false, commuteTypes: [] }),
            },
            'Clear filters',
          )
        : null,
    ),

    rows.length === 0
      ? h('div', { class: 'empty' }, 'No trips match these filters.')
      : cols.length === 0
        ? h('div', { class: 'empty' }, 'No columns selected.')
        : wide
          ? dataTable(rows, cols)
          : cardList(rows, cols),

    // Which segment type the spread chart plots. Anything else uses its own.
    h(
      'div',
      { class: 'row wrap gap-sm', style: { marginTop: '16px', marginBottom: '4px' } },
      h('span', { class: 'field-label', style: { alignSelf: 'center' } }, 'Chart segment'),
      ...columnTypes(state.trips).map((key) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(chartSegment === key),
            onclick: () => {
              chartSegment = key;
              render();
            },
          },
          segmentLabel(key),
        ),
      ),
    ),
    h(
      'div',
      { class: wide ? 'charts-grid' : '', style: { marginTop: '12px' } },
      ...CHART_KEYS.map((k) =>
        chartCard(k, rows, chartWantsSegment(k) ? { segment: chartSegment } : {}),
      ),
    ),
  );
}
