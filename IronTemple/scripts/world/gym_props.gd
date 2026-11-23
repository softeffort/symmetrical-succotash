class_name GymProps
extends RefCounted
## Stylized gym equipment and furniture built from primitives.
## Props sit on the floor at y = 0; stations face local +Z, the side the athlete approaches from.
## Trainable equipment is a WorkoutStation; other usable props carry a GymStation marker.

const STEEL := Color(0.74, 0.77, 0.82)
const FRAME := Color(0.13, 0.14, 0.17)
const RUBBER := Color(0.07, 0.07, 0.09)
const WOOD := Color(0.8, 0.62, 0.4)
const PLATES: Array[Color] = [Color(0.92, 0.22, 0.2), Color(0.16, 0.47, 0.96), Color(0.99, 0.8, 0.12), Color(0.2, 0.78, 0.4)]


static func steel() -> StandardMaterial3D:
	return Build.mat(STEEL, 0.35, 0.55)


static func frame() -> StandardMaterial3D:
	return Build.mat(FRAME, 0.55, 0.2)


## Root node for an interactable station. `bounds` is its collider; `lift` raises the collider
## off the floor (hanging equipment).
static func station(parent: Node, type: StringName, title: String, pos: Vector3, yaw_deg: float, bounds: Vector3, lift: float = 0.0) -> Node3D:
	var root := Build.group(parent, title.to_pascal_case(), pos, yaw_deg)
	var body := Build.blocker(root, bounds, Vector3(0.0, lift + bounds.y * 0.5, 0.0))
	body.name = "Body"
	var marker := GymStation.new()
	marker.name = "Station"
	marker.station_type = type
	marker.action_text = title
	body.add_child(marker)
	return root


## Places a workout station and gives it an interaction collider. The station builds its own
## moving parts (barbell, belt); the caller adds the static frame afterwards.
static func workout(parent: Node, node: WorkoutStation, type: StringName, title: String, pos: Vector3, yaw_deg: float, bounds: Vector3) -> WorkoutStation:
	node.name = title.to_pascal_case()
	node.title = title
	node.station_type = type
	node.collider_size = bounds
	node.position = pos
	node.rotation_degrees.y = yaw_deg
	parent.add_child(node, true)
	return node


static func bench_press(parent: Node, pos: Vector3, yaw_deg: float, pad_color: Color) -> Node3D:
	var lifter := BarbellStation.new()
	lifter.lift = &"bench_press"
	var root := workout(parent, lifter, &"bench_press", "Bench Press", pos, yaw_deg, Vector3(1.9, 1.25, 2.0))
	var pad := Stylized.leather(pad_color.darkened(0.12), 0.6)
	Build.box(root, Vector3(0.34, 0.09, 1.3), Vector3(0.0, 0.46, 0.3), pad)
	Build.box(root, Vector3(0.1, 0.06, 1.2), Vector3(0.0, 0.385, 0.3), frame())
	Build.box(root, Vector3(0.5, 0.06, 0.08), Vector3(0.0, 0.03, 0.9), frame())
	Build.tube(root, Vector3(0.0, 0.03, 0.9), Vector3(0.0, 0.4, 0.86), 0.035, frame())
	Build.tube(root, Vector3(-0.55, 0.3, -0.45), Vector3(0.55, 0.3, -0.45), 0.03, frame())
	for side: float in [-1.0, 1.0]:
		Build.tube(root, Vector3(side * 0.55, 0.0, -0.45), Vector3(side * 0.55, 1.22, -0.45), 0.04, frame())
		Build.box(root, Vector3(0.1, 0.05, 0.9), Vector3(side * 0.55, 0.025, -0.2), frame())
		Build.box(root, Vector3(0.06, 0.12, 0.16), Vector3(side * 0.55, 1.03, -0.38), steel())
	return root


