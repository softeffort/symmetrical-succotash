class_name Barbell
extends Node3D
## Olympic barbell whose plates follow `weight`. Local X runs along the bar; the grips are
## markers the first-person hands hold on to.

const BAR_WEIGHT := 20.0
const SLEEVE_START := 0.62
const PLATES: Array[Dictionary] = [
	{"kg": 25.0, "radius": 0.225, "width": 0.05, "color": Color(0.9, 0.16, 0.16)},
	{"kg": 20.0, "radius": 0.225, "width": 0.042, "color": Color(0.16, 0.42, 0.95)},
	{"kg": 15.0, "radius": 0.2, "width": 0.038, "color": Color(0.98, 0.8, 0.12)},
	{"kg": 10.0, "radius": 0.175, "width": 0.032, "color": Color(0.2, 0.78, 0.4)},
	{"kg": 5.0, "radius": 0.14, "width": 0.026, "color": Color(0.93, 0.93, 0.95)},
]

@export var grip_half_width := 0.32
## Total weight in kilograms, bar included.
var weight := BAR_WEIGHT: set = set_weight
var grip_left: Marker3D
var grip_right: Marker3D

var _plates: Node3D


func _ready() -> void:
	# Knurled shaft, shoulders and sleeves are one baked mesh shared by every bar.
	Assembly.place(self, GymIron.barbell_mesh()).name = "Bar"
	for side: float in [-1.0, 1.0]:
		var grip := Marker3D.new()
		grip.position = Vector3(side * grip_half_width, 0.0, 0.0)
		add_child(grip)
		if side < 0.0:
			grip_left = grip
		else:
			grip_right = grip
	_plates = Node3D.new()
	add_child(_plates)
	_load_plates()


func set_weight(value: float) -> void:
	var changed := not is_equal_approx(value, weight)
	weight = maxf(value, BAR_WEIGHT)
	if is_node_ready() and changed:
		_load_plates()
		# A quick pop sells the plates sliding on.
		var tween := create_tween()
		tween.tween_property(_plates, "scale", Vector3.ONE, 0.14).from(Vector3(1.0, 1.18, 1.18))


func _load_plates() -> void:
	for child in _plates.get_children():
		child.free()
	for side: float in [-1.0, 1.0]:
		var remaining := (weight - BAR_WEIGHT) * 0.5
		var cursor := SLEEVE_START
		for plate in PLATES:
			var kg: float = plate["kg"]
			var width: float = plate["width"]
			var radius: float = plate["radius"]
			var color: Color = plate["color"]
			while remaining >= kg - 0.01:
				remaining -= kg
				# Bumpers with colour-coded rims, heaviest innermost, then iron change plates.
				Assembly.place(_plates, GymIron.plate_mesh(radius, width, color), Vector3(side * (cursor + width * 0.5), 0.0, 0.0), Vector3(0.0, 0.0, 90.0))
				cursor += width + 0.004
		if cursor > SLEEVE_START:
			Assembly.place(_plates, GymIron.collar_mesh(), Vector3(side * (cursor + 0.0175), 0.0, 0.0), Vector3(0.0, 0.0, -90.0 * side))
