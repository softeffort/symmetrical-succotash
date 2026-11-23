extends Node
## Scripted player for bout simulations. It sees what a person sees (the opponent's tell, the
## guard label, the distance, the bars), answers after a reaction time and presses the real
## input actions, so every punch goes through `Player._unhandled_input`.
##
## Three skill levels, after the README: the novice reacts slowly, guesses the guard and never
## feints or intercepts; the average player uses every tool some of the time; the skilled one
## reads tells, beats the opponent to the punch and manages the gas tank. A fourth, the masher,
## only walks forward and swings.

const SKILLS := {
	## Walks forward and hammers the buttons: no defence, no pauses.
	"masher": {
		"react": Vector2(0.5, 0.7), "defend": 0.0, "right_guard": 0.5, "slip": 0.0, "slip_lead": Vector2(0.0, 0.4),
		"intercept": 0.0, "feint": 0.0, "spot_feint": 0.0, "read_guard": 0.0, "punish": 0.0, "spam": 1.0,
		"rest": Vector2(0.0, 0.0), "mash": 5.0, "timed": 0.0, "evade_grab": 0.0, "step_out": 0.0, "vary": false,
		"gap": Vector2(0.0, 0.1),
	},
	"novice": {
		"react": Vector2(0.34, 0.5),
		## Chance to do anything at all about a tell.
		"defend": 0.75,
		## Chance the guard goes to the level the strike is aimed at.
		"right_guard": 0.6,
		"slip": 0.1,
		## How long before the impact the slip is pressed (min, max).
		"slip_lead": Vector2(0.0, 0.4),
		"intercept": 0.0,
		"feint": 0.0,
		## Chance to see that a tell has no glow behind it.
		"spot_feint": 0.0,
		## Chance to aim at the level the opponent's guard leaves open.
		"read_guard": 0.25,
		## Chance to jump on a staggered, rocked or countered opponent.
		"punish": 0.35,
		## Chance to keep swinging past the third punch.
		"spam": 0.45,
		## Stamina share at which the bot stops attacking, and at which it starts again.
		"rest": Vector2(0.06, 0.3),
		## Presses a second in a clinch, and the chance of the timed press.
		"mash": 4.5,
		"timed": 0.0,
		"evade_grab": 0.1,
		## Chance to step out after a combination.
		"step_out": 0.1,
		"vary": false,
		## Pause between attacks (min, max).
		"gap": Vector2(0.5, 1.2),
	},
	"average": {
		"react": Vector2(0.24, 0.36),
		"defend": 0.9,
		"right_guard": 0.8,
		"slip": 0.25,
		"slip_lead": Vector2(0.03, 0.3),
		"intercept": 0.2,
		"feint": 0.12,
		"spot_feint": 0.5,
		"read_guard": 0.6,
		"punish": 0.7,
		"spam": 0.08,
		"rest": Vector2(0.22, 0.5),
		"mash": 6.5,
		"timed": 0.35,
		"evade_grab": 0.4,
		"step_out": 0.4,
		"vary": false,
		"gap": Vector2(0.45, 0.9),
	},
	"skilled": {
		"react": Vector2(0.17, 0.25),
		"defend": 0.97,
		"right_guard": 0.93,
		"slip": 0.35,
		"slip_lead": Vector2(0.05, 0.2),
		"intercept": 0.4,
		"feint": 0.25,
		"spot_feint": 0.85,
		"read_guard": 0.9,
		"punish": 0.95,
		"spam": 0.0,
		"rest": Vector2(0.28, 0.55),
		"mash": 8.0,
		"timed": 0.8,
		"evade_grab": 0.75,
		"step_out": 0.6,
		"vary": true,
		"gap": Vector2(0.42, 0.75),
	},
}
const PRESS_GAP := Vector2(0.2, 0.27)
const JAB_REACH := 1.8
const HOLD_RANGE := 1.7

var skill: Dictionary = SKILLS["average"]
var rng := RandomNumberGenerator.new()
var player: Player
var combat: CombatController
var ring: RingManager

var _time := 0.0
var _held := {}
var _taps: Array[StringName] = []
var _foe_state := -1
var _threat := {}
var _dodge_at := -1.0
var _guard_until := 0.0
var _guard_low := false
var _sequence: Array = []
var _sequence_at := 0.0
var _next_attack := 0.0
var _resting := false
var _retreat_until := 0.0
var _strafe := 1.0
var _strafe_until := 0.0
var _mash_at := 0.0
var _timed_tried := false
var _opening_seen := false
var _last_sequence := ""
var _feint_at := -1.0
var _feinted_at := -9.0


