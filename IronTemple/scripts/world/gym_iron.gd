class_name GymIron
extends RefCounted
## Weight-room hardware (Step 7): plates, the bar, rack and bench steelwork, lifting
## platforms, dumbbells, kettlebells and the treadmill's trim. These are looks only. The
## stations still own their colliders, their bar and their belt; the helpers here are handed
## the station's root and dress it in its own space (origin on the floor, +Z the side the
## athlete walks up from).

const BELT_SHADER := preload("res://shaders/treadmill_belt.gdshader")
const THREAD := Color(0.78, 0.76, 0.7)

static var _stitch: Dictionary = {}


# --- Plates and bar --------------------------------------------------------------------------

## A plate lying in the XZ plane, its bore along Y. Bumpers are black rubber with the rim in
## the plate's colour code; anything under 16 cm across is a machined iron change plate.
static func plate_mesh(radius: float, width: float, color: Color) -> ArrayMesh:
	return Assembly.cached("plate/%.3f/%.3f/%s" % [radius, width, color.to_html()], func(a: Assembly) -> void:
		var half := width * 0.5
		var web := half * 0.55
		var hub := half * 0.82
		var inner := radius * 0.6
		var band := radius * 0.66
		var lip := minf(0.011, half * 0.45)
		var iron := radius < 0.16
		var rim: Material = Stylized.standard(color.darkened(0.3), 0.42, 0.85, Stylized.Surface.STEEL) if iron else Stylized.rubber(color.darkened(0.06))
		var body: Material = Stylized.standard(Color(0.13, 0.135, 0.15), 0.5, 0.85, Stylized.Surface.STEEL) if iron else GymKit.rubber()
		a.lathe(PackedVector2Array([Vector2(inner, -web), Vector2(band, -half), Vector2(radius - lip, -half), Vector2(radius, -half + lip), Vector2(radius, half - lip), Vector2(radius - lip, half), Vector2(band, half), Vector2(inner, web)]), Vector3.ZERO, rim, Vector3.ZERO, 28)
		a.lathe(PackedVector2Array([Vector2(0.064, -web), Vector2(inner, -web)]), Vector3.ZERO, body, Vector3.ZERO, 28)
		a.lathe(PackedVector2Array([Vector2(inner, web), Vector2(0.064, web)]), Vector3.ZERO, body, Vector3.ZERO, 28)
		a.lathe(PackedVector2Array([Vector2(0.064, web), Vector2(0.058, hub), Vector2(0.0258, hub), Vector2(0.0258, -hub), Vector2(0.058, -hub), Vector2(0.064, -web)]), Vector3.ZERO, Stylized.chrome(Color(0.7, 0.72, 0.76), 0.3), Vector3.ZERO, 20)
		# Printed weight blocks on the rim band, both faces.
		var print_mat := Build.mat(Color(0.92, 0.92, 0.9) if not iron else Color(0.75, 0.76, 0.8), 0.6)
		for face: float in [-1.0, 1.0]:
			for turn in 3:
				var angle := turn * TAU / 3.0
				a.box(Vector3(radius * 0.3, 0.0012, radius * 0.085), Vector3(sin(angle), 0.0, cos(angle)) * radius * 0.84 + Vector3(0.0, face * (half + 0.0003), 0.0), print_mat, Vector3(0.0, rad_to_deg(angle), 0.0))
	)