static func squat_rack(parent: Node, pos: Vector3, yaw_deg: float, cage_color: Color) -> Node3D:
	var lifter := BarbellStation.new()
	lifter.lift = &"squat"
	var root := workout(parent, lifter, &"squat", "Squat Rack", pos, yaw_deg, Vector3(1.9, 2.4, 1.7))
	var cage := Build.mat(cage_color, 0.5, 0.2)
	Build.box(root, Vector3(1.5, 0.06, 2.5), Vector3(0.0, 0.03, 0.25), Build.mat(WOOD, 0.7))
	for side: float in [-1.0, 1.0]:
		Build.box(root, Vector3(0.6, 0.065, 2.5), Vector3(side * 1.05, 0.032, 0.25), Build.mat(RUBBER))
		for z: float in [-0.55, 0.5]:
			Build.tube(root, Vector3(side * 0.62, 0.0, z), Vector3(side * 0.62, 2.35, z), 0.04, cage)
		Build.tube(root, Vector3(side * 0.62, 2.35, -0.55), Vector3(side * 0.62, 2.35, 0.5), 0.035, cage)
		Build.tube(root, Vector3(side * 0.62, 0.85, -0.55), Vector3(side * 0.62, 0.85, 0.5), 0.025, steel())
		Build.box(root, Vector3(0.06, 0.12, 0.16), Vector3(side * 0.62, 1.48, 0.57), steel())
	for z: float in [-0.55, 0.5]:
		Build.tube(root, Vector3(-0.62, 2.35, z), Vector3(0.62, 2.35, z), 0.035, cage)
	Build.tube(root, Vector3(-0.62, 2.2, 0.5), Vector3(0.62, 2.2, 0.5), 0.02, steel())
	return root


static func deadlift_platform(parent: Node, pos: Vector3, yaw_deg: float) -> Node3D:
	var lifter := BarbellStation.new()
	lifter.lift = &"deadlift"
	var root := workout(parent, lifter, &"deadlift", "Deadlift", pos, yaw_deg, Vector3(2.4, 0.5, 0.6))
	Build.box(root, Vector3(1.3, 0.06, 2.4), Vector3(0.0, 0.03, 0.0), Build.mat(WOOD, 0.7))
	for side: float in [-1.0, 1.0]:
		Build.box(root, Vector3(0.75, 0.065, 2.4), Vector3(side * 1.02, 0.032, 0.0), Build.mat(RUBBER))
	return root


static func dumbbell(parent: Node, pos: Vector3, head_radius: float, color: Color, yaw_deg: float = 0.0) -> Node3D:
	var root := Build.group(parent, "Dumbbell", pos, yaw_deg)
	Build.tube(root, Vector3(-0.1, 0.0, 0.0), Vector3(0.1, 0.0, 0.0), 0.014, steel(), 6)
	for side: float in [-1.0, 1.0]:
		Build.cyl(root, head_radius, 0.085, Vector3(side * 0.115, 0.0, 0.0), Build.mat(color, 0.6), false, Vector3(0.0, 0.0, 90.0), -1.0, 6)
	return root


## Two-tier rack of hex dumbbells graded from light (cool colours) to heavy (hot colours).
static func dumbbell_rack(parent: Node, pos: Vector3, yaw_deg: float, length: float = 4.6) -> Node3D:
	var curls := CurlStation.new()
	curls.body_position = Vector3(0.0, 0.0, 1.05)
	curls.exit_position = curls.body_position
	var root := workout(parent, curls, &"dumbbell_curl", "Dumbbell Curls", pos, yaw_deg, Vector3(length, 1.1, 0.7))
	for side: float in [-1.0, 1.0]:
		var x := side * (length * 0.5 - 0.06)
		Build.tube(root, Vector3(x, 0.0, 0.25), Vector3(x, 1.0, -0.2), 0.035, frame())
		Build.box(root, Vector3(0.08, 0.05, 0.7), Vector3(x, 0.025, 0.0), frame())
	var per_tier := 10
	for tier in 2:
		var y := 0.42 + tier * 0.42
		var z := 0.08 - tier * 0.16
		Build.box(root, Vector3(length, 0.04, 0.34), Vector3(0.0, y, z), frame(), false, Vector3(12.0, 0.0, 0.0))
		for i in per_tier:
			var weight := (i + (1 - tier) * per_tier) / float(per_tier * 2 - 1)
			var color := Color.from_hsv(lerpf(0.55, 0.0, weight), 0.75, 0.95)
			var x := lerpf(-length * 0.5 + 0.3, length * 0.5 - 0.3, i / float(per_tier - 1))
			dumbbell(root, Vector3(x, y + 0.03 + lerpf(0.06, 0.11, weight), z), lerpf(0.06, 0.11, weight), color, 90.0)
	return root


static func weight_bench(parent: Node, pos: Vector3, yaw_deg: float) -> Node3D:
	# The lifter stands beside the bench, facing local -Z.
	var curls := CurlStation.new()
	curls.body_position = Vector3(0.75, 0.0, 0.0)
	curls.exit_position = curls.body_position
	var root := workout(parent, curls, &"dumbbell_curl", "Dumbbell Curls", pos, yaw_deg, Vector3(0.5, 0.52, 1.3))
	Build.box(root, Vector3(0.32, 0.09, 1.25), Vector3(0.0, 0.46, 0.0), Build.mat(Color(0.12, 0.13, 0.16), 0.6))
	Build.box(root, Vector3(0.1, 0.06, 1.1), Vector3(0.0, 0.385, 0.0), frame())
	for z: float in [-0.5, 0.5]:
		Build.box(root, Vector3(0.46, 0.05, 0.08), Vector3(0.0, 0.025, z), frame())
		Build.tube(root, Vector3(0.0, 0.03, z), Vector3(0.0, 0.38, z), 0.03, frame())
	return root


