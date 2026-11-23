class_name CombatController
extends Node
## First-person fighting for the Player: the stance, head and body strikes, timed combo chains,
## feints, the high and body guards, slips, the perfect counter, the chin gauge with its rocked
## spells and knockdowns, and breaking out of a clinch. Lives at `Player/Combat`.
##
## Targets are CombatTarget nodes (heavy bags, opponents). Opponents hit back through
## `receive_strike` and grab through `enter_clinch`. The stance comes up inside any CombatZone
## and for the length of a bout; damage, speed and footwork scale with `PlayerStats`, but the
## things that win fights (intercepts, feints, level changes, composure) are flat: skill beats
## stats.

signal stance_changed(active: bool)
signal bout_changed(active: bool)
signal health_changed(current: float, maximum: float)
## Consecutive strikes landed without being hit; 0 when the run ends.
signal streak_changed(hits: int)
## A named combo, a counter or a set-up connected, e.g. "GUARD BREAKER".
signal combo_landed(label: String)
signal strike_resolved(strike: Strike)
signal damage_taken(amount: float, blocked: bool)
## A perfect dodge opened the counter window for `seconds` of real time.
signal counter_opened(seconds: float)
signal guard_broken
signal knocked_out
## A strike has just left the guard; it lands (or not) `startup` later. Opponents read this.
signal strike_started(strike: Strike)
## The strike just started was pulled back into a feint.
signal feinted(strike: Strike)
## A slip began: -1 left, 1 right, 0 straight back.
signal dodged(direction: int)
## The chin gauge moved; `fill` is 0 to 1 (see ChinGauge.get_fill).
signal chin_changed(fill: float, rocked: bool)
## Put on the canvas for the `count`-th time this bout.
signal knocked_down(count: int)
signal clinch_changed(active: bool)
## Something the HUD should shout: "ROCKED!", "BODY SHOT!". `kind` is &"good", &"bad" or &"info".
signal callout(text: String, kind: StringName)

## Timings are seconds at full speed: `startup` from the button to the impact, `recovery` back to
## the guard, `cancel` how soon after the impact the next strike may start. `reach` is measured
## to the target's surface. `weight` (0 to 1) drives hit-stop, shake and camera punch; `stagger`
## is the composure a clean hit takes off the target's chin and `drain` the stamina it saps.
const MOVES := {
	Strike.JAB: {"damage": 7.0, "guard": 7.0, "stagger": 5.0, "cost": 5.0, "startup": 0.09, "recovery": 0.22, "cancel": 0.09, "reach": 1.55, "knockback": 0.5, "drain": 0.0, "weight": 0.2, "heavy": false},
	Strike.HOOK: {"damage": 12.0, "guard": 12.0, "stagger": 11.0, "cost": 8.0, "startup": 0.12, "recovery": 0.3, "cancel": 0.13, "reach": 1.4, "knockback": 0.9, "drain": 0.0, "weight": 0.45, "heavy": false},
	Strike.CROSS: {"damage": 14.0, "guard": 14.0, "stagger": 13.0, "cost": 9.0, "startup": 0.14, "recovery": 0.34, "cancel": 0.15, "reach": 1.65, "knockback": 1.1, "drain": 0.0, "weight": 0.55, "heavy": true},
	Strike.OVERHAND: {"damage": 20.0, "guard": 20.0, "stagger": 20.0, "cost": 13.0, "startup": 0.19, "recovery": 0.42, "cancel": 0.2, "reach": 1.55, "knockback": 1.8, "drain": 0.0, "weight": 0.8, "heavy": true},
	Strike.UPPERCUT: {"damage": 18.0, "guard": 18.0, "stagger": 18.0, "cost": 12.0, "startup": 0.16, "recovery": 0.38, "cancel": 0.18, "reach": 1.35, "knockback": 1.2, "drain": 0.0, "weight": 0.7, "heavy": true},
	Strike.BODY_HOOK: {"damage": 7.0, "guard": 8.0, "stagger": 6.0, "cost": 8.0, "startup": 0.13, "recovery": 0.3, "cancel": 0.14, "reach": 1.4, "knockback": 0.6, "drain": 14.0, "weight": 0.5, "heavy": false},
	Strike.BODY_CROSS: {"damage": 8.0, "guard": 9.0, "stagger": 6.0, "cost": 9.0, "startup": 0.15, "recovery": 0.34, "cancel": 0.16, "reach": 1.6, "knockback": 0.9, "drain": 12.0, "weight": 0.55, "heavy": true},
	Strike.KICK: {"damage": 10.0, "guard": 10.0, "stagger": 5.0, "cost": 12.0, "startup": 0.22, "recovery": 0.46, "cancel": 0.28, "reach": 1.9, "knockback": 3.2, "drain": 16.0, "weight": 0.6, "heavy": true},
	Strike.KNEE: {"damage": 13.0, "guard": 12.0, "stagger": 8.0, "cost": 11.0, "startup": 0.16, "recovery": 0.42, "cancel": 0.26, "reach": 1.0, "knockback": 1.6, "drain": 24.0, "weight": 0.65, "heavy": true},
}
## Inside this distance the kick button throws a knee instead.
const KNEE_RANGE := 0.7
## Half-angle of the cone in front of the view a strike can land in.
const AIM_CONE := 0.66
## A press this long before the fighter is free still comes out.
const BUFFER_TIME := 0.28
## Power left in a strike thrown with an empty stamina bar.
const GASSED_POWER := 0.55

const BLOCK_REDUCTION := 0.8
## Stamina per second with the guard up, and per point of damage absorbed.
const BLOCK_DRAIN := 3.0
const BLOCK_COST_PER_DAMAGE := 0.45
const GUARD_BREAK_STUN := 0.6

const DODGE_COST := 9.0
const DASH_TIME := 0.16
## Slip speed for untrained and fully trained legs. Short enough to counter from where it ends.
const DASH_SPEED := Vector2(4.4, 6.0)
## Seconds after a slip starts during which strikes pass through.
const IFRAME_TIME := 0.32
## Slipping this close to the impact is a perfect dodge.
const PERFECT_WINDOW := 0.22
const SLIP_ROLL := 0.13

