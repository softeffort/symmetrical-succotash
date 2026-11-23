extends "res://tests/walkthrough/walk.gd"
## Step 2: first-floor training. Every station type is entered with E and left again, the reps
## pay out through PlayerStats, the pump rises and decays, an overloaded bar injures the lifter
## and the HUD labels follow the numbers.

var overlay: WorkoutOverlay
var reps_log: Array[Dictionary] = []
var popups: Array[String] = []
var level_events: Array[int] = []
var rank_events: Array[String] = []
var _prev_pump := 0.0
var _last_tap := -100
var second_wind: Array[bool] = []
var _seen_level := 1


func _init() -> void:
	area = "first_floor"


func run() -> void:
	seed(4242)
	wipe_career()
	await boot()
	overlay = get_tree().get_first_node_in_group(&"workout_overlay") as WorkoutOverlay
	PlayerStats.rep_completed.connect(_on_rep)
	PlayerStats.popup_requested.connect(func(text: String, _kind: StringName) -> void: popups.append(text))
	PlayerStats.level_up.connect(func(level: int) -> void: level_events.append(level))
	PlayerStats.rank_changed.connect(func(title: String) -> void: rank_events.append(title))
	PlayerStats.xp_changed.connect(_on_xp_changed)
	await place_player(gym_point(0.0, 3.0), 0.0)

	await _station_sweep()
	await _warmup_mat()
	await _bench_press()
	await _squat_and_deadlift()
	await _curls()
	await _treadmill()
	await _level_up_and_rank()
	await _overload_injury()
	_hud_matches("end of session")


func _on_xp_changed(_xp: float, _next: float) -> void:
	if PlayerStats.level != _seen_level:
		_seen_level = PlayerStats.level
		second_wind.append(is_equal_approx(PlayerStats.stamina, PlayerStats.max_stamina))


func _on_rep(perfect: bool) -> void:
	reps_log.append({"perfect": perfect, "pump_delta": PlayerStats.pump_level - _prev_pump})
	_prev_pump = PlayerStats.pump_level


func _snapshot() -> Dictionary:
	return {"arms": PlayerStats.muscle_arms, "torso": PlayerStats.muscle_torso, "legs": PlayerStats.muscle_legs,
		"strength": PlayerStats.strength, "max_stamina": PlayerStats.max_stamina, "level": PlayerStats.level,
		"xp": PlayerStats.xp, "reps": reps_log.size()}


## Total XP earned, independent of level-ups.
func _xp_total() -> float:
	var total := PlayerStats.xp
	for level in range(1, PlayerStats.level):
		total += roundf(PlayerStats.XP_BASE * pow(level, PlayerStats.XP_CURVE))
	return total


func _hud_matches(when: String) -> void:
	var ok := hud.rank_label.text == PlayerStats.get_profile_title() and hud.level_label.text == "Lvl %d" % PlayerStats.level
	check("HUD profile (%s): rank label '%s' and level label match PlayerStats" % [when, hud.rank_label.text], ok, "rank='%s' want '%s' level='%s'" % [hud.rank_label.text, PlayerStats.get_profile_title(), hud.level_label.text])
	var want_xp := "%d / %d XP" % [floori(PlayerStats.xp), roundi(PlayerStats.xp_to_next())]
	check("HUD XP (%s): label '%s' and bar match" % [when, hud.xp_label.text], hud.xp_label.text == want_xp and near(hud.xp_bar.value, PlayerStats.xp, 0.01) and near(hud.xp_bar.max_value, PlayerStats.xp_to_next(), 0.01), "label='%s' want '%s' bar=%.2f/%.2f" % [hud.xp_label.text, want_xp, hud.xp_bar.value, hud.xp_bar.max_value])
	check("HUD stamina (%s): bar tracks stamina %.1f/%.1f" % [when, PlayerStats.stamina, PlayerStats.max_stamina], near(hud.stamina_bar.value, PlayerStats.stamina, 0.5) and near(hud.stamina_bar.max_value, PlayerStats.max_stamina, 0.01), "bar=%.2f/%.2f stats=%.2f/%.2f" % [hud.stamina_bar.value, hud.stamina_bar.max_value, PlayerStats.stamina, PlayerStats.max_stamina])
	check("HUD pump (%s): label '%s' and bar match the pump" % [when, hud.pump_label.text], hud.pump_label.text == "x%.1f" % PlayerStats.get_gain_multiplier() and near(hud.pump_bar.value, PlayerStats.pump_level, 0.5), "label='%s' want 'x%.1f' bar=%.1f pump=%.1f" % [hud.pump_label.text, PlayerStats.get_gain_multiplier(), hud.pump_bar.value, PlayerStats.pump_level])


# --- Every station ---------------------------------------------------------------------------

func _station_sweep() -> void:
	var all: Array = get_tree().get_nodes_in_group(&"gym_stations")
	check("the weight room has 17 stations (3 mats, 3 bench presses, 2 squat racks, 1 deadlift, 3 curl stations, 5 treadmills)", all.size() == 17, "found %d" % all.size())
	var index := 0
	for node in all:
		var st := node as WorkoutStation
		index += 1
		var label := "%s #%d (%s at %.1f, %.1f)" % [st.title, index, st.station_type, st.global_position.x, st.global_position.z + 255.0]
		await place_player(gym_point(0.0, 3.0), 0.0)
		var entered := await use_station(st)
		check("station sweep: E seats the player at %s, prompt '%s', overlay open" % [label, last_prompt], entered and last_prompt == st.title and overlay.visible and overlay.title_label.text == st.title.to_upper(), "entered=%s prompt='%s' overlay=%s '%s'" % [entered, last_prompt, overlay.visible, overlay.title_label.text])
		if not entered:
			continue
		var left := await leave_station(st, KEY_E if index % 2 == 0 else KEY_ESCAPE)
		check("station sweep: leaving %s hands control back (overlay closed, walk away works)" % label, left and not overlay.visible and await walks_away_from(st), "left=%s overlay=%s controls=%s" % [left, overlay.visible, player.controls_enabled])


