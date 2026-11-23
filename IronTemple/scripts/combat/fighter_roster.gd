class_name FighterRoster
extends RefCounted
## The opponents. Five ladder fighters, each a different archetype with its own tempo (see
## FightStyle), then the Endless Championship League: a new, seeded challenger for every level
## from 16 up, Pro-tier fighters who mix two archetypes, remember the player's habits and get
## sharper, not just tougher, as the levels climb.
##
## Progress lives in PlayerStats (`ladder_progress`, `league_wins`).

const LADDER_SIZE := 5
const BOSS_LEVEL := 15
const LEAGUE_START_LEVEL := 16
## Share of the purse and XP paid for beating someone again.
const REMATCH_SHARE := 0.5
## League levels over which the timing windows tighten to their limit.
const LEAGUE_SHARPEN_LEVELS := 20.0
## The first challenger is already this many levels sharp: the league starts where the boss left off.
const LEAGUE_HEAD_START := 4.0

## Hybrid styles of the league: the style the challenger opens with, then the one it switches to.
const _HYBRIDS := [
	[FightStyle.Archetype.SNIPER, FightStyle.Archetype.PRESSURE],
	[FightStyle.Archetype.DIRTY, FightStyle.Archetype.PRO],
	[FightStyle.Archetype.PRESSURE, FightStyle.Archetype.DIRTY],
	[FightStyle.Archetype.PRO, FightStyle.Archetype.SNIPER],
]
const _PREFIXES := [
	["Slick", "Cold", "Patient", "Sly", "Shadow"],
	["Granite", "Hammer", "Big", "Sledge", "Bulldozer"],
	["Rapid", "Flash", "Turbo", "Whirlwind", "Buzzsaw"],
	["Golden", "Savage", "Royal", "Prime", "Iron"],
]
const _NAMES := ["Rico", "Greg", "Sven", "Dante", "Hugo", "Malik", "Yuri", "Tomas", "Kenji", "Andre", "Luca", "Omar", "Felix", "Diego", "Niko", "Bruno"]
const _HYBRID_BLURBS := [
	"Sniper-Pressure. Baits you from the end of his reach, then swarms the moment you flinch.",
	"Dirty-Pro. Body rips and clinch knees up close, head-body-head bursts when you get away.",
	"Pressure-Dirty. Never stops walking: flurries upstairs, hooks downstairs, then the grab.",
	"Pro-Sniper. Broken rhythm with a counter-puncher's eyes. Feint first or pay for it.",
]


static func ladder() -> Array[FighterProfile]:
	return [_sam(), _carl(), _viktor(), _boris(), _champ()]


static func is_league_open() -> bool:
	return PlayerStats.ladder_progress >= LADDER_SIZE


## Level of the next Endless League challenger.
static func next_league_level() -> int:
	return LEAGUE_START_LEVEL + PlayerStats.league_wins


## The player may fight this opponent now.
static func is_unlocked(profile: FighterProfile) -> bool:
	if profile.is_league():
		return is_league_open() and profile.level <= next_league_level()
	return profile.ladder_index <= PlayerStats.ladder_progress


## The player has already beaten this opponent.
static func is_beaten(profile: FighterProfile) -> bool:
	if profile.is_league():
		return profile.level < next_league_level()
	return profile.ladder_index < PlayerStats.ladder_progress


## Who comes after `profile` once it is beaten, or null if nobody is unlocked yet.
static func next_after(profile: FighterProfile) -> FighterProfile:
	if not profile.is_league() and profile.ladder_index + 1 < LADDER_SIZE:
		var next := ladder()[profile.ladder_index + 1]
		return next if is_unlocked(next) else null
	return league_challenger(next_league_level()) if is_league_open() else null