## Olympic bar along X: bare shaft with three knurled grip bands, shoulders and rotating
## sleeves that the plates slide onto from 0.62 m out.
static func barbell_mesh() -> ArrayMesh:
	return Assembly.cached("barbell", func(a: Assembly) -> void:
		var shaft := Stylized.chrome(Color(0.74, 0.76, 0.8), 0.24)
		var grip := Stylized.knurled()
		var sleeve := Stylized.chrome(GymKit.CHROME, 0.14)
		var along := Vector3(0.0, 0.0, 90.0)
		a.cyl(0.0136, 1.2, Vector3.ZERO, shaft, along, -1.0, 12)
		for band: Vector2 in [Vector2(-0.53, -0.15), Vector2(0.15, 0.53), Vector2(-0.065, 0.065)]:
			a.cyl(0.0144, band.y - band.x, Vector3((band.x + band.y) * 0.5, 0.0, 0.0), grip, along, -1.0, 14)
		for side: float in [-1.0, 1.0]:
			var out := Vector3(0.0, 0.0, -90.0 * side)
			a.lathe(PackedVector2Array([Vector2(0.0136, 0.0), Vector2(0.034, 0.0), Vector2(0.045, 0.007), Vector2(0.045, 0.024), Vector2(0.034, 0.03), Vector2(0.0245, 0.03)]), Vector3(side * 0.59, 0.0, 0.0), sleeve, out, 18)
			a.cyl(0.0245, 0.48, Vector3(side * 0.86, 0.0, 0.0), sleeve, along, -1.0, 16)
			# Grooves near the shoulder and a bolted end cap.
			for groove in 3:
				a.cyl(0.0252, 0.004, Vector3(side * (0.635 + groove * 0.012), 0.0, 0.0), shaft, along, -1.0, 16)
			a.lathe(PackedVector2Array([Vector2(0.0245, 0.0), Vector2(0.0245, 0.004), Vector2(0.019, 0.008), Vector2(0.0, 0.008)]), Vector3(side * 1.1, 0.0, 0.0), shaft, out, 16)
			a.cyl(0.009, 0.004, Vector3(side * 1.109, 0.0, 0.0), Build.mat(Color(0.03, 0.03, 0.035), 0.4), along, -1.0, 6)
	)


## Spring collar that locks the last plate on, its bore along Y.
static func collar_mesh() -> ArrayMesh:
	return Assembly.cached("collar", func(a: Assembly) -> void:
		var steel := Stylized.chrome(Color(0.62, 0.64, 0.68), 0.3)
		a.lathe(PackedVector2Array([Vector2(0.0255, -0.017), Vector2(0.037, -0.017), Vector2(0.041, -0.012), Vector2(0.041, 0.012), Vector2(0.037, 0.017), Vector2(0.0255, 0.017), Vector2(0.0255, -0.017)]), Vector3.ZERO, steel, Vector3.ZERO, 16)
		# The two spring handles.
		for side: float in [-1.0, 1.0]:
			a.tube(Vector3(0.036, 0.008 * side, 0.01 * side), Vector3(0.075, 0.008 * side, 0.03 * side), 0.004, steel, 6)
			a.ball(0.007, Vector3(0.078, 0.008 * side, 0.032 * side), GymKit.rubber(), Vector3.ONE, 8)
	)


# --- Racks and benches -----------------------------------------------------------------------

## Dashed thread for stitched padding: a strip with a two-texel dash texture.
static func stitch_material(color: Color = THREAD) -> StandardMaterial3D:
	var key := color.to_html()
	if not _stitch.has(key):
		var image := Image.create(4, 1, false, Image.FORMAT_RGBA8)
		for x in 4:
			image.set_pixel(x, 0, Color(1.0, 1.0, 1.0, 1.0 if x < 3 else 0.0))
		var material := StandardMaterial3D.new()
		material.albedo_color = color
		material.albedo_texture = ImageTexture.create_from_image(image)
		material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		material.alpha_scissor_threshold = 0.5
		material.roughness = 0.8
		_stitch[key] = material
	return _stitch[key]


## Line of stitches between two points on an upward-facing surface.
static func stitch(a: Assembly, from: Vector3, to: Vector3, color: Color = THREAD) -> void:
	var span := to - from
	var length := span.length()
	var along := span / length
	a.add(Shapes.strip(length, 0.005, length / 0.017), Transform3D(Basis(along, Vector3.UP, along.cross(Vector3.UP)), (from + to) * 0.5), stitch_material(color))