# --- Warm-up mat -----------------------------------------------------------------------------

func _mat_rep(mat: WarmupStation) -> bool:
	await until(func() -> bool: return mat._recover <= 0.0 and mat.charge <= 0.02, 3.0)
	var reps_before := mat.reps
	key_down(KEY_SPACE)
	for i in 400:
		await get_tree().physics_frame
		if absf(mat.charge - mat._zone_centre) <= mat.ZONE_HALF_WIDTH * 0.35:
			break
	key_up(KEY_SPACE)
	await secs(0.2)
	return mat.reps > reps_before


func _warmup_mat() -> void:
	var mats := stations_of(&"warmup")
	check("three warm-up mats exist on the weight-room floor", mats.size() == 3, "found %d" % mats.size())
	var mat := mats[0] as WarmupStation
	var entered := await use_station(mat)
	check("warm-up mat: crosshair prompt reads '%s'" % mat.title, last_prompt == mat.title, "prompt='%s'" % last_prompt)
	check("warm-up mat: E seats the player on the mat", entered)
	check("warm-up mat: workout overlay opens with the station title", overlay.visible and overlay.title_label.text == mat.title.to_upper(), "visible=%s title='%s'" % [overlay.visible, overlay.title_label.text])
	check("warm-up mat starts on STRETCH", mat.exercise == WarmupStation.Exercise.STRETCH)
	var before := _snapshot()
	var progress_seen := 0.0
	var good := 0
	for i in 8:
		if await _mat_rep(mat):
			good += 1
		if i == 0:
			progress_seen = PlayerStats.warmup_progress
			await frames(2)
			check("stretch rep fills the warm-up bar and the HUD shows 'WARMING UP'", progress_seen > 0.0 and hud.warmup_badge.visible and hud.warmup_label.text.begins_with("WARMING UP"), "progress=%.2f badge=%s label='%s'" % [progress_seen, hud.warmup_badge.visible, hud.warmup_label.text])
		if PlayerStats.is_warmed_up():
			break
	await frames(3)
	check("stretching in the zone completes reps (%d)" % good, good >= 3, "good reps=%d" % good)
	check("stretching gives the Warmed Up status (about 300 s)", PlayerStats.is_warmed_up() and PlayerStats.warmup_timer > 290.0 and PlayerStats.warmup_timer <= 300.0, "timer=%.1f" % PlayerStats.warmup_timer)
	check("HUD shows the WARMED UP badge with a countdown", hud.warmup_badge.visible and hud.warmup_label.text.begins_with("WARMED UP") and ":" in hud.warmup_label.text, "label='%s'" % hud.warmup_label.text)
	check("a 'WARMED UP!' popup was shown", popups.has("WARMED UP!"))
	check("objective follows the warm-up ('Warmed up: lift, curl and run...')", GameState.objective.begins_with("Warmed up:") and hud.objective_label.text == GameState.objective, "objective='%s'" % GameState.objective)
	check("stretching earned XP", _xp_total() > 0.0)
	# Push-ups: A/D switches the exercise between reps.
	await until(func() -> bool: return mat._recover <= 0.0 and mat.charge <= 0.02, 3.0)
	await tap_key(KEY_D)
	check("D on the mat switches to PUSH-UPS", mat.exercise == WarmupStation.Exercise.PUSHUP and overlay.selector_value.text == "PUSH-UPS", "exercise=%d selector='%s'" % [mat.exercise, overlay.selector_value.text])
	var mid := _snapshot()
	var pushups := 0
	for i in 8:
		if await _mat_rep(mat):
			pushups += 1
	await frames(3)
	var after := _snapshot()
	check("push-ups completed (%d reps)" % pushups, pushups >= 4, "reps=%d" % pushups)
	check("push-ups raise torso muscle", after["torso"] > mid["torso"], "%.3f -> %.3f" % [mid["torso"], after["torso"]])
	check("push-ups raise arm muscle", after["arms"] > mid["arms"], "%.3f -> %.3f" % [mid["arms"], after["arms"]])
	check("push-ups leave leg muscle alone", near(after["legs"], mid["legs"], 0.0001), "legs %.3f -> %.3f" % [mid["legs"], after["legs"]])
	var levels_gained: int = after["level"] - mid["level"]
	check("push-ups raise max stamina beyond level-up bonuses", after["max_stamina"] > mid["max_stamina"] + levels_gained * PlayerStats.STAMINA_PER_LEVEL + 0.05, "%.2f -> %.2f (levels +%d)" % [mid["max_stamina"], after["max_stamina"], levels_gained])
	check("push-ups raise strength", after["strength"] > mid["strength"], "%.3f -> %.3f" % [mid["strength"], after["strength"]])
	check("push-ups raise the pump", PlayerStats.pump_level > 0.0, "pump=%.1f" % PlayerStats.pump_level)
	check("mat: Esc leaves the station and hands control back", await leave_station(mat, KEY_ESCAPE))
	check("mat: overlay closes", not overlay.visible)
	check("mat: the player can walk away afterwards", await walks_away_from(mat))
	check("mat: station can be used again (interactable re-enabled)", mat._interactable.enabled)
	_hud_matches("after the mat")


