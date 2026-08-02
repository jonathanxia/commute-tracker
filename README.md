# Commute Logger

A single-user PWA for logging a daily commute. Replaces hitting "lap" on the iPhone
stopwatch and transcribing the times by hand.

No accounts, no backend, no network calls at runtime, no dependencies, no build step.

## How it works

**Timestamps are the only source of truth.** iOS suspends a backgrounded web app, so a
ticking `setInterval` counter would freeze or drift during a 40-minute drive. Every tap
writes an absolute epoch-ms timestamp to storage; every duration is a subtraction
evaluated when it's displayed. The big counter on the tracking screen is cosmetic and
recomputed from the stored timestamp each tick.

Three screens:

- **Track** — one tap to start. Two buttons from then on: **LAP** at each transition and
  **END TRIP** when you arrive. Lap never runs out and never ends the trip; tap it as many
  times as the trip actually has transitions. Each lap locks the timestamp immediately and
  starts a new segment with a guessed type, which you correct with the pills whenever you
  like — labelling it thirty seconds later costs nothing, because the time is already
  recorded. The pill row is the whole type menu, including **+ New** to invent a type
  mid-commute. Direction is guessed from the clock (before 13:00 → east) and overridable.
  The in-progress trip is written to storage on *every* tap, so iOS killing the app
  mid-commute loses nothing.
- **History** — newest first, tap to open the editor. Manual entry for typing a past trip
  from durations. Export, backup and the segment-type editor live here.
- **Data** — filters, a sortable table with a column picker, and three charts. Filters drive
  the table, the charts *and* the export from that screen.

### Segment types are data, not code

The vocabulary lives in `localStorage`, not in a constant. **History → Segments** lets you add,
rename and delete segment types and edit each direction's default sequence. Adding a type makes
it appear immediately in the lap chips, the trip editor, the manual-entry form, the data table
and the CSV — no code edit anywhere.

A type has a **stable key** and an **editable name**, so renaming "Garage wait" to "Valet"
rewrites nothing in storage. Two guards keep that from losing data: a type in use can't be
deleted (it names the count instead), and any key found in a trip but missing from the
vocabulary — deleted, or restored from another device — still gets a column and a label.

`drive` is the one key with semantics: `drive_residual` is defined as that segment minus the
Google prediction, and two charts plot it, so it can be renamed but not deleted.

Each type has a **leave out of door-to-door** switch, on by default for `pause`. Such a
segment is still recorded and still gets its own CSV column — it just isn't counted in the
total, so a trip where you stopped for coffee stays comparable with one where you didn't.
**Consequence: `door2door` is not always the sum of the segment columns.** When an excluded
segment is present the columns add up to more.

Default sequences (Segments → each direction) are only the guess for which pill to
pre-select next. They constrain nothing — the recorder is free-form.

### Commute types

A separate, trip-level vocabulary — "Full Driving", "Ferry", "Bus Commute" — created the same
way and editable at runtime. Set it on the recorder or in the trip editor; filter by it on the
Data page. Trips can be left uncategorised, and "Uncategorised" is itself a filter option so
they never become invisible.

### Two distinctions the whole thing rests on

- **Absent ≠ zero.** A segment that didn't happen isn't in the array and exports blank. One
  that happened and measured ~nil is present with zero duration and exports `0.00`.
- **Incomplete is an explicit flag**, not something inferred from which segments exist. An
  incomplete trip exports blank for both `arrive` and `door2door`, so it never looks like a
  complete one.

Segments are independent `(start, end)` pairs. Editing one boundary never rewrites a
neighbour's — gaps and overlaps are shown as a note and left alone, because an edited
boundary has to survive and a pause can be real.

## Running it locally

```sh
python3 -m http.server 8123
# then open http://localhost:8123
```

Editing files while a service worker is registered will serve you stale JS. Either bump
`CACHE_VERSION` in `sw.js`, or clear it from the console:

```js
navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister())))
  .then(() => caches.keys()).then(ks => Promise.all(ks.map(k => caches.delete(k))))
  .then(() => location.reload());
```

## Getting it on the phone

Publish to GitHub Pages, open the `https://` URL in Safari, Share → **Add to Home Screen**.

The service worker only registers on a secure origin, and it's what makes the app open in a
tunnel or a parking garage: the phone hits the network once, on the first load, then serves
the app from its own cache forever. Over a plain LAN `http://` server the app still works
and still persists data — it just won't open when your Mac is off.

**Your trip data is never published.** It lives in `localStorage` on the phone; there is no
backend to send it to. The 8 seeded trips live in `seed.local.json`, which is **gitignored**,
because those rows carry real dates and times of day. See `seed.example.json`
for the format.