## Padded flat bench from the library, its pad re-upholstered in stitched leather. The pad
## top sits at 0.505 m, where the lifting profiles expect it.
static func bench(root: Node3D, pos: Vector3, pad_color: Color) -> MeshInstance3D:
	var paint := GymKit.palette(GymKit.ACCENT, {"pad": Stylized.leather(pad_color, 0.5)})
	var node := Assembly.place(root, ModelLoader.flat("gym/bench_flat", 0.505, {"palette": paint}), pos)
	node.name = "Bench"
	# At this size the library pad spans x +-0.19 and z +-0.69.
	Assembly.spawn(node, "bench_stitching", func(a: Assembly) -> void:
		var y := 0.5075
		for side: float in [-1.0, 1.0]:
			stitch(a, Vector3(side * 0.155, y, -0.655), Vector3(side * 0.155, y, 0.655))
			stitch(a, Vector3(-0.155, y, side * 0.655), Vector3(0.155, y, side * 0.655))
			stitch(a, Vector3(-0.155, y, side * 0.22), Vector3(0.155, y, side * 0.22))
	)
	return node


# Chrome J-hook on the front face of an upright: `seat` is where the bar's axis rests and
# `face` the z of the upright's face behind it.
static func _j_hook(a: Assembly, seat: Vector3, face: float, liner: Material) -> void:
	var chrome := GymKit.chrome()
	var reach := seat.z - face
	a.box(Vector3(0.062, 0.16, 0.012), Vector3(seat.x, seat.y + 0.02, face + 0.006), chrome)
	a.box(Vector3(0.05, 0.014, reach + 0.045), Vector3(seat.x, seat.y - 0.0215, face + (reach + 0.045) * 0.5), chrome)
	a.box(Vector3(0.05, 0.055, 0.012), Vector3(seat.x, seat.y + 0.004, seat.z + 0.039), chrome)
	# Plastic liner so the knurling is not chewed up.
	a.box(Vector3(0.044, 0.004, reach + 0.03), Vector3(seat.x, seat.y - 0.0125, face + (reach + 0.03) * 0.5), liner)
	a.cyl(0.011, 0.07, Vector3(seat.x, seat.y + 0.06, face + 0.004), chrome, Vector3(0.0, 0.0, 90.0), -1.0, 8)


# Row of adjustment holes up the face of an upright.
static func _holes(a: Assembly, x: float, z: float, from_y: float, to_y: float, facing: Vector3) -> void:
	var dark := Build.mat(Color(0.008, 0.008, 0.01), 0.9)
	var count := roundi((to_y - from_y) / 0.05)
	var tilt := Vector3(90.0, 0.0, 0.0) if absf(facing.z) > 0.5 else Vector3(0.0, 0.0, 90.0)
	for i in count + 1:
		a.cyl(0.0085, 0.003, Vector3(x, from_y + i * 0.05, z) + facing * 0.0005, dark, tilt, -1.0, 8)


# Storage horn pointing along `out` from `base`, loaded with plates given as [radius, width, colour].
static func _plate_horn(a: Assembly, base: Vector3, out: Vector3, length: float, plates: Array) -> void:
	a.tube(base, base + out * length, 0.0245, GymKit.chrome(), 12)
	a.cyl(0.03, 0.006, base + out * (length + 0.002), GymKit.frame(), Vector3(90.0, 0.0, 0.0) if absf(out.z) > 0.5 else Vector3(0.0, 0.0, 90.0), -1.0, 12)
	var cursor := 0.03
	for plate: Array in plates:
		var turn := Vector3(90.0, 0.0, 0.0) if absf(out.z) > 0.5 else Vector3(0.0, 0.0, 90.0)
		a.stamp(plate_mesh(plate[0], plate[1], plate[2]), base + out * (cursor + (plate[1] as float) * 0.5), turn)
		cursor += (plate[1] as float) + 0.004


