// Three charts, hand-rolled inline SVG. No library, no network, no animation.
//
// Charts are sized to their measured container rather than scaled with a
// viewBox, so axis text stays legible at phone width instead of shrinking with
// the drawing.

import { h, svg } from './dom.js';
import { fmtClock, fmtMin, fmtSigned } from './format.js';

/** Read the palette from CSS so styles.css stays the single source of truth. */
function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    east: v('--east', '#3987e5'),
    west: v('--west', '#d95926'),
    ink: v('--ink', '#eef3f9'),
    ink2: v('--ink-2', '#a9b6c6'),
    muted: v('--muted', '#7b8798'),
    grid: v('--grid', '#222b38'),
    axis: v('--axis', '#33404f'),
    surface: v('--surface', '#141a24'),
  };
}

const dirColor = (p, d) => (d === 'east' ? p.east : p.west);

// ── tooltip ────────────────────────────────────────────────────────────────

function tipEl() {
  return document.getElementById('tooltip');
}

function bindTip(node, lines) {
  const show = (e) => {
    const tip = tipEl();
    tip.replaceChildren(
      ...lines.map(([k, val]) =>
        h('div', null, h('span', { class: 'tt-k' }, `${k} `), h('span', null, String(val))),
      ),
    );
    tip.dataset.show = 'true';
    move(e);
  };
  const move = (e) => {
    const tip = tipEl();
    const pad = 12;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY - r.height - pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y < 8) y = e.clientY + pad;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${y}px`;
  };
  const hide = () => {
    tipEl().dataset.show = 'false';
  };
  node.addEventListener('pointerenter', show);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', hide);
  node.addEventListener('pointercancel', hide);
  return node;
}

// ── primitives ─────────────────────────────────────────────────────────────

/** Bar with rounded top corners only — the data-end is round, the baseline is flat. */
function barPath(x, y, w, hgt, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, hgt));
  return `M${x},${y + hgt} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + hgt} Z`;
}

/**
 * Ticks from 0 to at least `max`. The last tick must cover the data — stopping
 * below it would put the largest value outside the plot area and clip it off
 * the edge of the card.
 */
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks = [];
  for (let t = 0; ; t += step) {
    ticks.push(Number(t.toFixed(6)));
    if (t >= max - 1e-9) break;
  }
  return ticks;
}

// No axis-unit label: at this size it collides with the topmost tick. The unit
// lives in the chart's subtitle instead.
function yAxis(p, { x0, x1, y, ticks }) {
  return svg(
    'g',
    null,
    ...ticks.map((t) =>
      svg(
        'g',
        null,
        svg('line', { x1: x0, x2: x1, y1: y(t), y2: y(t), stroke: p.grid, 'stroke-width': 1 }),
        svg(
          'text',
          { x: x0 - 7, y: y(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: p.muted },
          String(t),
        ),
      ),
    ),
  );
}

function legend(items) {
  return h(
    'div',
    { class: 'legend' },
    ...items.map((it) =>
      h(
        'span',
        { class: 'legend-item' },
        it.line
          ? h('span', {
              class: 'legend-line',
              style: { borderTopColor: it.color, borderTopStyle: it.dashed ? 'dashed' : 'solid' },
            })
          : h('span', { class: 'legend-swatch', style: { background: it.color } }),
        it.label,
      ),
    ),
  );
}

function emptyNote(text) {
  return h('div', { class: 'empty', style: { padding: '28px 10px' } }, text);
}

// ── chart 1: drive time per trip, chronological ────────────────────────────

function driveBars(rows, width) {
  const p = palette();
  const height = 250;
  const m = { top: 14, right: 10, bottom: 34, left: 34 };
  const iw = Math.max(60, width - m.left - m.right);
  const ih = height - m.top - m.bottom;

  // Always chronological, whatever the table happens to be sorted by — this is
  // a time series, and reading it right to left would be a lie.
  const data = rows.filter((r) => r.drive != null).sort((a, b) => a.depart_ts - b.depart_ts);
  if (!data.length) return emptyNote('No drive times in this selection.');

  const max = Math.max(...data.map((r) => Math.max(r.drive, r.gmaps_pred_min ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v) => m.top + ih - (v / top) * ih;

  const band = iw / data.length;
  const bw = Math.max(4, Math.min(34, band - 6)); // >= 2px surface gap between bars

  // Label every nth tick so dates never collide.
  const every = Math.max(1, Math.ceil((data.length * 42) / iw));

  const node = svg(
    'svg',
    { class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' },
    yAxis(p, { x0: m.left, x1: m.left + iw, y, ticks }),
    ...data.map((r, i) => {
      const x = m.left + band * i + (band - bw) / 2;
      const hgt = Math.max(1, y(0) - y(r.drive));
      const g = svg(
        'g',
        null,
        svg('path', { d: barPath(x, y(r.drive), bw, hgt), fill: dirColor(p, r.direction) }),
        r.gmaps_pred_min != null
          ? svg('line', {
              x1: x - 3,
              x2: x + bw + 3,
              y1: y(r.gmaps_pred_min),
              y2: y(r.gmaps_pred_min),
              stroke: p.ink2,
              'stroke-width': 2,
              'stroke-dasharray': '4 3',
              'stroke-linecap': 'round',
            })
          : null,
        // Invisible full-height hit target, larger than the mark.
        svg('rect', { x: m.left + band * i, y: m.top, width: band, height: ih, fill: 'transparent' }),
      );
      bindTip(g, [
        ['', `${r.dow} ${r.date} ${fmtClock(r.depart_ts)}`],
        ['drive', `${fmtMin(r.drive)} min`],
        ['google', r.gmaps_pred_min == null ? '—' : `${r.gmaps_pred_min} min`],
        ['diff', r.drive_residual == null ? '—' : `${fmtSigned(r.drive_residual)} min`],
      ]);
      return g;
    }),
    svg('line', {
      x1: m.left,
      x2: m.left + iw,
      y1: y(0),
      y2: y(0),
      stroke: p.axis,
      'stroke-width': 1,
    }),
    ...data.map((r, i) =>
      i % every === 0
        ? svg(
            'text',
            {
              x: m.left + band * i + band / 2,
              y: height - 14,
              'text-anchor': 'middle',
              'font-size': 10,
              fill: p.muted,
            },
            r.date.slice(5),
          )
        : null,
    ),
  );

  return h(
    'div',
    null,
    node,
    legend([
      { color: p.east, label: 'East (→ office)' },
      { color: p.west, label: 'West (→ home)' },
      { color: p.ink2, label: 'Google prediction', line: true, dashed: true },
    ]),
  );
}

// ── chart 2: distribution by direction ─────────────────────────────────────

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function distribution(rows, width) {
  const p = palette();
  const groups = [
    { key: 'drive', dir: 'east', label: 'Drive · East' },
    { key: 'drive', dir: 'west', label: 'Drive · West' },
    { key: 'door2door', dir: 'east', label: 'Door to door · East' },
    { key: 'door2door', dir: 'west', label: 'Door to door · West' },
  ].map((g) => ({
    ...g,
    values: rows.filter((r) => r.direction === g.dir && r[g.key] != null).map((r) => r[g.key]),
  }));

  const all = groups.flatMap((g) => g.values);
  if (!all.length) return emptyNote('Nothing to compare in this selection.');

  const rowH = 46;
  const m = { top: 10, right: 14, bottom: 30, left: 118 };
  const height = m.top + m.bottom + rowH * groups.length;
  const iw = Math.max(60, width - m.left - m.right);

  const max = Math.max(...all);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (v) => m.left + (v / top) * iw;

  const node = svg(
    'svg',
    { class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' },
    ...ticks.map((t) =>
      svg(
        'g',
        null,
        svg('line', { x1: x(t), x2: x(t), y1: m.top, y2: m.top + rowH * groups.length, stroke: p.grid, 'stroke-width': 1 }),
        svg(
          'text',
          { x: x(t), y: height - 12, 'text-anchor': 'middle', 'font-size': 11, fill: p.muted },
          String(t),
        ),
      ),
    ),
    ...groups.map((g, gi) => {
      const cy = m.top + rowH * gi + rowH / 2;
      const med = median(g.values);
      const color = dirColor(p, g.dir);
      return svg(
        'g',
        null,
        svg(
          'text',
          { x: m.left - 10, y: cy + 4, 'text-anchor': 'end', 'font-size': 11.5, fill: p.ink2 },
          g.label,
        ),
        med != null
          ? svg('line', {
              x1: x(med),
              x2: x(med),
              y1: cy - 15,
              y2: cy + 15,
              stroke: p.ink,
              'stroke-width': 2,
              'stroke-linecap': 'round',
              opacity: 0.75,
            })
          : null,
        ...g.values.map((v, i) => {
          // Deterministic jitter: same data always draws the same picture.
          const jitter = ((i * 7919) % 13) / 13 - 0.5;
          const c = svg('circle', {
            cx: x(v),
            cy: cy + jitter * 17,
            r: 5,
            fill: color,
            stroke: p.surface,
            'stroke-width': 2,
          });
          bindTip(c, [
            ['', g.label],
            ['value', `${fmtMin(v)} min`],
          ]);
          return c;
        }),
        med != null
          ? svg(
              'text',
              { x: x(med), y: cy - 19, 'text-anchor': 'middle', 'font-size': 10, fill: p.muted },
              `med ${med.toFixed(1)}`,
            )
          : null,
      );
    }),
  );

  return h(
    'div',
    null,
    node,
    legend([
      { color: p.east, label: 'East' },
      { color: p.west, label: 'West' },
      { color: p.ink, label: 'Median', line: true },
    ]),
  );
}

// ── chart 3: time of day vs drive ──────────────────────────────────────────

function timeOfDay(rows, width) {
  const p = palette();
  const height = 250;
  const m = { top: 14, right: 14, bottom: 34, left: 34 };
  const iw = Math.max(60, width - m.left - m.right);
  const ih = height - m.top - m.bottom;

  const data = rows.filter((r) => r.drive != null);
  if (!data.length) return emptyNote('No drive times in this selection.');

  const mins = data.map((r) => {
    const d = new Date(r.depart_ts);
    return d.getHours() * 60 + d.getMinutes();
  });
  const lo = Math.max(0, Math.min(...mins) - 45);
  const hi = Math.min(1440, Math.max(...mins) + 45);
  const x = (v) => m.left + ((v - lo) / Math.max(1, hi - lo)) * iw;

  const maxY = Math.max(...data.map((r) => r.drive));
  const ticks = niceTicks(maxY);
  const top = ticks[ticks.length - 1];
  const y = (v) => m.top + ih - (v / top) * ih;

  const hourStep = hi - lo > 420 ? 120 : 60;
  const hours = [];
  for (let t = Math.ceil(lo / hourStep) * hourStep; t <= hi; t += hourStep) hours.push(t);

  const node = svg(
    'svg',
    { class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' },
    yAxis(p, { x0: m.left, x1: m.left + iw, y, ticks }),
    ...hours.map((t) =>
      svg(
        'g',
        null,
        svg('line', { x1: x(t), x2: x(t), y1: m.top, y2: m.top + ih, stroke: p.grid, 'stroke-width': 1 }),
        svg(
          'text',
          { x: x(t), y: height - 14, 'text-anchor': 'middle', 'font-size': 10, fill: p.muted },
          `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`,
        ),
      ),
    ),
    ...data.map((r, i) => {
      const c = svg('circle', {
        cx: x(mins[i]),
        cy: y(r.drive),
        r: 5.5,
        fill: dirColor(p, r.direction),
        stroke: p.surface,
        'stroke-width': 2,
      });
      bindTip(c, [
        ['', `${r.dow} ${r.date}`],
        ['left', fmtClock(r.depart_ts)],
        ['drive', `${fmtMin(r.drive)} min`],
        ['diff', r.drive_residual == null ? '—' : `${fmtSigned(r.drive_residual)} min`],
      ]);
      return c;
    }),
    svg('line', { x1: m.left, x2: m.left + iw, y1: y(0), y2: y(0), stroke: p.axis, 'stroke-width': 1 }),
  );

  return h(
    'div',
    null,
    node,
    legend([
      { color: p.east, label: 'East (→ office)' },
      { color: p.west, label: 'West (→ home)' },
    ]),
  );
}

// ── mounting ───────────────────────────────────────────────────────────────

const CHARTS = {
  drive: {
    title: 'Drive time per trip',
    sub: 'Minutes, chronological. Dashed tick is what Google predicted.',
    draw: driveBars,
    wide: true,
  },
  distribution: {
    title: 'Spread by direction',
    sub: 'Minutes. Every trip as a dot, with the median.',
    draw: distribution,
  },
  timeofday: {
    title: 'Departure time vs drive',
    sub: 'Drive minutes vs when you left. Does leaving later help?',
    draw: timeOfDay,
  },
};

/**
 * Charts redraw against their measured width, so a phone gets phone-sized type
 * rather than a shrunken desktop chart.
 */
export function chartCard(key, rows) {
  const spec = CHARTS[key];
  const holder = h('div', { style: { marginTop: '10px' } });
  const card = h(
    'div',
    { class: `card chart-card${spec.wide ? ' span-2' : ''}` },
    h('div', { class: 'chart-title' }, spec.title),
    h('div', { class: 'chart-sub' }, spec.sub),
    holder,
  );

  let last = 0;
  const paint = () => {
    const w = Math.round(holder.clientWidth || card.clientWidth - 24);
    if (w <= 0 || Math.abs(w - last) < 2) return;
    last = w;
    holder.replaceChildren(spec.draw(rows, w));
  };

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(paint);
    ro.observe(holder);
  }
  requestAnimationFrame(paint);
  return card;
}

export const CHART_KEYS = Object.keys(CHARTS);
