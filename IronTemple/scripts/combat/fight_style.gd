class_name FightStyle
extends RefCounted
## How a fighter fights: footwork, tempo, combinations, defence and fight IQ. Difficulty up the
## ladder comes from these numbers, not from health. `make()` builds the five archetypes;
## Endless League challengers carry two styles and switch between them mid-bout.

enum Archetype { NOOB, PRESSURE, SNIPER, DIRTY, PRO }

const TITLES := {
	Archetype.NOOB: "The Noob",
	Archetype.PRESSURE: "Pressure Fighter",
	Archetype.SNIPER: "Sniper",
	Archetype.DIRTY: "Dirty Boxer",
	Archetype.PRO: "The Pro",
}
const SHORT_TITLES := {
	Archetype.NOOB: "Noob",
	Archetype.PRESSURE: "Pressure",
	Archetype.SNIPER: "Sniper",
	Archetype.DIRTY: "Dirty",
	Archetype.PRO: "Pro",
}

var archetype := Archetype.NOOB

# Footwork.
var move_speed := 1.6
## Distance, centre to centre, the fighter likes to keep.
var preferred_range := 1.6
## Keeps walking forward instead of holding range.
var pressure := false
## Ring cutting, 0 to 1: steps across the player's exits and herds them onto the fence.
var cut_off := 0.0
## Sideways footwork, 0 (flat-footed) to 1.
var circling := 0.0
## Chance to back away after attacking.
var retreat := 0.0
## Shaky hands and a low guard, 0 to 1.
var nerves := 0.0
## Bounce in the step, 0 to 1.
var bounce := 0.0

# Tempo.
## Seconds between leads (min, max).
var attack_delay := Vector2(1.8, 2.8)
## Multiplier on every wind-up: above 1 is slow and easy to read.
var telegraph := 1.0
## Multiplier on the wind-up of each follow-up strike in a combination.
var follow_haste := 0.7
## Multiplier on the recovery after a strike: above 1 leaves a counter opening.
var recovery := 1.0
## Combinations the fighter leads with, as lists of strike kinds. Repeat one to favour it.
var combos: Array[Array] = [[Strike.JAB]]
## Stamina multiplier on everything thrown: wild swings cost more.
var effort := 1.0
## Chance to stop and stare instead of attacking.
var hesitation := 0.0
## Seconds the hands hang at the waist after an attack.
var hands_down := 0.0
## Chance that a lead is only a feint.
var feint_chance := 0.0
## Broken rhythm: seconds of calm probing (min, max) between explosions. Zero turns it off.
var probe_time := Vector2.ZERO
var burst_combos: Array[Array] = []
var burst_haste := 0.6
## Chance, each time the fighter is close enough to lead, to reach for a clinch instead.
var clinch_rate := 0.0

# Defence and fight IQ.
## Share of the time spent behind a raised guard.
var guard_uptime := 0.0
## Share of that guard held low over the body.
var body_guard := 0.0
## Share of a blocked strike's damage that the guard stops.
var block_power := 0.75
## Chance to read the level of an incoming strike and cover it.
var guard_read := 0.0
## Chance to slip the first strike of an attack.
var slip_skill := 0.0
var slip_cooldown := 1.5
## Chance to see a feint for what it is.
var feint_read := 0.0
## Chance to fire back after slipping a strike or watching one fall short.
var counter_rate := 0.0
## Chance to slip and counter the third punch thrown into the guard.
var counter_chance := 0.0
## Multiplier on a counter's wind-up.
var counter_haste := 1.0
var counter_move: StringName = Strike.CROSS
## Chance to cover up after taking a clean hit.
var block_reaction := 0.1

# Punch character.
## Extra stamina each blocked strike takes off the player's guard, per point of move power.
var guard_shred := 0.0
## Multiplier on the composure the fighter's clean hits take.
var stagger_power := 1.0
## Multiplier on the stamina its body shots drain.
var drain_power := 1.0
## Extra reach on every strike, in metres.
var reach := 0.0