### Staying out of search results

`index.html` and `verify.html` carry `<meta name="robots" content="noindex, nofollow,
noarchive, nosnippet">`, and `robots.txt` deliberately *allows* crawling so that crawlers can
reach the page and read that tag. Blocking with `Disallow: /` would backfire — a crawler
that can't fetch the page never sees the noindex, so a URL discovered via a link can still
be indexed as a bare entry.

This covers the Pages site. It does **not** cover the GitHub repository page itself: public
repos on github.com are crawlable and that's outside this repo's control. If the repo being
findable matters, it has to be private, which on the free tier means giving up Pages.

Because the seed file isn't deployed, the phone starts empty. Load it once, and only once:

1. On the Mac, **Export & backup → Copy JSON**.
2. On the phone, **Export & backup → Restore**, paste into the box, **Merge in**.

Universal Clipboard carries the copy straight from the Mac to the phone if both are signed
into the same Apple ID, so there's no file to AirDrop and nothing to find in the Files
picker. The payload is ~7 KB.

After that the trips are ordinary app data in `localStorage` — same storage, same editor,
same exports as anything you log later. This is a one-time bootstrap for a fresh install,
not a recurring step; you never carry the file around.

## Where the data actually lives

A web page can't write to disk. Two different mechanisms are at work:

- **`localStorage`** — a sandboxed, per-origin store the browser manages. Not a file path;
  the app can't see your Documents folder. Survives restarts and reboots, but iOS *can*
  evict script-writable storage, and deleting the home-screen icon deletes the data with it.
  The app calls `navigator.storage.persist()` to ask for the durable tier. That reduces the
  risk; it doesn't remove it.
- **Export** — the app builds the bytes in memory and hands them to `navigator.share()`.
  **iOS** performs the write, to a destination you pick in the share sheet. The app never
  learns the path.

So: back up. A banner nags you when it's been 10 trips or 14 days.

## Export

**JSON only.** There is no CSV, on purpose: it was a second, lossy representation of data the
app already holds, and keeping it in sync with a runtime-editable vocabulary was work with
nothing to show for it. The JSON is the actual data — raw timestamps, nothing rounded, plus
the segment and commute vocabularies needed to read it back:

```json
{ "app": "commute-logger", "version": 3, "exported_at": 0,
  "types": [...], "commute_types": [...], "sequences": {...}, "trips": [...] }
```

Anything tabular is one line away on the Mac:

```python
import json, pandas as pd
d = json.load(open("commute-backup.json"))
pd.json_normalize(d["trips"], "segments", ["date", "direction", "commute_type"])
```

Restore takes the same file, by picker or pasted text, and merges unknown segment and commute
types so nothing arrives unnamed.

`drive_residual` (`drive − gmaps_pred`) is **never stored**. It's derived at render and
export time, like `dow`, `arrive`, and `door2door`.

## Verifying the seed

`verify.html` round-trips `seed.local.json` through the model and diffs every derived value
cell-by-cell against the source table. Open <http://localhost:8123/verify.html>,
or with node:

```sh
node tools/verify-seed.mjs
```

Two things this catches, both of which silently corrupt the export:

1. The recorded `door2door` totals were summed *before* rounding, so five of the eight rows
   don't equal the sum of their own printed 2dp segments. `js/seed.js` spreads that
   discrepancy across the trip's segments — each shift is under 0.0034 min, far below the
   0.005 that would flip any segment's own rounding.
2. `HH:MM` must round to the **nearest** minute, not truncate. Truncating breaks four rows.

## Layout

```
index.html            shell
styles.css            dark theme
js/store.js           model, derivations, persistence   (DOM-free)
js/format.js          formatting                        (DOM-free)
js/seed.js            seed table -> timestamped trips
js/app.js             routing, lap flow, history, export
js/editor.js          trip editor + manual entry
js/table.js           filters, table, column picker
js/charts.js          three SVG charts
js/dom.js             ~60-line DOM helper
sw.js                 offline shell
tools/make-icons.py   generates the PNGs (stdlib only, no Pillow)
tools/verify-seed.*   the seed round-trip check
```

`store.js` and `format.js` stay DOM-free so the verifier can import them outside a
browser. Bump `CACHE_VERSION` in `sw.js` when you change any file listed in its `SHELL`.

## Deliberately not here

Accounts, sync, multi-device, native wrapper, Watch, GPS auto-start (there's a comment in
`app.js` marking where it would hook in), analytics, any runtime network call.
