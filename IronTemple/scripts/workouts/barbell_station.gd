class_name BarbellStation
extends WorkoutStation
## Bench press, squat and deadlift. Choose the load while the bar is racked, then hold the lift
## key to drive the bar up and release to lower it, tapping left and right to keep it level.
## Loads far above the lifter's strength build strain and end in an injury.

enum Phase { SETUP, UNRACK, LIFT, RERACK, DROPPED }

const MIN_WEIGHT := 20.0
const MAX_WEIGHT := 400.0
const WEIGHT_STEP := 10.0
## Load divided by the safe weight: above HEAVY strain builds, above DANGER the warning flashes,
## at STALL the bar no longer moves.
const HEAVY_OVERLOAD := 1.0
const DANGER_OVERLOAD := 1.25
const STALL_OVERLOAD := 1.7
const UP_TIME := 0.9
const DOWN_TIME := 0.8
const TOP := 0.97
const BOTTOM := 0.06
const HOLD_DRAIN := 1.2
const STRAIN_RATE := 1.1
const STRAIN_RECOVERY := 0.3
const TAP_IMPULSE := 0.5
const MAX_BAR_TILT := 0.21
## A rep is perfect when the bar never tilted past this and the tempo was clean.
const PERFECT_TILT := 0.4
const PERFECT_PAUSE := 0.6

## Lift definitions, in station space. `pole` aims the elbows in the torso frame.
const LIFTS := {
	&"bench_press": {
		"factor": 1.0, "focus": {&"torso": 1.0, &"arms": 0.5}, "strength": 1.0, "cost": 5.0,
		"body": Vector3(0.0, 0.0, 0.3), "yaw": PI, "exit": Vector3(0.0, 0.0, 1.6),
		"rack": Vector3(0.0, 1.11, -0.36), "bar_top": Vector3(0.0, 1.22, 0.0), "bar_bottom": Vector3(0.0, 0.78, 0.0),
		"drop": Vector3(0.0, 0.8, 0.02),
		"eye_top": Vector3(0.0, 0.68, -0.33), "eye_bottom": Vector3(0.0, 0.68, -0.33),
		"look_top": Vector3(0.0, 0.8, 0.6), "look_bottom": Vector3(0.0, 0.8, 0.6), "up": Vector3(0.0, 0.0, -1.0),
		# Racked, the bar hangs over the eyes: look straight up at it.
		"look_setup": Vector3(0.0, 1.0, -0.08),
		"lying": true, "pole": Vector3(0.8, -0.3, 0.7),
		"pose": CharacterModel.Pose.BENCH, "pose_offset": Vector3(0.0, 0.6, -1.15),
		"starts_top": true,
	},
	&"squat": {
		"factor": 1.25, "focus": {&"legs": 1.0, &"torso": 0.3}, "strength": 1.0, "cost": 6.0,
		"body": Vector3(0.0, 0.0, 1.1), "yaw": 0.0, "exit": Vector3(0.0, 0.0, 1.3),
		"rack": Vector3(0.0, 1.56, 0.6), "bar_top": Vector3(0.0, 1.56, 0.8), "bar_bottom": Vector3(0.0, 1.02, 0.8),
		"drop": Vector3(0.0, 0.9, 0.3),
		"eye_top": Vector3(0.0, 1.78, 1.1), "eye_bottom": Vector3(0.0, 1.24, 1.1),
		"look_top": Vector3(0.0, -0.2, -1.0), "look_bottom": Vector3(0.0, -0.08, -1.0), "up": Vector3(0.0, 1.0, 0.0),
		"lying": false, "pole": Vector3(0.5, -1.0, -0.15),
		"pose": CharacterModel.Pose.SQUAT, "pose_offset": Vector3(0.0, 0.0, 0.0),
		"starts_top": true,
	},
	&"deadlift": {
		"factor": 1.5, "focus": {&"legs": 0.6, &"torso": 0.6, &"arms": 0.2}, "strength": 1.2, "cost": 7.0,
		"body": Vector3(0.0, 0.0, 0.3), "yaw": 0.0, "exit": Vector3(0.0, 0.0, 0.85),
		"rack": Vector3(0.0, 0.29, 0.0), "bar_top": Vector3(0.0, 0.92, 0.12), "bar_bottom": Vector3(0.0, 0.29, 0.0),
		"drop": Vector3(0.0, 0.29, 0.05),
		"eye_top": Vector3(0.0, 1.76, 0.3), "eye_bottom": Vector3(0.0, 1.1, 0.0),
		"look_top": Vector3(0.0, -1.3, -1.0), "look_bottom": Vector3(0.0, -1.6, -1.0), "up": Vector3(0.0, 1.0, 0.0),
		# Shoulders sit low and back so the sleeves stay out of the downward view.
		"lying": false, "pole": Vector3(0.7, -0.2, 1.0), "shoulder": Vector3(0.22, -0.34, 0.14),
		"pose": CharacterModel.Pose.DEADLIFT, "pose_offset": Vector3(0.0, 0.0, 0.0),
		"starts_top": false,
	},
}