# --- Barbell stations ------------------------------------------------------------------------

## Waits for the stamina bar to refill while seated (real rest).
func _rest_until(ratio: float) -> void:
	await until(func() -> bool: return PlayerStats.get_stamina_ratio() >= ratio and not PlayerStats.is_exhausted, 30.0)


## Idles until the pump from earlier sets has worn off (it decays 3 points a second after a 3 s grace).
func _cool_pump() -> void:
	await until(func() -> bool: return PlayerStats.pump_level < 3.0, 90.0)


## Presses the lift key at the rack and waits for the bar to be in the lifter's hands.
func _lift_off(st: BarbellStation) -> bool:
	await tap_key(KEY_SPACE)
	var ok := await until(func() -> bool: return st.phase == BarbellStation.Phase.LIFT, 2.0)
	return ok


## Drives the bar like a lifter: hold to press, release to lower, tap A/D to keep it level.
func _lift_reps(st: BarbellStation, goal: int, timeout: float = 60.0) -> int:
	var start_reps := st.reps
	var want_press := not st._starts_top
	var press_start_reps := st.reps
	var frames_left := roundi(timeout * FPS)
	for i in frames_left:
		if st.phase != BarbellStation.Phase.LIFT or st.reps - start_reps >= goal:
			break
		if PlayerStats.is_exhausted:
			break
		_balance_tap(st)
		if want_press:
			if st.reps > press_start_reps or st.progress >= 0.999:
				want_press = false
		else:
			if st.progress <= 0.055:
				want_press = true
				press_start_reps = st.reps
		set_key(KEY_SPACE, want_press)
		await get_tree().physics_frame
	key_up(KEY_SPACE)
	await frames(2)
	return st.reps - start_reps


## One deliberately sloppy rep: the bar is reversed halfway up, so the rep counts but is not perfect.
func _sloppy_rep(st: BarbellStation) -> void:
	var start_reps := st.reps
	var stage := 0
	var hitch := 0
	for i in 900:
		if st.phase != BarbellStation.Phase.LIFT or st.reps > start_reps:
			break
		_balance_tap(st)
		match stage:
			0:
				key_up(KEY_SPACE)
				if st.progress <= 0.055:
					stage = 1
			1:
				key_down(KEY_SPACE)
				if st.progress >= 0.5:
					stage = 2
					hitch = 6
			2:
				key_up(KEY_SPACE)
				hitch -= 1
				if hitch <= 0:
					stage = 3
			3:
				key_down(KEY_SPACE)
		await get_tree().physics_frame
	key_up(KEY_SPACE)
	await frames(2)


func _balance_tap(st: BarbellStation) -> void:
	if Engine.get_physics_frames() - _last_tap < 4:
		return
	var lean := st.tilt + 0.55 * st._tilt_velocity
	if lean > 0.07:
		_last_tap = Engine.get_physics_frames()
		key_down(KEY_A)
		_release_later(KEY_A)
	elif lean < -0.07:
		_last_tap = Engine.get_physics_frames()
		key_down(KEY_D)
		_release_later(KEY_D)


func _release_later(code: Key) -> void:
	await get_tree().physics_frame
	await get_tree().physics_frame
	key_up(code)


