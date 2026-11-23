class_name FightKit
extends RefCounted
## Fight-hall hardware (Step 7): the cage's canvas, apron, padded posts and chain-link sides,
## the lighting rig over it, the heavy bags and the steel they hang from. Looks only: the
## fight hall, the RingManager and the PunchingBag keep every collider and trigger they had.

const CHAIN_SHADER := preload("res://shaders/chain_link.gdshader")
const CANVAS_SHADER := preload("res://shaders/canvas_mat.gdshader")
const VINYL := Color(0.028, 0.028, 0.034)
const STAGE_WHITE := Color(1.0, 0.93, 0.8)

static var _materials: Dictionary = {}


## Padded vinyl of the cage's foam.
static func vinyl(color: Color = VINYL) -> StandardMaterial3D:
	return Stylized.leather(color, 0.5)


static func chain_material(size: Vector2) -> ShaderMaterial:
	var key := "chain/%s" % size
	if not _materials.has(key):
		var material := ShaderMaterial.new()
		material.shader = CHAIN_SHADER
		material.set_shader_parameter("size", size)
		material.set_shader_parameter("rim_strength", 0.15)
		_materials[key] = material
	return _materials[key]


## Chain-link mesh panel `size` across, centred on `pos` and facing along local Z.
static func chain_link(parent: Node, size: Vector2, pos: Vector3, rot_deg: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var key := "quad/%s" % size
	if not _materials.has(key):
		var quad := QuadMesh.new()
		quad.size = size
		_materials[key] = quad
	var node := Assembly.place(parent, _materials[key], pos, rot_deg)
	node.name = "ChainLink"
	node.material_override = chain_material(size)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node


## Steelwork and padding of one fence bay `width` wide and `height` tall, standing on local
## y = 0 with local +Z pointing out of the cage: bottom and top rails, two intermediate posts,
## a mid rail, the thick foam roll along the top and the pad along the canvas edge.
static func fence_bay_mesh(width: float, height: float, stripe: Color) -> ArrayMesh:
	return Assembly.cached("fence_bay/%.2f/%.2f/%s" % [width, height, stripe.to_html()], func(a: Assembly) -> void:
		var steel := GymKit.frame()
		var foam := vinyl()
		a.tube(Vector3(-width * 0.5, height - 0.02, 0.0), Vector3(width * 0.5, height - 0.02, 0.0), 0.026, steel, 8)
		a.tube(Vector3(-width * 0.5, 0.15, 0.0), Vector3(width * 0.5, 0.15, 0.0), 0.02, steel, 8)
		a.tube(Vector3(-width * 0.5, height * 0.52, 0.0), Vector3(width * 0.5, height * 0.52, 0.0), 0.012, steel, 6)
		for share: float in [-1.0 / 6.0, 1.0 / 6.0]:
			a.tube(Vector3(width * share, 0.1, 0.0), Vector3(width * share, height - 0.02, 0.0), 0.018, steel, 8)
		# Foam roll over the top rail, with a stitched seam and a printed patch.
		a.rbox(Vector3(width, 0.19, 0.19), 0.085, Vector3(0.0, height, 0.0), foam)
		GymIron.stitch(a, Vector3(-width * 0.5 + 0.06, height + 0.096, 0.0), Vector3(width * 0.5 - 0.06, height + 0.096, 0.0), Color(0.3, 0.3, 0.33))
		a.box(Vector3(0.5, 0.07, 0.004), Vector3(0.0, height, -0.096), Build.mat(stripe, 0.5))
		# Pad along the edge of the canvas.
		a.rbox(Vector3(width + 0.06, 0.13, 0.34), 0.05, Vector3(0.0, 0.065, -0.06), foam)
		a.box(Vector3(width - 0.3, 0.004, 0.06), Vector3(0.0, 0.131, -0.1), Build.mat(stripe, 0.5))
	)


## Padded corner post standing on local y = 0: a steel core in a thick foam sleeve with
## fastening bands and a domed cap.
static func corner_post_mesh(height: float, color: Color) -> ArrayMesh:
	return Assembly.cached("corner_post/%.2f/%s" % [height, color.to_html()], func(a: Assembly) -> void:
		var foam := vinyl(color)
		var band := vinyl(color.darkened(0.45) if color.get_luminance() > 0.08 else Color(0.09, 0.09, 0.1))
		a.lathe(PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.12, 0.0), Vector2(0.14, 0.03), Vector2(0.14, height - 0.06), Vector2(0.125, height - 0.01), Vector2(0.08, height + 0.03), Vector2(0.0, height + 0.045)]), Vector3.ZERO, foam, Vector3.ZERO, 16)
		for share: float in [0.14, 0.5, 0.86]:
			a.lathe(PackedVector2Array([Vector2(0.142, height * share - 0.025), Vector2(0.144, height * share - 0.02), Vector2(0.144, height * share + 0.02), Vector2(0.142, height * share + 0.025)]), Vector3.ZERO, band, Vector3.ZERO, 16)
		# Printed patch facing into the cage and out of it.
		for face: float in [-1.0, 1.0]:
			a.box(Vector3(0.11, 0.2, 0.004), Vector3(0.0, height * 0.68, face * 0.141), Build.mat(Color(0.92, 0.92, 0.9), 0.5))
		a.cyl(0.19, 0.012, Vector3(0.0, 0.006, 0.0), GymKit.frame(), Vector3.ZERO, -1.0, 12)
	)


