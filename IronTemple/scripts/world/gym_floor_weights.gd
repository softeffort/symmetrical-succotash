extends Node3D
## Storey 1: weight and cardio room.
## Gym-local coordinates: entrance at z = 0, room spans x -14.6..14.6 and z -0.4..-25.6.
## The mirror wall is a scene instance (MirrorWall) so it can be tuned in the editor.

const CEILING := 4.7
const ACCENT := Color(1.0, 0.5, 0.1)


func _ready() -> void:
	_build_floor()
	_build_free_weights()
	_build_strength()
	_build_cardio()
	_build_warmup()
	_build_dressing()
	_build_lighting()


func _build_floor() -> void:
	# Finishes stay within a few centimetres of the ground collider at y = 0.
	Build.box(self, Vector3(29.6, 0.04, 26.0), Vector3(0.0, 0.0, -13.0), Build.mat(Color(0.19, 0.2, 0.24), 0.95))
	Build.box(self, Vector3(5.2, 0.02, 12.8), Vector3(-11.9, 0.025, -13.0), Build.mat(GymProps.WOOD.darkened(0.1), 0.6))
	Build.box(self, Vector3(13.0, 0.02, 5.0), Vector3(0.0, 0.025, -12.3), Build.mat(Color(0.5, 0.12, 0.13), 0.9))
	Build.box(self, Vector3(11.6, 0.02, 3.6), Vector3(8.6, 0.025, -2.4), Build.mat(Color(0.16, 0.3, 0.5), 0.9))


func _build_free_weights() -> void:
	GymProps.dumbbell_rack(self, Vector3(-13.9, 0.02, -22.4), 90.0)
	for z: float in [-10.0, -16.0]:
		GymProps.weight_bench(self, Vector3(-11.0, 0.02, z), 90.0)
		GymProps.dumbbell(self, Vector3(-10.2, 0.11, z + 1.0), 0.08, Color(0.2, 0.8, 0.9), 20.0)
		GymProps.dumbbell(self, Vector3(-10.5, 0.11, z + 1.3), 0.08, Color(0.2, 0.8, 0.9), -35.0)
	Build.text(self, "FREE WEIGHTS", Vector3(-14.55, 4.15, -13.0), 0.5, ACCENT, Vector3(0.0, 90.0, 0.0), 1.4)


func _build_strength() -> void:
	var plates := GymProps.PLATES
	for i in 3:
		GymProps.bench_press(self, Vector3(-4.2 + i * 4.2, 0.02, -12.4), 0.0, plates[i])
	GymProps.squat_rack(self, Vector3(-5.5, 0.02, -23.8), 0.0, ACCENT)
	GymProps.squat_rack(self, Vector3(-1.0, 0.02, -23.8), 0.0, Color(0.95, 0.8, 0.1))
	GymProps.deadlift_platform(self, Vector3(4.2, 0.02, -23.4), 0.0)
	# Plate tree between the racks.
	var tree := Build.group(self, "PlateTree", Vector3(-3.25, 0.02, -24.6))
	Build.blocker(tree, Vector3(0.7, 1.3, 0.7), Vector3(0.0, 0.65, 0.0))
	Build.tube(tree, Vector3.ZERO, Vector3(0.0, 1.3, 0.0), 0.04, GymProps.frame())
	Build.cyl(tree, 0.35, 0.04, Vector3(0.0, 0.02, 0.0), GymProps.frame())
	for i in 4:
		Build.cyl(tree, 0.22 - i * 0.02, 0.05, Vector3(0.0, 0.35 + i * 0.25, 0.12), Build.mat(plates[i], 0.6), false, Vector3(90.0, 0.0, 0.0))
	Build.text(self, "STRENGTH", Vector3(-1.0, 4.0, -25.55), 0.6, ACCENT, Vector3.ZERO, 1.4)


func _build_cardio() -> void:
	for i in 5:
		GymProps.treadmill(self, Vector3(4.0 + i * 2.2, 0.02, -2.4), 0.0)
	Build.text(self, "CARDIO", Vector3(8.6, 4.25, -0.45), 0.5, Color(0.3, 0.85, 1.0), Vector3(0.0, 180.0, 0.0), 1.4)