@export var lift: StringName = &"bench_press"

var barbell: Barbell
## Selected load in kilograms.
var weight := MIN_WEIGHT
var phase := Phase.SETUP
## Bar travel, 0 (chest, depth or floor) to 1 (lockout).
var progress := 1.0
## Bar balance, -1 to 1. Past either end the bar is lost.
var tilt := 0.0
## Injury build-up, 0 to 1.
var strain := 0.0

var _profile: Dictionary
var _starts_top := true
var _phase_time := 0.0
var _tilt_velocity := 0.0
var _wobble := 0.0
var _wobble_timer := 0.0
var _touched_bottom := false
var _was_pressing := false
var _rep_max_tilt := 0.0
var _rep_hitches := 0
var _bottom_time := 0.0
var _move_from := Vector3.ZERO
var _tilt_from := 0.0
var _progress_from := 1.0
var _drop_side := 1.0
var _leave_when_racked := false
var _setup_view := 1.0


func _build() -> void:
	_profile = LIFTS[lift]
	_starts_top = _profile["starts_top"]
	body_position = _profile["body"]
	body_yaw = _profile["yaw"]
	exit_position = _profile["exit"]
	barbell = Barbell.new()
	barbell.name = "Barbell"
	barbell.position = _profile["rack"]
	add_child(barbell)


## Heaviest load the lifter handles safely right now.
func get_safe_weight() -> float:
	var factor: float = _profile["factor"]
	return maxf(PlayerStats.get_effective_strength() * factor, 1.0)


## Selected load relative to the safe weight; above 1 the lifter is overloaded.
func get_overload() -> float:
	return weight / get_safe_weight()


## Strength needed to lift the selected load safely.
func get_required_strength() -> float:
	var factor: float = _profile["factor"]
	return weight / factor


func is_restful() -> bool:
	return phase == Phase.SETUP


func request_exit() -> void:
	match phase:
		Phase.SETUP:
			leave()
		Phase.LIFT:
			_start_move(Phase.RERACK)
		_:
			_leave_when_racked = true


func handle_input(event: InputEvent) -> void:
	if phase == Phase.LIFT:
		# Balance taps: nudge the bar back towards the side pressed.
		if event.is_action_pressed(&"move_left"):
			_tilt_velocity -= TAP_IMPULSE
		elif event.is_action_pressed(&"move_right"):
			_tilt_velocity += TAP_IMPULSE
		return
	if phase != Phase.SETUP:
		return
	var wheel := event as InputEventMouseButton
	if event.is_action_pressed(&"move_left") or (wheel != null and wheel.pressed and wheel.button_index == MOUSE_BUTTON_WHEEL_DOWN):
		_set_weight(weight - WEIGHT_STEP)
	elif event.is_action_pressed(&"move_right") or (wheel != null and wheel.pressed and wheel.button_index == MOUSE_BUTTON_WHEEL_UP):
		_set_weight(weight + WEIGHT_STEP)
	elif event.is_action_pressed(&"lift"):
		_start_move(Phase.UNRACK)


func _begin() -> void:
	phase = Phase.SETUP
	progress = 1.0
	tilt = 0.0
	strain = 0.0
	_leave_when_racked = false
	_setup_view = 1.0
	# Start at the heaviest safe load.
	_set_weight(floorf(get_safe_weight() / WEIGHT_STEP) * WEIGHT_STEP)
	user.model.pose = _profile["pose"]
	user.model.pose_offset = _profile["pose_offset"]
	user.model.pose_progress = Vector2.ONE
	_hold_bar(_starts_top)