func _bench_press() -> void:
	var benches := stations_of(&"bench_press")
	check("three bench presses on 1F", benches.size() == 3, "found %d" % benches.size())
	var st := benches[1] as BarbellStation
	await _cool_pump()
	await _rest_until(0.95)
	var entered := await use_station(st)
	check("bench: crosshair prompt reads '%s'" % st.title, last_prompt == st.title, "prompt='%s'" % last_prompt)
	check("bench: E seats the player at the bench", entered)
	check("bench: overlay shows BENCH PRESS and the bar is racked (SETUP)", overlay.visible and overlay.title_label.text == "BENCH PRESS" and st.phase == BarbellStation.Phase.SETUP, "title='%s' phase=%d" % [overlay.title_label.text, st.phase])
	var start_weight := st.weight
	check("bench: starts at the heaviest safe load (strength %.0f -> %.0f kg)" % [PlayerStats.strength, start_weight], near(start_weight, maxf(floorf(st.get_safe_weight() / 10.0) * 10.0, 20.0), 0.01), "weight=%.0f safe=%.1f" % [start_weight, st.get_safe_weight()])
	await tap_key(KEY_D)
	await tap_key(KEY_D)
	check("bench: D twice adds 20 kg", near(st.weight, start_weight + 20.0, 0.01), "weight=%.0f" % st.weight)
	check("bench: overlay selector shows the load", overlay.selector_value.text == "%d kg" % roundi(st.weight), "selector='%s'" % overlay.selector_value.text)
	await tap_key(KEY_A)
	check("bench: A takes 10 kg off", near(st.weight, start_weight + 10.0, 0.01), "weight=%.0f" % st.weight)
	for i in 6:
		await tap_key(KEY_A)
	check("bench: the load stops at the 20 kg minimum", near(st.weight, 20.0, 0.01), "weight=%.0f" % st.weight)
	check("bench: the barbell model carries the chosen load", near(st.barbell.weight, st.weight, 0.01))
	# Back to a safe weight, then lift.
	while st.weight < start_weight:
		await tap_key(KEY_D)
	check("bench: safe load is not overloaded", st.get_overload() <= 1.001, "overload=%.2f" % st.get_overload())
	var before := _snapshot()
	var xp_before := _xp_total()
	check("bench: Space lifts the bar off the rack", await _lift_off(st), "phase=%d" % st.phase)
	var done := await _lift_reps(st, 1)
	check("bench: first rep completes", done >= 1 and st.reps >= 1, "reps=%d phase=%d progress=%.2f" % [st.reps, st.phase, st.progress])
	var pump_one := PlayerStats.pump_level
	await _lift_reps(st, 5)
	check("bench: six reps counted by the station", st.reps >= 5, "reps=%d" % st.reps)
	var after := _snapshot()
	check("bench: reps raise torso muscle", after["torso"] > before["torso"], "%.3f -> %.3f" % [before["torso"], after["torso"]])
	check("bench: reps raise arm muscle", after["arms"] > before["arms"], "%.3f -> %.3f" % [before["arms"], after["arms"]])
	check("bench: reps do not train the legs", near(after["legs"], before["legs"], 0.0001), "%.3f -> %.3f" % [before["legs"], after["legs"]])
	check("bench: reps raise strength", after["strength"] > before["strength"], "%.3f -> %.3f" % [before["strength"], after["strength"]])
	check("bench: reps pay XP", _xp_total() > xp_before + 10.0, "%.1f -> %.1f" % [xp_before, _xp_total()])
	check("bench: the pump rises with reps (after 1 rep %.1f, now %.1f)" % [pump_one, PlayerStats.pump_level], pump_one > 0.0 and PlayerStats.pump_level > pump_one, "pump %.1f -> %.1f" % [pump_one, PlayerStats.pump_level])
	check("bench: stamina is spent by lifting", PlayerStats.stamina < PlayerStats.max_stamina - 5.0, "stamina %.1f/%.1f" % [PlayerStats.stamina, PlayerStats.max_stamina])
	var perfects := reps_log.filter(func(r: Dictionary) -> bool: return r["perfect"])
	var perfect_popups := popups.count("PERFECT REP!")
	var logged := reps_log.size()
	await _sloppy_rep(st)
	check("bench: a rep reversed halfway up still counts but is not perfect", reps_log.size() == logged + 1 and not reps_log.back()["perfect"] and popups.count("PERFECT REP!") == perfect_popups, "logged %d -> %d perfect=%s" % [logged, reps_log.size(), reps_log.back()["perfect"] if reps_log.size() > logged else "n/a"])
	check("bench: a normal rep gives +6 pump", reps_log.size() > logged and near(reps_log.back()["pump_delta"], 6.0, 1.0), "delta=%s" % (reps_log.back()["pump_delta"] if reps_log.size() > logged else "n/a"))
	check("bench: a perfect rep is recognized (%d of %d)" % [perfects.size(), reps_log.size()], perfects.size() >= 1 and popups.has("PERFECT REP!"), "perfects=%d popups has PERFECT REP=%s" % [perfects.size(), popups.has("PERFECT REP!")])
	if not perfects.is_empty():
		check("bench: a perfect rep gives double pump (+12 vs +6)", near(perfects[0]["pump_delta"], 12.0, 1.0), "perfect delta=%.1f" % perfects[0]["pump_delta"])
	_hud_matches("after the bench")
	# E racks the bar first, a second E leaves.
	await tap_key(KEY_E)
	var racked := await until(func() -> bool: return st.phase == BarbellStation.Phase.SETUP, 2.0)
	check("bench: E while lifting racks the bar and keeps the player seated", racked and player.station == st, "phase=%d station=%s" % [st.phase, player.station])
	var pump_before_idle := PlayerStats.pump_level
	check("bench: second E leaves the station and hands control back", await leave_station(st, KEY_E))
	check("bench: overlay closes", not overlay.visible)
	check("bench: the player can walk away afterwards", await walks_away_from(st))
	# The pump decays once the lifter idles for a few seconds.
	var pump_now := PlayerStats.pump_level
	await secs(7.0)
	check("pump decays after idling (%.1f -> %.1f)" % [pump_now, PlayerStats.pump_level], PlayerStats.pump_level < pump_now - 6.0 and pump_before_idle > 0.0, "pump %.1f -> %.1f" % [pump_now, PlayerStats.pump_level])
	check("HUD pump label follows the decay", hud.pump_label.text == "x%.1f" % PlayerStats.get_gain_multiplier(), "label='%s'" % hud.pump_label.text)


