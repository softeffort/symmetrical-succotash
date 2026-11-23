class_name TimeFx
extends Node
## Owns `Engine.time_scale` during fights: micro freeze frames on heavy hits (hit-stop) and the
## slow-motion window after a perfect dodge. Durations are real seconds, however slowly the
## game is running. Requests take effect from the next frame.

const FREEZE_SCALE := 0.03

## The time scale this frame's delta was measured with. Divide by it to get real time.
var frame_scale := 1.0

var _freeze_left := 0.0
var _slow_left := 0.0
var _slow_scale := 1.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(delta: float) -> void:
	var real := delta / frame_scale
	_freeze_left = maxf(_freeze_left - real, 0.0)
	_slow_left = maxf(_slow_left - real, 0.0)
	var scale := 1.0
	if _slow_left > 0.0:
		scale = _slow_scale
	if _freeze_left > 0.0:
		scale = FREEZE_SCALE
	if not is_equal_approx(scale, frame_scale):
		frame_scale = scale
		Engine.time_scale = scale


func _exit_tree() -> void:
	Engine.time_scale = 1.0


## Freezes the action for `seconds` (30 to 60 ms reads as weight).
func hit_stop(seconds: float) -> void:
	_freeze_left = maxf(_freeze_left, seconds)


func slow_motion(seconds: float, scale: float = 0.3) -> void:
	_slow_left = seconds
	_slow_scale = scale


func is_frozen() -> bool:
	return _freeze_left > 0.0


func is_slowed() -> bool:
	return _slow_left > 0.0


func clear() -> void:
	_freeze_left = 0.0
	_slow_left = 0.0