static func treadmill(parent: Node, pos: Vector3, yaw_deg: float) -> Node3D:
	var root := workout(parent, TreadmillStation.new(), &"treadmill", "Treadmill", pos, yaw_deg, Vector3(0.9, 1.45, 2.0))
	var shell := Build.mat(Color(0.2, 0.21, 0.25), 0.5)
	Build.box(root, Vector3(0.84, 0.16, 1.9), Vector3(0.0, 0.1, 0.0), shell)
	Build.box(root, Vector3(0.6, 0.02, 1.55), Vector3(0.0, 0.19, -0.12), Build.mat(RUBBER))
	Build.box(root, Vector3(0.84, 0.24, 0.42), Vector3(0.0, 0.27, 0.74), shell)
	Build.box(root, Vector3(0.84, 0.03, 0.06), Vector3(0.0, 0.4, 0.55), Build.glow(Color(1.0, 0.5, 0.1), 1.6))
	for side: float in [-1.0, 1.0]:
		Build.box(root, Vector3(0.1, 0.04, 1.9), Vector3(side * 0.37, 0.2, 0.0), steel())
		Build.tube(root, Vector3(side * 0.37, 0.3, 0.78), Vector3(side * 0.37, 1.28, 0.9), 0.035, shell)
		Build.tube(root, Vector3(side * 0.37, 1.08, 0.86), Vector3(side * 0.37, 1.02, 0.2), 0.028, steel())
	Build.box(root, Vector3(0.86, 0.34, 0.1), Vector3(0.0, 1.36, 0.9), shell, false, Vector3(22.0, 0.0, 0.0))
	Build.box(root, Vector3(0.56, 0.2, 0.02), Vector3(0.0, 1.37, 0.845), Build.glow(Color(0.25, 0.9, 1.0), 1.8), false, Vector3(22.0, 0.0, 0.0))
	return root


## Warm-up mat. Its collider sits on the interactables layer, so it can be aimed at but walked over.
static func yoga_mat(parent: Node, pos: Vector3, yaw_deg: float, color: Color) -> Node3D:
	var warmup := WarmupStation.new()
	warmup.collider_layer = 8
	var root := workout(parent, warmup, &"warmup", "Warm Up", pos, yaw_deg, Vector3(0.8, 0.5, 1.9))
	Build.box(root, Vector3(0.65, 0.015, 1.8), Vector3(0.0, 0.008, 0.0), Build.mat(color, 0.9))
	Build.box(root, Vector3(0.65, 0.016, 0.06), Vector3(0.0, 0.008, -0.78), Build.mat(color.darkened(0.3), 0.9))
	return root


static func kettlebell(parent: Node, pos: Vector3, color: Color, size: float = 1.0) -> void:
	var material := Build.mat(color, 0.5)
	Build.ball(parent, 0.11 * size, pos + Vector3(0.0, 0.1 * size, 0.0), material, Vector3(1.0, 0.92, 1.0))
	Build.ring(parent, 0.06 * size, 0.014 * size, pos + Vector3(0.0, 0.21 * size, 0.0), material, Vector3(90.0, 0.0, 0.0), 12)


static func bench(parent: Node, pos: Vector3, yaw_deg: float, length: float, color: Color) -> Node3D:
	var root := Build.group(parent, "Bench", pos, yaw_deg)
	Build.blocker(root, Vector3(length, 0.5, 0.45), Vector3(0.0, 0.25, 0.0))
	Build.box(root, Vector3(length, 0.08, 0.45), Vector3(0.0, 0.46, 0.0), Build.mat(color, 0.7))
	for side: float in [-1.0, 1.0]:
		Build.box(root, Vector3(0.08, 0.42, 0.4), Vector3(side * (length * 0.5 - 0.2), 0.21, 0.0), frame())
	return root


