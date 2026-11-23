class_name GymProps
extends RefCounted
## Gym equipment and furniture. Props sit on the floor at y = 0; stations face local +Z, the
## side the athlete approaches from. Trainable equipment is a WorkoutStation; other usable
## props carry a GymStation marker.
##
## Since Step 7 the looks come from the model library (ModelLoader) and from the detailed
## assemblies in GymIron and GymKit; the station nodes, their colliders and the invisible
## blockers of the furniture are unchanged.

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
	GymIron.bench(root, Vector3(0.0, 0.0, 0.3), pad_color.darkened(0.5))
	GymIron.bench_press_frame(root, pad_color)
	return root


static func squat_rack(parent: Node, pos: Vector3, yaw_deg: float, cage_color: Color) -> Node3D:
	var lifter := BarbellStation.new()
	lifter.lift = &"squat"
	var root := workout(parent, lifter, &"squat", "Squat Rack", pos, yaw_deg, Vector3(1.9, 2.4, 1.7))
	GymIron.platform(root, 1.5, 0.6, 2.5, 0.25)
	GymIron.power_rack(root, cage_color)
	return root


static func deadlift_platform(parent: Node, pos: Vector3, yaw_deg: float) -> Node3D:
	var lifter := BarbellStation.new()
	lifter.lift = &"deadlift"
	var root := workout(parent, lifter, &"deadlift", "Deadlift", pos, yaw_deg, Vector3(2.4, 0.5, 0.6))
	GymIron.platform(root, 1.3, 0.75, 2.4, 0.0)
	return root


## Hex dumbbell lying along local X, centred on `pos` (it is also what the hands hold).
static func dumbbell(parent: Node, pos: Vector3, head_radius: float, color: Color, yaw_deg: float = 0.0) -> Node3D:
	return GymIron.dumbbell(parent, pos, head_radius, color, yaw_deg)


## Three-tier rack of hex dumbbells graded from light (cool colours) to heavy (hot colours).
static func dumbbell_rack(parent: Node, pos: Vector3, yaw_deg: float, length: float = 4.6) -> Node3D:
	var curls := CurlStation.new()
	curls.body_position = Vector3(0.0, 0.0, 1.05)
	curls.exit_position = curls.body_position
	var root := workout(parent, curls, &"dumbbell_curl", "Dumbbell Curls", pos, yaw_deg, Vector3(length, 1.1, 0.7))
	GymIron.dumbbell_rack(root, length)
	return root


static func weight_bench(parent: Node, pos: Vector3, yaw_deg: float) -> Node3D:
	# The lifter stands beside the bench, facing local -Z.
	var curls := CurlStation.new()
	curls.body_position = Vector3(0.75, 0.0, 0.0)
	curls.exit_position = curls.body_position
	var root := workout(parent, curls, &"dumbbell_curl", "Dumbbell Curls", pos, yaw_deg, Vector3(0.5, 0.52, 1.3))
	GymIron.bench(root, Vector3.ZERO, Color(0.05, 0.05, 0.058))
	return root


static func treadmill(parent: Node, pos: Vector3, yaw_deg: float, bottle: Color = Color(0.2, 0.6, 1.0)) -> Node3D:
	var root := workout(parent, TreadmillStation.new(), &"treadmill", "Treadmill", pos, yaw_deg, Vector3(0.9, 1.45, 2.0))
	GymIron.treadmill(root, bottle)
	return root


## Warm-up mat. Its collider sits on the interactables layer, so it can be aimed at but walked over.
static func yoga_mat(parent: Node, pos: Vector3, yaw_deg: float, color: Color) -> Node3D:
	var warmup := WarmupStation.new()
	warmup.collider_layer = 8
	var root := workout(parent, warmup, &"warmup", "Warm Up", pos, yaw_deg, Vector3(0.8, 0.5, 1.9))
	GymIron.exercise_mat(root, color)
	return root


static func kettlebell(parent: Node, pos: Vector3, color: Color, size: float = 1.0) -> void:
	GymIron.kettlebell(parent, pos, color, size)


## Plain slatted bench built from primitives (the park and plaza outside use it too).
static func bench(parent: Node, pos: Vector3, yaw_deg: float, length: float, color: Color) -> Node3D:
	var root := Build.group(parent, "Bench", pos, yaw_deg)
	Build.blocker(root, Vector3(length, 0.5, 0.45), Vector3(0.0, 0.25, 0.0))
	Build.box(root, Vector3(length, 0.08, 0.45), Vector3(0.0, 0.46, 0.0), Build.mat(color, 0.7))
	for side: float in [-1.0, 1.0]:
		Build.box(root, Vector3(0.08, 0.42, 0.4), Vector3(side * (length * 0.5 - 0.2), 0.21, 0.0), frame())
	return root


