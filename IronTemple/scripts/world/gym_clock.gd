class_name GymClock
extends Node3D
## Wall-mounted LED gym clock, facing local +Z: the system time in large digits with a
## blinking colon, the weekday and date under it and a bar that fills over each minute.

@export var color := Color(1.0, 0.24, 0.12)
@export var width := 1.1

var _digits: Label3D
var _date: Label3D
var _bar: MeshInstance3D
var _bar_length := 0.0


func _ready() -> void:
	var height := width * 0.42
	var casing := Assembly.new()
	casing.rbox(Vector3(width, height, 0.07), 0.025, Vector3(0.0, 0.0, 0.035), Stylized.steel(Color(0.03, 0.03, 0.038), 0.4))
	casing.box(Vector3(width - 0.07, height - 0.07, 0.004), Vector3(0.0, 0.0, 0.071), GymKit.screen())
	# Wall brackets, visible from the side.
	for side: float in [-1.0, 1.0]:
		casing.box(Vector3(0.05, height * 0.5, 0.03), Vector3(side * width * 0.3, 0.0, -0.012), Stylized.steel(Color(0.05, 0.05, 0.06)))
	casing.commit(self, "Casing")
	_digits = Build.text(self, "00:00", Vector3(0.0, height * 0.1, 0.076), height * 0.52, color, Vector3.ZERO, 2.6)
	_date = Build.text(self, "", Vector3(0.0, -height * 0.31, 0.076), height * 0.11, color.lerp(Color.WHITE, 0.35), Vector3.ZERO, 1.6)
	_bar_length = width - 0.2
	_bar = Build.box(self, Vector3(1.0, height * 0.022, 0.004), Vector3(-_bar_length * 0.5, -height * 0.42, 0.074), Build.glow(color, 2.4))
	_bar.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var tick := Timer.new()
	tick.wait_time = 0.5
	tick.autostart = true
	tick.timeout.connect(_refresh)
	add_child(tick)
	_refresh()


func _refresh() -> void:
	var now := Time.get_datetime_dict_from_system()
	var colon := ":" if Time.get_ticks_msec() % 1000 < 500 else " "
	_digits.text = "%02d%s%02d" % [now["hour"], colon, now["minute"]]
	var days: Array[String] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
	_date.text = "%s  %02d.%02d   GYM TIME" % [days[now["weekday"]], now["day"], now["month"]]
	var share := maxf((now["second"] as int) / 59.0, 0.02)
	_bar.scale.x = _bar_length * share
	_bar.position.x = -_bar_length * 0.5 + _bar_length * share * 0.5