func setup(owner_player: Player, ring_manager: RingManager, level: String, seed_value: int) -> void:
	player = owner_player
	combat = player.combat
	ring = ring_manager
	skill = SKILLS[level]
	rng.seed = seed_value * 7919 + 17


func _physics_process(delta: float) -> void:
	if player == null:
		return
	_time += delta
	for action in _taps:
		_send(action, false)
	_taps.clear()
	var foe := ring.opponent
	if ring.state != RingManager.State.FIGHT or foe == null or not is_instance_valid(foe):
		_idle()
		return
	var offset := foe.global_position - player.global_position
	offset.y = 0.0
	var distance := offset.length()
	if combat.clinch == null:
		player._yaw = atan2(-offset.x, -offset.z)
	else:
		_struggle()
		_stand_still()
		return
	_perceive(foe)
	_defend(foe, distance)
	_attack(foe, distance)
	_move(foe, distance)


# --- Input -----------------------------------------------------------------------------------

func _send(action: StringName, pressed: bool) -> void:
	var event := InputEventAction.new()
	event.action = action
	event.pressed = pressed
	Input.parse_input_event(event)


func _tap(action: StringName) -> void:
	_send(action, true)
	_taps.append(action)


func _hold(action: StringName, on: bool) -> void:
	if bool(_held.get(action, false)) == on:
		return
	_held[action] = on
	_send(action, on)


func _stand_still() -> void:
	for action: StringName in [&"move_forward", &"move_back", &"move_left", &"move_right", &"block", &"body_mod"]:
		_hold(action, false)


func _idle() -> void:
	_stand_still()
	_threat = {}
	_sequence.clear()
	_foe_state = -1
	_dodge_at = -1.0
	_feint_at = -1.0
	_guard_until = 0.0
	_resting = false
	_next_attack = _time + 0.3


# --- Reading the opponent --------------------------------------------------------------------

func _perceive(foe: EnemyFighter) -> void:
	var state := foe.state
	if state == _foe_state:
		return
	_foe_state = state
	match state:
		EnemyFighter.State.WINDUP:
			# A counter out of a slip showed its tell when the slip began.
			if foe._wound <= 0.0 or _threat.is_empty():
				_notice(foe._move_kind, true, "strike")
		EnemyFighter.State.FEINT:
			_notice(foe._move_kind, false, "strike")
		EnemyFighter.State.SLIP:
			if foe._slip_counter != &"":
				_notice(foe._slip_counter, true, "strike")
		EnemyFighter.State.CROUCH:
			_notice(&"", true, "burst")
		EnemyFighter.State.REACH:
			_notice(&"", true, "grab")
		EnemyFighter.State.STAGGER, EnemyFighter.State.ROCKED:
			_opening_seen = false


func _notice(kind: StringName, real: bool, what: String) -> void:
	# The next punch of a combination already being watched is answered a little sooner.
	var follow := not _threat.is_empty() and _time - float(_threat["seen"]) < 1.3
	var react := rng.randf_range(skill["react"].x, skill["react"].y) * (0.8 if follow else 1.0)
	_threat = {"seen": _time, "at": _time + react, "kind": kind, "real": real, "what": what, "done": false}


## Seconds until the strike being shown lands, as far as the bot can tell.
func _time_to_impact(foe: EnemyFighter) -> float:
	match foe.state:
		EnemyFighter.State.WINDUP:
			return maxf(foe._windup_time - foe._state_time, 0.0) + 0.1
		EnemyFighter.State.SLIP:
			return maxf(foe._slip_time - foe._state_time, 0.0) + 0.2
		EnemyFighter.State.CROUCH:
			return maxf(EnemyFighter.CROUCH_TIME - foe._state_time, 0.0) + 0.38
		EnemyFighter.State.STRIKE:
			return 0.05
	return 0.3


# --- Defence ---------------------------------------------------------------------------------

