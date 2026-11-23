class_name TreadmillStation
extends WorkoutStation
## Treadmill: W and S set the belt speed. Above the training pace it builds legs and maximum
## stamina and drains stamina; below it the jog is active recovery and stamina refills faster.

const MAX_SPEED := 20.0
## Belt speed in km/h above which running counts as training.
const TRAINING_SPEED := 7.0
const START_SPEED := 6.0
const SPEED_CHANGE := 5.0
const BELT_ACCELERATION := 6.0
## Metres of training pace that pay out one cardio rep.
const INTERVAL := 12.0
const STAMINA_DRAIN := 2.2
const RECOVERY_RATE := 0.06
const FOCUS := {&"legs": 0.5}
const STAMINA_GROWTH := 0.3
const DECK_HEIGHT := 0.2
const BELT_FROM := -0.88
const BELT_LENGTH := 1.52
const STRIPES := 6

## Current belt speed and the speed dialled in, in km/h.
var speed := 0.0
var target_speed := 0.0
## Metres run this session.
var distance := 0.0

var _interval := 0.0
var _belt_offset := 0.0
var _winded := false
var _stripes: Array[MeshInstance3D] = []
var _display: Label3D


func _build() -> void:
	# The runner faces the console at the +Z end of the deck.
	body_position = Vector3(0.0, DECK_HEIGHT, -0.15)
	body_yaw = PI
	exit_position = Vector3(0.0, 0.0, -1.5)
	var stripe := Build.mat(Color(0.2, 0.2, 0.24), 0.9)
	for i in STRIPES:
		_stripes.append(Build.box(self, Vector3(0.58, 0.004, 0.05), Vector3.ZERO, stripe))
	_display = Build.text(self, "0.0", Vector3(0.0, 1.375, 0.832), 0.1, Color(0.05, 0.1, 0.14), Vector3(-22.0, 180.0, 0.0))
	_move_belt()


func _begin() -> void:
	speed = 0.0
	target_speed = START_SPEED
	distance = 0.0
	_interval = 0.0
	_winded = false


func _end() -> void:
	speed = 0.0
	gait_move = 0.0
	gait_sprint = 0.0
	_display.text = "0.0"


func _tick(delta: float) -> void:
	target_speed = clampf(target_speed + Input.get_axis(&"move_back", &"move_forward") * SPEED_CHANGE * delta, 0.0, MAX_SPEED)
	if PlayerStats.is_exhausted:
		# Out of breath: the belt backs off to a walk until stamina returns.
		if not _winded and target_speed > TRAINING_SPEED:
			popup("Out of breath!", &"warning")
		_winded = true
		target_speed = minf(target_speed, TRAINING_SPEED - 2.0)
	else:
		_winded = false
	speed = move_toward(speed, target_speed, BELT_ACCELERATION * delta)

	var metres := speed / 3.6 * delta
	distance += metres
	_belt_offset = fposmod(_belt_offset + metres, BELT_LENGTH / STRIPES)
	_move_belt()
	gait_move = clampf(speed / 6.0, 0.0, 1.0)
	gait_sprint = clampf((speed - 9.0) / 8.0, 0.0, 1.0)
	gait_phase = fmod(gait_phase + delta * TAU * lerpf(0.9, 1.7, speed / MAX_SPEED) * gait_move, TAU)

	if speed > TRAINING_SPEED:
		var effort := speed / 10.0
		PlayerStats.spend_stamina(STAMINA_DRAIN * effort * effort * delta)
		_interval += metres
		if _interval >= INTERVAL:
			_interval -= INTERVAL
			reps += 1
			PlayerStats.reward_rep(FOCUS, clampf(effort, 0.7, 1.6), false, 0.0, STAMINA_GROWTH)
	elif speed > 1.0:
		PlayerStats.restore_stamina(PlayerStats.max_stamina * RECOVERY_RATE * delta)

	_display.text = "%.1f" % speed
	if overlay != null:
		var pace := "TRAINING PACE" if speed > TRAINING_SPEED else "RECOVERY PACE"
		overlay.set_counter("%d m" % roundi(distance))
		overlay.set_speed(true, speed / MAX_SPEED, TRAINING_SPEED / MAX_SPEED, "%.1f km/h      %s" % [speed, pace])
		overlay.set_hint("W  faster      S  slower      Under %d km/h stamina recovers      E  step off" % roundi(TRAINING_SPEED))


func _view() -> Transform3D:
	# Footsteps bob the head: twice per stride vertically, once side to side.
	var bob := sin(gait_phase * 2.0) * (0.03 + 0.03 * gait_sprint) * gait_move
	var sway := cos(gait_phase) * 0.02 * gait_move
	var eye := body_position + Vector3(sway, EYE_HEIGHT + bob, 0.0)
	return eye_frame(eye, Vector3(0.0, -0.14, 1.0))


func _move_belt() -> void:
	var spacing := BELT_LENGTH / STRIPES
	for i in STRIPES:
		# The belt runs backwards under the runner, towards -Z.
		var along := BELT_LENGTH - fposmod(i * spacing + _belt_offset, BELT_LENGTH)
		_stripes[i].position = Vector3(0.0, DECK_HEIGHT + 0.002, BELT_FROM + along)