## Raised eight-sided stage of the cage with a flat side facing +Z: black vinyl apron with a
## kick plate and a coloured band, under the printed canvas. Returns the canvas material.
static func octagon_stage(parent: Node, radius: float, height: float, fence_apothem: float, red: Color, blue: Color) -> ShaderMaterial:
	var turn := Vector3(0.0, 22.5, 0.0)
	var apron := Assembly.new()
	apron.lathe(PackedVector2Array([Vector2(radius - 0.3, 0.0), Vector2(radius, 0.0), Vector2(radius, height - 0.07), Vector2(radius - 0.025, height - 0.01), Vector2(radius - 0.4, height - 0.01)]), Vector3.ZERO, vinyl(), turn, 8, true)
	apron.lathe(PackedVector2Array([Vector2(radius + 0.006, 0.0), Vector2(radius + 0.006, 0.09), Vector2(radius, 0.1)]), Vector3.ZERO, GymKit.frame(), turn, 8, true)
	apron.lathe(PackedVector2Array([Vector2(radius + 0.004, height - 0.2), Vector2(radius + 0.004, height - 0.13)]), Vector3.ZERO, Build.mat(red.darkened(0.1), 0.5), turn, 8, true)
	apron.commit(parent, "Apron")
	var canvas := Assembly.new()
	var print_material := ShaderMaterial.new()
	print_material.shader = CANVAS_SHADER
	print_material.set_shader_parameter("apothem", fence_apothem)
	print_material.set_shader_parameter("red", red)
	print_material.set_shader_parameter("blue", blue)
	print_material.set_shader_parameter("weave", Stylized.height_map(Stylized.Surface.CANVAS))
	print_material.set_shader_parameter("rim_strength", 0.12)
	canvas.lathe(PackedVector2Array([Vector2(radius - 0.03, height - 0.012), Vector2(radius - 0.03, height + 0.04), Vector2(0.0, height + 0.04)]), Vector3.ZERO, print_material, turn, 8, true)
	canvas.commit(parent, "Canvas")
	return print_material


## Steel treads, stringers and grab rails over the plain steps up to the gate. `steps` of
## `rise` by `tread`, `width` wide, climbing towards local -Z from the origin.
static func cage_steps(parent: Node3D, steps: int, rise: float, tread: float, width: float) -> MeshInstance3D:
	var node := Assembly.spawn(parent, "cage_steps/%d/%.2f/%.2f/%.2f" % [steps, rise, tread, width], func(a: Assembly) -> void:
		var steel := GymKit.frame()
		var grip := GymKit.rubber()
		var bright := Stylized.chrome(Color(0.6, 0.62, 0.66), 0.3)
		for i in steps:
			var top := rise * (i + 1)
			var front := -tread * i
			a.box(Vector3(width, 0.03, tread), Vector3(0.0, top - 0.015, front - tread * 0.5), steel)
			a.box(Vector3(width, rise - 0.03, 0.012), Vector3(0.0, top - 0.03 - (rise - 0.03) * 0.5, front - 0.006), steel)
			a.box(Vector3(width - 0.1, 0.006, tread - 0.08), Vector3(0.0, top + 0.002, front - tread * 0.5), grip)
			a.box(Vector3(width - 0.1, 0.008, 0.02), Vector3(0.0, top + 0.004, front - 0.02), Build.glow(Color(1.0, 0.85, 0.3), 1.2))
		for side: float in [-1.0, 1.0]:
			var x := side * (width * 0.5 + 0.01)
			a.box(Vector3(0.02, rise * steps, tread * steps), Vector3(x, rise * steps * 0.5, -tread * steps * 0.5), steel)
			# Grab rail: up from the floor, along the climb and into the gate post.
			a.path([Vector3(x, 0.0, 0.12), Vector3(x, 0.95, 0.12), Vector3(x, rise * steps + 0.95, -tread * steps + 0.05), Vector3(x, rise * steps + 0.02, -tread * steps + 0.05)] as Array[Vector3], 0.022, bright, 10)
	)
	node.name = "Steps"
	return node