## Slatted timber-and-steel changing bench from the library, `length` long, with the same
## footprint blocker as `bench`.
static func changing_bench(parent: Node, pos: Vector3, yaw_deg: float, length: float, timber: Color = Color(0.42, 0.27, 0.15)) -> Node3D:
	var root := Build.group(parent, "Bench", pos, yaw_deg)
	Build.blocker(root, Vector3(length, 0.5, 0.45), Vector3(0.0, 0.25, 0.0))
	var paint := GymKit.palette(GymKit.ACCENT, {"timber": {"color": timber, "roughness": 0.55, "surface": Stylized.Surface.WOOD}})
	var mesh := ModelLoader.flat("gym/bench_changing", 0.48, {"palette": paint})
	var seat := Assembly.place(root, mesh)
	seat.scale.x = length / maxf(mesh.get_aabb().size.x, 0.01)
	return root


## Chrome-and-leather bar stool from the library, on the same drum blocker as before.
static func stool(parent: Node, pos: Vector3, seat_color: Color) -> Node3D:
	var root := Build.group(parent, "Stool", pos)
	Build.drum_blocker(root, 0.2, 0.8, Vector3(0.0, 0.4, 0.0))
	var bright := {"color": GymKit.CHROME, "roughness": 0.2, "metallic": 0.78, "surface": Stylized.Surface.METAL, "bump": 0.1}
	var paint := {
		"surface": bright,
		"accent": bright,
		"soft": Stylized.leather(seat_color.darkened(0.25), 0.46),
	}
	Assembly.place(root, ModelLoader.flat("gym/stool_bar_backless", 0.8, {"palette": paint}))
	return root


## Lounge seating from the library: a sofa `width` wide, or an armchair when it is narrow.
## `color` is the leather of the cushions.
static func sofa(parent: Node, pos: Vector3, yaw_deg: float, color: Color, width: float = 2.2) -> Node3D:
	var root := Build.group(parent, "Sofa", pos, yaw_deg)
	Build.blocker(root, Vector3(width, 0.85, 0.95), Vector3(0.0, 0.425, 0.0))
	var paint := {
		"teak": Stylized.leather(Color(0.05, 0.045, 0.05), 0.5),
		"navy": Stylized.leather(color.darkened(0.3), 0.5),
		"canvas": {"color": color.lightened(0.25), "roughness": 0.85, "surface": Stylized.Surface.FABRIC},
	}
	var id := "gym/sofa_modern" if width > 1.6 else "gym/armchair_lounge"
	# The library seats face local -Z once loaded; the lounge's sofas face +Z.
	var mesh := ModelLoader.flat(id, 0.88, {"palette": paint, "yaw": 180.0})
	var seat := Assembly.place(root, mesh)
	seat.scale.x = width / maxf(mesh.get_aabb().size.x, 0.01)
	return root


static func round_table(parent: Node, pos: Vector3, radius: float, height: float, top_color: Color) -> Node3D:
	var root := Build.group(parent, "Table", pos)
	Build.drum_blocker(root, radius * 0.9, height, Vector3(0.0, height * 0.5, 0.0))
	var table := Assembly.spawn(root, "round_table/%.2f/%.2f/%s" % [radius, height, top_color.to_html()], func(a: Assembly) -> void:
		var chrome := GymKit.chrome()
		var top := Stylized.standard(top_color, 0.22, 0.1, Stylized.Surface.PLAIN)
		a.lathe(PackedVector2Array([Vector2(0.0, height - 0.045), Vector2(radius - 0.03, height - 0.045), Vector2(radius, height - 0.03), Vector2(radius, height - 0.008), Vector2(radius - 0.008, height), Vector2(0.0, height)]), Vector3.ZERO, top, Vector3.ZERO, 32)
		a.lathe(PackedVector2Array([Vector2(radius - 0.004, height - 0.026), Vector2(radius + 0.002, height - 0.026), Vector2(radius + 0.002, height - 0.012), Vector2(radius - 0.004, height - 0.012)]), Vector3.ZERO, chrome, Vector3.ZERO, 32)
		a.lathe(PackedVector2Array([Vector2(0.0, 0.0), Vector2(radius * 0.55, 0.0), Vector2(radius * 0.55, 0.012), Vector2(radius * 0.5, 0.026), Vector2(0.06, 0.05), Vector2(0.04, 0.09), Vector2(0.04, height - 0.09), Vector2(0.1, height - 0.045)]), Vector3.ZERO, chrome, Vector3.ZERO, 20)
	)
	table.name = "Top"
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


## Hanging linear LED fitting with a downward spot light. `pos` is on the ceiling.
static func ceiling_light(parent: Node, pos: Vector3, color: Color, energy: float, yaw_deg: float = 0.0) -> SpotLight3D:
	return GymKit.led_pendant(parent, pos, yaw_deg, color, energy)