## Bench-press uprights around a bench at the station origin: heavy dark-steel posts with
## adjustment holes, chrome J-hooks under the racked bar (y 1.11, z -0.36), chrome-capped
## safety bars just under the bottom of the press, and plate storage behind.
static func bench_press_frame(root: Node3D, accent: Color) -> MeshInstance3D:
	var node := Assembly.spawn(root, "bench_press_frame/%s" % accent.to_html(), func(a: Assembly) -> void:
		var steel := GymKit.frame()
		var chrome := GymKit.chrome()
		var rubber := GymKit.rubber()
		var liner := GymKit.plastic(Color(0.02, 0.02, 0.024))
		var plates := Barbell.PLATES
		var z := -0.45
		for side: float in [-1.0, 1.0]:
			var x := side * 0.55
			a.box(Vector3(0.06, 1.34, 0.06), Vector3(x, 0.67, z), steel)
			a.rbox(Vector3(0.068, 0.018, 0.068), 0.005, Vector3(x, 1.347, z), rubber)
			_holes(a, x, z + 0.03, 0.6, 1.25, Vector3.BACK)
			# Floor runner with rubber feet, and a gusset up to the post.
			a.box(Vector3(0.07, 0.05, 1.05), Vector3(x, 0.025, z + 0.3), steel)
			for foot: float in [-0.2, 0.8]:
				a.rbox(Vector3(0.1, 0.016, 0.12), 0.005, Vector3(x, 0.008, z + foot), rubber)
			a.beam(Vector3(x, 0.05, z + 0.42), Vector3(x, 0.46, z + 0.03), 0.04, 0.04, steel)
			a.box(Vector3(0.012, 0.16, 0.16), Vector3(x + side * 0.036, 0.1, z), steel)
			_j_hook(a, Vector3(x, 1.11, -0.36), z + 0.03, liner)
			_j_hook(a, Vector3(x, 0.9, -0.36), z + 0.03, liner)
			# Safety bar under the bottom of the press.
			a.box(Vector3(0.05, 0.05, 0.6), Vector3(x, 0.7, z + 0.33), steel)
			a.box(Vector3(0.038, 0.006, 0.54), Vector3(x, 0.728, z + 0.34), chrome)
			a.rbox(Vector3(0.056, 0.056, 0.02), 0.006, Vector3(x, 0.7, z + 0.64), Stylized.rubber(accent.darkened(0.1)))
			a.box(Vector3(0.07, 0.11, 0.012), Vector3(x, 0.7, z + 0.036), steel)
			_plate_horn(a, Vector3(x, 0.44, z - 0.03), Vector3.FORWARD, 0.2, [[plates[3]["radius"], plates[3]["width"], plates[3]["color"]], [plates[4]["radius"], plates[4]["width"], plates[4]["color"]]])
		# Cross members tie the posts together behind the lifter's head.
		a.box(Vector3(1.04, 0.05, 0.05), Vector3(0.0, 0.32, z), steel)
		a.box(Vector3(1.04, 0.07, 0.04), Vector3(0.0, 1.27, z), steel)
		a.box(Vector3(0.44, 0.05, 0.004), Vector3(0.0, 1.27, z + 0.022), Stylized.standard(accent, 0.4, 0.3, Stylized.Surface.STEEL))
		for bolt_x: float in [-0.5, 0.5]:
			for bolt_y: float in [0.32, 1.27]:
				a.cyl(0.011, 0.008, Vector3(bolt_x, bolt_y, z + 0.03), chrome, Vector3(90.0, 0.0, 0.0), -1.0, 6)
	)
	node.name = "Frame"
	return node


