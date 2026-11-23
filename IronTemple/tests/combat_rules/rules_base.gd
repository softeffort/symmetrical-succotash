extends Node
## Shared harness for the Step 5 fight rule runners. A runner extends this script and
## implements `run()`; the harness boots the real main scene, gives helpers to start bouts,
## script the opponent, press inputs through Input.parse_input_event and record what happened,
## then prints `RESULT passed=N failed=M` and exits non-zero on any failure.
##
## The opponent is made passive by `fresh()` (a PuppetBrain with a style that never chooses
## anything), so the scenario decides every guard, attack and slip. Nothing here re-implements
## game rules: checks read Strike objects, signals, state enums, stats and HUD nodes.

const PuppetBrain := preload("res://tests/combat_rules/puppet_brain.gd")
const DT := 1.0 / 60.0

var passed := 0
var failed := 0
var budget_ms := 230000

var main: Node = null
var ring: RingManager = null
var player: Player = null
var combat: CombatController = null
var hud: CombatHUD = null
var opp: EnemyFighter = null
var brain = null
## Distance (centre to centre) the opponent is held at in front of the player; 0 = free.
var anchor := 0.0
## Runners that play several bouts in a row (payout, streaks) keep the career between them.
var keep_career := false

var game_time := 0.0
var started: Array = []
var started_t: Array = []
var resolved: Array = []
var resolved_t: Array = []
var resolved_ostate: Array = []
var callouts: Array = []
var events: Array = []
var opp_states: Array = []
var flags: Array = []

var _last_opp_state := -1
var _prev_time := 0.0
## Game time at each physics frame (frame number -> seconds), for the tell measurements.
var ftime := {}
var track_tells := false
var cues: Array = []
var _cue_vis := false
var _cue_text := ""
## The opponent's state at the start of this idle frame, i.e. before the player's strike resolves.
var pre_state := -1
var _last_flags := {}
var _t0 := 0


func _ready() -> void:
	seed(20260101)
	_t0 = Time.get_ticks_msec()
	await get_tree().process_frame
	main = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	for i in 45:
		await get_tree().physics_frame
	ring = get_tree().get_first_node_in_group(&"ring") as RingManager
	player = get_tree().get_first_node_in_group(&"player") as Player
	hud = get_tree().get_first_node_in_group(&"combat_hud") as CombatHUD
	check("harness: ring, player and HUD exist in main.tscn", ring != null and player != null and hud != null, "ring=%s player=%s hud=%s" % [ring, player, hud])
	if ring == null or player == null or hud == null:
		finish()
		return
	combat = player.combat
	_connect_player()
	await run()
	finish()


## Override in the runner.
func run() -> void:
	pass


func _process(_delta: float) -> void:
	pre_state = int(opp.state) if opp != null and is_instance_valid(opp) else -1
	if Time.get_ticks_msec() - _t0 > budget_ms:
		print("FAIL watchdog: runner exceeded %d ms" % budget_ms)
		failed += 1
		print("RESULT passed=%d failed=%d" % [passed, failed])
		get_tree().quit(2)


func _physics_process(delta: float) -> void:
	_prev_time = game_time
	game_time += delta
	ftime[Engine.get_physics_frames()] = game_time
	if track_tells and opp != null and is_instance_valid(opp):
		_sample_cue()
	if opp != null and is_instance_valid(opp):
		if anchor > 0.0:
			_place()
		if int(opp.state) != _last_opp_state:
			_last_opp_state = int(opp.state)
			opp_states.append([game_time, _last_opp_state])
	if combat != null:
		_flag("down", combat.is_down())
		_flag("rocked", combat.is_rocked())
		_flag("blocking", combat.blocking)
		_flag("clinch", combat.clinch != null)
		_flag("stun", combat._stun > 0.0)
		_flag("striking", combat.is_striking())
		_flag("slow", Engine.time_scale < 0.99)


func _flag(name: String, value: bool) -> void:
	if _last_flags.get(name, false) != value:
		_last_flags[name] = value
		flags.append([game_time, name, value])


func _connect_player() -> void:
	combat.strike_started.connect(func(s: Strike) -> void:
		started.append(s)
		started_t.append(game_time)
		ev("started", s))
	combat.strike_resolved.connect(func(s: Strike) -> void:
		resolved.append(s)
		resolved_t.append(game_time)
		resolved_ostate.append(pre_state)
		ev("resolved", s))
	combat.callout.connect(func(text: String, _kind: StringName) -> void:
		callouts.append(text)
		ev("callout", text))
	combat.feinted.connect(func(s: Strike) -> void: ev("feinted", s))
	combat.dodged.connect(func(d: int) -> void: ev("dodged", d))
	combat.damage_taken.connect(func(a: float, b: bool) -> void: ev("damage_taken", [a, b]))
	combat.guard_broken.connect(func() -> void: ev("guard_broken"))
	combat.knocked_down.connect(func(n: int) -> void: ev("p_knocked_down", n))
	combat.knocked_out.connect(func() -> void: ev("p_knocked_out"))
	combat.clinch_changed.connect(func(a: bool) -> void: ev("clinch_changed", a))
	combat.counter_opened.connect(func(s: float) -> void: ev("counter_opened", s))
	combat.combo_landed.connect(func(t: String) -> void: ev("combo_landed", t))
	ring.bout_finished.connect(func(_p: FighterProfile, won: bool) -> void: ev("bout_finished", won))
	ring.bout_started.connect(func(_p: FighterProfile) -> void: ev("bout_started"))