const COUNTER_SLOWMO := 0.25
const COUNTER_SLOWMO_SCALE := 0.3
## Real seconds after the slow motion ends in which the counter strike can still be thrown.
const COUNTER_GRACE := 0.4
const COUNTER_MULTIPLIER := 2.0

const ONE_TWO_BONUS := 1.5
const GUARD_BREAKER_BONUS := 1.25
const KO_FINISHER_BONUS := 2.0

## Tapping the guard this soon after a punch starts turns it into a feint.
const FEINT_WINDOW := 0.15
## Seconds the twitch lasts; the guard stays down for it.
const FEINT_TIME := 0.16
## Freeze frame of an intercept counter.
const COUNTER_HIT_STOP := 0.08
## Damage multiplier when an opponent beats the fighter to the punch.
const COUNTERED_DAMAGE := 1.6
## Below this share of stamina one clean counter-hit ends the bout.
const LOW_STAMINA := 0.2

## Strikes in a row that come out clean; from the next one on they are sloppy.
const SPAM_FREE := 3
## What wipes the count: this long without throwing, or this far walked between punches. A
## slip, the guard and a feint wipe it at once.
const SPAM_PAUSE := 0.4
const SPAM_STEP := 0.5
## A sloppy strike is this much slower, costs this much more and has this much behind it.
const SPAM_SLOW := 1.45
const SPAM_COST := 2.0
const SPAM_POWER := 0.65
const SPAM_STAGGER := 0.3

## Share of the walking speed a rocked fighter keeps.
const ROCKED_MOVE := 0.5
## A knockdown, from the blow to back on the feet, and how much of it is the get-up.
const KNOCKDOWN_TIME := 2.3
const RISE_TIME := 0.6
const MAX_KNOCKDOWNS := 2
## Seconds nothing can land after getting up, and the stamina the count gives back.
const GET_UP_GRACE := 0.9
const GET_UP_STAMINA := 0.5

## Clinch struggle, as shares of the break bar: one press, one press timed with the knee coming
## up, and what leaks away per second.
const CLINCH_MASH := 0.14
const CLINCH_TIMED := 0.5
const CLINCH_DECAY := 0.2

const STREAK_TIMEOUT := 2.2
## The hands stay up this long after leaving a combat zone.
const STANCE_LINGER := 0.4

var player: Player
## Hands up, gloves on.
var stance := false
## A bout is running: opponents can hurt the fighter.
var in_bout := false
## Stance without strikes or steps (countdown, result screen).
var locked := false
var blocking := false
## The guard is over the body (elbows down) instead of the head.
var guard_low := false
var health := 100.0
var max_health := 100.0
var hit_streak := 0
var tracker := ComboTracker.new()
var chin := ChinGauge.new()
var knockdowns := 0
## The opponent holding the fighter in a clinch, or null.
var clinch: Node3D = null
## 0 to 1; the grip breaks at 1.
var clinch_progress := 0.0
## Direction of the last slip: -1 left, 1 right, 0 back.
var last_dodge := 0

## Read by Player for the view: slip tilt (radians), the knockdown (0 standing, 1 on the floor),
## the drop into a body shot or body guard and the rocked sway (both 0 to 1).
var view_roll := 0.0
var view_drop := 0.0
var view_crouch := 0.0
var view_wobble := 0.0
## Velocity of the slip in progress; valid while `is_dashing()`.
var dash_velocity := Vector3.ZERO

# Totals for the current bout, for the result screen.
var bout_damage_dealt := 0.0
var bout_damage_taken := 0.0
var bout_hits := 0
var bout_counters := 0
var bout_intercepts := 0
var bout_baits := 0
var bout_best_streak := 0

var _strike: Strike = null
var _strike_time := 0.0
var _strike_cost := 0.0
var _resolved := false
var _startup := 0.1
var _recovery := 0.2
var _cancel := 0.1
var _reach := 1.5
var _weight := 0.2
var _buffer := ""
var _buffer_age := 0.0
var _stun := 0.0
var _dodge_time := 99.0
var _dodge_origin := Vector3.ZERO
var _dash_left := 0.0
var _dodge_cooldown := 0.0
var _slip_roll := 0.0
var _slip_lean := 0.0
var _counter_time := 0.0
var _streak_time := 0.0
var _stance_linger := 0.0
var _work_time := 0.0
var _feint_lock := 0.0
var _block_age := 99.0
var _spam_count := 0
var _spam_travel := 0.0
var _idle_time := 0.0
var _down := false
var _out := false
var _down_time := 0.0
var _untouchable := 0.0
var _clinch_window := false
var _clinch_timed := false
var _body := FightAnimator.new()
var _body_gloves: Array[Node3D] = []

@onready var time_fx: TimeFx = $TimeFx


func _ready() -> void:
	set_process(false)
	chin.changed.connect(func() -> void: chin_changed.emit(chin.get_fill(), chin.rocked))


## Called by the Player once its rig is ready.
func bind(owner_player: Player) -> void:
	player = owner_player
	max_health = PlayerStats.get_max_health()
	health = max_health
	chin.reset(PlayerStats.get_chin())
	player.model.fight_pose = _body.pose
	var padding := Build.mat(player.arms.glove_color, 0.5)
	for i in 2:
		var glove := FightGear.glove(player.model.get_hand(i), padding, player.arms.glove_trim_color, player.model.render_layers)
		glove.visible = false
		_body_gloves.append(glove)
	set_process(true)


func _process(delta: float) -> void:
	var real := minf(delta / time_fx.frame_scale, 0.1)
	# In slow motion the fighter keeps their own pace; during hit-stop they freeze with the world.
	var slowed := time_fx.is_slowed() and not time_fx.is_frozen()
	var own := real if slowed else delta
	player.arms.fight_time_scale = own / delta if delta > 0.0 else 1.0

	_update_stance(real)
	tracker.tick(real)
	_tick_timers(own, real)
	_tick_condition(own)
	_tick_clinch(own)
	_tick_block(own)
	_tick_strike(own)
	_tick_view(delta)
	player.arms.fight_stance = stance
	player.arms.blocking = blocking
	player.arms.guard_low = guard_low
	player.arms.dazed = is_rocked()
	player.arms.clinched = clinch != null