## Power rack: four dark-steel uprights with adjustment holes, chrome J-hooks at the racked
## bar (y 1.56, z 0.6), spotter arms out in front under the bottom of the squat, a knurled
## pull-up bar and loaded plate horns down both rear posts.
static func power_rack(root: Node3D, accent: Color) -> MeshInstance3D:
	var node := Assembly.spawn(root, "power_rack/%s" % accent.to_html(), func(a: Assembly) -> void:
		var steel := GymKit.frame()
		var chrome := GymKit.chrome()
		var rubber := GymKit.rubber()
		var paint := Stylized.standard(accent, 0.42, 0.3, Stylized.Surface.STEEL)
		var liner := GymKit.plastic(Color(0.02, 0.02, 0.024))
		var plates := Barbell.PLATES
		var post := 0.07
		var half := 0.53
		var front := 0.5
		var back := -0.55
		for side: float in [-1.0, 1.0]:
			var x := side * half
			for z: float in [back, front]:
				a.box(Vector3(post, 2.35, post), Vector3(x, 1.175, z), steel)
				a.box(Vector3(0.16, 0.012, 0.16), Vector3(x, 0.006, z), steel)
				for bolt: Vector2 in [Vector2(-0.055, -0.055), Vector2(0.055, -0.055), Vector2(-0.055, 0.055), Vector2(0.055, 0.055)]:
					a.cyl(0.009, 0.01, Vector3(x + bolt.x, 0.016, z + bolt.y), chrome, Vector3.ZERO, -1.0, 6)
				# Colour band near the top of every post.
				a.box(Vector3(post + 0.004, 0.11, post + 0.004), Vector3(x, 2.08, z), paint)
			_holes(a, x, front + post * 0.5, 0.35, 1.95, Vector3.BACK)
			_holes(a, x + side * post * 0.5, front, 0.35, 1.95, Vector3.RIGHT * side)
			_holes(a, x + side * post * 0.5, back, 0.35, 1.95, Vector3.RIGHT * side)
			# Side runners at the floor and the head, and a mid brace at the back.
			a.box(Vector3(post, post, front - back - post), Vector3(x, post * 0.5, (front + back) * 0.5), steel)
			a.box(Vector3(post, post, front - back - post), Vector3(x, 2.315, (front + back) * 0.5), steel)
			a.beam(Vector3(x, 2.28, back + 0.3), Vector3(x, 2.0, back + 0.035), 0.04, 0.04, steel)
			_j_hook(a, Vector3(x, 1.56, 0.6), front + post * 0.5, liner)
			# Spotter arm: boxed steel with a chrome-capped top, pinned through the post.
			a.box(Vector3(0.06, 0.08, 0.7), Vector3(x, 0.9, front + post * 0.5 + 0.35), steel)
			a.box(Vector3(0.044, 0.006, 0.66), Vector3(x, 0.943, front + post * 0.5 + 0.35), chrome)
			a.rbox(Vector3(0.066, 0.086, 0.02), 0.006, Vector3(x, 0.9, front + post * 0.5 + 0.705), Stylized.rubber(accent.darkened(0.1)))
			a.box(Vector3(0.012, 0.2, 0.11), Vector3(x + side * (post * 0.5 + 0.006), 0.9, front), steel)
			a.cyl(0.012, post + 0.07, Vector3(x, 0.95, front), chrome, Vector3(0.0, 0.0, 90.0), -1.0, 8)
			# Plate storage down the rear post.
			var heavy := [plates[0]["radius"], plates[0]["width"], plates[0]["color"]]
			var blue := [plates[1]["radius"], plates[1]["width"], plates[1]["color"]]
			var yellow := [plates[2]["radius"], plates[2]["width"], plates[2]["color"]]
			var green := [plates[3]["radius"], plates[3]["width"], plates[3]["color"]]
			var small := [plates[4]["radius"], plates[4]["width"], plates[4]["color"]]
			var base_x := x + side * post * 0.5
			_plate_horn(a, Vector3(base_x, 0.42, back), Vector3.RIGHT * side, 0.24, [heavy, heavy, blue] if side < 0.0 else [heavy, blue, blue])
			_plate_horn(a, Vector3(base_x, 0.98, back), Vector3.RIGHT * side, 0.24, [yellow, green, green] if side < 0.0 else [blue, yellow])
			_plate_horn(a, Vector3(base_x, 1.5, back), Vector3.RIGHT * side, 0.2, [green, small, small] if side < 0.0 else [yellow, small])
		# Head: front and rear cross members, the name plate and the pull-up bar.
		for z: float in [back, front]:
			a.box(Vector3(half * 2.0 - post, post, post), Vector3(0.0, 2.315, z), steel)
		a.box(Vector3(half * 2.0 - post, post, post), Vector3(0.0, post * 0.5, back), steel)
		a.box(Vector3(0.56, 0.055, 0.005), Vector3(0.0, 2.315, front + post * 0.5 + 0.002), paint)
		a.cyl(0.016, half * 2.0 - post, Vector3(0.0, 2.18, front), Stylized.knurled(), Vector3(0.0, 0.0, 90.0), -1.0, 12)
		for side: float in [-1.0, 1.0]:
			a.box(Vector3(0.012, 0.09, 0.07), Vector3(side * (half - post * 0.5 - 0.006), 2.2, front), steel)
			# Band pegs low on the front posts.
			a.tube(Vector3(side * half, 0.2, front + post * 0.5), Vector3(side * half, 0.2, front + post * 0.5 + 0.09), 0.011, chrome, 8)
		a.rbox(Vector3(half * 2.0 + post, 0.02, post + 0.004), 0.005, Vector3(0.0, 2.36, front), rubber)
		a.rbox(Vector3(half * 2.0 + post, 0.02, post + 0.004), 0.005, Vector3(0.0, 2.36, back), rubber)
	)
	node.name = "Rack"
	return node


