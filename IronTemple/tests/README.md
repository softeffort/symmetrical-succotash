# Tests

Everything here drives the real `scenes/main.tscn`; nothing is mocked. The folder is left out of the
Windows export (`exclude_filter` in `export_presets.cfg`) and no game script refers to it.

All runners are headless and use `--fixed-fps 60`, so the game steps 1/60 s per frame and runs many times
faster than real time. Each sets its own `XDG_DATA_HOME`, so no run touches a real save. `GODOT` picks the
binary (default `godot`).

| Folder | What it checks | Run | Time |
| --- | --- | --- | --- |
| `walkthrough/` | Steps 1 to 4: street and bike, every station, heavy bags and the fight card, the regulars and the crowd, the bar, sound registration, the pause menu, saving, a Step 4 save | `tests/walkthrough/run_all.sh` | 2 min |
| `combat_rules/` | Step 5 rules: guards, combos, feints, intercepts, perfect dodges, anti-spam, chin and knockdowns, the clinch, every tell and the 0.28 s floor, opponents, bout flow and payouts, the fight HUD | `tests/combat_rules/run_all.sh` | 3 min |
| `combat/` | Balance: a scripted player fights whole bouts and the lengths and results are tabulated | `tests/combat/sim_matrix.sh` | 15 min |
| `audio/` | Every synthesized sound: registered, audible, not clipped, no clicks | see below | 10 s |
| `visual/` | Screenshot tour of the HUD and the fight effects, to look at | see below | 4 min |

Both check suites print `PASS`/`FAIL` per check, a `RESULT` line per runner and a total, and exit non-zero
on a failed check or on any `SCRIPT ERROR` or `ERROR:` line in the engine output. Pass runner names to run
only some: `tests/combat_rules/run_all.sh r05_dodge`.

`combat_rules/r10_opponents.gd`, `combat_rules/r11_flow.gd` and `walkthrough/second_floor.gd` pin the
ladder's health numbers; change them together with `fighter_roster.gd` and the README table.

## Balance simulation

`combat/fight_bot.gd` is a player that sees what a person sees (the tell, the guard label, the distance,
the bars), answers after a reaction time and presses the real input actions. It has four skill levels:
`masher`, `novice`, `average` and `skilled`. `combat/builds.gd` gives it the stats a career has at the
opponent's level, paid out through `PlayerStats.reward_rep` and the purses of the fights before.

```sh
# One cell: 20 bouts, printed one per line.
godot --headless --path . --fixed-fps 60 res://tests/combat/sim.tscn -- \
    --opp=viktor --skill=novice --bouts=20 --verbose=1

# The README table: every opponent against novice, average and skilled.
tests/combat/sim_matrix.sh

# Bouts, tiers of extra training, opponents, skills.
tests/combat/sim_matrix.sh 20 1 "boris champ" "novice"
```

`--opp` is `sam`, `carl`, `viktor`, `boris`, `champ` or `league<level>`. `--edge=N` trains the player N
tiers past the opponent. `--tune=file.json` tries numbers before they go into the roster, for example
`{"boris": {"damage": 7.0, "style.clinch_rate": 0.3}, "league": {"x:max_health": 1.1}}`; pass it to the
matrix with `EXTRA="--tune=file.json"`.

Twenty bouts is a small sample: a cell moves by two or three wins between runs of different tunings.

## Sounds

```sh
XDG_DATA_HOME=/tmp/xdg_audio godot --headless --path . -s res://tests/audio/dump_sounds.gd
python3 tests/audio/analyze.py /tmp/audio_out
XDG_DATA_HOME=/tmp/xdg_audio godot --headless --path . -s res://tests/audio/check_names.gd
```

The first writes every effect and the music loop to `/tmp/audio_out/*.wav`, the second measures them, the
third lists any sound the game plays that is not registered, or the reverse.

## Screenshots

Needs a display and a renderer. On a machine without a GPU, Xvfb and Mesa's software Vulkan driver do:

```sh
xvfb-run -a -s "-screen 0 1600x900x24" \
    godot --path . --audio-driver Dummy --rendering-driver vulkan --resolution 1600x900 --fixed-fps 60 \
    res://tests/visual/capture.tscn -- --out=/tmp/shots --only=fight,ends
```

Groups are `street`, `gym`, `fight`, `ends`, `bar`, `pause` and `crowd`; leave `--only` out for all of
them. Drawing is switched off between shots, so only the frames that are saved get rendered.

`visual/lookdev.tscn` is a neutral stage for the Step 6 art: `--set=bodies` (physique range), `fighters`
(the five ladder looks), `poses` and `workouts` (the rig in every fight and lifting pose), `arms` (the
first-person view model bare, wrapped and gloved), `armside` (the arms seen from outside) and `props`
(every library model the world places, at its placed size). It takes the
same display and renderer flags as the tour: `res://tests/visual/lookdev.tscn -- --out=/tmp/look --set=fighters`.

The models have to be imported once before any runner starts (`godot --headless --path . --import`, or
just opening the editor). A first headless import prints `Parameter "t" is null` once per model: the
dummy renderer cannot make thumbnails, and the import itself is complete.