# --- Input -----------------------------------------------------------------------------------

## True while the fighter can throw, block and slip.
func can_act() -> bool:
	return stance and not locked and not _down and clinch == null and player.controls_enabled


## Receives the player's unhandled input while the stance is up.
func handle_input(event: InputEvent) -> void:
	if clinch != null:
		if event.is_action_pressed(&"clinch_break"):
			_struggle()
		return
	if not can_act():
		return
	if event.is_action_pressed(&"strike_left"):
		_press("l" if _aiming_low() else "L")
	elif event.is_action_pressed(&"strike_right"):
		_press("r" if _aiming_low() else "R")
	elif event.is_action_pressed(&"kick"):
		_press("K")
	elif event.is_action_pressed(&"dodge"):
		_try_dodge()
	elif event.is_action_pressed(&"block"):
		_try_feint()


func is_dashing() -> bool:
	return _dash_left > 0.0


## Walking speed multiplier in the stance: leg muscle is footwork, a raised guard is slow, and
## a fighter who is down or held goes nowhere.
func get_move_factor() -> float:
	if not stance:
		return 1.0
	if _down or clinch != null:
		return 0.0
	var factor := lerpf(0.8, 1.08, PlayerStats.get_footwork())
	if is_rocked():
		factor *= ROCKED_MOVE
	elif blocking:
		factor *= 0.55
	elif _strike != null and not _resolved:
		factor *= 0.7
	return factor


## True shortly after landing a strike; bag and ring work both count as training.
func is_working() -> bool:
	return _work_time > 0.0


## True while the next strike will be a counter.
func is_counter_ready() -> bool:
	return _counter_time > 0.0


## On the canvas, from a knockdown or for good.
func is_down() -> bool:
	return _down


## Out on the feet: no guard, no punches, until the spell wears off.
func is_rocked() -> bool:
	return chin.rocked and not _down


## A punch is on its way and has not landed yet.
func is_striking() -> bool:
	return _strike != null and not _resolved


## The next strike will come out sloppy: the anti-spam limit is used up.
func is_sloppy() -> bool:
	return _spam_count >= SPAM_FREE


## So little stamina left that one clean counter-hit ends the bout.
func is_spent() -> bool:
	return PlayerStats.is_exhausted or PlayerStats.get_stamina_ratio() < LOW_STAMINA


## Seconds since the last slip started, and since the guard last came up.
func get_dodge_age() -> float:
	return _dodge_time


func get_block_age() -> float:
	return _block_age if blocking else 99.0


## An opponent bit on a feint.
func note_bait() -> void:
	bout_baits += 1


## The fighter reacted to an opponent's feint.
func note_fooled() -> void:
	callout.emit("FEINTED!", &"bad")


func _press(key: String) -> void:
	# Both punch buttons together is the guard, not a strike.
	if key != "K" and _both_buttons():
		_abort_startup()
		_buffer = ""
		return
	_buffer = key
	_buffer_age = 0.0


func _both_buttons() -> bool:
	return Input.is_action_pressed(&"strike_left") and Input.is_action_pressed(&"strike_right")


func _aiming_low() -> bool:
	return Input.is_action_pressed(&"body_mod")


# --- Stance and bouts ------------------------------------------------------------------------

## Starts a bout: full health and composure, hands up, frozen until `set_locked(false)`.
func begin_bout() -> void:
	in_bout = true
	locked = true
	max_health = PlayerStats.get_max_health()
	health = max_health
	knockdowns = 0
	bout_damage_dealt = 0.0
	bout_damage_taken = 0.0
	bout_hits = 0
	bout_counters = 0
	bout_intercepts = 0
	bout_baits = 0
	bout_best_streak = 0
	_stand_up()
	chin.reset(PlayerStats.get_chin())
	_set_streak(0)
	time_fx.clear()
	health_changed.emit(health, max_health)
	bout_changed.emit(true)


func set_locked(value: bool) -> void:
	locked = value
	if locked:
		_reset_action()


func end_bout() -> void:
	in_bout = false
	locked = false
	knockdowns = 0
	_stand_up()
	chin.reset()
	_set_streak(0)
	time_fx.clear()
	bout_changed.emit(false)


## Back on the feet with nothing in progress.
func _stand_up() -> void:
	_down = false
	_out = false
	_untouchable = 0.0
	_leave_clinch()
	_reset_action()


func _update_stance(real: float) -> void:
	var wanted := in_bout
	if not wanted and player.vehicle == null and player.station == null:
		var spot := player.global_position
		for node in get_tree().get_nodes_in_group(&"combat_zones"):
			var zone := node as CombatZone
			if zone != null and zone.contains(spot):
				wanted = true
				break
	if wanted:
		_stance_linger = STANCE_LINGER
	else:
		_stance_linger -= real
		wanted = stance and _stance_linger > 0.0
	if wanted == stance:
		return
	stance = wanted
	if not stance:
		_reset_action()
		_set_streak(0)
	stance_changed.emit(stance)


func _reset_action() -> void:
	_strike = null
	_buffer = ""
	blocking = false
	guard_low = false
	_stun = 0.0
	_dash_left = 0.0
	_counter_time = 0.0
	_feint_lock = 0.0
	_clear_spam()
	tracker.clear()
	if player != null:
		player.arms.cancel_strikes()


