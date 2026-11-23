class_name CurlStation
extends WorkoutStation
## Alternating dumbbell curls: the left mouse button curls the left arm, the right button the
## right arm. Alternating arms at a steady tempo builds a rhythm streak and perfect reps.

const UP_TIME := 0.42
const DOWN_TIME := 0.36
const TOP := 0.96
const BOTTOM := 0.15
## Seconds between reps that count as keeping the rhythm.
const TEMPO := Vector2(0.3, 1.3)
const REP_COST := 2.0
const HOLD_DRAIN := 0.8
const FOCUS := {&"arms": 0.6}
## Right hand at the bottom and top of a curl and the arc's control point, relative to the eyes.
const HAND_REST := Vector3(0.3, -0.56, -0.44)
const HAND_ARC := Vector3(0.31, -0.46, -0.66)
const HAND_PEAK := Vector3(0.25, -0.21, -0.42)
const LOOK := Vector3(0.0, -0.36, -1.0)

## Curl height per arm, 0 to 1: x is the left arm, y the right.
var curl := Vector2.ZERO
## Consecutive reps that alternated arms in tempo.
var rhythm := 0
## Weight of each dumbbell in kilograms, picked from the lifter's strength.
var dumbbell_weight := 5.0

var _armed := [true, true]
var _last_arm := -1
var _since_rep := 10.0
var _view_dumbbells: Array[Node3D] = []
var _mirror_dumbbells: Array[Node3D] = []


func _begin() -> void:
	curl = Vector2.ZERO
	rhythm = 0
	_armed = [true, true]
	_last_arm = -1
	_since_rep = 10.0
	dumbbell_weight = clampf(snappedf(PlayerStats.strength * 0.22, 2.5), 5.0, 40.0)
	var head := lerpf(0.06, 0.115, (dumbbell_weight - 5.0) / 35.0)
	var color := Color.from_hsv(lerpf(0.55, 0.0, (dumbbell_weight - 5.0) / 35.0), 0.75, 0.95)
	for i in 2:
		# One pair for the first-person hands, one on the mirrored body's hands.
		var held := GymProps.dumbbell(self, Vector3.ZERO, head, color)
		# Slightly undersized: at arm's length a true-size dumbbell fills the view.
		held.scale = Vector3.ONE * 0.8
		set_render_layers(held, PlayerArms.FIRST_PERSON_LAYER)
		_view_dumbbells.append(held)
		var mirrored := GymProps.dumbbell(user.model.get_hand(i), Vector3.ZERO, head, color)
		set_render_layers(mirrored, user.model.render_layers)
		_mirror_dumbbells.append(mirrored)
	_place_dumbbells()
	for held in _view_dumbbells:
		held.reset_physics_interpolation()
	user.model.pose = CharacterModel.Pose.CURL
	user.model.pose_progress = Vector2.ZERO
	user.arms.set_grips(_view_dumbbells[0], _view_dumbbells[1], PlayerArms.DEFAULT_SHOULDER, Vector3(0.35, -1.0, 0.6))


func _end() -> void:
	for node in _view_dumbbells + _mirror_dumbbells:
		node.queue_free()
	_view_dumbbells.clear()
	_mirror_dumbbells.clear()


func _tick(delta: float) -> void:
	_since_rep += delta
	var pressed := [Input.is_action_pressed(&"curl_left"), Input.is_action_pressed(&"curl_right")]
	# Heavier arms move the same dumbbells faster; a strain slows them down.
	var speed := PlayerStats.get_lift_speed_factor() * lerpf(0.75, 1.0, PlayerStats.get_stamina_ratio())
	for i in 2:
		var height := curl[i]
		if pressed[i]:
			height = minf(height + speed * delta / UP_TIME, 1.0)
			PlayerStats.spend_stamina(HOLD_DRAIN * delta)
		else:
			height = maxf(height - delta / DOWN_TIME, 0.0)
		curl[i] = height
		if height <= BOTTOM:
			_armed[i] = true
		elif height >= TOP and _armed[i]:
			_armed[i] = false
			_complete_rep(i)
	_place_dumbbells()
	user.model.pose_progress = curl
	if overlay != null:
		overlay.set_counter("REPS  %d      RHYTHM  x%d" % [reps, rhythm])
		overlay.set_arms(true, curl.x, curl.y, TOP)
		overlay.set_selector(true, "%s kg dumbbells" % String.num(dumbbell_weight, 1), "", 0, false)
		overlay.set_hint("LMB  curl left      RMB  curl right      Alternate in rhythm      E  leave")


func _view() -> Transform3D:
	# The head dips a touch with each curl.
	var effort := (curl.x + curl.y) * 0.5
	return eye_frame(body_position + Vector3(0.0, EYE_HEIGHT - 0.012 * effort, 0.0), LOOK.rotated(Vector3.UP, body_yaw))


func _complete_rep(arm: int) -> void:
	var alternated := arm != _last_arm
	var in_tempo := _last_arm == -1 or (_since_rep >= TEMPO.x and _since_rep <= TEMPO.y)
	rhythm = rhythm + 1 if alternated and in_tempo else 0
	_last_arm = arm
	_since_rep = 0.0
	reps += 1
	PlayerStats.spend_stamina(PlayerStats.get_effort_cost(REP_COST))
	# Curling the same arm twice in a row is half a rep's worth of work.
	PlayerStats.reward_rep(FOCUS, 1.0 if alternated else 0.5, rhythm >= 2, 0.2)


func _place_dumbbells() -> void:
	var frame := Transform3D(Basis(Vector3.UP, body_yaw), body_position + Vector3.UP * EYE_HEIGHT)
	for i in 2:
		var side := -1.0 if i == 0 else 1.0
		var t := smoothstep(0.0, 1.0, curl[i])
		# Quadratic arc: the hand swings forward before it comes up to the shoulder.
		var hand := HAND_REST.lerp(HAND_ARC, t).lerp(HAND_ARC.lerp(HAND_PEAK, t), t)
		_view_dumbbells[i].transform = frame * Transform3D(Basis.IDENTITY, Vector3(hand.x * side, hand.y, hand.z))
