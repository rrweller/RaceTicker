# RaceTicker (ScriptAI + RaceSplits)

RaceTicker is a BeamNG UI app that provides a broadcast-style timing tower for ScriptAI races.

The app supports 4 timing modes:

1. `Absolute` (time behind leader)
2. `Relative` (time behind car ahead)
3. `Best Lap` (best completed checkpoint lap)
4. `Average` (average of all completed checkpoint laps)

RaceSplits lap timing is checkpoint-based and runs in parallel with ScriptAI timing, so you can switch modes during a run without losing lap timing state.

## Install

1. Place/unpack this mod in your BeamNG mods folder.
2. Enable the RaceTicker app in the UI app menu.
3. Start your ScriptAI route/session.

## Quick Usage

1. Spawn all race cars and start a shared ScriptAI line.
2. Open RaceTicker.
3. Use `CFG` -> `Timing Mode` to switch between `Absolute`, `Relative`, `Best Lap`, and `Average`.
4. Click a row to jump camera focus to that vehicle.

## Timing Modes

### Absolute

- Uses ScriptAI progress time (`scriptTime`).
- Sort order: highest progress to lowest.
- Leader row shows `Leader` (or `% left`, depending on Leader Display setting).
- Other rows show `+X.XX` to the leader.

### Relative

- Uses ScriptAI progress time.
- Sort order: highest progress to lowest.
- Leader row shows `Leader` (or `% left` with Leader Display setting).
- Other rows show `+X.XX` to the car directly ahead.
- If a car is lapped, gap switches to lap format (`+N Lap(s)`) capped at `+9 Laps`.

### Best Lap

- Uses RaceSplits checkpoint lap timing.
- Before a car completes lap 1: shows live current lap timer.
- After first completed lap: shows fixed best lap, updates only on new best.
- Rows are sorted by best lap (lower is better) once any lap is posted.

### Average

- Uses RaceSplits checkpoint lap timing.
- Before a car completes lap 1: shows live current lap timer.
- After first completed lap: shows rolling average across all completed laps.
- Rows are sorted by average lap (lower is better) once any lap is posted.

## Lap Mode Rules (Best Lap / Average)

- Position delta arrows are not shown.
- During first lap, ordering stays at start order (no lap-time sorting yet).
- As soon as lap results exist, sorting is by lap metric (best/average), with tie-breakers:
1. completed-lap status (completed laps first)
2. lap metric (lower is better)
3. completed lap count (higher first)
4. start order
- Sorting is re-applied whenever mode is switched into a lap mode.

## RaceSplits Checkpoint System

RaceSplits does not use ScriptAI lap counters. It measures crossings against a generated checkpoint gate.

### Gate creation

- Trigger: ScriptAI run start/reset detection.
- Source: first valid active ScriptAI recording path.
- Gate center: recording start point (with `timeOffset` interpolation support).
- Gate forward normal: direction of travel from recording.
- Gate width is made robust by combining observed active car spread, road width estimate from map nodes, and safety padding with min/max clamps.

### Crossing detection robustness

For each vehicle, each update:

- Uses previous and current world position segment.
- Rejects teleports/large jumps.
- Requires vehicle to re-arm by moving sufficiently behind gate first.
- Requires proper direction alignment through gate normal.
- Computes crossing time by segment interpolation (not coarse frame timestamping).
- Enforces minimum lap time to reject false triggers.
- Expands gate width when a valid crossing happens near gate edge.

This makes checkpoint detection reliable even when cars do not drive exactly over the original ScriptAI start point.

## ScriptAI + RaceSplits Running Together

- ScriptAI timing and RaceSplits lap timing run concurrently.
- Switching between `Absolute/Relative` and `Best Lap/Average` does not reset active lap tracking.
- ScriptAI is used for run start/reset detection and initial checkpoint gate seeding from current recording data.
- Lap crossing logic itself is calculated from live vehicle positions against the gate.

## CSV Export on Run End

When a ScriptAI run ends (active following set goes from non-empty to empty), RaceTicker writes 4 CSV files and overwrites the previous run outputs.

Paths:

- `%LOCALAPPDATA%\BeamNG.drive\current\settings\raceTicker_results_absolute.csv`
- `%LOCALAPPDATA%\BeamNG.drive\current\settings\raceTicker_results_relative.csv`
- `%LOCALAPPDATA%\BeamNG.drive\current\settings\raceTicker_results_best_lap.csv`
- `%LOCALAPPDATA%\BeamNG.drive\current\settings\raceTicker_results_average_lap.csv`

Format:

- Header: `car,time`
- Column 1: resolved car display name
- Column 2: exactly what that mode displays (`Leader`, `+X.XX`, or lap time)

Sorting used for export:

- `absolute`: ScriptAI finish order
- `relative`: ScriptAI finish order
- `best_lap`: lap-mode order by best lap logic
- `average_lap`: lap-mode order by average lap logic

## Car Number and Color Logic

### Car number extraction

Car number extraction now uses:

- Primary: `^[^_-]+[-_](\d{1,3})(?=[-_])` (number between the first and second `_`/`-`)
- Fallback: `^(\d{1,3})(?=[-_])` (legacy filenames that start with the number)

Examples:

- `keudn_73_keudn_prebodywork.zip` -> `73`
- `73-keudn_prebodywork.zip` -> `73`
If no valid prefix is found, RaceTicker uses `000`.

### Optional CSV car colors

Path:

- `%LOCALAPPDATA%\BeamNG.drive\current\settings\raceTicker_car_colors.csv`

Auto-created if missing.

Expected format:

```csv
carnumber,color
69,#1887DB
420,#0F47AA
111,#B0A100
1,#70D938
```

Rules:

- `carnumber` must be numeric
- `color` accepts `#RRGGBB` or `#RGB`

## Config Panel Settings

`Timing Mode` appears at the top of CFG and includes all 4 modes.
There is no separate RaceSplits toggle in the UI.

- `Timing Mode`: `Absolute`, `Relative`, `Best Lap`, `Average`
- `Series Name`: top title text (`RACE` default)
- `Race Length`: manual lap count for lap banner and percent-left calculations
- `UI Scale`: step buttons or direct numeric/percent entry
- `Off-Line Sensitivity`: line error tolerance for warning/out logic
- `Fuel Column`: show/hide fuel data
- `Leader Display`: `Laps` or `% left` for leader label logic
- `Display Car Number`: show/hide number box
- `Display Car Color`: apply CSV color mapping

## Update Rates and Polling

- UI heartbeat loop: `50 ms`
- Default tower refresh: `500 ms`
- Lap modes refresh at `50 ms` while first-lap live timers are active, otherwise `500 ms`
- Vehicle data polling from Lua: `200 ms`

Lap timing math still runs continuously in the Lua update loop; the `50 ms` rate only controls UI redraw frequency.

## Additional Race Logic

- Start reorder pause: `5s` to stabilize early race ordering.
- Position baseline captured after pause for position delta labels (non-lap modes only).
- Warning states include crash/jump/stall/out handling.
- `OUT` cars are sorted to the bottom by out sequence.

## Persistence

Settings are persisted to:

- `%LOCALAPPDATA%\BeamNG.drive\current\settings\raceTicker.json`

UI also caches a local copy in browser storage key:

- `apps:raceTicker.uiConfig`

## Development Notes

- BeamNG UI asset caching can prevent full hot-reload with `F5` for JS/CSS.
- If a change does not appear after `F5`, restart BeamNG.