func ev(name: String, value: Variant = null) -> void:
	events.append({"n": name, "t": game_time, "f": Engine.get_physics_frames(), "v": value})


func count_ev(name: String) -> int:
	var n := 0
	for e: Dictionary in events:
		if e["n"] == name:
			n += 1
	return n


func last_ev(name: String) -> Variant:
	for i in range(events.size() - 1, -1, -1):
		if events[i]["n"] == name:
			return events[i]["v"]
	return null


func ev_time(name: String, nth: int = 0) -> float:
	var k := 0
	for e: Dictionary in events:
		if e["n"] == name:
			if k == nth:
				return e["t"]
			k += 1
	return -1.0


func clear_logs() -> void:
	started.clear()
	started_t.clear()
	resolved.clear()
	resolved_t.clear()
	resolved_ostate.clear()
	callouts.clear()
	events.clear()
	opp_states.clear()
	flags.clear()
	_last_opp_state = -1
	_last_flags.clear()


# --- Checks ----------------------------------------------------------------------------------

func check(name: String, ok: bool, detail: String = "") -> bool:
	if ok:
		passed += 1
		print("PASS ", name)
	else:
		failed += 1
		print("FAIL %s: %s" % [name, detail])
	return ok


func check_near(name: String, observed: float, expected: float, tol: float, note: String = "") -> bool:
	return check(name, absf(observed - expected) <= tol, "observed %.4f vs expected %.4f (+-%.4f) %s" % [observed, expected, tol, note])


func check_range(name: String, observed: float, low: float, high: float, note: String = "") -> bool:
	return check(name, observed >= low and observed <= high, "observed %.4f vs expected [%.4f, %.4f] %s" % [observed, low, high, note])


func check_eq(name: String, observed: Variant, expected: Variant, note: String = "") -> bool:
	return check(name, observed == expected, "observed %s vs expected %s %s" % [observed, expected, note])


func finish() -> void:
	print("RESULT passed=%d failed=%d" % [passed, failed])
	get_tree().quit(1 if failed > 0 else 0)


# --- Time ------------------------------------------------------------------------------------

func frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func secs(s: float) -> void:
	await frames(maxi(roundi(s / DT), 0))


func until(cond: Callable, max_frames: int = 600) -> bool:
	for i in max_frames:
		if cond.call():
			return true
		await get_tree().physics_frame
	return cond.call()


# --- Input -----------------------------------------------------------------------------------

func act(action: StringName, pressed: bool = true) -> void:
	var event := InputEventAction.new()
	event.action = action
	event.pressed = pressed
	event.strength = 1.0 if pressed else 0.0
	Input.parse_input_event(event)


func tap(action: StringName, hold_frames: int = 2) -> void:
	act(action, true)
	await frames(hold_frames)
	act(action, false)


func release_all() -> void:
	for a in [&"strike_left", &"strike_right", &"kick", &"block", &"dodge", &"body_mod", &"clinch_break", &"move_left", &"move_right", &"move_forward", &"move_back"]:
		if Input.is_action_pressed(a):
			act(a, false)


# --- Bouts -----------------------------------------------------------------------------------

## Starts a fresh bout against ladder fighter `index` (or `profile`) and waits for "FIGHT!".
## `passive` swaps in a PuppetBrain whose style never acts; `dist` holds the opponent in front
## of the player at that centre-to-centre distance (0 leaves it free).
func fresh(index: int = 4, passive: bool = true, profile: FighterProfile = null, dist: float = 1.4) -> void:
	release_all()
	Engine.time_scale = 1.0
	if not keep_career:
		PlayerStats.reset_career()
	PlayerStats.max_stamina = 100.0
	PlayerStats.stamina = PlayerStats.max_stamina
	PlayerStats.is_exhausted = false
	PlayerStats.injury_timer = 0.0
	PlayerStats.preworkout_timer = 0.0
	var chosen: FighterProfile = profile if profile != null else FighterRoster.ladder()[index]
	anchor = 0.0
	brain = null
	ring.start_bout(chosen)
	opp = ring.opponent
	clear_logs()
	if passive:
		make_passive()
	opp.defeated.connect(func() -> void: ev("o_defeated"))
	opp.knocked_down.connect(func(n: int) -> void: ev("o_knocked_down", n))
	var ok := await until(func() -> bool: return ring.state == RingManager.State.FIGHT, 400)
	if not ok:
		check("harness: bout reaches FIGHT", false, "ring state %s" % ring.state)
	if dist > 0.0:
		engage(dist)
	await frames(2)