func _tick_timers(own: float, real: float) -> void:
	_dodge_time += own
	_dash_left = maxf(_dash_left - own, 0.0)
	_dodge_cooldown = maxf(_dodge_cooldown - own, 0.0)
	_stun = maxf(_stun - own, 0.0)
	_feint_lock = maxf(_feint_lock - own, 0.0)
	_untouchable = maxf(_untouchable - own, 0.0)
	_work_time = maxf(_work_time - real, 0.0)
	_counter_time = maxf(_counter_time - real, 0.0)
	if hit_streak > 0:
		_streak_time -= own
		if _streak_time <= 0.0:
			_set_streak(0)
	# Anti-spam: a breath or a step between punches wipes the count.
	if _spam_count > 0 and (_strike == null or _resolved):
		_spam_travel += Vector2(player.velocity.x, player.velocity.z).length() * own
	if _strike != null:
		_idle_time = 0.0
	elif _spam_count > 0:
		_idle_time += own
		if _idle_time >= SPAM_PAUSE or _spam_travel >= SPAM_STEP:
			_clear_spam()


func _clear_spam() -> void:
	_spam_count = 0
	_spam_travel = 0.0
	_idle_time = 0.0


func _tick_view(delta: float) -> void:
	var slipping := _dodge_time < DASH_TIME + 0.1
	view_roll = lerpf(view_roll, _slip_roll if slipping else 0.0, 1.0 - exp(-24.0 * delta))
	var floored := _down and (_out or _down_time < KNOCKDOWN_TIME - RISE_TIME)
	view_drop = move_toward(view_drop, 1.0 if floored else 0.0, delta * (2.4 if floored else 1.0 / RISE_TIME))
	view_wobble = move_toward(view_wobble, 1.0 if is_rocked() else 0.0, delta * 4.0)
	# The whole fighter drops a level for a body shot and behind the body guard.
	var low := (blocking and guard_low) or (_strike != null and _strike.is_body() and not _strike.is_kick())
	view_crouch = move_toward(view_crouch, 1.0 if low else 0.0, delta * 9.0)


# --- Striking --------------------------------------------------------------------------------

func _tick_strike(own: float) -> void:
	if not _buffer.is_empty():
		_buffer_age += own
		if _buffer_age > BUFFER_TIME:
			_buffer = ""
	if _strike != null:
		_strike_time += own
		if not _resolved and _strike_time >= _startup:
			_resolve()
	if _strike != null and _strike_time >= _startup + _recovery:
		_strike = null
	if not _buffer.is_empty() and _can_start():
		var key := _buffer
		_buffer = ""
		_start(key)


func _can_start() -> bool:
	if not can_act() or blocking or _stun > 0.0 or is_dashing() or is_rocked():
		return false
	return _strike == null or (_resolved and _strike_time >= _startup + _cancel)


func _start(key: String) -> void:
	var kind: StringName
	var combo: StringName = &""
	if key == "K":
		var kick_reach: float = MOVES[Strike.KICK]["reach"]
		var target := _find_target(kick_reach)
		kind = Strike.KNEE if target != null and _distance_to(target) < KNEE_RANGE else Strike.KICK
	else:
		kind = tracker.next_kind(key)
		combo = tracker.push(key)
	var move: Dictionary = MOVES[kind]
	var kicking := kind == Strike.KICK or kind == Strike.KNEE
	var power := PlayerStats.get_kick_power() if kicking else PlayerStats.get_punch_power()
	# Past the limit a string of punches turns into arm punches: slow, costly and easy to slip.
	_spam_count += 1
	_spam_travel = 0.0
	var sloppy := _spam_count > SPAM_FREE
	# An empty tank still throws, but slowly and without much behind it.
	var cost: float = move["cost"]
	if sloppy:
		cost *= SPAM_COST
		power *= SPAM_POWER
		combo = &""
	var tank := PlayerStats.stamina
	var paid := PlayerStats.spend_stamina(cost)
	_strike_cost = tank - PlayerStats.stamina if paid else 0.0
	if _strike_cost <= 0.0:
		power *= GASSED_POWER

	var strike := Strike.new()
	var base_damage: float = move["damage"]
	var base_guard: float = move["guard"]
	var base_stagger: float = move["stagger"]
	var base_knockback: float = move["knockback"]
	var base_drain: float = move["drain"]
	strike.kind = kind
	strike.side = 0 if kind == Strike.JAB or kind == Strike.HOOK or kind == Strike.BODY_HOOK else 1
	strike.zone = Strike.zone_of(kind)
	strike.damage = base_damage * power * randf_range(0.94, 1.06)
	strike.guard_damage = base_guard * PlayerStats.get_guard_break_power()
	strike.stagger = base_stagger * (SPAM_STAGGER if sloppy else 1.0)
	strike.knockback = base_knockback * (PlayerStats.get_kick_power() if kicking else 1.0)
	strike.stamina_drain = base_drain * (PlayerStats.get_kick_power() if kicking else 1.0)
	strike.heavy = move["heavy"]
	strike.sloppy = sloppy
	strike.combo = combo
	strike.attacker = player
	if _counter_time > 0.0:
		strike.counter = true
		strike.bonus = COUNTER_MULTIPLIER
		strike.damage *= COUNTER_MULTIPLIER
		_counter_time = 0.0

	var speed := PlayerStats.get_fight_speed() / (SPAM_SLOW if sloppy else 1.0)
	var startup: float = move["startup"]
	var recovery: float = move["recovery"]
	var cancel: float = move["cancel"]
	_strike = strike
	_strike_time = 0.0
	_resolved = false
	_startup = startup / speed
	_recovery = recovery / speed
	_cancel = cancel / speed
	_reach = move["reach"]
	_weight = move["weight"]
	if kicking:
		player.arms.play_kick(kind, _startup, _recovery)
	else:
		player.arms.play_strike(kind, strike.side, _startup, _recovery)
	strike_started.emit(strike)