func _end() -> void:
	# Leave the bar racked for the next lifter.
	barbell.position = _profile["rack"]
	barbell.rotation.z = 0.0
	phase = Phase.SETUP


func _tick(delta: float) -> void:
	_phase_time += delta
	_setup_view = move_toward(_setup_view, 1.0 if phase == Phase.SETUP else 0.0, delta * 3.0)
	match phase:
		Phase.SETUP:
			strain = maxf(strain - STRAIN_RECOVERY * delta, 0.0)
			_set_weight(weight)  # a strain or fatigue can lower the cap while seated
		Phase.UNRACK:
			_tick_unrack()
		Phase.LIFT:
			_tick_lift(delta)
		Phase.RERACK:
			_tick_rerack()
		Phase.DROPPED:
			_tick_dropped()
	if user == null:
		return
	user.model.pose_progress = Vector2(progress, progress)
	_refresh_overlay()


func _view() -> Transform3D:
	var eye_top: Vector3 = _profile["eye_top"]
	var eye_bottom: Vector3 = _profile["eye_bottom"]
	var look_top: Vector3 = _profile["look_top"]
	var look_bottom: Vector3 = _profile["look_bottom"]
	var up: Vector3 = _profile["up"]
	var look := look_bottom.lerp(look_top, progress)
	if _profile.has("look_setup"):
		var racked: Vector3 = _profile["look_setup"]
		look = look.lerp(racked, smoothstep(0.0, 1.0, _setup_view))
	return eye_frame(eye_bottom.lerp(eye_top, progress), look, up)


func _torso() -> Transform3D:
	if _profile["lying"]:
		# On the back: right is -X, "up the body" is -Z and the chest faces the ceiling.
		var eye: Vector3 = _profile["eye_top"]
		return Transform3D(Basis(Vector3(-1.0, 0.0, 0.0), Vector3(0.0, 0.0, -1.0), Vector3(0.0, -1.0, 0.0)), eye + Vector3(0.0, -0.11, -0.02))
	return super()


func _set_weight(value: float) -> void:
	var limit := MAX_WEIGHT
	if PlayerStats.is_strained():
		# A strained lifter cannot load past the reduced safe weight.
		limit = maxf(floorf(get_safe_weight() / WEIGHT_STEP) * WEIGHT_STEP, MIN_WEIGHT)
	var loaded := clampf(value, MIN_WEIGHT, limit)
	if not is_equal_approx(loaded, weight) and user != null:
		AudioManager.play_varied(&"plate", 0.8)
	weight = loaded
	barbell.weight = weight


func _hold_bar(holding: bool) -> void:
	var shoulder: Vector3 = _profile.get("shoulder", PlayerArms.DEFAULT_SHOULDER)
	if not holding:
		user.arms.set_grips(null, null)
	elif cos(body_yaw) < 0.0:
		# Facing +Z (bench press) the lifter's left hand is on the bar's +X side.
		user.arms.set_grips(barbell.grip_right, barbell.grip_left, shoulder, _profile["pole"])
	else:
		user.arms.set_grips(barbell.grip_left, barbell.grip_right, shoulder, _profile["pole"])


func _start_move(next: Phase) -> void:
	phase = next
	_phase_time = 0.0
	_move_from = barbell.position
	_tilt_from = barbell.rotation.z
	_progress_from = progress


func _tick_unrack() -> void:
	var t := smoothstep(0.0, 1.0, _phase_time / 0.4)
	if _starts_top:
		barbell.position = _move_from.lerp(_profile["bar_top"], t)
	else:
		# Bend down to a bar that starts on the floor.
		progress = 1.0 - t
	if t < 1.0:
		return
	_hold_bar(true)
	AudioManager.play_varied(&"clank", 0.5)
	phase = Phase.LIFT
	progress = 1.0 if _starts_top else 0.0
	tilt = 0.0
	_tilt_velocity = 0.0
	_was_pressing = Input.is_action_pressed(&"lift")
	_reset_rep()
	# A deadlift starts from the floor, so its first pull already counts.
	_touched_bottom = not _starts_top