func make_passive() -> void:
	var style := FightStyle.new()
	style.block_reaction = 0.0
	style.attack_delay = Vector2(9999.0, 9999.0)
	style.move_speed = 0.0
	opp.profile.style = style
	opp.profile.alt_style = null
	opp.profile.adaptive = false
	brain = PuppetBrain.new(opp)
	brain.style = style
	opp.brain = brain
	opp.on_style_changed()


func engage(d: float) -> void:
	anchor = d
	player._yaw = 0.0
	_place()


func _place() -> void:
	var p := player.global_position
	opp.global_position = Vector3(p.x, opp.global_position.y, p.z - anchor)
	opp.face(p)


func free_opponent() -> void:
	anchor = 0.0


## Full health, chin and stamina for the player; keeps a scenario from ending the bout early.
func reset_player() -> void:
	combat.health = combat.max_health
	combat.chin.reset()
	PlayerStats.stamina = PlayerStats.max_stamina
	PlayerStats.is_exhausted = false


func wait_free(max_frames: int = 300) -> bool:
	return await until(func() -> bool: return opp.state == EnemyFighter.State.FOOTWORK, max_frames)


## Base damage the player's move would do at full power (before the 0.94 to 1.06 spread).
func base_damage(kind: StringName) -> float:
	var move: Dictionary = CombatController.MOVES[kind]
	var power: float = PlayerStats.get_kick_power() if (kind == Strike.KICK or kind == Strike.KNEE) else PlayerStats.get_punch_power()
	return float(move["damage"]) * power


## dealt / (base damage), i.e. the effective multiplier of a player strike.
func mult(strike: Strike) -> float:
	return strike.dealt / base_damage(strike.kind)


func last_landing() -> Dictionary:
	if brain == null or brain.landings.is_empty():
		return {}
	return brain.landings[brain.landings.size() - 1]


## Seconds the opponent spent in `state` the nth time it entered it (-1 if never / unfinished).
func opp_state_duration(state: int, nth: int = 0) -> float:
	var k := 0
	for i in opp_states.size():
		if opp_states[i][1] == state:
			if k == nth:
				if i + 1 >= opp_states.size():
					return -1.0
				return opp_states[i + 1][0] - opp_states[i][0]
			k += 1
	return -1.0


func opp_entered(state: int, nth: int = 0) -> float:
	var k := 0
	for s: Array in opp_states:
		if s[1] == state:
			if k == nth:
				return s[0]
			k += 1
	return -1.0


## Seconds the player flag `name` stayed true the nth time it became true (-1 if unfinished).
func flag_duration(name: String, nth: int = 0) -> float:
	var k := 0
	for i in flags.size():
		if flags[i][1] == name and flags[i][2]:
			if k == nth:
				for j in range(i + 1, flags.size()):
					if flags[j][1] == name and not flags[j][2]:
						return flags[j][0] - flags[i][0]
				return -1.0
			k += 1
	return -1.0


func flag_start(name: String, nth: int = 0) -> float:
	var k := 0
	for f: Array in flags:
		if f[1] == name and f[2]:
			if k == nth:
				return f[0]
			k += 1
	return -1.0


## Throws `kind` from the player's side the way the buttons do, and returns the Strike thrown.
## kinds: jab, hook, cross, overhand, body_hook, body_cross, kick. Chains are the caller's job.
func button(name: String) -> void:
	match name:
		"L":
			await tap(&"strike_left")
		"R":
			await tap(&"strike_right")
		"l":
			act(&"body_mod", true)
			await tap(&"strike_left")
			act(&"body_mod", false)
		"r":
			act(&"body_mod", true)
			await tap(&"strike_right")
			act(&"body_mod", false)
		"K":
			await tap(&"kick")


## Presses a chain of buttons spaced `gap` seconds apart ("LLR", "RLR", "lr" ...).
func chain(keys: String, gap: float = 0.22) -> void:
	for i in keys.length():
		await button(keys[i])
		if i < keys.length() - 1:
			await secs(gap)


## Records every time the opponent's cue label appears (or changes), with the glove glow seen
## while it was up. Times are game time; the cue is set one tick before it is observed.
func _sample_cue() -> void:
	var visible_now: bool = opp.telegraph.visible
	var text_now: String = opp.telegraph.text
	var glow: float = maxf(opp._glove_materials[0].emission_energy_multiplier, opp._glove_materials[1].emission_energy_multiplier)
	if visible_now and (not _cue_vis or text_now != _cue_text):
		cues.append({"t": _prev_time, "text": text_now, "peak": 0.0, "last": 0.0, "seen": 0, "dark_frames": 0})
	if visible_now and not cues.is_empty():
		var c: Dictionary = cues[cues.size() - 1]
		c["peak"] = maxf(c["peak"], glow)
		c["last"] = glow
		c["seen"] += 1
		if c["seen"] > 6 and glow <= 0.0:
			c["dark_frames"] += 1
	_cue_vis = visible_now
	_cue_text = text_now


func clear_cues() -> void:
	cues.clear()
	_cue_vis = false
	_cue_text = ""


## Game time of the nth strike the puppet's fighter landed.
func land_time(n: int) -> float:
	if brain == null or brain.landings.size() <= n:
		return -1.0
	return ftime.get(brain.landings[n]["frame"], -1.0)