## Lifting platform: a boarded hardwood centre between two rubber drop pads, in a steel frame.
## `wood` and the pads are `depth` long and centred on `centre_z`.
static func platform(root: Node3D, wood_width: float, pad_width: float, depth: float, centre_z: float) -> MeshInstance3D:
	var node := Assembly.spawn(root, "platform/%.2f/%.2f/%.2f" % [wood_width, pad_width, depth], func(a: Assembly) -> void:
		var timber := Stylized.wood(Color(0.56, 0.4, 0.23), 0.5)
		var groove := Build.mat(Color(0.07, 0.045, 0.025), 0.8)
		var steel := GymKit.frame()
		var boards := maxi(roundi(wood_width / 0.25), 2)
		a.box(Vector3(wood_width, 0.06, depth), Vector3(0.0, 0.03, 0.0), timber)
		for i in range(1, boards):
			a.box(Vector3(0.005, 0.004, depth - 0.02), Vector3(-wood_width * 0.5 + wood_width * i / boards, 0.0595, 0.0), groove)
		var total := wood_width + pad_width * 2.0
		for side: float in [-1.0, 1.0]:
			var x := side * (wood_width + pad_width) * 0.5
			a.rbox(Vector3(pad_width - 0.01, 0.066, depth - 0.01), 0.01, Vector3(x, 0.033, 0.0), Stylized.rubber(Color(0.035, 0.035, 0.04)))
			# Tile joints across the drop pad.
			for joint in range(1, 4):
				a.box(Vector3(pad_width - 0.03, 0.003, 0.006), Vector3(x, 0.066, -depth * 0.5 + depth * joint / 4.0), groove)
			a.box(Vector3(0.014, 0.07, depth + 0.028), Vector3(side * (total * 0.5 + 0.007), 0.035, 0.0), steel)
			a.box(Vector3(total + 0.028, 0.07, 0.014), Vector3(0.0, 0.035, side * (depth * 0.5 + 0.007)), steel)
	)
	node.position.z = centre_z
	node.name = "Platform"
	return node


# --- Free weights ----------------------------------------------------------------------------

## Hex rubber dumbbell from the library, lying along local X and centred on `pos` as the
## hands hold it. `head_radius` sets its size; `color` is its weight's colour code.
static func dumbbell(parent: Node, pos: Vector3, head_radius: float, color: Color, yaw_deg: float = 0.0) -> Node3D:
	var root := Build.group(parent, "Dumbbell", pos, yaw_deg)
	var id := "gym/dumbbell_light" if head_radius < 0.075 else ("gym/dumbbell" if head_radius < 0.1 else "gym/dumbbell_heavy")
	var paint := GymKit.palette(color, {
		"rubber": {"color": GymKit.RUBBER_BLACK.lerp(color, 0.3), "roughness": 0.8, "surface": Stylized.Surface.RUBBER},
		"metal": {"color": Color(0.8, 0.82, 0.86), "roughness": 0.32, "metallic": 0.75, "surface": Stylized.Surface.KNURL, "bump": 0.5},
	})
	var node := Assembly.place(root, ModelLoader.flat(id, head_radius * 2.0, {"palette": paint}), Vector3(0.0, -head_radius, 0.0))
	# The library's handles are long for their heads.
	node.scale.x = 0.62
	return root