## Square lighting truss of library sections `half` out from `centre`, hung from the slab at
## `ceiling`, carrying spot cans with visible beams aimed at the cage floor at `target_y`.
## Two of the cans cast shadows; the red and blue ones sit over their corners.
static func light_rig(parent: Node, centre: Vector3, half: float, ceiling: float, target_y: float, red: Color, blue: Color) -> Node3D:
	var rig := Build.group(parent, "LightRig", centre)
	var paint := {
		"metal": {"color": Color(0.11, 0.115, 0.13), "roughness": 0.36, "metallic": 0.8, "surface": Stylized.Surface.METAL, "bump": 0.1},
		"magenta": {"color": Color(0.03, 0.03, 0.036), "roughness": 0.5},
		"cyan": {"color": Color(0.03, 0.03, 0.036), "roughness": 0.5},
	}
	var section := ModelLoader.flat("gym/truss_straight", 0.0, {"palette": paint})
	var bounds := section.get_aabb()
	var count := maxi(roundi(half * 2.0 / bounds.size.x), 1)
	var stretch := half * 2.0 / (count * bounds.size.x)
	var drop := ceiling - centre.y
	var steel := GymKit.frame()
	var extras := Assembly.new()
	for side in 4:
		var turn := Basis(Vector3.UP, side * PI * 0.5)
		for i in count:
			var piece := Assembly.place(rig, section)
			piece.transform = Transform3D(turn * Basis.from_scale(Vector3(stretch, 1.0, 1.0)), turn * Vector3(-half + (i + 0.5) * half * 2.0 / count, -bounds.size.y * 0.5, half))
			piece.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		# Corner block and its hanger up to the slab.
		var corner := turn * Vector3(half, 0.0, half)
		extras.box(Vector3(0.36, bounds.size.y + 0.04, 0.36), corner, steel)
		extras.tube(corner + Vector3(0.0, bounds.size.y * 0.5, 0.0), corner + Vector3(0.0, drop, 0.0), 0.012, steel, 6)
		extras.box(Vector3(0.16, 0.02, 0.16), corner + Vector3(0.0, drop - 0.01, 0.0), steel)
	extras.commit(rig, "Hangers").cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Eight cans, two a side, converging on the middle of the canvas.
	var floor_point := Vector3(0.0, target_y - centre.y, 0.0)
	for side in 4:
		var turn := Basis(Vector3.UP, side * PI * 0.5)
		for offset: float in [-0.45, 0.45]:
			var at := turn * Vector3(half * offset * 2.0, -bounds.size.y * 0.5 - 0.31, half)
			var aim := floor_point + turn * Vector3(half * offset * 0.9, 0.0, -half * 0.25)
			var color := STAGE_WHITE
			var energy := 2.1
			# The front pair leans to its corner: red on +X, blue on -X.
			if side == 0:
				color = red.lerp(Color.WHITE, 0.25) if offset > 0.0 else blue.lerp(Color.WHITE, 0.25)
				energy = 2.6
			GymKit.stage_spot(rig, at, aim, color, energy, 27.0, side == 1 and offset > 0.0 or side == 3 and offset < 0.0, 0.11)
	return rig


## Steel beam from `from` to `to` for hanging bags from: an I-section with end plates.
static func i_beam(a: Assembly, from: Vector3, to: Vector3, depth: float = 0.18) -> void:
	var steel := GymKit.frame()
	var span := to - from
	var middle := (from + to) * 0.5
	var along := span.normalized()
	var basis := Basis(along.cross(Vector3.UP).normalized() * -1.0, Vector3.UP, along)
	var length := span.length()
	a.add(Shapes.box(Vector3(0.14, 0.014, length)), Transform3D(basis, middle + Vector3(0.0, depth * 0.5, 0.0)), steel)
	a.add(Shapes.box(Vector3(0.14, 0.014, length)), Transform3D(basis, middle - Vector3(0.0, depth * 0.5, 0.0)), steel)
	a.add(Shapes.box(Vector3(0.012, depth, length)), Transform3D(basis, middle), steel)