func _squat_and_deadlift() -> void:
	for kind: StringName in [&"squat", &"deadlift"]:
		var list := stations_of(kind)
		check("%s: stations exist on 1F (%d)" % [kind, list.size()], list.size() >= 1)
		var st := list[0] as BarbellStation
		await place_player(gym_point(0.0, 3.0), 0.0)
		await _rest_until(0.95)
		var entered := await use_station(st)
		check("%s: crosshair prompt reads '%s'" % [kind, st.title], last_prompt == st.title, "prompt='%s'" % last_prompt)
		check("%s: E seats the player" % kind, entered)
		if not entered:
			continue
		check("%s: overlay opens" % kind, overlay.visible and overlay.title_label.text == st.title.to_upper(), "title='%s'" % overlay.title_label.text)
		var w0 := st.weight
		await tap_key(KEY_D)
		check("%s: D changes the load (+10 kg)" % kind, near(st.weight, w0 + 10.0, 0.01), "%.0f -> %.0f" % [w0, st.weight])
		await tap_key(KEY_A)
		check("%s: A changes the load (-10 kg)" % kind, near(st.weight, w0, 0.01), "weight=%.0f" % st.weight)
		var before := _snapshot()
		var xp_before := _xp_total()
		var lifted := await _lift_off(st)
		var done := await _lift_reps(st, 3) if lifted else 0
		var after := _snapshot()
		check("%s: three reps complete" % kind, done >= 3, "reps=%d lifted=%s phase=%d" % [done, lifted, st.phase])
		check("%s: reps raise leg muscle" % kind, after["legs"] > before["legs"], "%.3f -> %.3f" % [before["legs"], after["legs"]])
		check("%s: reps raise torso muscle" % kind, after["torso"] > before["torso"], "%.3f -> %.3f" % [before["torso"], after["torso"]])
		if kind == &"squat":
			check("squat: reps do not train the arms", near(after["arms"], before["arms"], 0.0001), "%.3f -> %.3f" % [before["arms"], after["arms"]])
		else:
			check("deadlift: reps raise arm muscle too", after["arms"] > before["arms"], "%.3f -> %.3f" % [before["arms"], after["arms"]])
		check("%s: reps raise strength" % kind, after["strength"] > before["strength"], "%.3f -> %.3f" % [before["strength"], after["strength"]])
		check("%s: reps pay XP" % kind, _xp_total() > xp_before, "%.1f -> %.1f" % [xp_before, _xp_total()])
		await tap_key(KEY_E)
		await until(func() -> bool: return st.phase == BarbellStation.Phase.SETUP, 2.0)
		check("%s: E racks the bar, second E leaves" % kind, await leave_station(st, KEY_E))
		check("%s: the player can walk away afterwards" % kind, await walks_away_from(st))


# --- Dumbbell curls --------------------------------------------------------------------------

func _curls() -> void:
	var list := stations_of(&"dumbbell_curl")
	check("dumbbell curl stations exist (%d)" % list.size(), list.size() >= 2)
	var st := list[1] as CurlStation
	await place_player(gym_point(0.0, 3.0), 0.0)
	await _rest_until(0.95)
	var entered := await use_station(st)
	check("curls: crosshair prompt reads '%s'" % st.title, last_prompt == st.title, "prompt='%s'" % last_prompt)
	check("curls: E seats the player", entered)
	if not entered:
		return
	check("curls: overlay opens with the dumbbell weight", overlay.visible and overlay.selector_value.text.ends_with("kg dumbbells"), "selector='%s'" % overlay.selector_value.text)
	var before := _snapshot()
	var xp_before := _xp_total()
	# LMB curls the left arm, RMB the right: alternate in a steady rhythm.
	var curls_done := 0
	var button := MOUSE_BUTTON_LEFT
	for i in 10:
		var arm := 0 if button == MOUSE_BUTTON_LEFT else 1
		var reps0 := st.reps
		mouse_button(button, true)
		await until(func() -> bool: return st.reps > reps0 or st.curl[arm] >= 0.99, 1.5)
		mouse_button(button, false)
		if st.reps > reps0:
			curls_done += 1
		button = MOUSE_BUTTON_RIGHT if button == MOUSE_BUTTON_LEFT else MOUSE_BUTTON_LEFT
	await secs(0.6)
	var after := _snapshot()
	check("curls: alternating LMB/RMB completes reps (%d of 10)" % curls_done, curls_done >= 8 and st.reps >= 8, "done=%d reps=%d" % [curls_done, st.reps])
	check("curls: alternating arms in tempo builds a rhythm streak", st.rhythm >= 3, "rhythm=%d" % st.rhythm)
	check("curls: reps raise arm muscle", after["arms"] > before["arms"], "%.3f -> %.3f" % [before["arms"], after["arms"]])
	check("curls: reps raise strength a little", after["strength"] > before["strength"], "%.3f -> %.3f" % [before["strength"], after["strength"]])
	check("curls: reps do not train legs or torso", near(after["legs"], before["legs"], 0.0001) and near(after["torso"], before["torso"], 0.0001), "legs %.3f->%.3f torso %.3f->%.3f" % [before["legs"], after["legs"], before["torso"], after["torso"]])
	check("curls: reps pay XP", _xp_total() > xp_before, "%.1f -> %.1f" % [xp_before, _xp_total()])
	var perfect_curls := reps_log.slice(before["reps"]).filter(func(r: Dictionary) -> bool: return r["perfect"])
	check("curls: rhythm gives perfect reps (%d)" % perfect_curls.size(), perfect_curls.size() >= 2, "perfect=%d" % perfect_curls.size())
	check("curls: E leaves and hands control back", await leave_station(st, KEY_E))
	check("curls: the player can walk away afterwards", await walks_away_from(st))


# --- Treadmill -------------------------------------------------------------------------------