## The moment of impact: finds what is in front of the fist and lands on it.
func _resolve() -> void:
	_resolved = true
	var strike := _strike
	var target := _find_target(_reach)
	if target == null:
		# A whiff breaks the chain.
		AudioManager.play_varied(&"whoosh", 0.6)
		tracker.clear()
		strike_resolved.emit(strike)
		return
	var flat := target.global_position - player.global_position
	flat.y = 0.0
	strike.direction = flat.normalized() if flat.length() > 0.01 else _view_forward()
	# A combo's bonus replaces a counter's rather than multiplying it: the bigger one counts.
	var combo_bonus := 1.0
	match strike.combo:
		Strike.ONE_TWO:
			combo_bonus = ONE_TWO_BONUS
		Strike.GUARD_BREAKER:
			strike.guard_breaker = true
			combo_bonus = GUARD_BREAKER_BONUS
		Strike.KO_FINISHER:
			combo_bonus = KO_FINISHER_BONUS
			strike.knockback = strike.knockback * 2.0 + 3.0
			strike.heavy = true
	if combo_bonus > strike.bonus:
		strike.damage *= combo_bonus / strike.bonus
		strike.bonus = combo_bonus
	target.receive(strike)
	if strike.connected():
		_on_connected(strike, target)
	else:
		tracker.clear()
		AudioManager.play_varied(&"whoosh", 0.6)
		if strike.outcome == Strike.Outcome.DODGED:
			CombatPopup.spawn(get_tree().current_scene, "SLIPPED", target.global_position + Vector3.UP * 0.45, CombatPopup.MUTED, 0.13, 0.7)
	strike_resolved.emit(strike)


func _on_connected(strike: Strike, target: CombatTarget) -> void:
	_work_time = 3.0
	bout_hits += 1
	bout_damage_dealt += strike.dealt
	_set_streak(hit_streak + 1)

	var blocked := strike.outcome == Strike.Outcome.BLOCKED
	var knockout := strike.outcome == Strike.Outcome.KNOCKOUT
	var weight := _weight
	if strike.counter_hit or strike.counter or strike.knockdown or strike.combo == Strike.KO_FINISHER:
		weight = 1.0
	elif strike.combo != &"" or strike.rocked or strike.setup:
		weight = maxf(weight, 0.75)
	if blocked:
		weight *= 0.5
	elif strike.counter_hit:
		time_fx.hit_stop(COUNTER_HIT_STOP)
	elif strike.heavy or strike.counter or strike.combo != &"" or strike.knockdown:
		time_fx.hit_stop(lerpf(0.03, 0.06, weight))
	player.add_shake(0.12 + 0.6 * weight)
	var across := -1.0 if strike.side == 0 else 1.0
	player.add_view_punch(Vector2(-0.006 - 0.022 * weight, -across * 0.014 * weight))
	if strike.counter_hit:
		# The whole view rattles along the line of the punch.
		player.add_directional_shake(Vector2(-0.35, -across), 0.03)

	var host := get_tree().current_scene
	var at := target.global_position + Vector3.UP * 0.45
	var above := at + Vector3.UP * 0.2
	_play_impact(strike, host, target.global_position + Vector3.UP * (-0.15 if strike.is_body() else 0.2), weight)
	if strike.counter_hit:
		bout_intercepts += 1
		combo_landed.emit("INTERCEPT COUNTER x2.5")
	elif strike.counter:
		bout_counters += 1
		combo_landed.emit("COUNTER x2")
	elif strike.combo != &"":
		combo_landed.emit(ComboTracker.LABELS[strike.combo])
	elif strike.setup:
		combo_landed.emit("BODY-HEAD SETUP")

	# The headline, then the reason for it underneath.
	if knockout:
		CombatPopup.spawn(host, "KNOCKOUT!", above + Vector3.UP * 0.25, CombatPopup.WARN, 0.42, 1.8)
	elif strike.knockdown:
		CombatPopup.spawn(host, "KNOCKDOWN!", above + Vector3.UP * 0.25, CombatPopup.WARN, 0.38, 1.5)
	elif strike.rocked:
		CombatPopup.spawn(host, "ROCKED!", above + Vector3.UP * 0.25, CombatPopup.HOT, 0.36, 1.4)
	if strike.counter_hit:
		CombatPopup.spawn(host, "INTERCEPT COUNTER!", above, CombatPopup.HOT, 0.3, 1.2)
	elif strike.counter:
		CombatPopup.spawn(host, "COUNTER x2!", above, CombatPopup.HOT, 0.3, 1.1)
	elif strike.outcome == Strike.Outcome.GUARD_BREAK:
		CombatPopup.spawn(host, "GUARD BREAK!", above, CombatPopup.ACCENT, 0.3, 1.1)
	elif strike.combo == Strike.KO_FINISHER:
		CombatPopup.spawn(host, "KO FINISHER!", above, CombatPopup.WARN, 0.3, 1.1)
	elif strike.setup:
		CombatPopup.spawn(host, "LEVEL CHANGE!", above, CombatPopup.ACCENT, 0.24, 0.9)
	elif strike.is_body() and strike.clean() and not strike.is_kick():
		CombatPopup.spawn(host, "BODY SHOT!", above, CombatPopup.ACCENT, 0.22, 0.9)
	elif strike.combo == Strike.ONE_TWO and not blocked:
		CombatPopup.spawn(host, "1-2!", above, CombatPopup.ACCENT, 0.22)
	if blocked:
		CombatPopup.spawn(host, "BLOCKED", at, CombatPopup.MUTED, 0.13, 0.7)
	else:
		CombatPopup.spawn(host, str(maxi(roundi(strike.dealt), 1)), at, CombatPopup.WHITE, 0.13 + 0.09 * weight, 0.8)


## Sound, sweat and sparks for a strike that connected.
func _play_impact(strike: Strike, host: Node, at: Vector3, weight: float) -> void:
	var spray := (strike.direction + Vector3.UP * 0.7).normalized()
	match strike.outcome:
		Strike.Outcome.BLOCKED:
			AudioManager.play_varied(&"block", 0.5 + 0.5 * weight)
			if strike.heavy:
				CombatFx.burst(host, CombatFx.SPARK, at, -strike.direction + Vector3.UP * 0.5, 0.4)
			return
		Strike.Outcome.GUARD_BREAK:
			AudioManager.play(&"snap")
			AudioManager.play_varied(&"hit_heavy", 0.8)
			CombatFx.burst(host, CombatFx.SHATTER, at, -strike.direction + Vector3.UP * 0.6)
			CombatFx.flash(host, at, Color(0.8, 0.6, 1.0), 3.0)
			return
	var knockout := strike.outcome == Strike.Outcome.KNOCKOUT
	var big := strike.heavy or strike.counter or strike.counter_hit or strike.combo != &"" or knockout
	if strike.is_body() and not strike.is_kick():
		AudioManager.play_varied(&"body_hit", 0.7 + 0.3 * weight)
	else:
		AudioManager.play_varied(&"hit_heavy" if big else &"hit_light", 0.6 + 0.4 * weight)
	if strike.counter_hit:
		AudioManager.play(&"counter_crunch")
	elif strike.counter:
		AudioManager.play(&"snap")
	if big:
		CombatFx.burst(host, CombatFx.SWEAT, at, spray, 0.6 + weight)
	if strike.counter_hit or strike.counter or strike.knockdown or strike.combo == Strike.KO_FINISHER:
		CombatFx.burst(host, CombatFx.SPARK, at, spray)
		CombatFx.flash(host, at, Color(1.0, 0.85, 0.6), 3.5)