## Three-tier steel rack stocked with graduated pairs, lightest top left to heaviest bottom
## right. Runs `length` along local X; the tiers lean towards +Z.
static func dumbbell_rack(root: Node3D, length: float) -> void:
	var frame_node := Assembly.spawn(root, "dumbbell_rack/%.2f" % length, func(a: Assembly) -> void:
		var steel := GymKit.frame()
		var rubber := GymKit.rubber()
		for i in 3:
			var x := lerpf(-length * 0.5 + 0.06, length * 0.5 - 0.06, i / 2.0)
			a.beam(Vector3(x, 0.03, 0.26), Vector3(x, 1.13, -0.27), 0.06, 0.05, steel)
			a.box(Vector3(0.07, 0.05, 0.72), Vector3(x, 0.025, 0.0), steel)
			for foot: float in [-0.3, 0.3]:
				a.rbox(Vector3(0.09, 0.014, 0.1), 0.004, Vector3(x, 0.007, foot), rubber)
		for tier in 3:
			var y := 0.34 + tier * 0.34
			var z := 0.13 - tier * 0.13
			var tilt := Vector3(14.0, 0.0, 0.0)
			a.box(Vector3(length - 0.04, 0.012, 0.3), Vector3(0.0, y, z), steel, tilt)
			# Lip at the front edge and a saddle rail for the handles.
			a.box(Vector3(length - 0.04, 0.035, 0.012), Vector3(0.0, y - 0.022, z + 0.15), steel, tilt)
			a.box(Vector3(length - 0.04, 0.014, 0.05), Vector3(0.0, y + 0.012, z), rubber, tilt)
	)
	frame_node.name = "RackFrame"
	var pairs := 9
	for tier in 3:
		var holder := Build.group(root, "Tier%d" % (tier + 1), Vector3(0.0, 0.34 + tier * 0.34, 0.13 - tier * 0.13))
		holder.rotation_degrees.x = 14.0
		for i in pairs * 2:
			var step := i / 2 + (2 - tier) * pairs
			var weight := step / float(pairs * 3 - 1)
			var color := Color.from_hsv(lerpf(0.55, 0.0, weight), 0.75, 0.95)
			var radius := lerpf(0.05, 0.105, weight)
			var x := lerpf(-length * 0.5 + 0.2, length * 0.5 - 0.2, (i + 0.5) / float(pairs * 2)) + (0.012 if i % 2 == 0 else -0.012)
			dumbbell(holder, Vector3(x, 0.024 + radius * 0.92, 0.0), radius, color, 90.0)


## Cast kettlebell from the library in its weight's colour.
static func kettlebell(parent: Node, pos: Vector3, color: Color, size: float = 1.0, yaw_deg: float = 0.0) -> MeshInstance3D:
	var paint := GymKit.palette(color, {"frame": {"color": color.darkened(0.3), "roughness": 0.5, "metallic": 0.3, "surface": Stylized.Surface.STEEL}})
	var node := Assembly.place(parent, ModelLoader.flat("gym/kettlebell", 0.27 * size, {"palette": paint}), pos, Vector3(0.0, yaw_deg, 0.0))
	node.name = "Kettlebell"
	return node


## Exercise mat: closed-cell foam with rounded edges, a ribbed grip and a rolled-in logo band.
static func exercise_mat(root: Node3D, color: Color) -> MeshInstance3D:
	var node := Assembly.spawn(root, "exercise_mat/%s" % color.to_html(), func(a: Assembly) -> void:
		var foam := Stylized.foam(color.darkened(0.35))
		a.rbox(Vector3(0.66, 0.016, 1.82), 0.006, Vector3(0.0, 0.008, 0.0), foam, Vector3.ZERO, 1)
		var rib := Stylized.foam(color.darkened(0.5))
		for i in 16:
			a.box(Vector3(0.6, 0.0015, 0.012), Vector3(0.0, 0.0165, -0.82 + i * 0.1 + 0.07), rib)
		a.box(Vector3(0.66, 0.002, 0.07), Vector3(0.0, 0.0168, -0.78), Stylized.foam(color.darkened(0.1)))
	)
	node.name = "Mat"
	return node