func _build_warmup() -> void:
	# Interlocking foam tiles.
	var tiles := [Build.mat(Color(0.15, 0.7, 0.75), 0.95), Build.mat(Color(0.3, 0.8, 0.45), 0.95)]
	for column in 4:
		for row in 2:
			var tile: Material = tiles[(column + row) % 2]
			Build.box(self, Vector3(2.2, 0.04, 2.2), Vector3(-12.2 + column * 2.2, 0.04, -2.0 - row * 2.2), tile)
	for i in 3:
		var mat_color := Color.from_hsv(0.78 + i * 0.09, 0.55, 0.9)
		GymProps.yoga_mat(self, Vector3(-12.3 + i * 1.3, 0.06, -3.0), 0.0, mat_color)
	Build.cyl(self, 0.08, 0.65, Vector3(-8.2, 0.14, -4.6), Build.mat(Color(0.95, 0.4, 0.6), 0.9), false, Vector3(0.0, 30.0, 90.0))
	Build.ball(self, 0.17, Vector3(-7.4, 0.23, -2.0), Build.mat(Color(0.95, 0.3, 0.25), 0.7))
	Build.ball(self, 0.14, Vector3(-7.0, 0.2, -2.5), Build.mat(Color(0.2, 0.45, 0.95), 0.7))
	for i in 4:
		GymProps.kettlebell(self, Vector3(-5.3, 0.06, -1.6 - i * 0.45), Color.from_hsv(0.12 - i * 0.03, 0.8, 0.95), 0.85 + i * 0.12)
	Build.box(self, Vector3(0.7, 0.6, 0.7), Vector3(-6.0, 0.36, -4.6), Build.mat(GymProps.WOOD, 0.7), true)
	Build.text(self, "WARM-UP", Vector3(-8.7, 4.25, -0.45), 0.5, Color(0.35, 0.9, 0.55), Vector3(0.0, 180.0, 0.0), 1.4)


func _build_dressing() -> void:
	# Lockers along the east wall beyond the stairs.
	for i in 7:
		var door := Color.from_hsv(0.58, 0.55, 0.85) if i % 2 == 0 else Color(1.0, 0.5, 0.1)
		Build.box(self, Vector3(0.5, 1.9, 0.98), Vector3(14.3, 0.97, -17.6 - i * 1.02), Build.mat(Color(0.3, 0.32, 0.38)), true)
		Build.box(self, Vector3(0.03, 1.8, 0.9), Vector3(14.04, 0.97, -17.6 - i * 1.02), Build.mat(door, 0.5))
	GymProps.bench(self, Vector3(12.6, 0.02, -20.6), 90.0, 3.0, GymProps.WOOD)
	GymProps.plant(self, Vector3(-2.9, 0.02, -1.1), 1.2)
	GymProps.plant(self, Vector3(2.9, 0.02, -1.1), 1.2)
	GymProps.plant(self, Vector3(9.4, 0.02, -24.8), 1.3)
	# Library props tucked against the walls, clear of every station and walkway.
	GymProps.prop(self, "gym/water_cooler", Vector3(4.5, 0.02, -0.75), 180.0, 1.35)
	GymProps.prop(self, "gym/fan_standing", Vector3(-4.6, 0.02, -0.9), 160.0, 1.5)
	GymProps.prop(self, "gym/radio_boombox", Vector3(8.2, 0.02, -25.1), 0.0, 0.34)
	GymProps.prop(self, "gym/trashcan", Vector3(10.5, 0.02, -25.0), 0.0, 0.7)
	# Accent stripe around the room at rail height.
	var stripe := Build.mat(ACCENT, 0.6)
	Build.box(self, Vector3(29.2, 0.14, 0.02), Vector3(0.0, 4.45, -25.58), stripe)
	Build.box(self, Vector3(0.02, 0.14, 25.2), Vector3(14.58, 4.45, -13.0), stripe)
	Build.box(self, Vector3(0.02, 0.14, 25.2), Vector3(-14.58, 4.45, -13.0), stripe)


func _build_lighting() -> void:
	var white := Color(1.0, 0.98, 0.94)
	for x: float in [-9.5, -0.5, 7.2]:
		for z: float in [-4.5, -13.0, -21.5]:
			GymProps.ceiling_light(self, Vector3(x, CEILING - 0.04, z), white, 3.2)