## The nearest enabled target inside `reach` and the aim cone, or null.
func _find_target(reach: float) -> CombatTarget:
	var forward := _view_forward()
	var best: CombatTarget = null
	var best_score := INF
	for node in get_tree().get_nodes_in_group(&"combat_targets"):
		var target := node as CombatTarget
		if target == null or not target.enabled or not target.is_visible_in_tree():
			continue
		var offset := target.global_position - player.global_position
		# The aim point is at chest height; anything else is on another storey.
		if offset.y < -0.4 or offset.y > 2.6:
			continue
		var flat := Vector3(offset.x, 0.0, offset.z)
		var distance := flat.length() - target.radius
		if distance > reach:
			continue
		var angle := forward.angle_to(flat) if flat.length() > 0.05 else 0.0
		# Up close the target fills the view, so the cone opens up.
		if angle > AIM_CONE * (1.7 if distance < 0.6 else 1.0):
			continue
		var score := angle + maxf(distance, 0.0) * 0.25
		if score < best_score:
			best_score = score
			best = target
	return best


func _distance_to(target: CombatTarget) -> float:
	var offset := target.global_position - player.global_position
	return Vector2(offset.x, offset.z).length() - target.radius


func _view_forward() -> Vector3:
	var forward := -player.head.global_transform.basis.z
	forward.y = 0.0
	if forward.length() < 0.05:
		forward = -player.global_transform.basis.z
	return forward.normalized()


func _abort_startup() -> void:
	if _strike != null and not _resolved:
		_strike = null
		player.arms.cancel_strikes()


## Shift tapped as a punch starts: the punch is pulled, the shoulder twitches, and whatever the
## opponent did about it was for nothing.
func _try_feint() -> void:
	if _strike == null or _resolved or _strike_time > FEINT_WINDOW or _strike.is_kick():
		return
	var strike := _strike
	_strike = null
	_buffer = ""
	# A feint is free: the stamina the punch took comes straight back.
	if _strike_cost > 0.0:
		PlayerStats.restore_stamina(_strike_cost)
	tracker.clear()
	_clear_spam()
	_feint_lock = FEINT_TIME
	player.arms.cancel_strikes()
	player.arms.play_feint(strike.side, strike.is_body())
	AudioManager.play(&"feint")
	feinted.emit(strike)


func _set_streak(hits: int) -> void:
	if hits == hit_streak:
		if hits > 0:
			_streak_time = STREAK_TIMEOUT
		return
	hit_streak = hits
	_streak_time = STREAK_TIMEOUT
	bout_best_streak = maxi(bout_best_streak, hits)
	streak_changed.emit(hits)


# --- Defence ---------------------------------------------------------------------------------

func _tick_block(own: float) -> void:
	var held := Input.is_action_pressed(&"block") or _both_buttons()
	var wanted := held and can_act() and _stun <= 0.0 and _feint_lock <= 0.0 and not is_dashing() and not is_rocked() and not PlayerStats.is_exhausted
	if wanted and _strike != null:
		if _resolved:
			# The guard comes straight back up after a punch has landed.
			_strike = null
			player.arms.cancel_strikes()
		elif _both_buttons():
			_abort_startup()
		else:
			wanted = false
	if blocking and held and PlayerStats.is_exhausted:
		# Ran out of stamina with the guard up.
		_break_guard()
	if wanted and not blocking:
		_block_age = 0.0
	blocking = wanted
	# Ctrl drops the elbows: the body is covered and the head is not.
	guard_low = blocking and _aiming_low()
	if blocking:
		_block_age += own
		_clear_spam()
		PlayerStats.spend_stamina(BLOCK_DRAIN * own)


func _try_dodge() -> void:
	if _dodge_cooldown > 0.0 or _stun > 0.0 or not player.is_on_floor():
		return
	var input := Input.get_vector(&"move_left", &"move_right", &"move_forward", &"move_back")
	var direction := Vector3.ZERO
	if absf(input.x) > 0.3 and absf(input.x) >= absf(input.y):
		direction.x = signf(input.x)
	elif input.y > -0.3:
		# Back, or no direction at all: slip straight out of range.
		direction.z = 1.0
	else:
		return
	# With an empty tank the slip still comes out, slower and less often.
	var tired := 1.0 if PlayerStats.spend_stamina(DODGE_COST) else 0.7
	_abort_startup()
	_buffer = ""
	_clear_spam()
	var footwork := PlayerStats.get_footwork()
	dash_velocity = player.global_transform.basis * direction * lerpf(DASH_SPEED.x, DASH_SPEED.y, footwork) * tired
	_dash_left = DASH_TIME
	_dodge_time = 0.0
	_dodge_origin = player.global_position
	_dodge_cooldown = lerpf(0.55, 0.38, footwork) / tired
	_slip_roll = -direction.x * SLIP_ROLL
	_slip_lean = direction.x
	last_dodge = int(direction.x)
	if direction.z > 0.0:
		player.add_view_punch(Vector2(0.035, 0.0))
	AudioManager.play_varied(&"whoosh", 0.8)
	dodged.emit(last_dodge)