static func make(kind: Archetype) -> FightStyle:
	var style := FightStyle.new()
	style.archetype = kind
	match kind:
		Archetype.NOOB:
			_noob(style)
		Archetype.PRESSURE:
			_pressure(style)
		Archetype.SNIPER:
			_sniper(style)
		Archetype.DIRTY:
			_dirty(style)
		Archetype.PRO:
			_pro(style)
	return style


## "Sniper" for one style, "Sniper-Pressure" for a hybrid.
static func title_of(style: FightStyle, alt: FightStyle = null) -> String:
	if alt == null:
		return TITLES[style.archetype]
	return "%s-%s" % [SHORT_TITLES[style.archetype], SHORT_TITLES[alt.archetype]]


## Tightens every timing window by `amount` (0 to 1) for Endless League challengers. Wind-ups
## still never drop under EnemyFighter.MIN_WINDUP, so every strike stays readable.
func sharpen(amount: float) -> FightStyle:
	var edge := clampf(amount, 0.0, 1.0)
	telegraph = lerpf(telegraph, telegraph * 0.82, edge)
	recovery = lerpf(recovery, recovery * 0.8, edge)
	follow_haste = lerpf(follow_haste, follow_haste * 0.88, edge)
	counter_haste = lerpf(counter_haste, counter_haste * 0.88, edge)
	attack_delay = attack_delay.lerp(attack_delay * 0.75, edge)
	if probe_time.y > 0.0:
		probe_time = probe_time.lerp(Vector2(3.0, 6.0), edge)
	guard_read = minf(guard_read + 0.15 * edge, 0.9)
	slip_skill = minf(slip_skill + 0.15 * edge, 0.7)
	feint_read = minf(feint_read + 0.25 * edge, 0.7)
	counter_rate = minf(counter_rate + 0.2 * edge, 0.95)
	slip_cooldown = lerpf(slip_cooldown, slip_cooldown * 0.75, edge)
	return self


## Slow and sloppy: wide looping hooks, hands down after throwing, awkward pauses, no gas tank.
static func _noob(style: FightStyle) -> void:
	style.move_speed = 1.3
	style.preferred_range = 1.65
	style.circling = 0.1
	style.retreat = 0.9
	style.nerves = 1.0
	style.attack_delay = Vector2(1.6, 2.8)
	style.telegraph = 1.6
	style.follow_haste = 1.0
	style.recovery = 1.6
	style.combos = [[Strike.HOOK], [Strike.HOOK], [Strike.OVERHAND], [Strike.JAB], [Strike.JAB, Strike.HOOK]]
	style.effort = 1.5
	style.hesitation = 0.35
	style.hands_down = 1.2
	style.guard_uptime = 0.85
	style.block_power = 0.75
	style.block_reaction = 0.7
	style.counter_move = Strike.HOOK
	style.stagger_power = 0.7


## Relentless: marches forward, cuts off the cage and throws three and four punch flurries.
static func _pressure(style: FightStyle) -> void:
	style.move_speed = 2.6
	style.preferred_range = 1.5
	style.pressure = true
	style.cut_off = 1.0
	style.circling = 0.2
	style.bounce = 1.0
	style.attack_delay = Vector2(0.55, 1.0)
	style.telegraph = 0.85
	style.follow_haste = 0.62
	style.recovery = 0.8
	style.combos = [
		[Strike.JAB, Strike.JAB, Strike.CROSS, Strike.HOOK],
		[Strike.JAB, Strike.CROSS, Strike.HOOK],
		[Strike.JAB, Strike.JAB, Strike.CROSS],
		[Strike.JAB, Strike.CROSS, Strike.HOOK, Strike.CROSS],
	]
	style.hands_down = 0.1
	style.guard_uptime = 0.85
	style.block_power = 0.75
	style.block_reaction = 0.4
	style.guard_read = 0.3
	style.slip_skill = 0.05
	style.feint_read = 0.05
	style.counter_rate = 0.15
	style.counter_chance = 0.2
	style.counter_haste = 0.8
	style.guard_shred = 2.0
	style.stagger_power = 0.8


