# Commute Logger

A personal iPhone web app for timing a commute, segment by segment. Replaces hitting "lap"
on the stopwatch and transcribing the numbers afterwards.

**https://jonathanxia.github.io/commute-tracker/**

## Install

Open that link in **Safari** (not Chrome — only Safari can install to the home screen), tap
**Share → Add to Home Screen**. Launch it from the icon.

It works offline after the first load, so it keeps working in a tunnel or a parking garage.

## Recording a trip

1. **Track → Start trip.** One tap. It timestamps your departure immediately.
2. **LAP** at every transition — got to the car, car arrived, parked, whatever. Lap never
   runs out; tap it as many times as the trip has transitions.
3. After each lap, tap the **pill** for what that segment actually was. The time was already
   recorded at the tap, so labelling it thirty seconds later costs you nothing.
4. **END TRIP** when you arrive → check the segments → **Save**.

Other things on that screen:

- **Direction** is guessed from the clock (before 13:00 → east). Tap to override.
- **Google says (min)** — type Google Maps' predicted drive time. Optional, editable later.
- **Commute type** — Full Driving, Ferry, Bus Commute, or your own.
- **+ New** on the pill row invents a segment type mid-commute and applies it.

If the app gets killed mid-trip, nothing is lost — every tap is written to storage as it
happens.

## Adding a trip you didn't record live

**History → + Past trip.** Type the durations you remember. Leave a field **blank** if that
segment didn't happen; type **0** if it happened and was negligible. Those mean different
things and stay different everywhere.

Tick **Not fully recorded** if you didn't capture the whole trip — arrival and door-to-door
then stay blank instead of showing a total that looks complete but isn't.

## Editing

Tap any trip in History. Everything is editable: date, departure time, direction, commute
type, the Google prediction, and each segment's start, end, or duration. You can add, delete,
reorder and relabel segments.

Segments are independent start/end pairs, so changing one boundary never moves its
neighbour's. If that leaves a gap or an overlap, the app says so and leaves it alone — it
might be intentional.

## Segment types

**History → Segments.** Add, rename, or delete them, and set each direction's default order
(only a suggestion for which pill to pre-select).

- One name each. It's the pill, the table header, and the export key.
- Renaming is safe — it never touches a stored trip.
- A type in use can't be deleted.
- **Leave out of door-to-door** — on by default for Pause. The segment is still recorded and
  still gets its own column; it just isn't counted in the total, so a coffee stop doesn't make
  the commute look slow. Door-to-door is therefore *not* always the sum of the segments.
- **Drive** can be renamed but not deleted — "vs Google" is defined as that segment minus the
  prediction.

## Data screen

Charts first, trip list underneath.

- **Charts show** — pick a segment; all four charts follow it.
- The Google prediction overlay only appears on **Drive**, since that's the only thing it
  predicts.
- Door-to-door has its own chart with its own scale, so a 2-minute wait doesn't get squashed
  by an 85-minute total.
- **Range** — All time / Last 30 days / This month / Last month / This year.
- **Filters & columns** — direction, commute type, day of week, custom dates, and which
  columns to show.

Filters drive the table, the charts, and the export together.

## Where your data lives

**On your phone, in the app's own storage. Nowhere else.** There's no account, no server, and
the app makes no network calls — there is nothing for it to send data to. Nothing you log is
on GitHub; the published site is just the app's code.

Two things to know:

- iOS can clear that storage, and **deleting the home-screen icon deletes your trips with it.**
- A web page can't write files. **Export** builds the data in memory and hands it to iOS,
  which writes it wherever you choose in the share sheet.

So back up. **History → Export → Export JSON** (share/save it) or **Copy JSON** (straight to
the clipboard — Universal Clipboard carries it to your Mac). A banner nags you after 10 trips
or 14 days.

JSON is the only format, and it's the real data: exact timestamps, nothing rounded, with your
segment and commute type names included. To get a table out of it on the Mac:

```python
import json, pandas as pd
d = json.load(open("commute-backup.json"))
pd.json_normalize(d["trips"], "segments", ["date", "direction", "commute_type"])
```

**Restore** takes that same file back — pick the file or paste the text, then Merge or Replace.

## Updating

The app updates itself on launch when it has signal. To force it: **History → Export → Check
for updates**. The current build is shown at the bottom of History.

## Verifying the seed data

`verify.html` re-derives every value from `seed.local.json` and diffs it against the source
table, to prove nothing drifts. `seed.local.json` is gitignored — real trips never get
committed. See `seed.example.json` for the format.