## An opponent's strike arrives. `in_reach` is whether it would connect with a fighter who
## stood still. Writes the outcome into `strike`.
func receive_strike(strike: Strike, in_reach: bool) -> void:
	strike.outcome = Strike.Outcome.MISS
	strike.dealt = 0.0
	if not in_bout or _down or _untouchable > 0.0:
		return
	if strike.held:
		# A knee in the clinch: nowhere to go and no hands free.
		strike.outcome = Strike.Outcome.HIT
		strike.dealt = strike.damage
		_take_damage(strike)
		return
	if _dodge_time < IFRAME_TIME:
		if not in_reach and not _threatened(strike):
			# It was never going to reach: nothing was slipped, so there is no counter to earn.
			return
		strike.outcome = Strike.Outcome.DODGED
		if _dodge_time <= PERFECT_WINDOW:
			strike.perfect = true
			_open_counter()
		return
	if not in_reach:
		return

	var facing := _view_forward().dot(-strike.direction) > 0.1
	# The high guard stops head shots and the body guard stops body shots, never both.
	if blocking and facing and guard_low == strike.is_body():
		strike.outcome = Strike.Outcome.BLOCKED
		strike.dealt = strike.damage * (1.0 - BLOCK_REDUCTION)
		var cost := strike.damage * BLOCK_COST_PER_DAMAGE + strike.guard_damage
		if not PlayerStats.spend_stamina(cost) or PlayerStats.is_exhausted:
			# The guard gives way under the blow.
			strike.outcome = Strike.Outcome.GUARD_BREAK
			strike.dealt = strike.damage * 0.5
			_break_guard()
	else:
		strike.outcome = Strike.Outcome.HIT
		strike.dealt = strike.damage
		if is_striking():
			# Beaten to the punch.
			strike.counter_hit = true
			strike.dealt *= COUNTERED_DAMAGE
	_take_damage(strike)


## True when `strike` would have reached the spot the slip in progress started from.
func _threatened(strike: Strike) -> bool:
	if strike.reach <= 0.0 or strike.attacker == null:
		return true
	var offset := _dodge_origin - strike.attacker.global_position
	return Vector2(offset.x, offset.z).length() <= strike.reach + 0.1


func _open_counter() -> void:
	_counter_time = COUNTER_SLOWMO + COUNTER_GRACE
	time_fx.slow_motion(COUNTER_SLOWMO, COUNTER_SLOWMO_SCALE)
	AudioManager.play(&"bass_drop")
	PlayerStats.popup_requested.emit("PERFECT DODGE!", &"perfect")
	counter_opened.emit(_counter_time)


func _break_guard() -> void:
	blocking = false
	guard_low = false
	_stun = GUARD_BREAK_STUN
	_reset_strike_only()
	AudioManager.play(&"snap", 0.8, 0.8)
	PlayerStats.popup_requested.emit("GUARD BROKEN!", &"warning")
	guard_broken.emit()


func _reset_strike_only() -> void:
	_strike = null
	_buffer = ""
	player.arms.cancel_strikes()


func _take_damage(strike: Strike) -> void:
	var blocked := strike.outcome == Strike.Outcome.BLOCKED
	var clean := strike.outcome == Strike.Outcome.HIT
	var body := strike.is_body()
	health = maxf(health - strike.dealt, 0.0)
	bout_damage_taken += strike.dealt
	if strike.stamina_drain > 0.0 and not PlayerStats.is_exhausted:
		# Body shots empty the tank; the guard takes most of it.
		PlayerStats.spend_stamina(strike.stamina_drain * (1.0 if clean else 0.3))
	if not blocked:
		_set_streak(0)
		tracker.clear()
	if strike.counter_hit:
		# The punch that was on its way never gets there.
		_reset_strike_only()

	# The view is thrown away from the blow: an opponent's right hand comes from our left, and a
	# body shot folds it down.
	var weight := clampf(strike.dealt / maxf(max_health * 0.2, 1.0), 0.15, 1.0)
	var across := -1.0 if strike.side == 1 else 1.0
	if strike.is_kick() or body:
		player.add_view_punch(Vector2((0.05 if strike.is_kick() else -0.045) * weight, across * 0.02 * weight))
	else:
		player.add_view_punch(Vector2(0.02 * weight, across * 0.06 * weight))
	player.add_shake(0.25 + 0.7 * weight)
	player.arms.flinch(0.4 + 0.6 * weight)
	_body.flinch(weight, across)
	if strike.knockback > 0.0:
		player.apply_impulse(strike.direction * strike.knockback * (0.4 if blocked else 1.0))
	if clean and strike.counter_hit:
		time_fx.hit_stop(0.06)
		player.add_directional_shake(Vector2(0.3, across), 0.03)
	elif not blocked and strike.heavy:
		time_fx.hit_stop(0.04)
	if blocked:
		AudioManager.play_varied(&"block", 0.6 + 0.4 * weight)
	elif body:
		AudioManager.play_varied(&"body_hit", 0.7 + 0.3 * weight, 0.05)
	else:
		AudioManager.play_varied(&"hit_heavy" if strike.heavy else &"hit_light", 0.6 + 0.4 * weight, 0.05)
	if clean and strike.counter_hit:
		AudioManager.play(&"counter_crunch", 0.8)

	# Composure: clean hits fill the chin gauge; a full one rocks the fighter, and a heavy blow
	# on a rocked fighter is a knockdown.
	var result := ChinGauge.Result.NONE
	if clean:
		var jolt := strike.stagger * (2.0 if strike.counter_hit else 1.0)
		if body:
			chin.note_body_hit()
		elif chin.is_set_up():
			strike.setup = true
			jolt *= ChinGauge.SETUP_JOLT
		result = chin.take(jolt, strike.heavy)
		if strike.finisher:
			result = ChinGauge.Result.KNOCKDOWN
	# Caught clean on the way in with nothing left in the tank: floored on the spot.
	if clean and strike.counter_hit and is_spent():
		result = ChinGauge.Result.KNOCKDOWN
	if result == ChinGauge.Result.KNOCKDOWN:
		knockdowns += 1
	if knockdowns >= MAX_KNOCKDOWNS:
		health = 0.0
	health_changed.emit(health, max_health)
	damage_taken.emit(strike.dealt, blocked)
	if health <= 0.0:
		strike.outcome = Strike.Outcome.KNOCKOUT
		strike.knockdown = true
		_go_out(result == ChinGauge.Result.KNOCKDOWN)
	elif result == ChinGauge.Result.KNOCKDOWN:
		strike.knockdown = true
		_fall()
	elif result == ChinGauge.Result.ROCKED:
		strike.rocked = true
		_rock()
	elif clean and strike.counter_hit:
		callout.emit("COUNTERED!", &"bad")
	elif clean and body:
		callout.emit("BODY SHOT!", &"bad")