func _treadmill() -> void:
	var list := stations_of(&"treadmill")
	check("five treadmills on 1F", list.size() == 5, "found %d" % list.size())
	var st := list[2] as TreadmillStation
	await place_player(gym_point(0.0, 3.0), 0.0)
	await _rest_until(0.95)
	var entered := await use_station(st)
	check("treadmill: crosshair prompt reads '%s'" % st.title, last_prompt == st.title, "prompt='%s'" % last_prompt)
	check("treadmill: E steps onto the treadmill", entered)
	if not entered:
		return
	check("treadmill: starts at a recovery pace (6 km/h target)", near(st.target_speed, 6.0, 0.3), "target=%.1f" % st.target_speed)
	var t0 := st.target_speed
	key_down(KEY_W)
	await secs(1.0)
	key_up(KEY_W)
	check("treadmill: W raises the belt speed (+5 km/h per second)", near(st.target_speed - t0, 5.0, 1.2), "target %.1f -> %.1f" % [t0, st.target_speed])
	var t1 := st.target_speed
	key_down(KEY_S)
	await secs(0.5)
	key_up(KEY_S)
	check("treadmill: S lowers the belt speed", near(t1 - st.target_speed, 2.5, 0.8), "target %.1f -> %.1f" % [t1, st.target_speed])
	var before := _snapshot()
	var xp_before := _xp_total()
	var stamina_before := PlayerStats.stamina
	key_down(KEY_W)
	await secs(0.5)
	key_up(KEY_W)
	await until(func() -> bool: return st.speed > 8.0, 5.0)
	check("treadmill: the belt reaches training pace (>7 km/h)", st.speed > TreadmillStation.TRAINING_SPEED, "speed=%.1f" % st.speed)
	check("treadmill: overlay shows TRAINING PACE", overlay.speed_caption.text.contains("TRAINING PACE"), "caption='%s'" % overlay.speed_caption.text)
	key_down(KEY_W)
	await secs(1.5)
	key_up(KEY_W)
	await until(func() -> bool: return st.reps >= 4 or PlayerStats.get_stamina_ratio() < 0.3, 40.0)
	var after := _snapshot()
	check("treadmill: running above 7 km/h pays cardio reps (%d)" % st.reps, st.reps >= 3, "reps=%d distance=%.0f m" % [st.reps, st.distance])
	check("treadmill: running raises leg muscle", after["legs"] > before["legs"], "%.3f -> %.3f" % [before["legs"], after["legs"]])
	var levels: int = after["level"] - before["level"]
	check("treadmill: running raises max stamina beyond level-up bonuses", after["max_stamina"] > before["max_stamina"] + levels * PlayerStats.STAMINA_PER_LEVEL + 0.05, "%.2f -> %.2f (levels +%d)" % [before["max_stamina"], after["max_stamina"], levels])
	check("treadmill: running costs stamina", PlayerStats.stamina < stamina_before - 10.0 or levels > 0, "stamina %.1f -> %.1f" % [stamina_before, PlayerStats.stamina])
	check("treadmill: running pays XP", _xp_total() > xp_before, "%.1f -> %.1f" % [xp_before, _xp_total()])
	check("treadmill: running does not train arms or torso", near(after["arms"], before["arms"], 0.0001) and near(after["torso"], before["torso"], 0.0001))
	# Recovery pace: stamina refills.
	key_down(KEY_S)
	await until(func() -> bool: return st.target_speed <= 3.5, 6.0)
	key_up(KEY_S)
	await until(func() -> bool: return st.speed < 5.0, 8.0)
	var low := PlayerStats.stamina
	var reps_before := st.reps
	var tenure_before := PlayerStats.gym_tenure
	await secs(4.0)
	var tenure_gain := PlayerStats.gym_tenure - tenure_before
	check("training at a station adds gym tenure at one day per 45 s (+%.4f days in 4 s)" % tenure_gain, near(tenure_gain, 4.0 / 45.0, 0.006), "gain=%.4f expected=%.4f" % [tenure_gain, 4.0 / 45.0])
	check("treadmill: below 7 km/h is recovery pace (stamina refills %.0f -> %.0f, no reps)" % [low, PlayerStats.stamina], PlayerStats.stamina > low + 5.0 and low < PlayerStats.max_stamina * 0.8 and st.reps == reps_before and overlay.speed_caption.text.contains("RECOVERY PACE"), "stamina %.1f -> %.1f reps %d->%d caption='%s'" % [low, PlayerStats.stamina, reps_before, st.reps, overlay.speed_caption.text])
	check("treadmill: E steps off and hands control back", await leave_station(st, KEY_E))
	check("treadmill: belt stops when stepping off", near(st.speed, 0.0, 0.01), "speed=%.2f" % st.speed)
	check("treadmill: the player can walk away afterwards", await walks_away_from(st))


# --- Levels and ranks ------------------------------------------------------------------------