static func stool(parent: Node, pos: Vector3, seat_color: Color) -> Node3D:
	var root := Build.group(parent, "Stool", pos)
	Build.drum_blocker(root, 0.2, 0.8, Vector3(0.0, 0.4, 0.0))
	Build.cyl(root, 0.19, 0.07, Vector3(0.0, 0.77, 0.0), Build.mat(seat_color, 0.5))
	Build.cyl(root, 0.03, 0.72, Vector3(0.0, 0.37, 0.0), steel(), false, Vector3.ZERO, -1.0, 8)
	Build.cyl(root, 0.22, 0.03, Vector3(0.0, 0.015, 0.0), steel())
	Build.ring(root, 0.15, 0.012, Vector3(0.0, 0.3, 0.0), steel(), Vector3.ZERO, 16)
	return root


static func sofa(parent: Node, pos: Vector3, yaw_deg: float, color: Color, width: float = 2.2) -> Node3D:
	var root := Build.group(parent, "Sofa", pos, yaw_deg)
	var fabric := Build.mat(color, 0.9)
	var cushion := Build.mat(color.lightened(0.18), 0.9)
	Build.blocker(root, Vector3(width, 0.85, 0.95), Vector3(0.0, 0.425, 0.0))
	Build.box(root, Vector3(width, 0.32, 0.95), Vector3(0.0, 0.24, 0.0), fabric)
	Build.box(root, Vector3(width, 0.55, 0.22), Vector3(0.0, 0.62, -0.365), fabric)
	Build.box(root, Vector3(width - 0.5, 0.14, 0.66), Vector3(0.0, 0.46, 0.1), cushion)
	for side: float in [-1.0, 1.0]:
		Build.box(root, Vector3(0.22, 0.62, 0.95), Vector3(side * (width * 0.5 - 0.11), 0.39, 0.0), fabric)
		Build.cyl(root, 0.04, 0.08, Vector3(side * (width * 0.5 - 0.15), 0.04, 0.35), frame(), false, Vector3.ZERO, -1.0, 8)
	return root


static func round_table(parent: Node, pos: Vector3, radius: float, height: float, top_color: Color) -> Node3D:
	var root := Build.group(parent, "Table", pos)
	Build.drum_blocker(root, radius * 0.9, height, Vector3(0.0, height * 0.5, 0.0))
	Build.cyl(root, radius, 0.05, Vector3(0.0, height - 0.025, 0.0), Build.mat(top_color, 0.25, 0.1), false, Vector3.ZERO, -1.0, 24)
	Build.cyl(root, 0.04, height - 0.05, Vector3(0.0, (height - 0.05) * 0.5, 0.0), steel(), false, Vector3.ZERO, -1.0, 8)
	Build.cyl(root, radius * 0.55, 0.03, Vector3(0.0, 0.015, 0.0), steel())
	return root


## A decorative model from the library standing at `pos`, `height` metres tall, with no
## collider. A missing model becomes ModelLoader's procedural stand-in.
static func prop(parent: Node, id: String, pos: Vector3, yaw_deg: float, height: float, options: Dictionary = {}) -> Node3D:
	var model := ModelLoader.instantiate(id, height, options)
	model.position = pos
	model.rotation_degrees.y = yaw_deg
	parent.add_child(model)
	return model


static func plant(parent: Node, pos: Vector3, size: float = 1.0) -> Node3D:
	var root := Build.group(parent, "Plant", pos)
	Build.drum_blocker(root, 0.25 * size, 0.9 * size, Vector3(0.0, 0.45 * size, 0.0))
	if ModelLoader.has_model("gym/potted_plant"):
		root.add_child(ModelLoader.instantiate("gym/potted_plant", 1.25 * size))
		return root
	Build.cyl(root, 0.18 * size, 0.42 * size, Vector3(0.0, 0.21 * size, 0.0), Build.mat(Color(0.93, 0.93, 0.95), 0.6), false, Vector3.ZERO, 0.25 * size)
	var leaf := Build.mat(Color(0.2, 0.62, 0.3), 0.9)
	Build.ball(root, 0.32 * size, Vector3(0.0, 0.75 * size, 0.0), leaf, Vector3(1.0, 1.25, 1.0), 8)
	Build.ball(root, 0.22 * size, Vector3(0.14 * size, 1.08 * size, 0.06 * size), Build.mat(Color(0.3, 0.72, 0.36), 0.9), Vector3.ONE, 8)
	return root


## Glowing ceiling panel with a downward spot light.
static func ceiling_light(parent: Node, pos: Vector3, color: Color, energy: float, panel: Vector2 = Vector2(2.6, 0.5)) -> void:
	Build.box(parent, Vector3(panel.x, 0.06, panel.y), pos, Build.glow(color, 2.2))
	Build.spot_down(parent, pos - Vector3(0.0, 0.15, 0.0), color, energy, 9.0, 78.0)