# --- Treadmill -------------------------------------------------------------------------------

## The library treadmill in the gym's finish, plus the trim it lacks: bottle holders either
## side of the console with a bottle in one, a start/stop cluster and status lights. The
## running belt and the live read-out belong to TreadmillStation.
static func treadmill(root: Node3D, bottle: Color) -> MeshInstance3D:
	var paint := GymKit.palette(GymKit.ACCENT, {
		"carcass": {"color": Color(0.085, 0.09, 0.105), "roughness": 0.42},
		"dark": {"color": Color(0.026, 0.026, 0.03), "roughness": 0.6},
		"screen": {"color": Color(0.008, 0.012, 0.018), "roughness": 0.12, "emission": Color(0.04, 0.3, 0.45), "energy": 0.5},
	})
	var body := Assembly.place(root, ModelLoader.flat("gym/treadmill", 1.42, {"palette": paint}))
	body.name = "Treadmill"
	var trim := Assembly.spawn(root, "treadmill_trim/%s" % bottle.to_html(), func(a: Assembly) -> void:
		var shell := GymKit.plastic(Color(0.04, 0.042, 0.05))
		var chrome := GymKit.chrome()
		for side: float in [-1.0, 1.0]:
			# Bottle holder moulded onto the console's shoulder.
			var cup := Vector3(side * 0.375, 1.07, 0.68)
			a.lathe(PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.04, 0.0), Vector2(0.046, 0.012), Vector2(0.05, 0.09), Vector2(0.044, 0.09), Vector2(0.04, 0.014), Vector2(0.0, 0.014)]), cup, shell, Vector3.ZERO, 14)
			a.box(Vector3(0.09, 0.02, 0.05), cup + Vector3(-side * 0.06, 0.06, 0.02), shell)
			# Anti-slip treads on the deck's side rails.
			for i in 7:
				a.box(Vector3(0.07, 0.003, 0.03), Vector3(side * 0.395, 0.215, -0.7 + i * 0.2), Build.mat(Color(0.3, 0.31, 0.34), 0.7))
			# Chrome heart-rate grips on the handrails.
			a.cyl(0.021, 0.11, Vector3(side * 0.24, 1.03, 0.6), chrome, Vector3(0.0, 0.0, 90.0), -1.0, 10)
		a.stamp(ModelLoader.flat("gym/water_bottle", 0.24, {"palette": GymKit.palette(bottle, {"accent": bottle, "carcass": Color(0.85, 0.87, 0.9)})}), Vector3(-0.375, 1.084, 0.68))
		# Start, stop and the safety clip under the screen.
		a.cyl(0.02, 0.012, Vector3(-0.09, 1.135, 0.705), Build.glow(Color(0.2, 1.0, 0.4), 1.6), Vector3(-70.0, 0.0, 0.0), -1.0, 12)
		a.cyl(0.02, 0.012, Vector3(0.09, 1.135, 0.705), Build.glow(Color(1.0, 0.15, 0.1), 1.6), Vector3(-70.0, 0.0, 0.0), -1.0, 12)
		a.cyl(0.026, 0.016, Vector3(0.0, 1.13, 0.703), Build.mat(Color(0.85, 0.1, 0.08), 0.4), Vector3(-70.0, 0.0, 0.0), -1.0, 12)
		a.box(Vector3(0.5, 0.012, 0.012), Vector3(0.0, 0.31, 0.664), Build.glow(GymKit.ACCENT, 1.8))
	)
	trim.name = "Trim"
	return body


## Fresh belt material for one treadmill; its "scroll" parameter is the belt's travel in metres.
static func belt_material(size: Vector2, mark_spacing: float) -> ShaderMaterial:
	var material := ShaderMaterial.new()
	material.shader = BELT_SHADER
	material.set_shader_parameter("size", size)
	material.set_shader_parameter("mark_spacing", mark_spacing)
	# A whole number of ribs per mark, so the pattern repeats exactly with the marks.
	material.set_shader_parameter("rib_pitch", mark_spacing / 21.0)
	return material