func _defend(foe: EnemyFighter, distance: float) -> void:
	if _dodge_at >= 0.0 and _time >= _dodge_at:
		_dodge_at = -1.0
		_slip()
	if not _threat.is_empty() and not _threat["done"] and _time >= float(_threat["at"]):
		_threat["done"] = true
		_answer(foe, distance)
	if not _threat.is_empty() and _time - float(_threat["seen"]) > 1.6:
		_threat = {}
	var guarding := _time < _guard_until and _sequence.is_empty()
	_hold(&"block", guarding)
	_hold(&"body_mod", guarding and _guard_low)


func _answer(foe: EnemyFighter, distance: float) -> void:
	var real: bool = _threat["real"]
	if not real and rng.randf() < skill["spot_feint"]:
		return
	if rng.randf() > skill["defend"]:
		return
	var busy := foe.state == EnemyFighter.State.WINDUP or foe.state == EnemyFighter.State.SLIP or foe.state == EnemyFighter.State.CROUCH or foe.state == EnemyFighter.State.STRIKE or foe.state == EnemyFighter.State.FEINT or foe.state == EnemyFighter.State.REACH
	if not busy:
		# Too late: whatever it was has already happened.
		return
	match String(_threat["what"]):
		"grab":
			if rng.randf() < skill["evade_grab"]:
				_dodge_at = _time + maxf(EnemyFighter.REACH_TIME - foe._state_time - rng.randf_range(0.08, 0.26), 0.0)
			return
		"burst":
			if distance <= JAB_REACH and rng.randf() < skill["intercept"] * 1.5 and _free_to_punch():
				_begin_sequence(["L", "R"])
			else:
				_raise_guard(false, _time_to_impact(foe) + 0.3)
			return
	var lands_in := _time_to_impact(foe)
	var body := Strike.zone_of(_threat["kind"]) == Strike.Zone.BODY
	var roll := rng.randf()
	if roll < skill["intercept"] and foe.state != EnemyFighter.State.SLIP and distance <= JAB_REACH and lands_in > 0.14 and _free_to_punch() and not combat.is_sloppy():
		# Beat him to the punch: the jab is home before his hand arrives.
		_begin_sequence(["L", "R"] if lands_in > 0.34 else ["L"])
		return
	roll -= skill["intercept"]
	if roll < skill["slip"]:
		_sequence.clear()
		_dodge_at = _time + maxf(lands_in - rng.randf_range(skill["slip_lead"].x, skill["slip_lead"].y), 0.0)
		return
	_raise_guard(body if rng.randf() < skill["right_guard"] else not body, lands_in + 0.22)


func _raise_guard(low: bool, seconds: float) -> void:
	_sequence.clear()
	_guard_low = low
	_guard_until = _time + seconds


func _slip() -> void:
	# Mostly sideways; straight back now and then.
	var side := rng.randf()
	_hold(&"move_forward", false)
	_hold(&"move_back", false)
	_hold(&"move_left", side < 0.4)
	_hold(&"move_right", side >= 0.4 and side < 0.8)
	_hold(&"block", false)
	_guard_until = 0.0
	_tap(&"dodge")
	_strafe_until = _time + 0.12
	_opening_seen = false


# --- Offence ---------------------------------------------------------------------------------

func _free_to_punch() -> bool:
	return combat.can_act() and not combat.is_rocked() and not combat.blocking and not PlayerStats.is_exhausted


func _attack(foe: EnemyFighter, distance: float) -> void:
	if foe.state == EnemyFighter.State.DOWN or foe.state == EnemyFighter.State.OUT or not combat.can_act() or combat.is_rocked():
		_sequence.clear()
		return
	if _feint_at >= 0.0 and _time >= _feint_at:
		_feint_at = -1.0
		_feinted_at = _time
		_tap(&"block")
	# A sequence already under way runs to its end unless a tell interrupts it.
	if not _sequence.is_empty():
		if _time >= _sequence_at:
			_press(_sequence.pop_front())
			_sequence_at = _time + rng.randf_range(PRESS_GAP.x, PRESS_GAP.y)
			if _sequence.is_empty():
				_after_sequence()
		return
	if _time < _guard_until or _dodge_at >= 0.0:
		return
	if not _threat.is_empty() and not _threat["done"]:
		# Something is coming and the answer is still on its way.
		return
	var ratio := PlayerStats.get_stamina_ratio()
	if _resting:
		if ratio < skill["rest"].y and not (ratio > skill["rest"].x and combat.is_counter_ready()):
			return
		_resting = false
	elif ratio <= skill["rest"].x or PlayerStats.is_exhausted:
		_resting = true
		return
	var opening := foe.state == EnemyFighter.State.STAGGER or foe.state == EnemyFighter.State.ROCKED or combat.is_counter_ready() or (_time - _feinted_at < 0.5 and foe.brain._committed > 0.0)
	if opening and not _opening_seen:
		_opening_seen = true
		if rng.randf() < skill["punish"]:
			_next_attack = 0.0
	if not opening:
		_opening_seen = false
	if _time < _next_attack or distance > JAB_REACH:
		return
	_begin_sequence(_pick_sequence(foe, opening))