func _level_up_and_rank() -> void:
	var bench := stations_of(&"bench_press")[0] as BarbellStation
	if PlayerStats.level < 3:
		await place_player(gym_point(0.0, 3.0), 0.0)
		await _rest_until(0.95)
		if await use_station(bench) and await _lift_off(bench):
			for i in 6:
				if PlayerStats.level >= 3:
					break
				await _lift_reps(bench, 4)
				if PlayerStats.is_exhausted or PlayerStats.get_stamina_ratio() < 0.35:
					await tap_key(KEY_E)
					await until(func() -> bool: return bench.phase == BarbellStation.Phase.SETUP, 2.0)
					await _rest_until(0.95)
					await _lift_off(bench)
			await tap_key(KEY_E)
			await until(func() -> bool: return bench.phase == BarbellStation.Phase.SETUP, 2.0)
			await leave_station(bench, KEY_E)
	await frames(3)
	var expected_levels: Array[int] = []
	for l in range(2, PlayerStats.level + 1):
		expected_levels.append(l)
	check("XP crossing thresholds raises the level one step at a time (level %d)" % PlayerStats.level, PlayerStats.level >= 3 and level_events == expected_levels, "level=%d events=%s" % [PlayerStats.level, level_events])
	var expected_ranks: Array[String] = []
	var previous := "Skinny Rookie"
	for l in range(2, PlayerStats.level + 1):
		if PlayerStats.get_rank_for(l) != previous:
			previous = PlayerStats.get_rank_for(l)
			expected_ranks.append(previous)
	check("the rank title follows the level (level %d is '%s')" % [PlayerStats.level, PlayerStats.rank_title], PlayerStats.rank_title == PlayerStats.get_rank_for(PlayerStats.level) and PlayerStats.rank_title != "Skinny Rookie", "rank='%s' level=%d" % [PlayerStats.rank_title, PlayerStats.level])
	check("rank_changed fired once per new title, first 'Gym Regular' at level 3", rank_events == expected_ranks and rank_events[0] == "Gym Regular", "events=%s expected=%s" % [rank_events, expected_ranks])
	check("XP threshold for the current level is 50 * level^1.3", near(PlayerStats.xp_to_next(), roundf(50.0 * pow(PlayerStats.level, 1.3)), 0.01))
	check("every level-up refilled the stamina bar (second wind)", not second_wind.is_empty() and not second_wind.has(false), "second_wind=%s" % [second_wind])
	check("a LEVEL UP popup was shown for each level", popups.has("LEVEL UP!  Lvl 2") and popups.has("LEVEL UP!  Lvl %d" % PlayerStats.level), "popups=%s" % [popups.filter(func(p: String) -> bool: return p.begins_with("LEVEL"))])
	check("HUD toast announced the latest rank", hud.toast_label.text == "New rank: %s" % rank_events.back(), "toast='%s' last rank=%s" % [hud.toast_label.text, rank_events.back()])
	_hud_matches("after the level-up")
	check("rank unlock table: levels 1/3/6/9/13/17 give the six titles and numerals follow every 5 levels", PlayerStats.get_rank_for(1) == "Skinny Rookie" and PlayerStats.get_rank_for(2) == "Skinny Rookie" and PlayerStats.get_rank_for(3) == "Gym Regular" and PlayerStats.get_rank_for(6) == "Lean Grinder" and PlayerStats.get_rank_for(9) == "Shredded Prospect" and PlayerStats.get_rank_for(13) == "Cage Ready" and PlayerStats.get_rank_for(17) == "Iron Machine" and PlayerStats.get_rank_for(22) == "Iron Machine II", "%s" % [[1, 3, 6, 9, 13, 17, 22].map(func(l: int) -> String: return PlayerStats.get_rank_for(l))])


# --- Overload and injury ---------------------------------------------------------------------

## Lifts off, lowers the bar to the bottom (balanced) and presses for `seconds`. Returns the strain
## reached, or -1 if the press never started.
func _strain_after_press(st: BarbellStation, seconds: float) -> float:
	if not await _lift_off(st):
		return -1.0
	# Bench and squat start at the top: lower the bar first.
	for i in 300:
		_balance_tap(st)
		key_up(KEY_SPACE)
		if st.progress <= 0.055:
			break
		await get_tree().physics_frame
	var start := st.strain
	key_down(KEY_SPACE)
	var frames_to_press := roundi(seconds * FPS)
	for i in frames_to_press:
		_balance_tap(st)
		await get_tree().physics_frame
		if PlayerStats.is_strained():
			break
	key_up(KEY_SPACE)
	return st.strain - start


## Sets the load to the multiple of 10 kg whose overload is nearest `target` (below the 1.7 stall point).
func _load_to_overload(st: BarbellStation, target: float) -> void:
	var want := clampf(roundf(st.get_safe_weight() * target / 10.0) * 10.0, 20.0, 400.0)
	while st.weight < want:
		await tap_key(KEY_D)
	while st.weight > want or st.get_overload() > 1.65:
		await tap_key(KEY_A)


func _rerack(st: BarbellStation) -> void:
	await tap_key(KEY_E)
	await until(func() -> bool: return st.phase == BarbellStation.Phase.SETUP, 3.0)