## Endless League challenger for `level` (16 and up). The same level always gives the same
## fighter, so a rematch is against the opponent who beat you.
static func league_challenger(level: int) -> FighterProfile:
	var rng := RandomNumberGenerator.new()
	rng.seed = 104729 * level + 7919
	var tier := maxi(level - BOSS_LEVEL, 1)
	var mix := rng.randi_range(0, _HYBRIDS.size() - 1)
	var fighter := FighterProfile.new()
	fighter.id = StringName("league_%d" % level)
	var prefixes: Array = _PREFIXES[mix]
	fighter.fighter_name = "%s %s" % [prefixes[rng.randi_range(0, prefixes.size() - 1)], _NAMES[rng.randi_range(0, _NAMES.size() - 1)]]
	fighter.level = level
	fighter.rank = "League Contender" if tier < 5 else PlayerStats.get_rank_for(level)
	fighter.tenure = "%d Years" % (3 + tier / 2)
	fighter.blurb = _HYBRID_BLURBS[mix]

	# Pro-tier numbers that creep up slowly; the real climb is in the timing windows.
	fighter.max_health = 700.0 + 14.0 * tier
	fighter.max_stamina = 240.0 + 5.0 * tier
	fighter.stamina_regen = 7.0
	fighter.damage = minf(7.6 + 0.14 * tier, 10.5)
	fighter.chin = minf(95.0 + 1.5 * tier, 135.0)
	fighter.guard_max = 190.0 + 4.0 * tier
	fighter.guard_regen = 20.0
	fighter.composure = minf(1.8 + 0.04 * tier, 2.6)
	fighter.adaptive = true
	var sharpness := (tier + LEAGUE_HEAD_START) / LEAGUE_SHARPEN_LEVELS
	var pair: Array = _HYBRIDS[mix]
	fighter.style = FightStyle.make(pair[0]).sharpen(sharpness)
	fighter.alt_style = FightStyle.make(pair[1]).sharpen(sharpness)

	# Infighters are thick, snipers lean; everyone at this level is built.
	var bulk := 0.85 if mix == 1 else (0.55 if mix == 0 else 0.7)
	fighter.build = Vector3(clampf(bulk + rng.randf_range(-0.1, 0.15), 0.0, 1.0), clampf(bulk + rng.randf_range(-0.1, 0.15), 0.0, 1.0), clampf(bulk + rng.randf_range(-0.15, 0.1), 0.0, 1.0))
	fighter.height = rng.randf_range(0.96, 1.12)
	fighter.skin = Color(0.98, 0.84, 0.74).lerp(Color(0.42, 0.28, 0.2), rng.randf())
	fighter.hair = Color.from_hsv(rng.randf_range(0.02, 0.12), rng.randf_range(0.2, 0.8), rng.randf_range(0.05, 0.6))
	var hue := rng.randf()
	fighter.shorts = Color.from_hsv(hue, 0.75, 0.85)
	fighter.gloves = Color.from_hsv(fmod(hue + 0.5, 1.0), 0.7, 0.9)

	fighter.cash = 1200 + 160 * tier
	fighter.xp = 2400.0 + 280.0 * tier
	return fighter


## Tier 1, the Noob.
static func _sam() -> FighterProfile:
	var fighter := FighterProfile.new()
	fighter.id = &"sam"
	fighter.ladder_index = 0
	fighter.fighter_name = "Skinny Sam"
	fighter.level = 1
	fighter.rank = "Skinny Rookie"
	fighter.tenure = "First Week"
	fighter.blurb = "The Noob. Wide looping hooks you can see coming, then his hands drop and he runs out of breath. Make him miss and hit him."
	fighter.max_health = 310.0
	fighter.max_stamina = 95.0
	fighter.stamina_regen = 4.5
	fighter.damage = 5.0
	fighter.chin = 60.0
	fighter.guard_max = 120.0
	fighter.guard_regen = 8.0
	fighter.composure = 0.3
	fighter.style = FightStyle.make(FightStyle.Archetype.NOOB)
	fighter.height = 1.07
	fighter.build = Vector3(0.02, 0.03, 0.04)
	fighter.skin = Color(0.98, 0.84, 0.74)
	fighter.hair = Color(0.78, 0.45, 0.18)
	fighter.shorts = Color(0.25, 0.4, 0.75)
	fighter.bare_chest = false
	fighter.gloves = Color(0.9, 0.2, 0.2)
	fighter.cash = 60
	fighter.xp = 110.0
	return fighter


## Tier 2, the Pressure Fighter.
static func _carl() -> FighterProfile:
	var fighter := FighterProfile.new()
	fighter.id = &"carl"
	fighter.ladder_index = 1
	fighter.fighter_name = "Cardio Carl"
	fighter.level = 3
	fighter.rank = "Gym Regular"
	fighter.tenure = "2 Months"
	fighter.blurb = "Pressure Fighter. Marches you onto the fence behind four-punch flurries that eat a static guard. Step off the line and beat him to the punch."
	fighter.max_health = 350.0
	fighter.max_stamina = 170.0
	fighter.stamina_regen = 9.0
	fighter.damage = 3.5
	fighter.chin = 55.0
	fighter.guard_max = 80.0
	fighter.guard_regen = 14.0
	fighter.composure = 0.7
	fighter.style = FightStyle.make(FightStyle.Archetype.PRESSURE)
	# Club level: the engine is already there, the hands are not that fast or that heavy yet.
	fighter.style.attack_delay = Vector2(0.9, 1.5)
	fighter.style.telegraph = 1.0
	fighter.style.guard_shred = 1.0
	fighter.build = Vector3(0.22, 0.2, 0.45)
	fighter.skin = Color(0.82, 0.62, 0.46)
	fighter.hair = Color(0.1, 0.1, 0.1)
	fighter.shorts = Color(0.2, 0.85, 0.5)
	fighter.gloves = Color(0.2, 0.85, 0.5)
	fighter.cash = 130
	fighter.xp = 260.0
	return fighter