func _begin_sequence(keys: Array) -> void:
	_sequence = keys.duplicate()
	_sequence_at = _time
	_guard_until = 0.0


func _press(key: String) -> void:
	match key:
		"~":
			pass
		"K":
			_tap(&"kick")
		_:
			if key == "l" or key == "r":
				_send(&"body_mod", true)
				_taps.append(&"body_mod")
				_held[&"body_mod"] = false
			_tap(&"strike_left" if key.to_upper() == "L" else &"strike_right")
			if not _sequence.is_empty() and String(_sequence[0]) == "~":
				_sequence.pop_front()
				_feint_at = _time + rng.randf_range(0.04, 0.1)


func _after_sequence() -> void:
	_next_attack = _time + rng.randf_range(skill["gap"].x, skill["gap"].y)
	if rng.randf() < skill["spam"]:
		# Keeps swinging: no pause, so the punches turn sloppy.
		_sequence = [["L", "R"].pick_random(), ["L", "R"].pick_random()]
		return
	if rng.randf() < skill["step_out"]:
		_retreat_until = _time + rng.randf_range(0.25, 0.45)


func _pick_sequence(foe: EnemyFighter, opening: bool) -> Array:
	if opening:
		if foe.state == EnemyFighter.State.ROCKED:
			# Any heavy clean blow puts a rocked fighter down.
			return ["R"]
		return ["R", "L", "R"] if skill["read_guard"] > 0.5 else ["L", "R"]
	if rng.randf() < skill["feint"]:
		return ["L", "~"]
	var guard := foe.guard_mode if foe.is_guarding() else EnemyFighter.Guard.NONE
	var pool: Array = [["L"], ["R"], ["L", "R"], ["L", "L"], ["R", "R"], ["L", "R", "L"], ["l"], ["K"]]
	if rng.randf() < skill["read_guard"]:
		match guard:
			EnemyFighter.Guard.HIGH:
				pool = [["l", "r"], ["l", "R"], ["r", "L", "R"], ["L", "L", "R"], ["K"]]
			EnemyFighter.Guard.LOW:
				pool = [["L", "R"], ["R", "L", "R"], ["L", "L"], ["L", "R", "L"]]
			_:
				pool = [["L", "R"], ["R", "L", "R"], ["l", "R"], ["L", "L", "R"], ["L"]]
	var picked: Array = pool.pick_random()
	if skill["vary"] and "".join(picked) == _last_sequence:
		picked = pool.pick_random()
	_last_sequence = "".join(picked)
	return picked


# --- Footwork and the clinch -----------------------------------------------------------------

func _move(foe: EnemyFighter, distance: float) -> void:
	if _time < _strafe_until:
		return
	var forward := false
	var back := false
	if combat.is_rocked() or _resting or _time < _retreat_until:
		back = true
	elif _time < _guard_until:
		pass
	elif foe.state == EnemyFighter.State.DOWN:
		back = distance < 2.2
	elif distance > HOLD_RANGE:
		forward = true
	elif distance < 1.2:
		back = true
	_hold(&"move_forward", forward)
	_hold(&"move_back", back)
	# Circles away while backing off, so the fence does not come up behind.
	var circling: bool = back and float(skill["step_out"]) > 0.3
	_hold(&"move_left", circling and _strafe < 0.0)
	_hold(&"move_right", circling and _strafe > 0.0)
	if rng.randf() < 0.004:
		_strafe = -_strafe


func _struggle() -> void:
	if not combat._clinch_window:
		_timed_tried = false
	if combat.is_clinch_window() and not _timed_tried:
		_timed_tried = true
		if rng.randf() < skill["timed"]:
			_tap(&"clinch_break")
			return
	if _time >= _mash_at:
		_mash_at = _time + rng.randf_range(0.8, 1.2) / float(skill["mash"])
		_tap(&"clinch_break")
