class_name WarmupStation
extends WorkoutStation
## Warm-up mat with two exercises on one rhythm bar: hold the lift key to move the marker and
## let go inside the drifting sweet spot. Stretching fills the "Warmed Up" buff and eases
## strains; push-ups also train chest, arms and stamina.

enum Exercise { STRETCH, PUSHUP }

const NAMES: Array[String] = ["STRETCH", "PUSH-UPS"]
## Seconds of holding that take the marker across the whole bar.
const CHARGE_TIME: Array[float] = [1.5, 1.15]
const ZONE_HALF_WIDTH := 0.11
const PERFECT_HALF_WIDTH := 0.04
const RECOVER_TIME := 0.4
const STRETCH_WARMUP := Vector2(0.22, 0.34)
const PUSHUP_WARMUP := 0.12
const PUSHUP_COST := 3.0
const PUSHUP_FOCUS := {&"torso": 0.45, &"arms": 0.35}
## Where the toes rest during push-ups, towards the +Z end of the mat.
const FEET := Vector3(0.0, 0.0, 1.03)
const HAND_FLOOR := Vector3(0.26, 0.09, -0.77)
## Right shoulder and elbow direction in the torso frame, per exercise.
const SHOULDERS: Array[Vector3] = [Vector3(0.2, -0.25, -0.05), Vector3(0.2, 0.08, -0.06)]
const POLES: Array[Vector3] = [Vector3(0.8, -0.8, 0.2), Vector3(0.9, -0.7, 0.3)]

var exercise := Exercise.STRETCH
## Marker position on the rhythm bar, 0 to 1.
var charge := 0.0

var _holding := false
var _recover := 0.0
var _zone_clock := 0.0
var _zone_centre := 0.6
var _side := 1.0
var _hands: Array[Marker3D] = []


func _build() -> void:
	exit_position = Vector3.ZERO
	for i in 2:
		var hand := Marker3D.new()
		add_child(hand)
		_hands.append(hand)


func is_restful() -> bool:
	return exercise == Exercise.STRETCH


func handle_input(event: InputEvent) -> void:
	# Swap exercise between reps only.
	if _holding or charge > 0.02:
		return
	if event.is_action_pressed(&"move_left") or event.is_action_pressed(&"move_right"):
		_select(Exercise.PUSHUP if exercise == Exercise.STRETCH else Exercise.STRETCH)


func _begin() -> void:
	charge = 0.0
	_holding = false
	_recover = 0.0
	user.model.pose_offset = FEET
	_select(Exercise.STRETCH)
	_place_hands()
	for hand in _hands:
		hand.reset_physics_interpolation()


func _tick(delta: float) -> void:
	_zone_clock += delta
	_zone_centre = 0.62 + 0.2 * sin(_zone_clock * 1.4)
	var pressing := Input.is_action_pressed(&"lift")
	if _recover > 0.0:
		_recover -= delta
		charge = move_toward(charge, 0.0, delta * 3.5)
	elif pressing:
		_holding = true
		charge += delta / CHARGE_TIME[exercise]
		if charge >= 1.0:
			_finish(false, "Held too long")
	elif _holding:
		var miss := absf(charge - _zone_centre)
		if miss <= ZONE_HALF_WIDTH:
			_succeed(miss <= PERFECT_HALF_WIDTH)
		else:
			_finish(false, "Too early" if charge < _zone_centre else "Too late")
	else:
		charge = move_toward(charge, 0.0, delta * 3.5)

	_place_hands()
	if exercise == Exercise.STRETCH:
		user.model.pose_progress = Vector2(charge, _side)
	else:
		user.model.pose_progress = Vector2(1.0 - charge, 1.0)
	if overlay != null:
		var detail := "Warmed up" if PlayerStats.is_warmed_up() else "Warm-up  %d%%" % roundi(PlayerStats.warmup_progress * 100.0)
		overlay.set_counter("REPS  %d" % reps)
		overlay.set_selector(true, NAMES[exercise], detail, 0, not _holding)
		overlay.set_rhythm(true, charge, _zone_centre - ZONE_HALF_WIDTH, _zone_centre + ZONE_HALF_WIDTH, "HOLD, THEN RELEASE IN THE ZONE")
		overlay.set_hint("Hold LMB / Space, release inside the zone      A / D  switch exercise      E  leave")


func _view() -> Transform3D:
	if exercise == Exercise.PUSHUP:
		var eye := Vector3(0.0, lerpf(0.78, 0.32, charge), -0.61)
		return eye_frame(eye, Vector3(0.0, -1.0, -0.45), Vector3(0.0, 0.0, -1.0))
	# Reaching up tips the head back and leans it to the stretched side.
	return eye_frame(Vector3(_side * 0.1 * charge, EYE_HEIGHT + 0.03 * charge, 0.0), Vector3(_side * 0.12 * charge, -0.1 + 0.5 * charge, -1.0))


func _torso() -> Transform3D:
	if exercise == Exercise.PUSHUP:
		# Face down: "up the body" is -Z and the back faces the ceiling.
		return Transform3D(Basis(Vector3(1.0, 0.0, 0.0), Vector3(0.0, 0.0, -1.0), Vector3(0.0, 1.0, 0.0)), _view().origin)
	return super()


func _select(next: Exercise) -> void:
	exercise = next
	user.model.pose = CharacterModel.Pose.STRETCH if exercise == Exercise.STRETCH else CharacterModel.Pose.PUSHUP
	user.arms.set_grips(_hands[0], _hands[1], SHOULDERS[exercise], POLES[exercise])


func _succeed(perfect: bool) -> void:
	reps += 1
	if exercise == Exercise.STRETCH:
		PlayerStats.warm_up(STRETCH_WARMUP.y if perfect else STRETCH_WARMUP.x)
		PlayerStats.add_xp(8.0 if perfect else 4.0)
		popup("PERFECT STRETCH!" if perfect else "+Warm-up", &"perfect" if perfect else &"gain")
	else:
		# Bodyweight work matters less as the fighter gets stronger.
		var intensity := clampf(50.0 / PlayerStats.strength, 0.4, 1.0)
		PlayerStats.spend_stamina(PlayerStats.get_effort_cost(PUSHUP_COST))
		PlayerStats.reward_rep(PUSHUP_FOCUS, intensity, perfect, 0.3, 0.15)
		PlayerStats.warm_up(PUSHUP_WARMUP)
	_finish(true, "")


func _finish(success: bool, reason: String) -> void:
	_holding = false
	_recover = RECOVER_TIME
	_side = -_side
	if not success:
		PlayerStats.add_pump(-5.0)
		popup(reason, &"warning")


func _place_hands() -> void:
	for i in 2:
		var side := -1.0 if i == 0 else 1.0
		if exercise == Exercise.PUSHUP:
			_hands[i].position = Vector3(HAND_FLOOR.x * side, HAND_FLOOR.y, HAND_FLOOR.z)
		else:
			# Hands rise from the hips to overhead as the stretch deepens.
			var low := Vector3(0.3 * side, EYE_HEIGHT - 0.5, -0.46)
			var high := Vector3(0.3 * side + _side * 0.08, EYE_HEIGHT + 0.36, -0.34)
			_hands[i].position = low.lerp(high, smoothstep(0.0, 1.0, charge))
