# Iron Temple

First-person stylized Gym & MMA progression game for **Godot 4.4+** (Forward+ renderer; tested on 4.4.1 and 4.7.2).

**All six steps are in**, and the game is complete: the intro street and a rideable bicycle, a three-storey
gym, first-floor training with stats, levelling, visible muscle growth, a pump multiplier and injuries,
second-floor MMA with first-person striking, heavy bags, a five-fighter ladder and an endless league, a
living gym (regulars who react to your reputation, a supplement bar on the third floor, synthesized sound
and music, saving, a pause menu and particle effects), and fast, technical fights: head and body targeting,
two guards, feints, intercept counters, a chin gauge with knockdowns, the clinch and five opponent styles.
Step 6 is a visual overhaul: rigged CC0 character models, skinned first-person arms with MMA gloves drawn
in their own view-model pass, a stylized PBR look and upgraded lighting. The world is still assembled in
code and every sound is synthesized; the models and four texture maps in `assets/` are CC0 and fetched by
`tools/fetch_assets.py` (see [Added in Step 6](#added-in-step-6)). Open `project.godot` in the editor, let
it import the models, and press **F5**.

## Controls

| Input | On foot | On the bike |
| --- | --- | --- |
| `W` `A` `S` `D` | Move | Accelerate, brake/reverse, steer |
| Mouse | Look | Look around (the bike keeps its heading) |
| `Shift` | Sprint (uses stamina) | Sprint pedalling (uses stamina) |
| `Space` | Jump | |
| `E` | Interact with what the crosshair points at | Dismount (prompt shows at walking pace) |
| `Esc` | Pause menu (leaves a station; in a fight it only frees the mouse, click to take it back) | Pause menu |
| `M` | Mute or unmute the gym speakers | |

The ride from the house to the gym is about 250 m: roughly 18 s sprinting, about 40 s at cruising speed.

### Workout stations

Press `E` on a piece of equipment to use it; the camera eases into position and the mouse still turns your head.
`E` or `Esc` hands control back.

| Station | Controls | Trains |
| --- | --- | --- |
| Warm-up mat | Hold `LMB`/`Space`, release inside the drifting zone. `A`/`D` switches between stretch and push-ups | Stretch: "Warmed Up" for 5 minutes, heals strains faster. Push-ups: torso, arms, max stamina |
| Bench press, squat rack, deadlift | Racked: `A`/`D` or mouse wheel changes the load (20 to 400 kg), `LMB`/`Space` lifts the bar off. Lifting: hold to press, release to lower, tap `A`/`D` to keep the balance gauge centred. `E` racks the bar | Bench: torso, arms. Squat: legs, torso. Deadlift: legs, torso, arms. All: strength |
| Dumbbell bench or rack | `LMB` curls the left arm, `RMB` the right. Alternate in a steady rhythm | Arms, a little strength |
| Treadmill | `W`/`S` sets the belt speed. Above 7 km/h is training pace, below is recovery | Legs, max stamina |

The load is changed with `A`/`D` rather than `Q`/`E`, because `E` leaves the station.

### Fighting (2F)

Walk up to a heavy bag or into the cage and the hands come up with the gloves on. Use the
**Fight Card** terminal beside the cage (`E`) to pick an opponent.

| Input | Action |
| --- | --- |
| `LMB` | Left jab to the head. A second `LMB` straight after a jab is a left hook |
| `RMB` | Right cross to the head. A second `RMB` straight after a cross is a right overhand |
| `Ctrl` (or `C`) + `LMB` / `RMB` | Body shots: liver hook and body cross. Less damage, but they drain the opponent's stamina |
| `F` / middle mouse | Front push kick to the body; a knee when chest to chest. Pushes back and drains stamina |
| `Shift`, or `LMB` + `RMB` held together | High guard: stops head shots for 80% less damage, costs stamina. The body is open |
| `Ctrl` + `Shift` | Body guard: stops body shots the same way. The head is open |
| Tap `Shift` within 0.15 s of starting a punch, before it lands | Feint: the punch is pulled back and its stamina refunded. A jab is home in 0.09 s, so feint off the cross, the hooks and the overhand |
| `A` / `D` / `S` + `Space` | Slip left, right or back (`Space` alone slips back) |
| `Space` / `F` in a clinch | Break the grip: mash, or time one press with the knee coming up |
| `E` at the terminal | Fight Card / Enter Ring |

| Combo | Buttons | Effect |
| --- | --- | --- |
| 1-2 Combo | `LMB` `RMB` | Cross lands for x1.5 |
| Guard Breaker | `LMB` `LMB` `RMB` | Jab, hook, uppercut: shatters a raised guard and staggers |
| KO Finisher | `RMB` `LMB` `RMB` | Cross, jab, overhand for x2 with heavy knockback and a stagger |

Presses chain when they are less than 0.9 s apart; a whiff or taking a clean hit breaks the chain. Body
shots chain like any other press, but only head shots complete the named combos.

| Technique | How | Reward |
| --- | --- | --- |
| Intercept counter | Land a clean punch while the opponent is still winding up | x2.5 damage, his attack is cancelled, a heavy jolt to his chin |
| Perfect counter | Slip within 0.22 s of a strike landing; time slows for a quarter of a second | The next strike does x2 and staggers |
| Level change | A head shot within 1.2 s of a clean body shot | x1.2 damage and x1.6 on his chin gauge |
| Feint | Tap `Shift` as the punch starts | An opponent who bites is stuck with his guard or slip for 0.55 s |
| Punish | Hit a staggered or rocked opponent | x1.25 damage |

Bonuses never stack: the biggest one that applies is the one that counts.

### Supplement bar (3F)

Aim at the bar counter or the bartender and press `E` to open the shop. Each item is drunk the moment it is
bought; `E` or `Esc` closes the shop.

| Item | Price | Effect |
| --- | --- | --- |
| Isotonic Water | $15 | Stamina back to 100%, and an active injury heals in half the time left |
| Whey Protein Shake | $40 | x2 Muscle and XP from every workout rep for 3 minutes |
| Hardcore Pre-Workout | $75 | Stamina regenerates 3.5x as fast, +20% punch speed and lifting power, for 2 minutes |
| Recovery Elixir | $60 | Heals a Strained muscle at once (only sold when you are strained) |

Active buffs show as countdown badges under the profile panel; pre-workout also pulses a faint purple
vignette and makes the forearms steam.

## How progression works

- **Reps pay out** muscle, strength and XP through `PlayerStats.reward_rep()`. Gains scale with the load
  relative to your strength, so light bars build little.
- **Pump** rises with every rep (double for a perfect one), multiplies muscle and XP gains up to x2.5, makes
  every rep cost more stamina and decays after three idle seconds.
- **Perfect reps**: on a barbell, keep the balance marker inside the zone and move the bar without stalling
  or reversing. On curls, alternate arms in tempo. On the mat, release near the centre of the zone.
- **Injury**: each load needs `weight / factor` strength (factor 1.0 bench, 1.25 squat, 1.5 deadlift).
  Above that the strain bar fills while you push, five times slower when warmed up and faster when out
  of stamina. A full strain bar drops the bar and strains a muscle; so does losing balance under a load a
  quarter over your limit, unless you are warmed up and lucky. A strain means camera shake, a red vignette
  and 45 to 60 seconds of slower lifts with 40% less usable strength. Standing still, sitting at a racked
  bar or stretching heals it twice as fast.
- **Levels and ranks**: XP needed per level is `50 * level^1.3`. Titles unlock at levels 1, 3, 6, 9, 13
  and 17 (Skinny Rookie, Gym Regular, Lean Grinder, Shredded Prospect, Cage Ready, Iron Machine), then
  gain a numeral every five levels. One day of gym tenure passes per 45 seconds at a station.
- **Body**: `MuscleArms`, `MuscleTorso` and `MuscleLegs` run 0 to 100 with diminishing returns and drive
  the first-person arms and the mirrored body separately.

## How fighting works

Bouts are short and decided by clean, timed strikes rather than by trading into a health bar. Health pools
are small, every strike is aimed at a level, and a bout ends on the health bar or on the second knockdown.
A fighter with nothing left in the tank who walks onto a clean counter is floored on the spot.

- **Stats carry upstairs.** `Strength` and `MuscleArms` scale punch damage and how fast a guard breaks;
  `MuscleLegs` scales kicks, slip speed and footwork; level, `MuscleTorso` and `MaxStamina` set the health
  bar for a bout (140 for a rookie); level and `MuscleTorso` add a little chin (60 for a rookie). Timing
  windows, bonuses and composure are flat, so skill beats stats.
- **Head and body.** Every strike goes to one level and every guard covers one level. The HUD names the
  opponent's guard (`HIGH GUARD`, `BODY GUARD`, `NO GUARD`): hit the other one. Body shots do about half
  the damage of head shots but take 12 to 24 stamina each, wind the opponent (no stamina regeneration for
  2.5 s) and knock the rest of his combination out of him.
- **Guards.** Your guard stops 80% of a strike at its level and costs stamina with every blocked blow; with
  none left it breaks and you are stunned for 0.6 s. An opponent's guard is a meter: blocked strikes chip
  it, an empty one breaks (60% of the blow goes through and he staggers for 0.8 s), and it comes back whole
  and unbreakable for 2 s, so nobody is stun-locked.
- **Stamina gates everything.** Every strike, slip and second behind the guard costs stamina. Run dry and
  punches come out at 60% speed and 55% power, and the guard drops until a quarter of the bar is back.
  Under 20% you are one mistake from the canvas: get hit clean while your own punch is on its way and it
  is a knockdown, whatever the chin gauge says; you get up with half a tank, and the second knockdown ends
  the bout. The same goes for opponents: empty the tank downstairs, then beat them to the punch.
- **Anti-spam.** Three strikes in a row are free. From the fourth without a pause they are arm punches:
  x1.45 slower, double the stamina, 65% of the damage, no combos, no intercepts, and every opponent slips
  them and counters. A 0.4 s breath, a step of half a metre, a slip, the guard or a feint resets the count.
  The HUD warns `SLOPPY`.
- **Chin gauge and knockdowns.** Under each health bar is a thin gauge with two dots. Clean hits fill it
  (jab 5, hook 11, cross 13, uppercut 18, overhand 20; intercepts, counters and level changes far more) and
  it drains again after 1.6 s without one, so it takes hits in bunches. A full gauge is `ROCKED!` for 1.5 s:
  no guard, no punches, and the view swims. A heavy clean blow on a rocked fighter, or enough light ones,
  is a knockdown; the fighter is up again in 2.3 s with the gauge reset. The second knockdown stops the
  bout, whatever is left on the health bar.
- **Opponents telegraph.** A cue pops over the head and the glove glows for the whole wind-up, never shorter
  than 0.28 s: `!` a light head strike, `!!` a heavy one (hooks and overhands also swoosh), `LOW` a body
  shot (he dips first), `GRAB` a clinch attempt, `!!!` an explosive burst (a tense crouch and a sharp
  exhale). A feint shows the cue with **no glow on the glove**. The cue is repeated on the HUD under the
  bout clock, because up close his head is out of the top of the view. Block the right level, slip it, step
  out, or hit first.
- **Clinch.** A grab that closes holds you chest to chest for up to three knees to the body that cannot be
  blocked. Mash `Space` or `F` to fill the break bar, or press once as a knee comes up (the prompt flashes)
  for half the bar. Breaking out shoves him off, staggered. Slipping the grab makes him stumble past.
- **Heavy bags** take any strike and combo, swing as damped pendulums and pay a little XP, arm or leg
  muscle and max stamina per clean hit. No sign-up needed: just walk up.
- **The ladder** is five styles, not five health bars (Step 4's pools were 150, 260, 430, 560 and 820):

  | Tier | Fighter | Style | Health | How he fights | How to beat him |
  | --- | --- | --- | --- | --- | --- |
  | 1 | Skinny Sam (Lvl 1) | The Noob | 310 | Wide looping hooks with long wind-ups, hands at his waist after every swing, awkward pauses, no gas tank | Make him miss and hit him, intercept the wind-up, go under his high guard |
  | 2 | Cardio Carl (Lvl 3) | Pressure Fighter | 350 | Cuts off the cage and throws three and four punch flurries that eat the stamina of a static guard | Step off the line, beat him to the punch, rip the body |
  | 3 | Counter-King Viktor (Lvl 6) | Sniper | 300 | Holds the end of a long reach, feints six leads in ten, slips and threads a straight through | Watch the glove, feint him back, do not whiff |
  | 4 | Brawler Boris (Lvl 10) | Dirty Boxer | 520 | Walks inside, rips the body to empty your tank, grabs the clinch for knees | Guard low, hit him on the way in, break the grip |
  | 5 | The Iron Champ (Lvl 15, Gym Boss) | The Pro | 630 | Calm for 4 to 8 s, then head-body-head in a blink, and he reads your habits | Intercept the crouch, change levels, never throw the same thing three times |

- **Adaptive opponents** (the Champ and every league challenger) remember your last five combinations and
  slips. Throw the same combination twice and the third is `READ!`: slipped, and answered with a counter that
  floors you if it lands clean. Slip the same way twice and the third time the punch is held until your slip
  has run out. They also cover the level you keep going to, show more feints to a player who slips
  everything and go to the body of one who blocks everything.
- **Endless Championship League** opens when the Champ falls: a seeded challenger for every level from
  16 up, with a random name, build and colours. Each is an adaptive Pro-tier hybrid that switches between
  two styles every 5 to 8 s, at the first moment he is free, so never in the middle of an attack
  (Sniper-Pressure, Dirty-Pro, Pressure-Dirty, Pro-Sniper). Health only creeps up,
  by 14 a level from 714; what climbs is the fight IQ: shorter wind-ups (never under 0.28 s) and
  recoveries, better reads of levels and feints and more counters, at their sharpest from level 31.
- **Winning** pays the purse plus bonuses (win streak 10% a win up to 50%, flawless 25%, 5% for every
  perfect counter and every intercept counter, 10% for every knockdown), large XP and three days of tenure,
  and unlocks the next fighter. Beating someone again pays half. **Losing** pays 15% of the XP and one day,
  and you walk out of the cage free to train and rematch.
- **Feel**: 30 to 80 ms of hit-stop on heavy, combo and counter hits; a crunch and a rattle of the view
  along the line of the punch on an intercept; the view dips for body shots, swims when rocked, drops to
  the canvas on a knockdown and is dragged onto the opponent in a clinch; a red vignette when hit, floating
  callouts (`INTERCEPT COUNTER!`, `LEVEL CHANGE!`, `ROCKED!`, `KNOCKDOWN!`) and a slow-motion finish.

**Bout length and difficulty.** Tuned with a scripted player that reads the tells and presses the real
inputs in the real scene (`tests/combat/`), 20 bouts per cell, with the build a career has at each
opponent's level (league challengers are met with the body that beat the boss). "Novice" reacts in 0.34
to 0.5 s, picks the right guard 60% of the time, sometimes keeps swinging and never feints or intercepts;
"average" reacts in 0.24 to 0.36 s and uses every tool some of the time; "skilled" reacts in 0.17 to
0.25 s. Median bout, with wins out of 20 in brackets:

| Opponent | Novice | Average | Skilled |
| --- | --- | --- | --- |
| Skinny Sam | 45 s (19) | 54 s (20) | 49 s (20) |
| Cardio Carl | 35 s (9) | 44 s (20) | 43 s (20) |
| Counter-King Viktor | 56 s (12) | 59 s (20) | 51 s (20) |
| Brawler Boris | 51 s (12) | 47 s (20) | 43 s (20) |
| The Iron Champ | 57 s (8) | 52 s (20) | 40 s (20) |
| League, levels 16, 20 and 28 | 47 to 58 s (2 to 11) | 48 to 55 s (20) | 36 to 48 s (19 to 20) |

Bouts run 40 to 60 s at every tier and the longest of the 480 took 90 s; the two cells under 40 s are the
novice losing to Carl and the expert against one league challenger. A player who uses the tools wins, and
one who only guards and trades wins about half of the time from Carl up, most often losing to two
knockdowns rather than to the health bar. One tier of extra training downstairs lifts that player to 13 to
19 wins in 20 against the same opponents. Pure button mashing (no guard, no pauses) loses to every ladder
fighter, Sam included, on two knockdowns inside 10 to 15 s. These are scripts, not people: the numbers
order the opponents and catch regressions, they do not say how the fights feel.

To re-run a cell or the whole table (about 15 minutes), see `tests/README.md`.

## The living gym

- **Thirteen regulars** train across the three storeys, plus Joe behind the bar. On the first floor two
  work dumbbells by the mirror, one squats and one stretches; on the second one works a heavy bag (it
  swings, and pays you nothing), one does push-ups and two watch the cage; on the third three stand at the
  bar and the high tables with a shaker; two more walk a lap between the lobby and the bar, up and down both
  flights of stairs. Each has a name tag: `Mike | LVL 4 | 3 Months`.
- **Reputation** follows your level. Walk within a few metres and the nearest regular who has not spoken
  lately comments, and what they say also depends on your arm and torso muscle, your pump and your record.
  - *Levels 1 to 3:* teasing, and only some of the time. "Careful with that bar, stickman!", "First day, huh?"
  - *Levels 4 to 9:* a nod and respect. "Solid pump!", "Nice form, bro.", "Saw your last bout!"
  - *Level 10 and up:* hype. "Make way for the Machine!", "Absolute beast!", "Legend of the gym!" Regulars
    also step out of your way when you walk close, and come to the cage for your fights.
- **The crowd.** The ringside pair watch every bout. From level 10 a further `3 + (level - 10) / 2 +
  win streak` regulars (nine at most) jog to the cage when a bout starts, those from other storeys coming
  up the stairs, and stand around it until you leave. They throw their arms up and roar on heavy clean
  hits, guard breaks and knockouts, louder the more of them there are.
- A walker stops for you if you stand in the way. Regulars are solid: walk around them, unless you are a
  legend.

## Sound and music

There are no audio files. `AudioManager` synthesizes twenty-nine effects and a four-bar beat on a worker thread
at start-up (about half a second) from sine and triangle pitch drops, filtered noise bursts and ringing
partials, and plays them through two `AudioStreamGenerator` streams. Pitch-shifted effects are read
between samples, and a limiter on the master bus keeps a heavy hit, a crunch and the crowd landing on the
same frame from clipping.

- **Gym:** plate clanks when a bar is lifted off, racked or dropped, a click per plate when changing the
  load, a tick per rep (two notes for a perfect rep), a crunch and warning buzz on injury and overload, a
  gulp at the bar, a chime on level-up.
- **Fights:** low thuds for hits (deeper and saturated for heavy ones), a sharp snap on counters and guard
  breaks, a muffled impact on blocks, a whoosh on misses and slips, a bass drop as slow motion starts,
  countdown beeps, the ring bell at "FIGHT!" and three strokes at the end, crowd roars. Step 5 adds a crunch
  for intercept counters, a deep thump for body shots, a ringing tone when a fighter is rocked, a body
  hitting the canvas, and the tells: a swoosh as a hook or overhand loads, a dip for a body shot, a lunge
  and a grab for the clinch, a sharp exhale before a burst and a soft flick for a feint.
- **Speakers:** a 128 BPM phonk-style loop (808 kick and sliding sub-bass, claps, hats, a pulsing synth, a
  quiet cowbell line, all low-passed) plays softly inside the gym, leaks faintly through the walls and
  fades out on the street. `M` or the pause menu mutes it.

## Saving and the pause menu

- The career is saved to `user://gym_mma_save.json` after every workout session, fight and bar purchase,
  from the pause menu, and when the window closes. It holds Level, XP, Cash, Strength, MaxStamina, the
  three muscle groups, the FightRecord, GymTenure, ladder and league progress (with the unlocked Endless
  League flag) and the settings. Buffs, pump and injuries are not kept.
- A saved career loads on start-up. Once you have reached the gym, later sessions start at its door
  instead of at the house.
- **Pause menu** (`Esc` on foot or on the bike): Resume, Save Game, Mouse Sensitivity (0.3x to 3x), gym
  speakers and sound effects on or off, Reset Career (asks first, keeps the settings, restarts at the
  house) and Save and Quit.

Fight tuning lives in `MOVES` and the constants at the top of `scripts/combat/combat_controller.gd`,
`MOVES` in `scripts/combat/enemy_fighter.gd` and the fighter definitions in
`scripts/combat/fighter_roster.gd`.

Tuning lives in the constants at the top of `scripts/autoload/player_stats.gd`. A scripted player doing
warm-up, bench, squat, curls, deadlift and treadmill circuits reaches 85 to 90 out of 100 in every muscle
group after about 18 minutes and 100 after about 28. A person plays less efficiently than the script.

## Scene tree

`scenes/main.tscn`

```
Main (Node3D)                              scripts/main.gd
├── WorldEnvironment                       sky, ambient, glow, SSAO, fog
├── Sun (DirectionalLight3D)               soft shadows
├── Neighborhood (Node3D)                  scripts/world/neighborhood.gd
├── Gym (Node3D)                           scripts/world/gym.gd
│   ├── Floor1_WeightRoom (Node3D)         scripts/world/gym_floor_weights.gd
│   │   └── MirrorWall                     instance of scenes/world/mirror.tscn
│   ├── Floor2_FightHall (Node3D)          scripts/world/gym_floor_mma.gd
│   └── Floor3_Lounge (Node3D)             scripts/world/gym_floor_lounge.gd
├── GymBeacon (Node3D)                     scripts/world/beacon.gd
├── Bicycle                                instance of scenes/vehicles/bicycle.tscn
├── Player                                 instance of scenes/player/player.tscn
└── HUD                                    instance of scenes/ui/hud.tscn
```

### Added in Step 2

Autoloads (Project Settings, Autoload):

```
GameState      res://scripts/autoload/game_state.gd      objective and toast messages only
PlayerStats    res://scripts/autoload/player_stats.gd    new: every stat, timer and signal
```

Input Map: `lift` (Space, left mouse), `curl_left` (left mouse), `curl_right` (right mouse).
Physics layer 4 is "Interactables": aimed at by the interact ray, never collided with.

Workout stations are created by `Floor1_WeightRoom` at runtime, one node per piece of equipment:

```
Floor1_WeightRoom
├── BenchPress x3, SquatRack x2, Deadlift  (BarbellStation)   scripts/workouts/barbell_station.gd
│   ├── Body (StaticBody3D) → Interactable
│   └── Barbell (Barbell)                                      scripts/workouts/barbell.gd
├── DumbbellCurls x3                       (CurlStation)       scripts/workouts/curl_station.gd
├── Treadmill x5                           (TreadmillStation)  scripts/workouts/treadmill_station.gd
└── WarmUp x3                              (WarmupStation)     scripts/workouts/warmup_station.gd
```

`scenes/player/player.tscn`: the `Stamina` node is gone (stamina lives in `PlayerStats`) and `InteractRay`
also scans layer 4.

`scenes/world/mirror.tscn`: new `NameTag (Label3D)` showing rank, days and level above the reflection.

`scenes/ui/hud.tscn`

```
HUD (CanvasLayer)                          scripts/ui/hud.gd
└── Root (Control)
    ├── Vignette (ColorRect)                                   new: red injury flash
    ├── LeftColumn (VBoxContainer)
    │   ├── ProfilePanel (PanelContainer) → VBox
    │   │   ├── Header: LevelBadge → LevelLabel, RankLabel
    │   │   ├── XPRow: XPCaption, XPBar, XPLabel               new
    │   │   ├── StaminaRow: StaminaCaption, StaminaBar
    │   │   └── PumpRow: PumpCaption, PumpBar, PumpLabel       new
    │   ├── StatusRow (HBoxContainer)                          new
    │   │   ├── WarmupBadge → WarmupLabel
    │   │   └── InjuryBadge → InjuryLabel
    │   └── ObjectiveLabel
    ├── Crosshair, PromptAnchor → Prompt, ToastLabel, ControlsHint, Waypoint
    ├── WorkoutOverlay                                         new: instance of scenes/ui/workout_overlay.tscn
    └── Popups (Control)                                       new: floating "+Arms", "PERFECT REP!"
```

`scenes/ui/workout_overlay.tscn` (rows appear only while a station uses them)

```
WorkoutOverlay (Control)                   scripts/ui/workout_overlay.gd
├── Danger (Label)                         flashing overload warning
└── Dock (VBoxContainer) → Panel (PanelContainer) → Rows (VBoxContainer)
    ├── Header: Title, Counter
    ├── Selector: PrevKey, SelectorValue, NextKey             weight or exercise
    ├── SelectorDetail
    ├── BalanceRow: BalanceCaption, Balance (GaugeBar)
    ├── RhythmRow: RhythmCaption, Rhythm (GaugeBar)
    ├── ArmsRow: LeftBox → LeftArm (GaugeBar), RightBox → RightArm (GaugeBar)
    ├── SpeedRow: SpeedCaption, Speed (GaugeBar)
    ├── StrainRow: StrainCaption, Strain (GaugeBar)
    └── Hint
```

Other scenes are unchanged from Step 1: `player.tscn` (CollisionShape3D, Head → Camera3D → InteractRay and
Arms, Model), `bicycle.tscn` (FrameCollision, RiderCollision, Interactable, Model) and `mirror.tscn`
(SubViewport → MirrorCamera, Surface).

### Added in Step 3

Input Map: `strike_left` (left mouse), `strike_right` (right mouse), `kick` (F, middle mouse), `block`
(Shift), `dodge` (Space).

`scenes/player/player.tscn`

```
Player (CharacterBody3D)                   scripts/player/player.gd
├── CollisionShape3D, Head → Camera3D → InteractRay, Arms, Model
└── Combat (Node)                          new: scripts/combat/combat_controller.gd
    └── TimeFx (Node)                      new: scripts/combat/time_fx.gd (hit-stop, slow motion)
```

`Arms` gains the gloves, the guard, punch paths and a kicking leg; `Model` gains a fight layer and gloves.

`scenes/ui/hud.tscn`

```
HUD (CanvasLayer)
└── Root (Control)
    ├── LeftColumn → ProfilePanel → VBox
    │   └── FightRow: CashCaption, CashLabel, RecordCaption, RecordLabel   new
    ├── CombatHUD                          new: instance of scenes/ui/combat_hud.tscn
    ├── Popups
    └── FightCard                          new: instance of scenes/ui/fight_card.tscn
```

`scenes/ui/combat_hud.tscn` and `scenes/ui/fight_card.tscn` are a root `Control` with a script; the scripts
build their panels in `_ready()` from `UiKit`:

```
CombatHUD (Control)                        scripts/ui/combat_hud.gd
├── OpponentPanel                          name, LVL | rank | tenure, health, guard, stamina
├── PlayerPanel                            health, stamina, strained / gassed line
├── Streak, ComboName                      hit counter, "GUARD BREAKER"
├── Count, Counter                         "3 2 1 FIGHT!", "COUNTER!" and the screen flash
├── Hint                                   fight controls
└── Result                                 VICTORY / DEFEAT, reward rows, Next Fight / Rematch / Exit Ring

FightCard (Control)                        scripts/ui/fight_card.gd
└── dimmer + panel: header and record, fighter list, detail pane, Close / Enter Ring
```

New scenes, instanced at runtime:

```
scenes/combat/punching_bag.tscn
PunchingBag (Node3D)                       scripts/combat/punching_bag.gd
├── Pivot → Bag                            built in _ready(): bag, straps, chain; swings
├── Body (StaticBody3D)
├── Hurtbox (CombatTarget)                 scripts/combat/combat_target.gd
└── Zone (CombatZone)                      scripts/combat/combat_zone.gd

scenes/combat/enemy_fighter.tscn
EnemyFighter (CharacterBody3D)             scripts/combat/enemy_fighter.gd
├── CollisionShape3D
├── Model (CharacterModel)                 render layer 1, shaped and coloured by the FighterProfile
├── Hurtbox (CombatTarget)
├── NameTag (Label3D, billboard)           "SKINNY SAM / LVL 1 | Skinny Rookie | First Week"
└── Telegraph (Label3D, billboard)         the "!" wind-up cue
```

`Floor2_FightHall` creates the fight content at runtime, the same way the weight room creates its stations:

```
Floor2_FightHall                           scripts/world/gym_floor_mma.gd
├── HeavyBag1 … HeavyBag5                  instances of scenes/combat/punching_bag.tscn
└── RingManager (Node3D)                   scripts/combat/ring_manager.gd, at the octagon's centre
    ├── Zone (CombatZone)                  hands up inside the cage
    ├── Gate + GateBlocker                 swings shut and locks for the bout
    ├── FightCardTerminal (Node3D)         scripts/combat/fight_card_terminal.gd → Body → Interactable
    └── EnemyFighter                       spawned per bout from enemy_fighter.tscn
```

To place any of these by hand instead, instance the scene (or add a `Node3D` with the script) and set its
exports: `PunchingBag.mount_height`, `RingManager.arena_radius`, `platform_height`, `gate_distance`.

`scenes/world/mirror.tscn`: `NameTag` now shows the overhead tag, `LVL 7 | Shredded Prospect | 14 Days`, above
the player's reflection. It is drawn in front of the glass on the sight line to the reflected head, so it
reads the right way round.

Scripts that build geometry add their meshes, colliders and lights as children at runtime, so the street,
the gym and the equipment are visible when the game runs, not in the editor viewport.

### Added in Step 4

Autoloads (Project Settings, Autoload), after the existing two:

```
AudioManager   res://scripts/autoload/audio_manager.gd   procedural sound effects and the gym beat
SaveManager    res://scripts/autoload/save_manager.gd    JSON save, load, settings, career reset
```

Input Map: `toggle_music` (M).

`scenes/main.tscn`

```
Main
└── Gym
    ├── Floor1_WeightRoom, Floor2_FightHall, Floor3_Lounge
    └── GymCrowd (Node3D)                  new: scripts/npc/gym_crowd.gd, NPC spawner and crowd controller
        └── Mike, Dana, … Nora             13 instances of scenes/npc/gym_npc.tscn, spawned at runtime
```

`scenes/npc/gym_npc.tscn`

```
GymNpc (AnimatableBody3D)                  scripts/npc/gym_npc.gd
├── CollisionShape3D
├── Model (CharacterModel)                 render layer 1, coloured and shaped per regular
├── NameTag (Label3D, billboard)           "Mike | LVL 4 | 3 Months"
└── Bubble (Label3D, billboard)            speech bubble
```

The labels are on render layer 2, so mirrors do not show them backwards.

`Floor3_Lounge` creates the bar's working parts at runtime:

```
Floor3_Lounge                              scripts/world/gym_floor_lounge.gd
└── SupplementBar (Node3D)                 scripts/world/supplement_bar.gd, at the middle of the counter
    ├── Counter (StaticBody3D, layer 4) → Interactable    "[E] Supplement Bar"
    └── Bartender                          instance of gym_npc.tscn, activity SERVE
```

`scenes/ui/hud.tscn`

```
HUD (CanvasLayer)
└── Root (Control)
    ├── Vignette, PulseVignette            new: pre-workout pulse
    ├── LeftColumn
    │   └── BuffRow: ProteinBadge → ProteinLabel, PreworkoutBadge → PreworkoutLabel   new
    ├── … CombatHUD, Popups, FightCard
    ├── BarShop                            new: instance of scenes/ui/bar_shop.tscn
    └── PauseMenu                          new: instance of scenes/ui/pause_menu.tscn
```

`bar_shop.tscn` and `pause_menu.tscn` are a root `Control` with a script that builds its panel from `UiKit`,
like the Step 3 menus. `PauseMenu` runs with `process_mode = Always`.

Particle effects are created in code and need no nodes of their own: `CombatFx.burst()` adds a one-shot
`GPUParticles3D` to the scene and frees it; `PlayerArms` owns two `GPUParticles3D` for the forearm aura.

### Added in Step 5

Input Map: `body_mod` (Ctrl, C) and `clinch_break` (Space, F).

No scene file changes. Step 5 replaces the Step 3 fight scripts in place (`combat_controller.gd`,
`enemy_fighter.gd`, `ring_manager.gd`, `combat_hud.gd` and the data classes around them) and adds four
scripts that are plain `RefCounted` classes created in code:

```
Player → Combat (CombatController)         owns a ChinGauge; new signals strike_started, feinted, dodged,
                                           chin_changed, knocked_down, clinch_changed, callout

EnemyFighter (CharacterBody3D)             the body: states, tells, guards, chin, knockdowns
├── ChinGauge                              scripts/combat/chin_gauge.gd (the player has one too)
└── EnemyAI                                scripts/combat/enemy_ai.gd, the brain
    ├── FightStyle                         scripts/combat/fight_style.gd, from FighterProfile.style / alt_style
    └── PatternMemory                      scripts/combat/pattern_memory.gd, used by adaptive fighters

CombatHUD (Control)                        scripts/ui/combat_hud.gd, still built in _ready()
├── OpponentPanel                          adds the style, a chin gauge, two knockdown dots, the guard's level
├── Clock                                  new: bout clock
├── PlayerPanel                            adds a chin gauge, two knockdown dots, ROCKED / LOW STAMINA / SLOPPY
├── Callout                                new: "ROCKED!", "FEINTED!", "BODY SHOT!", "COUNTERED!", "KNOCKDOWN!"
└── Clinch                                 new: "[SPACE] / [F]" prompt and the break bar
```

`FighterProfile` now carries a `style` (and an `alt_style` for league hybrids), `chin`, `composure` and
`adaptive`; `PlayerStats` gains `get_chin()`. The save format is unchanged, so Step 4 saves load as they are.

### Added in Step 6

A visual overhaul on top of the existing nodes and scripts: no gameplay rule, number, input or save field
changed, and the two check suites pass unmodified (498 + 665).

**Models.** `tools/fetch_assets.py` downloads 84 CC0 `.glb` models and 4 tiling texture maps into `assets/`
and derives the first-person arms from the male body (88 downloads + 1 derived file, 21 MB; they are
committed, so the tool only needs running to refresh or repair them):

```
assets/models/characters/   rigged Quaternius bodies (male, female) and six hair pieces
assets/models/hands/        fps_arms.glb: the arms of the male body on the same skeleton
assets/models/gym/          44 props (weights, benches, machines, lounge furniture)
assets/models/street/       32 props (cars, street furniture, trees)
assets/textures/            leather, cloth, rubber and concrete normal maps (ambientCG)
assets/ASSET_CREDITS.md     source, author and licence of every file; models/manifest.json has the hashes
```

Every model is checked before it is written (more than 5 KB, `glTF` magic, version 2, declared length equal
to the file's, a parseable JSON chunk with meshes), so a saved error page can never become a model.
`python tools/fetch_assets.py --check` re-validates what is on disk, `--force` downloads again,
`--only gym,street` limits the run and `--list` prints the manifest.

`ModelLoader` (`scripts/visual/model_loader.gd`) loads any `.glb` under `assets/models/` by id:

```gdscript
var car := ModelLoader.instantiate("street/car_sedan", 4.3, {"fit": ModelLoader.Fit.LONGEST})
add_child(car)                      # pivot on the floor, model centred over it, facing -Z
ModelLoader.list("gym")             # every model in a folder; drop a new .glb in and it is found
```

It measures the model's bounding box, scales it to the height asked for, puts the pivot at floor level and
turns it to face -Z, then replaces its materials with the stylized PBR pass
(`shaders/stylized_pbr.gdshader`: the model's own maps, micro surface noise and the shared stylized
lighting in `shaders/stylized_light.gdshaderinc`: wrapped diffuse, GGX highlights and a light-driven Fresnel
rim whose width does not grow with roughness, so matte models keep their colour).
It reads the editor's import when there is one and parses the raw file when there is not. If a file is
missing or invalid it returns a multi-part procedural stand-in from `ModelFallbacks` instead, and the
bodies and arms fall back to the Step 1 to 5 primitive ones: with `assets/` deleted the game still runs and
the suites still pass with a clean log. `project.godot` sets `importer_defaults/scene` so imported models
keep their textures embedded rather than scattering PNGs next to them.

**Rendering.** `Environment_world` in `main.tscn`: ACES tone mapping (exposure 1.18, white 6), sharper SSAO,
SSIL for bounce light, a subtler glow tuned for neon and hit flashes, flat ambient light reduced to match.
`Sun`: tighter bias and normal bias, re-spaced cascades with blended splits. Project settings: 4096
directional shadow map and positional atlas, soft shadow filter quality 3, debanding, 8x anisotropic
filtering, high-quality SSAO. `Build.mat` now goes through `Stylized.standard`, so every flat-colour surface
in the world gets a `NoiseTexture2D` normal map and roughness map chosen from its gloss and metalness
(brushed metal, cloth weave, leather grain, skin pores, mottled masonry), triplanar so no UVs are needed,
plus the engine's rim on glossy finishes. Where the scanned maps in `assets/textures/` are present, concrete and rubber
use them and leather and cloth layer them over the procedural normal as fine detail.

**First-person arms.** `PlayerArms` keeps its two-bone solve and every hand target, and now drives an
`ArmsRig`: skinned arms with articulated hands. Fingers hang loose at rest, close into fists in the guard,
open for the clinch and wrap bars and handlebars; the forearm takes half of the hand's roll. Muscle girth,
definition, veins and a sweat sheen follow `set_physique` (arm level and pump). What the hands wear follows
the place: bare on the street and in the lounge, athletic wrist wraps in the weight room, fingerless MMA
gloves over white hand wraps on the fight floor and in any fight (padded and quilted knuckles, stitched
seams, a hook-and-loop wrist strap). The hands dip out of view for 0.45 s to change. The guard turns the
gloves' padding to the view and a punch lands with the fist level.

The arms are drawn by a `Viewmodel` pass: their own camera (68° field of view) renders render layer 4 into
a transparent `SubViewport` laid over the world below the HUD, so they have their own depth buffer and
cannot clip into a wall, a bag or an opponent, and they are lit and shadowed by the world's lights. While
the hands grip real equipment the pass eases its field of view to the world camera's and hands the arms
over to it, so fingers and bars sort correctly, exactly as before.

**Characters.** `CharacterModel` still animates its joint hierarchy (walk cycle, six workout poses, the
whole `FightAnimator` layer); `CharacterRig` copies that pose onto the imported skeleton every tick: the
spine shares the torso's lean and twist over three bones, arms follow the shoulder and elbow angles, legs
are solved so the feet land where the joints put them and flatten onto the floor, fingers close into fists
or around what the hand holds. Timing is untouched because the choreography is the same code. Clothing
and gear are drawn by `shaders/character_body.gdshader` from rest-pose masks baked into the mesh, so one
body dresses everyone:

| Fighter | Look |
| --- | --- |
| Noob (Skinny Sam) | lanky, oversized t-shirt, long shorts, rounded shoulders |
| Pressure (Cardio Carl) | lean, tank top, red gloves over red wraps |
| Sniper (Counter-King Viktor) | sharp, sleek fight shorts with trim, dark gloves |
| Dirty Boxer (Brawler Boris) | stocky, wide shoulders, beard, taped fists, chin tucked |
| Pro / Boss (The Iron Champ, the league) | heavyweight, black and gold gloves, gold trim, a rising aura |

The regulars get a male or female body, a hair piece and a cut of top that stay the same per name, and the
player's mirror body wears what the first-person hands wear. Glove wind-up glow, name tags, hand props and
every `CharacterModel` call are unchanged.

Nodes created at run time:

```
Player/Head/Camera3D/Arms
├── ArmsRig                  rigged arms (render layer 4)
└── Viewmodel
    ├── Pass (SubViewport) / ViewmodelCamera
    └── Overlay (CanvasLayer -1) / Arms (TextureRect)
*/Model/Rig                  CharacterRig under every CharacterModel
EnemyFighter/Aura, AuraLight for the boss and league fighters
```

Scene files: `main.tscn` (environment and sun), `mirror.tscn` (the mirror camera skips layer 4). Render
layer 4 is named "Viewmodel". Parked cars, kerb furniture, plants and a few wall-side gym props now come
from the model library; they add no colliders.

New scripts:

```
scripts/visual/model_loader.gd      ModelLoader
scripts/visual/model_fallbacks.gd   ModelFallbacks
scripts/visual/stylized.gd          Stylized: noise maps, material factories, material conversion
scripts/visual/character_rig.gd     CharacterRig
scripts/player/arms_rig.gd          ArmsRig
scripts/player/viewmodel.gd         Viewmodel
scripts/combat/fighter_look.gd      FighterLook
shaders/stylized_pbr.gdshader, shaders/character_body.gdshader, shaders/stylized_light.gdshaderinc
```

## Scripts

| Path | Role |
| --- | --- |
| `scripts/visual/model_loader.gd`, `model_fallbacks.gd` | `ModelLoader`: loads, normalises and stylizes any `.glb` in `assets/models/`. `ModelFallbacks`: procedural stand-ins |
| `scripts/visual/stylized.gd` | `Stylized`: procedural noise maps, the material factories behind `Build.mat`, conversion of imported materials |
| `scripts/visual/character_rig.gd`, `scripts/combat/fighter_look.gd` | `CharacterRig`: the rigged body a `CharacterModel` drives. `FighterLook`: outfit, gear and aura per archetype |
| `scripts/player/arms_rig.gd`, `viewmodel.gd` | `ArmsRig`: the skinned first-person arms. `Viewmodel`: their render pass |
| `scripts/autoload/player_stats.gd` | Autoload `PlayerStats`: level, XP, strength, stamina, muscles, pump, warm-up, injury, tenure, rank |
| `scripts/autoload/game_state.gd` | Autoload `GameState`: objective and toast messages |
| `scripts/autoload/audio_manager.gd` | Autoload `AudioManager`: mixes sound effects and streams the gym beat through `AudioStreamGenerator` |
| `scripts/autoload/save_manager.gd` | Autoload `SaveManager`: JSON save and load, settings, career reset |
| `scripts/audio/synth.gd`, `sound_bank.gd`, `gym_beat.gd` | Oscillator and noise building blocks; the twenty-nine effects; the speaker loop |
| `scripts/npc/gym_npc.gd` | `GymNpc`: a regular with a name tag, speech bubble and one looping activity |
| `scripts/npc/gym_crowd.gd`, `reputation.gd` | `GymCrowd`: spawner, remarks, stepping aside, the crowd at the cage. `Reputation`: tier and lines |
| `scripts/world/supplement_bar.gd`, `scripts/core/supplements.gd` | The bartender and shop prompt; the four consumables |
| `scripts/ui/bar_shop.gd`, `pause_menu.gd` | Shop and pause menu |
| `scripts/fx/combat_fx.gd` | `CombatFx`: sweat, spark, shard and confetti bursts, light flashes |
| `scripts/core/build.gd` | `Build`: primitive mesh, collider, wall and stair helpers with cached meshes and materials |
| `scripts/core/interactable.gd` | `Interactable`: component the player's interact ray looks for |
| `scripts/player/player.gd` | `Player`: movement, look, interaction, riding, station seat, camera shake |
| `scripts/player/player_arms.gd` | `PlayerArms`: first-person arms with two-bone IK, grips and physique |
| `scripts/player/character_model.gd` | `CharacterModel`: jointed humanoid with per-group physique and workout poses |
| `scripts/workouts/workout_station.gd` | `WorkoutStation`: base class for usable equipment |
| `scripts/workouts/barbell_station.gd`, `barbell.gd` | Bench, squat and deadlift mini-game; barbell with plates that follow the load |
| `scripts/workouts/curl_station.gd` | Alternating dumbbell curls |
| `scripts/workouts/treadmill_station.gd` | Treadmill with moving belt |
| `scripts/workouts/warmup_station.gd` | Stretch and push-up rhythm game |
| `scripts/ui/hud.gd`, `workout_overlay.gd`, `gauge_bar.gd` | HUD, contextual station gauges, the gauge control |
| `scripts/ui/combat_hud.gd`, `fight_card.gd`, `ui_kit.gd` | Fight overlay (health, chin gauges, knockdown dots, guard, clock, callouts, clinch bar) and result screen, fight selection menu, shared flat dark UI pieces |
| `scripts/combat/combat_controller.gd` | `CombatController`: stance, head and body strikes, combos, feints, both guards, slips, perfect counter, anti-spam, the player's health, chin gauge, knockdowns and clinch escape |
| `scripts/combat/strike.gd`, `combo_tracker.gd` | `Strike`: one blow, its level and its outcome. `ComboTracker`: timed chain detection for head and body presses |
| `scripts/combat/chin_gauge.gd` | `ChinGauge`: composure shared by both fighters: stagger, rocked spell, knockdown |
| `scripts/combat/combat_target.gd`, `combat_zone.gd` | `CombatTarget`: hurtbox component. `CombatZone`: where the hands come up |
| `scripts/combat/time_fx.gd`, `combat_popup.gd` | Hit-stop and slow motion; floating 3D callouts |
| `scripts/combat/fight_animator.gd`, `fight_pose.gd`, `fight_gear.gd` | Guard (high and low), wind-up, strike, slip, crouch, reach, clinch, stagger, rocked and knockdown poses for `CharacterModel`; gloves |
| `scripts/combat/punching_bag.gd` | `PunchingBag`: swinging heavy bag that pays XP and conditioning |
| `scripts/combat/enemy_fighter.gd` | `EnemyFighter`: opponent body and action state machine: wind-ups and tells, both guards, slips, the clinch, chin gauge and knockdowns |
| `scripts/combat/enemy_ai.gd` | `EnemyAI`: the fight brain: footwork, leads, feints, bursts, grabs, and its answers to the player's strikes, feints and slips |
| `scripts/combat/fight_style.gd` | `FightStyle`: the five archetypes as tempo, combination and fight-IQ numbers; `sharpen()` for the league |
| `scripts/combat/pattern_memory.gd` | `PatternMemory`: the player's recent combinations and slips, for adaptive opponents |
| `scripts/combat/fighter_profile.gd`, `fighter_roster.gd` | Opponent data; the five-fighter ladder and the Endless League's hybrid generator |
| `scripts/combat/ring_manager.gd`, `fight_card_terminal.gd` | `RingManager`: gate, countdown, bout clock, how the bout ended, payout. The kiosk beside the cage |
| `scripts/combat/fight_record.gd` | `FightRecord`: wins, losses, streak |
| `scripts/vehicles/bicycle.gd`, `bicycle_model.gd` | `Bicycle` arcade physics and its `BicycleModel` |
| `scripts/world/mirror.gd` | `Mirror`: planar reflection through a SubViewport, rank tag |
| `scripts/world/beacon.gd` | `Beacon`: waypoint beam, emits `reached` |
| `scripts/world/neighborhood.gd` | `Neighborhood`: seeded street generator |
| `scripts/world/gym.gd`, `gym_floor_*.gd`, `gym_props.gd`, `gym_station.gd` | Gym shell, the three storeys, equipment builders, the `GymStation` marker for props without a mini-game |

Render layers: 1 world (opponents and regulars included), 2 first-person only (arms, gloves, held dumbbells,
the regulars' name tags and speech bubbles), 3 third-person only (the player's body, seen by mirrors and shadows). Physics layers: 1 world, 2 player, 3 vehicles, 4 interactables.

## PlayerStats reference

Read these directly from the `PlayerStats` autoload:

| Property | Meaning |
| --- | --- |
| `cash` | Prize money in dollars. `add_cash(n)`, `can_afford(price)`, `spend_cash(price)` (false if short), `get_cash_text()` gives "$1,250" |
| `level`, `xp`, `rank_title`, `gym_tenure` | Progress; `get_profile_title()` gives "Gym Regular \| 4 Days", `get_overhead_tag()` gives "LVL 3 \| Gym Regular \| 4 Days" |
| `fight_record` | A `FightRecord`: `wins`, `losses`, `win_streak`, `best_streak`, `total()`, `to_text()` gives "3 W - 1 L" |
| `ladder_progress`, `league_wins` | Ladder fighters beaten (0 to 5) and Endless League challengers beaten |
| `get_max_health()`, `get_chin()` | Health bar and chin gauge for a bout: 140 and 60 for a rookie, growing with level and `muscle_torso` |
| `strength` | Roughly the safe bench press in kg; `get_effective_strength()` applies strain, fatigue and pre-workout |
| `stamina`, `max_stamina`, `is_exhausted` | `spend_stamina(amount)` returns false when exhausted |
| `muscle_arms`, `muscle_torso`, `muscle_legs` | 0 to 100; `get_muscle_visual(group)` gives 0 to 1 for models |
| `pump_level` | 0 to 100; `get_gain_multiplier()` gives 1.0 to 2.5 |
| `warmup_timer`, `injury_timer` | Seconds left; `is_warmed_up()`, `is_strained()` |
| `protein_timer`, `preworkout_timer` | Seconds of each buff left; `has_protein()`, `has_preworkout()`, `drink_isotonic()`, `drink_protein()`, `drink_preworkout()`, `heal_strain()` |
| `to_save()`, `apply_save(data)`, `reset_career()` | The career as a dictionary, and back |

Signals: `cash_changed`, `fight_record_changed`, `buffs_changed`, `rep_completed`, `profile_reloaded`,
`xp_changed`, `level_up`, `rank_changed`, `tenure_changed`, `strength_changed`, `stamina_changed`, `exhausted`,
`muscle_changed`, `pump_changed`, `status_changed`, `injured`, `popup_requested`.

Extension points:

- **A new consumable**: add an entry to `Supplements.ITEMS` and a branch in `Supplements.buy()`.
- **A new regular**: add a line to `GymCrowd.ROSTER`. A new activity is a value in `GymNpc.Activity` and a
  branch in `GymNpc._animate()`.
- **A new sound**: add a function to `SoundBank` and its name to `render_all()`, then
  `AudioManager.play(&"name")`.
- **A new station**: extend `WorkoutStation`, override `_begin`, `_tick`, `_view` and `handle_input`, and
  place it with `GymProps.workout()`.
- **More opponents**: add a `FighterProfile` to `FighterRoster.ladder()`, an archetype to `FightStyle.make()`
  or a pair of styles to the hybrids in `league_challenger()`. A profile may override single numbers of its
  style, as Carl does.

## Final checklist

Checked on Godot 4.4.1 and 4.7.2 by scripted play of the real scene. The scripts are in `tests/` (see
`tests/README.md`): 498 walkthrough checks for Steps 1 to 4, 665 fight-rule checks for Step 5, a bout
simulator for the balance table above, a sound measurement and a screenshot tour.

- [x] **Step 1** Start at the house, mount the bike, ride to the beacon, walk into the three-storey gym.
- [x] **Step 2** Use a station, bank reps into muscle, strength, XP and pump; strain and recover.
- [x] **Step 3** Work a heavy bag; open the fight card, win through the five-fighter ladder into the Endless
  League; lose a bout and walk out; cash, XP, tenure and the record are paid.
- [x] **Step 4** Thirteen regulars and a bartender on three storeys; remarks change with the level tier;
  regulars step aside and gather at the cage from level 10 and cheer; the bar sells and applies all four
  consumables; nineteen synthesized sounds and the gym beat; save, load, autosave and career reset; pause
  menu with sensitivity and audio settings; sweat, sparks, shards, confetti and the arm aura.
- [x] **Step 5** (Godot 4.4.1, headless, scripted) Head and body strikes against the high and the body
  guard, both ways; guard breaks; feints that are bitten on and seen through; intercept and perfect
  counters; the anti-spam limit; the chin gauge, rocked spells, knockdowns and the two-knockdown stoppage
  for both fighters; the knockdown of a gassed fighter; the clinch, its knees and all three ways out; every
  tell and the 0.28 s wind-up floor across all styles; adaptive reads of repeated combinations and slips;
  hybrid style switches; HUD gauges, dots, callouts and result lines; purse bonuses; ten new sounds; a
  Step 4 save loading unchanged.
- [x] **Together** Stats trained downstairs decide fights upstairs; fight cash buys buffs on the third
  floor that speed up training and fighting; everything survives a restart.
- [x] **No stuck input** Leaving a station, the ring, the fight card, the shop and the pause menu each hand
  back movement and the captured mouse; a career reset reloads the world unpaused at normal speed.

Step 6 was checked the same way: both suites pass unchanged with the models loaded, the first-floor, street
and guard runners pass again with `assets/` removed (procedural fallbacks), and the screenshot tour and
`tests/visual/lookdev.tscn` were rendered and looked at for the bodies, the fighters, the arms and the lighting.

## Windows build

`export_presets.cfg` has a **Windows Desktop** preset that produces a single `IronTemple.exe` with the game
data embedded. In the editor, install the export templates (Editor → Manage Export Templates), then use
Project → Export → Windows Desktop → Export Project. From a shell:

```
godot --headless --path . --export-release "Windows Desktop" build/IronTemple.exe
```

The preset leaves `tests/` out of the build. `tools/` holds no resources, so it is not exported either; the
imported models and textures are.
