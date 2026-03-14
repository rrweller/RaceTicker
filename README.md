# RaceTicker (ScriptAI)

RaceTicker is a BeamNG UI app for running ScriptAI race sessions with a clean, broadcast-style timing tower.

## Features

- ScriptAI-only timing and race order display
- Leader display mode: `Laps` or `% left`
- Gap timing mode: `Absolute` (to leader) or `Relative` (to car ahead)
- Fuel column toggle
- Off-line / crash detection with `OUT` state
- Position change indicator since race-start baseline (`▲`, `▼`, `- 0`)
- Click a row to jump camera to that vehicle
- Car number detection from mod zip filename (`###-name.zip`)
- Optional per-car number color mapping from CSV
- Persistent settings between maps and sessions

## Install

1. Download the .zip from the Releases and place this mod in your BeamNG mods folder.
2. Enable the RaceTicker app in the UI app menu.
3. Start your ScriptAI route/session.

## Basic Usage

1. Spawn all race cars and start ScriptAI.
2. Open RaceTicker.
3. Click any row to switch camera focus to that car.

## Car Number Detection

RaceTicker extracts car numbers from the mod file name:

- Expected format: `###-carname.zip`
- Examples:
  - `69-keudn_car3_a.zip` -> `69`
  - `420-keudn_car3_b.zip` -> `420`
- If no valid prefix exists, RaceTicker uses `000`.

## CSV Car Colors

CSV path:

`%LOCALAPPDATA%\BeamNG.drive\current\settings\raceTicker_car_colors.csv`

The file is auto-created if missing.

CSV format:

```csv
carnumber,color
69,#1887DB
420,#0F47AA
111,#B0A100
1,#70D938
```

Rules:

- Header must be: `carnumber,color`
- `carnumber` must be numeric
- `color` accepts `#RRGGBB` or `#RGB`

## Config Panel Settings

- `Series Name`: Top title text. Default is `RACE`.
- `Race Length`: Manual lap count used for lap/percent calculations.
- `UI Scale`: `+/-` steps through preset sizes, text input accepts any positive value.
- `Off-Line Sensitivity`: Lower = stricter off-line detection, higher = more forgiving.
- `Fuel Column`: Show/hide fuel info in each row.
- `Leader Display`: `Laps` or `% left` for the leader label.
- `Gap Timing`: `Absolute` (to leader) or `Relative` (to car ahead).
- `Display Car Number`: Show/hide the number box.
- `Display Car Color`: Use CSV-defined number-box colors.

## Race Logic Notes

- UI polling is every `0.5s`.
- Position/split updates are paused for `5s` at race start to reduce spawn noise.
- After that pause, RaceTicker captures a position baseline.
- Position delta badge meanings:
  - `▲ N` = gained positions since baseline
  - `▼ N` = lost positions since baseline
  - `- 0` = unchanged
- Warning icon has priority over position delta badge.
- `OUT` cars are dimmed and sorted to the bottom in wreck order until race reset.
- In relative mode, lapped cars switch to lap-based gaps and are capped at `+9 Laps`.

## Persistence

Settings are saved to:

- `%LOCALAPPDATA%\BeamNG.drive\current\settings\raceTicker.json`

Car colors are read from:

- `%LOCALAPPDATA%\BeamNG.drive\current\settings\raceTicker_car_colors.csv`

## Development Note

BeamNG UI asset caching can prevent full hot-reload with `F5` for JS/CSS in some cases.
If a change does not appear after `F5`, restart BeamNG.