func _tick_rerack() -> void:
	var t := smoothstep(0.0, 1.0, _phase_time / 0.35)
	barbell.position = _move_from.lerp(_profile["rack"], t)
	barbell.rotation.z = lerpf(_tilt_from, 0.0, t)
	progress = lerpf(_progress_from, 1.0, t)
	if t >= 1.0:
		_racked()


func _racked() -> void:
	AudioManager.play_varied(&"clank", 0.8)
	phase = Phase.SETUP
	tilt = 0.0
	strain = 0.0
	progress = 1.0
	_hold_bar(_starts_top)
	if _leave_when_racked:
		leave()


func _tick_lift(delta: float) -> void:
	var overload := get_overload()
	var pressing := Input.is_action_pressed(&"lift")
	# Holding a loaded bar keeps stamina from recovering.
	PlayerStats.spend_stamina(HOLD_DRAIN * delta)

	if pressing and overload < STALL_OVERLOAD:
		progress = minf(progress + _up_speed(overload) * delta, 1.0)
	elif pressing:
		# Far too heavy to hold: the bar sinks even against a full effort.
		progress = maxf(progress - _down_speed(overload) * 0.5 * delta, 0.0)
	else:
		progress = maxf(progress - _down_speed(overload) * delta, 0.0)
	# Reversing mid-range is a hitch: the rep still counts but is not perfect.
	if pressing != _was_pressing and progress > 0.1 and progress < 0.9:
		_rep_hitches += 1
	_was_pressing = pressing
	if progress <= BOTTOM:
		_touched_bottom = true
		_bottom_time += delta
	if progress >= TOP and _touched_bottom:
		_complete_rep()

	var straining := pressing and progress < TOP and overload > HEAVY_OVERLOAD
	if straining:
		strain += (overload - HEAVY_OVERLOAD) * STRAIN_RATE * PlayerStats.get_injury_risk() * delta
	else:
		strain = maxf(strain - STRAIN_RECOVERY * delta, 0.0)

	_tick_balance(delta, overload)
	_rep_max_tilt = maxf(_rep_max_tilt, absf(tilt))
	var top: Vector3 = _profile["bar_top"]
	var bottom: Vector3 = _profile["bar_bottom"]
	barbell.position = bottom.lerp(top, progress)
	# The lifter's right hand is on -X when facing +Z (bench) and on +X otherwise.
	barbell.rotation.z = -tilt * MAX_BAR_TILT * cos(body_yaw)

	if strain >= 1.0:
		_drop(true)
	elif absf(tilt) >= 1.0:
		# Losing a bar that is far too heavy tears something unless the lifter is warm and lucky.
		var risky := overload >= DANGER_OVERLOAD or strain > 0.6
		_drop(risky and (not PlayerStats.is_warmed_up() or randf() < 0.35))


func _tick_balance(delta: float, overload: float) -> void:
	var instability := 0.35 + 1.3 * maxf(overload - 0.5, 0.0)
	if PlayerStats.get_stamina_ratio() < 0.2:
		instability += 0.5
	_wobble_timer -= delta
	if _wobble_timer <= 0.0:
		_wobble_timer = randf_range(0.3, 0.8)
		_wobble = randf_range(-1.0, 1.0)
	# Locked out or resting at the bottom the bar is steadier.
	var travel := 1.0 if progress > 0.03 and progress < TOP else 0.4
	_tilt_velocity += (_wobble * 1.5 + tilt * 2.0) * instability * travel * delta
	_tilt_velocity += Input.get_axis(&"move_left", &"move_right") * 0.9 * delta
	_tilt_velocity *= maxf(1.0 - 1.8 * delta, 0.0)
	tilt += _tilt_velocity * delta


func _up_speed(overload: float) -> float:
	if overload >= STALL_OVERLOAD:
		return 0.0
	var drive := clampf(remap(overload, 0.7, STALL_OVERLOAD, 1.0, 0.0), 0.0, 1.0)
	return (0.15 + 0.85 * drive) / UP_TIME * PlayerStats.get_lift_speed_factor()


func _down_speed(overload: float) -> float:
	return (1.0 + 0.5 * maxf(overload - 1.0, 0.0)) / DOWN_TIME