## Cold and patient: holds the end of the range, feints to draw a reaction, counters with straights.
static func _sniper(style: FightStyle) -> void:
	style.move_speed = 2.5
	style.preferred_range = 2.05
	style.circling = 0.5
	style.retreat = 0.5
	style.attack_delay = Vector2(1.8, 3.0)
	style.telegraph = 0.9
	style.follow_haste = 0.7
	style.recovery = 0.85
	style.combos = [[Strike.CROSS], [Strike.JAB, Strike.CROSS], [Strike.JAB], [Strike.BODY_CROSS, Strike.CROSS]]
	style.feint_chance = 0.6
	style.guard_uptime = 0.6
	style.body_guard = 0.15
	style.block_power = 0.8
	style.guard_read = 0.45
	style.slip_skill = 0.4
	style.slip_cooldown = 1.4
	style.feint_read = 0.3
	style.counter_rate = 0.65
	style.counter_chance = 0.6
	style.counter_haste = 0.6
	style.block_reaction = 0.6
	style.stagger_power = 1.2
	style.reach = 0.15


## Gritty: walks inside, rips the body to empty the gas tank and grabs a clinch for knees.
static func _dirty(style: FightStyle) -> void:
	style.move_speed = 2.2
	style.preferred_range = 1.2
	style.pressure = true
	style.cut_off = 0.6
	style.attack_delay = Vector2(0.7, 1.2)
	style.telegraph = 0.75
	style.follow_haste = 0.65
	style.recovery = 0.85
	style.combos = [
		[Strike.BODY_HOOK, Strike.BODY_CROSS],
		[Strike.BODY_HOOK, Strike.UPPERCUT],
		[Strike.BODY_CROSS, Strike.HOOK],
		[Strike.JAB, Strike.BODY_HOOK, Strike.BODY_HOOK],
		[Strike.BODY_HOOK],
	]
	style.clinch_rate = 0.4
	style.guard_uptime = 0.9
	style.body_guard = 0.4
	style.block_power = 0.85
	style.guard_read = 0.5
	style.slip_skill = 0.1
	style.feint_read = 0.15
	style.counter_rate = 0.3
	style.counter_chance = 0.35
	style.counter_haste = 0.75
	style.counter_move = Strike.UPPERCUT
	style.block_reaction = 0.6
	style.stagger_power = 1.0
	style.drain_power = 1.3


## Broken rhythm: circles and probes behind feints, then explodes through head, body and head.
static func _pro(style: FightStyle) -> void:
	style.move_speed = 2.6
	style.preferred_range = 1.95
	style.circling = 0.8
	style.retreat = 0.3
	style.bounce = 0.5
	style.attack_delay = Vector2(1.4, 2.4)
	style.telegraph = 0.85
	style.follow_haste = 0.65
	style.recovery = 0.8
	style.combos = [[Strike.JAB], [Strike.JAB], [Strike.JAB, Strike.CROSS], [Strike.BODY_CROSS]]
	style.feint_chance = 0.4
	style.probe_time = Vector2(4.0, 8.0)
	style.burst_combos = [
		[Strike.CROSS, Strike.BODY_HOOK, Strike.OVERHAND],
		[Strike.JAB, Strike.CROSS, Strike.BODY_HOOK, Strike.OVERHAND],
		[Strike.BODY_CROSS, Strike.HOOK, Strike.OVERHAND],
		[Strike.JAB, Strike.BODY_HOOK, Strike.CROSS, Strike.HOOK],
	]
	style.burst_haste = 0.55
	style.guard_uptime = 0.9
	style.body_guard = 0.3
	style.block_power = 0.88
	style.guard_read = 0.7
	style.slip_skill = 0.4
	style.slip_cooldown = 1.2
	style.feint_read = 0.4
	style.counter_rate = 0.8
	style.counter_chance = 0.7
	style.counter_haste = 0.55
	style.block_reaction = 0.75
	style.stagger_power = 1.15