# --- Composure -------------------------------------------------------------------------------

func _tick_condition(own: float) -> void:
	if in_bout and not _down:
		chin.tick(own)
	if _down and not _out:
		_down_time += own
		if _down_time >= KNOCKDOWN_TIME:
			_get_up()


## The chin gauge filled: the guard drops and the view swims until it wears off.
func _rock() -> void:
	_reset_strike_only()
	blocking = false
	guard_low = false
	tracker.clear()
	AudioManager.play(&"rocked")
	callout.emit("ROCKED!", &"bad")


## A knockdown: on the canvas, then back up with the composure reset.
func _fall() -> void:
	_down = true
	_down_time = 0.0
	_leave_clinch()
	_reset_action()
	chin.reset()
	AudioManager.play(&"knockdown", 1.0, 1.0, 0.25)
	callout.emit("KNOCKDOWN!", &"bad")
	knocked_down.emit(knockdowns)


func _get_up() -> void:
	_down = false
	_untouchable = GET_UP_GRACE
	var short := PlayerStats.max_stamina * GET_UP_STAMINA - PlayerStats.stamina
	if short > 0.0:
		PlayerStats.restore_stamina(short)
	callout.emit("BACK UP!", &"info")


## Stopped for good. `floored` when it was the last knockdown that did it.
func _go_out(floored: bool) -> void:
	_down = true
	_out = true
	_down_time = 0.0
	_leave_clinch()
	_reset_action()
	AudioManager.play(&"knockdown", 1.0, 1.0, 0.25)
	if floored:
		knocked_down.emit(knockdowns)
	knocked_out.emit()


# --- Clinch ----------------------------------------------------------------------------------

## An opponent's grab arrives. Returns false when it closes on air (the fighter slipped it).
func enter_clinch(holder: Node3D) -> bool:
	if not in_bout or _down or clinch != null or _untouchable > 0.0 or _dodge_time < IFRAME_TIME:
		return false
	_reset_action()
	clinch = holder
	clinch_progress = 0.0
	_clinch_window = false
	_clinch_timed = false
	_set_streak(0)
	callout.emit("CLINCHED!", &"bad")
	clinch_changed.emit(true)
	return true


## The holder is bringing a knee up (or has thrown it): a press in this window is a timed one.
func set_clinch_window(open: bool) -> void:
	if open and not _clinch_window:
		_clinch_timed = false
	_clinch_window = open


func is_clinch_window() -> bool:
	return clinch != null and _clinch_window and not _clinch_timed


## The holder let go.
func release_clinch() -> void:
	_leave_clinch()


func _tick_clinch(own: float) -> void:
	if clinch == null:
		return
	if not is_instance_valid(clinch):
		_leave_clinch()
		return
	clinch_progress = maxf(clinch_progress - CLINCH_DECAY * own, 0.0)


## One push against the grip. Mashing works; one push timed with the knee is worth several.
func _struggle() -> void:
	var timed := is_clinch_window()
	if timed:
		_clinch_timed = true
		callout.emit("TIMED!", &"good")
	clinch_progress += CLINCH_TIMED if timed else CLINCH_MASH
	player.arms.shove()
	AudioManager.play_varied(&"block", 0.35)
	if clinch_progress < 1.0:
		return
	var holder := clinch
	_leave_clinch()
	if holder.has_method(&"on_clinch_broken"):
		holder.call(&"on_clinch_broken")
	player.add_shake(0.5)
	AudioManager.play_varied(&"whoosh", 0.9)
	AudioManager.play(&"hit_light", 0.8)
	callout.emit("CLINCH BROKEN!", &"good")


func _leave_clinch() -> void:
	if clinch == null:
		return
	clinch = null
	clinch_progress = 0.0
	_clinch_window = false
	clinch_changed.emit(false)


# --- Third-person body -----------------------------------------------------------------------

## Poses the player's own body (mirror, shadow) to match the fight. Called by the Player every
## physics tick, before it animates the model.
func pose_body(delta: float, stride_phase: float, move_amount: float) -> void:
	var model := player.model
	model.fight_blend = move_toward(model.fight_blend, 1.0 if stance else 0.0, delta * 5.0)
	for glove in _body_gloves:
		glove.visible = model.fight_blend > 0.05
	if model.fight_blend <= 0.0:
		return
	_body.stride_phase = stride_phase
	_body.move_amount = move_amount
	_body.block = move_toward(_body.block, 1.0 if blocking and not guard_low else 0.0, delta * 10.0)
	_body.block_low = move_toward(_body.block_low, 1.0 if blocking and guard_low else 0.0, delta * 10.0)
	_body.rocked = move_toward(_body.rocked, 1.0 if is_rocked() else 0.0, delta * 6.0)
	_body.clinch = move_toward(_body.clinch, 1.0 if clinch != null else 0.0, delta * 8.0)
	_body.knockdown = view_drop
	_body.lean = _slip_lean if _dodge_time < DASH_TIME + 0.1 else 0.0
	if _strike == null:
		_body.clear_strike()
	elif _resolved:
		_body.set_strike(_strike.kind, _strike.side, 0.0, 1.0 - (_strike_time - _startup) / _recovery)
	else:
		var progress := _strike_time / _startup
		_body.set_strike(_strike.kind, _strike.side, progress * 2.5, (progress - 0.4) / 0.6)
	_body.update(delta)