func _complete_rep() -> void:
	# Resting on the chest or in the hole breaks the tempo; a deadlift may reset on the floor.
	var paused := _starts_top and _bottom_time > PERFECT_PAUSE
	var perfect := _rep_max_tilt <= PERFECT_TILT and _rep_hitches == 0 and not paused
	var factor: float = _profile["factor"]
	var cost: float = _profile["cost"]
	var strength_weight: float = _profile["strength"]
	# Gains follow the load relative to rested strength: light bars build little.
	var intensity := clampf(weight / (PlayerStats.strength * factor), 0.35, 1.4)
	reps += 1
	PlayerStats.spend_stamina(PlayerStats.get_effort_cost(cost))
	PlayerStats.reward_rep(_profile["focus"], intensity, perfect, strength_weight)
	_reset_rep()


func _reset_rep() -> void:
	_touched_bottom = false
	_rep_max_tilt = absf(tilt)
	_rep_hitches = 0
	_bottom_time = 0.0


## The bar gets away. With `injury` the lifter also strains a muscle.
func _drop(injury: bool) -> void:
	var overload := get_overload()
	_drop_side = signf(barbell.rotation.z) if absf(barbell.rotation.z) > 0.01 else 1.0
	_start_move(Phase.DROPPED)
	_hold_bar(false)
	AudioManager.play(&"clank", 1.0, 0.8, 0.3)
	PlayerStats.add_pump(-20.0)
	if injury:
		PlayerStats.apply_strain(clampf((overload - 1.0) / 0.6, 0.0, 1.0))
	else:
		user.add_shake(0.5)
		popup("Bar slipped!", &"warning")


func _tick_dropped() -> void:
	var rack: Vector3 = _profile["rack"]
	var floor_spot: Vector3 = _profile["drop"]
	if _phase_time < 0.3:
		# Free fall with one side leading.
		var fall := pow(_phase_time / 0.3, 2.0)
		barbell.position = _move_from.lerp(floor_spot, fall)
		barbell.rotation.z = lerpf(_tilt_from, _drop_side * 0.3, fall)
	elif _phase_time < 1.3:
		# A short bounce, then the bar settles.
		var settle := _phase_time - 0.3
		barbell.position = floor_spot + Vector3.UP * absf(sin(settle * 14.0)) * 0.06 * exp(-settle * 6.0)
		barbell.rotation.z = _drop_side * lerpf(0.3, 0.12, minf(settle * 2.0, 1.0))
	else:
		var back := smoothstep(0.0, 1.0, (_phase_time - 1.3) / 0.5)
		barbell.position = floor_spot.lerp(rack, back)
		barbell.rotation.z = _drop_side * 0.12 * (1.0 - back)
		if back >= 1.0:
			_racked()
			return
	progress = move_toward(progress, 1.0, get_physics_process_delta_time() * 1.5)


func _refresh_overlay() -> void:
	if overlay == null:
		return
	var overload := get_overload()
	var level := 0
	if overload >= DANGER_OVERLOAD:
		level = 2
	elif overload > HEAVY_OVERLOAD:
		level = 1
	var lifting := phase == Phase.LIFT
	overlay.set_counter("REPS  %d" % reps)
	var detail := "Needs %d Strength  -  you have %d" % [ceili(get_required_strength()), floori(PlayerStats.get_effective_strength())]
	if PlayerStats.is_strained():
		detail += "  (strained)"
	overlay.set_selector(true, "%d kg" % roundi(weight), detail, level, phase == Phase.SETUP)
	overlay.set_balance(lifting, tilt, PERFECT_TILT)
	overlay.set_strain(lifting or strain > 0.01, strain)
	if phase == Phase.SETUP:
		overlay.set_hint("A / D  change weight      LMB / Space  lift the bar      E  leave")
	else:
		overlay.set_hint("Hold LMB / Space to lift, release to lower      Tap A / D to balance      E  rack the bar")
	var danger := ""
	if level == 2 or strain > 0.5:
		danger = "DANGER  -  TOO HEAVY"
		if not PlayerStats.is_warmed_up():
			danger += "  -  NOT WARMED UP"
	overlay.set_danger(danger)