## Tier 3, the Sniper.
static func _viktor() -> FighterProfile:
	var fighter := FighterProfile.new()
	fighter.id = &"viktor"
	fighter.ladder_index = 2
	fighter.fighter_name = "Counter-King Viktor"
	fighter.level = 6
	fighter.rank = "Lean Grinder"
	fighter.tenure = "6 Months"
	fighter.blurb = "Sniper. Sits at the end of his reach and twitches to make you flinch, then threads a straight through. No glow on the glove means no punch: feint him back."
	fighter.max_health = 300.0
	fighter.max_stamina = 150.0
	fighter.stamina_regen = 9.0
	fighter.damage = 5.0
	fighter.chin = 62.0
	fighter.guard_max = 100.0
	fighter.guard_regen = 20.0
	fighter.composure = 1.0
	fighter.style = FightStyle.make(FightStyle.Archetype.SNIPER)
	fighter.height = 1.06
	fighter.build = Vector3(0.5, 0.46, 0.5)
	fighter.skin = Color(0.72, 0.52, 0.38)
	fighter.hair = Color(0.05, 0.05, 0.07)
	fighter.shorts = Color(0.08, 0.08, 0.1)
	fighter.gloves = Color(0.95, 0.75, 0.15)
	fighter.cash = 280
	fighter.xp = 560.0
	return fighter


## Tier 4, the Dirty Boxer.
static func _boris() -> FighterProfile:
	var fighter := FighterProfile.new()
	fighter.id = &"boris"
	fighter.ladder_index = 3
	fighter.fighter_name = "Brawler Boris"
	fighter.level = 10
	fighter.rank = "Shredded Prospect"
	fighter.tenure = "1 Year"
	fighter.blurb = "Dirty Boxer. Walks inside, rips the body until your tank is empty and grabs the clinch for knees. Guard low, keep him off you, break the grip."
	fighter.max_health = 520.0
	fighter.max_stamina = 190.0
	fighter.stamina_regen = 8.0
	fighter.damage = 6.0
	fighter.chin = 80.0
	fighter.guard_max = 170.0
	fighter.guard_regen = 20.0
	fighter.composure = 1.4
	fighter.style = FightStyle.make(FightStyle.Archetype.DIRTY)
	fighter.height = 0.99
	fighter.build = Vector3(0.8, 0.9, 0.68)
	fighter.skin = Color(0.9, 0.68, 0.55)
	fighter.hair = Color(0.35, 0.2, 0.1)
	fighter.shorts = Color(0.75, 0.12, 0.12)
	fighter.gloves = Color(0.1, 0.1, 0.12)
	fighter.cash = 550
	fighter.xp = 1100.0
	return fighter


## Tier 5, the Pro and Gym Boss.
static func _champ() -> FighterProfile:
	var fighter := FighterProfile.new()
	fighter.id = &"champ"
	fighter.ladder_index = 4
	fighter.fighter_name = "The Iron Champ"
	fighter.level = BOSS_LEVEL
	fighter.rank = "Gym Boss"
	fighter.tenure = "3 Years"
	fighter.blurb = "The Pro. Calm for a few seconds, then head-body-head in a blink, and he remembers your habits. Feint, go downstairs, never throw the same thing three times."
	fighter.max_health = 630.0
	fighter.max_stamina = 240.0
	fighter.stamina_regen = 7.0
	fighter.damage = 7.6
	fighter.chin = 95.0
	fighter.guard_max = 190.0
	fighter.guard_regen = 24.0
	fighter.composure = 1.8
	fighter.adaptive = true
	fighter.style = FightStyle.make(FightStyle.Archetype.PRO)
	fighter.height = 1.1
	fighter.build = Vector3(1.0, 1.0, 0.95)
	fighter.skin = Color(0.6, 0.42, 0.3)
	fighter.hair = Color(0.06, 0.05, 0.05)
	fighter.shorts = Color(0.95, 0.78, 0.2)
	fighter.gloves = Color(0.07, 0.07, 0.08)
	fighter.cash = 1200
	fighter.xp = 2400.0
	return fighter