func _overload_injury() -> void:
	var st := stations_of(&"bench_press")[2] as BarbellStation
	await place_player(gym_point(0.0, 3.0), 0.0)
	await _rest_until(0.99)
	check("precondition: no injury yet", not PlayerStats.is_strained())
	check("precondition: still warmed up from the mat", PlayerStats.is_warmed_up(), "timer=%.1f" % PlayerStats.warmup_timer)
	check("bench #3: E seats the player", await use_station(st))
	var strength := PlayerStats.strength
	var effective_before := PlayerStats.get_effective_strength()
	# A moderate overload (1.6x): the bar still moves, so the strain bar fills at a measurable rate.
	await _load_to_overload(st, 1.45)
	var overload := st.get_overload()
	check("bench: a load above strength is flagged as heavy on the overlay (overload %.2f)" % overload, overload > 1.15 and overload < 1.69 and overlay.selector_detail.visible, "overload=%.2f" % overload)
	var warm_gain := await _strain_after_press(st, 0.5)
	check("warm-up: the strain bar fills slowly while warmed up (+%.3f in 0.5 s)" % warm_gain, warm_gain > 0.0 and warm_gain < 0.2 and not PlayerStats.is_strained(), "gain=%.3f strained=%s" % [warm_gain, PlayerStats.is_strained()])
	await _rerack(st)
	check("bench: leaving the station (still warmed up)", await leave_station(st, KEY_E))
	# Let the warm-up wear off (5 minutes) and measure again.
	await place_player(gym_point(0.0, 3.0), 0.0)
	await until(func() -> bool: return not PlayerStats.is_warmed_up(), 320.0)
	await frames(3)
	check("the warm-up wears off after 5 minutes (no WARMED UP badge, popup shown)", not PlayerStats.is_warmed_up() and not hud.warmup_label.text.begins_with("WARMED UP") and popups.has("Warm-up wore off"), "warmed=%s badge=%s label='%s'" % [PlayerStats.is_warmed_up(), hud.warmup_badge.visible, hud.warmup_label.text])
	await _rest_until(0.99)
	check("bench #3 again: E seats the player", await use_station(st))
	await _load_to_overload(st, 1.45)
	var cold_gain := await _strain_after_press(st, 0.5)
	check("not warmed up: the strain bar fills about 5x faster (+%.3f vs +%.3f warmed)" % [cold_gain, warm_gain], cold_gain > warm_gain * 3.0 and cold_gain < warm_gain * 8.0, "cold=%.3f warm=%.3f ratio=%.1f" % [cold_gain, warm_gain, cold_gain / maxf(warm_gain, 0.0001)])
	await _rerack(st)
	await _rest_until(0.99)
	# Now far too heavy: the strain bar fills up and the lifter is hurt.
	while st.weight < 100.0:
		await tap_key(KEY_D)
	check("bench: load can be raised far above strength (%.0f kg vs strength %.1f)" % [st.weight, strength], st.weight >= 100.0 and st.get_overload() > 3.0, "weight=%.0f overload=%.2f" % [st.weight, st.get_overload()])
	check("bench: overlay warns 'DANGER' about the overload", overlay.danger_label.visible and overlay.danger_label.text.begins_with("DANGER"), "danger='%s' visible=%s" % [overlay.danger_label.text, overlay.danger_label.visible])
	check("bench: Space lifts off the overloaded bar", await _lift_off(st))
	key_down(KEY_SPACE)
	var peak_strain := 0.0
	var gauge_seen := false
	for i in 400:
		_balance_tap(st)
		await get_tree().physics_frame
		peak_strain = maxf(peak_strain, st.strain)
		gauge_seen = gauge_seen or (overlay.strain_row.visible and overlay.strain.value > 0.05)
		if PlayerStats.is_strained():
			break
	key_up(KEY_SPACE)
	var shake := player._shake
	var vignette_raw: Variant = hud._vignette_material.get_shader_parameter("intensity")
	var vignette := float(vignette_raw) if vignette_raw != null else 0.0
	await frames(3)
	check("overloaded press fills the strain bar (peak %.2f) and shows it on the overlay" % peak_strain, peak_strain > 0.9 and gauge_seen, "peak=%.2f gauge=%s" % [peak_strain, gauge_seen])
	check("a full strain bar injures the lifter (injury timer 45-60 s)", PlayerStats.is_strained() and PlayerStats.injury_timer >= 44.0 and PlayerStats.injury_timer <= 60.1, "timer=%.1f" % PlayerStats.injury_timer)
	check("the bar is dropped on injury", st.phase == BarbellStation.Phase.DROPPED or st.phase == BarbellStation.Phase.SETUP, "phase=%d" % st.phase)
	check("injury shakes the camera and flashes the red vignette", shake > 0.5 and vignette > 0.3, "shake=%.2f vignette=%.2f" % [shake, vignette])
	check("a 'MUSCLE STRAIN!' popup was shown", popups.has("MUSCLE STRAIN!"))
	var effective_now := PlayerStats.get_effective_strength()
	check("strain cuts usable strength by 40%% (%.1f -> %.1f of %.1f)" % [effective_before, effective_now, PlayerStats.strength], near(effective_now, PlayerStats.strength * 0.6, PlayerStats.strength * 0.05), "effective=%.2f strength=%.2f" % [effective_now, PlayerStats.strength])
	check("strain slows lifts to 60%", near(PlayerStats.get_lift_speed_factor(), 0.6, 0.001))
	check("HUD shows the STRAINED badge with a countdown", hud.injury_badge.visible and hud.injury_label.text.begins_with("STRAINED") and ":" in hud.injury_label.text, "label='%s' visible=%s" % [hud.injury_label.text, hud.injury_badge.visible])
	check("objective tells the player to rest or stretch", GameState.objective.begins_with("Strained:") and hud.objective_label.text == GameState.objective, "objective='%s'" % GameState.objective)
	await until(func() -> bool: return st.phase == BarbellStation.Phase.SETUP, 5.0)
	for i in 14:
		await tap_key(KEY_D)
	var cap := maxf(floorf(st.get_safe_weight() / 10.0) * 10.0, 20.0)
	check("while strained the bar cannot be loaded past the reduced safe weight (cap %.0f kg)" % cap, st.weight <= cap + 0.01, "weight=%.0f cap=%.0f" % [st.weight, cap])
	var timer0 := PlayerStats.injury_timer
	var t0 := sim_time()
	await until(func() -> bool: return not PlayerStats.is_strained(), 70.0)
	var healed_after := sim_time() - t0
	check("the strain heals by itself, about twice as fast while resting at the bar (%.0f s for %.0f s of strain)" % [healed_after, timer0], not PlayerStats.is_strained() and healed_after > timer0 * 0.35 and healed_after < timer0 * 0.65, "healed after %.1f s, timer was %.1f" % [healed_after, timer0])
	await frames(3)
	check("after healing usable strength is back to full", near(PlayerStats.get_effective_strength(), PlayerStats.strength, 0.01), "effective=%.2f strength=%.2f" % [PlayerStats.get_effective_strength(), PlayerStats.strength])
	check("a 'Strain healed' popup was shown and the badge is gone", popups.has("Strain healed") and not hud.injury_badge.visible)
	check("objective no longer says Strained", not GameState.objective.begins_with("Strained:"), "objective='%s'" % GameState.objective)
	check("bench: leaving after the injury hands control back", await leave_station(st, KEY_E))