## Heavy bag hanging from local y = `top_chain` down: a stitched leather cylinder with capped
## ends, a printed band, four webbing straps with D-rings and the chains up to its swivel.
## The bag's centre is the origin, `length` tall; the swivel sits `hang` above its top.
static func heavy_bag_mesh(radius: float, length: float, hang: float, color: Color) -> ArrayMesh:
	return Assembly.cached("heavy_bag/%.2f/%.2f/%.2f/%s" % [radius, length, hang, color.to_html()], func(a: Assembly) -> void:
		var half := length * 0.5
		var hide := Stylized.leather(color, 0.55)
		var cap := vinyl(color.darkened(0.6) if color.get_luminance() > 0.08 else Color(0.1, 0.1, 0.11))
		var chrome := GymKit.chrome()
		var thread := Color(0.82, 0.8, 0.74) if color.get_luminance() < 0.5 else Color(0.12, 0.12, 0.13)
		a.lathe(PackedVector2Array([Vector2(0.0, -half), Vector2(radius * 0.72, -half), Vector2(radius * 0.95, -half + 0.02), Vector2(radius, -half + 0.06), Vector2(radius, half - 0.06), Vector2(radius * 0.95, half - 0.02), Vector2(radius * 0.72, half), Vector2(0.0, half)]), Vector3.ZERO, hide, Vector3.ZERO, 20)
		# End caps and the printed band.
		for low: float in [-half + 0.012, half - 0.097]:
			a.lathe(PackedVector2Array([Vector2(radius, low - 0.004), Vector2(radius + 0.005, low), Vector2(radius + 0.005, low + 0.085), Vector2(radius, low + 0.089)]), Vector3.ZERO, cap, Vector3.ZERO, 20)
		a.lathe(PackedVector2Array([Vector2(radius + 0.003, 0.23), Vector2(radius + 0.003, 0.37)]), Vector3.ZERO, Build.mat(Color(0.93, 0.93, 0.9), 0.6), Vector3.ZERO, 20)
		# Panel seams: two rings of stitches and one seam down the back.
		var seam := Build.mat(thread, 0.7)
		for y: float in [-half * 0.42, half * 0.1]:
			a.ring(radius + 0.001, 0.004, Vector3(0.0, y, 0.0), seam, Vector3.ZERO, 20)
		a.tube(Vector3(0.0, -half + 0.09, -radius - 0.001), Vector3(0.0, half - 0.09, -radius - 0.001), 0.0045, seam, 5)
		# Straps, D-rings and the four chains to the swivel.
		var top := half + 0.03
		var swivel := Vector3(0.0, half + hang, 0.0)
		for i in 4:
			var angle := i * PI * 0.5 + PI * 0.25
			var out := Vector3(cos(angle), 0.0, sin(angle))
			a.box(Vector3(0.04, 0.16, 0.005), out * (radius + 0.004) + Vector3(0.0, half - 0.05, 0.0), cap, Vector3(0.0, 90.0 - rad_to_deg(angle), 0.0))
			a.ring(0.02, 0.0045, out * (radius - 0.03) + Vector3(0.0, top, 0.0), chrome, Vector3(90.0, 90.0 - rad_to_deg(angle), 0.0), 10)
			a.chain(out * (radius - 0.03) + Vector3(0.0, top + 0.015, 0.0), swivel - Vector3(0.0, 0.03, 0.0), 0.034, 0.0045, chrome)
		a.lathe(PackedVector2Array([Vector2(0.0, -0.04), Vector2(0.02, -0.035), Vector2(0.026, -0.01), Vector2(0.026, 0.02), Vector2(0.012, 0.035), Vector2(0.012, 0.06), Vector2(0.0, 0.06)]), swivel, chrome, Vector3.ZERO, 10)
	)


## Chain of `length` hanging down from the origin, with the shackle that bolts to the beam.
static func bag_chain_mesh(length: float) -> ArrayMesh:
	return Assembly.cached("bag_chain/%.2f" % length, func(a: Assembly) -> void:
		var chrome := GymKit.chrome()
		a.chain(Vector3(0.0, -0.06, 0.0), Vector3(0.0, -length, 0.0), 0.042, 0.0055, chrome)
		a.ring(0.03, 0.007, Vector3(0.0, -0.04, 0.0), chrome, Vector3(90.0, 0.0, 0.0), 10)
	)


## Bracket that clamps a bag's shackle under the beam, at the origin.
static func bag_mount_mesh() -> ArrayMesh:
	return Assembly.cached("bag_mount", func(a: Assembly) -> void:
		var steel := GymKit.frame()
		a.box(Vector3(0.2, 0.014, 0.16), Vector3(0.0, 0.0, 0.0), steel)
		for side: float in [-1.0, 1.0]:
			a.box(Vector3(0.012, 0.08, 0.1), Vector3(side * 0.03, -0.04, 0.0), steel)
			a.cyl(0.011, 0.012, Vector3(side * 0.075, -0.012, 0.05), GymKit.chrome(), Vector3.ZERO, -1.0, 6)
			a.cyl(0.011, 0.012, Vector3(side * 0.075, -0.012, -0.05), GymKit.chrome(), Vector3.ZERO, -1.0, 6)
		a.cyl(0.012, 0.09, Vector3(0.0, -0.045, 0.0), GymKit.chrome(), Vector3(0.0, 0.0, 90.0), -1.0, 8)
	)
