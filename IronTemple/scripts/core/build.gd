class_name Build
extends RefCounted
## Toolkit for assembling stylized props from primitive meshes.
## Each helper parents the new node and returns it; `solid` adds a matching StaticBody3D.
## Meshes and materials are cached so repeated props are drawn instanced.

static var _materials: Dictionary = {}
static var _meshes: Dictionary = {}


## Flat-colour material with the stylized finish its gloss suggests: brushed grain on metal,
## weave on matte cloth and paint, mottling on masonry (see Stylized). Colours with alpha below 1
## become plain double-sided transparent.
static func mat(color: Color, roughness: float = 0.85, metallic: float = 0.0) -> StandardMaterial3D:
	return Stylized.standard(color, roughness, metallic, Stylized.guess(roughness, metallic))


## Self-lit material for neon, screens and lamps; blooms through the environment glow.
static func glow(color: Color, energy: float = 2.5) -> StandardMaterial3D:
	var key := "glow/%s/%.2f" % [color.to_html(), energy]
	if not _materials.has(key):
		var material := StandardMaterial3D.new()
		material.albedo_color = color
		material.emission_enabled = true
		material.emission = color
		material.emission_energy_multiplier = energy
		_materials[key] = material
	return _materials[key]


static func glass(color: Color = Color(0.62, 0.84, 0.98, 0.2)) -> StandardMaterial3D:
	return mat(color, 0.08)


static func group(parent: Node, node_name: String, pos: Vector3 = Vector3.ZERO, yaw_deg: float = 0.0) -> Node3D:
	var node := Node3D.new()
	node.name = node_name
	node.position = pos
	node.rotation_degrees.y = yaw_deg
	parent.add_child(node, true)
	return node


static func box(parent: Node, size: Vector3, pos: Vector3, material: Material, solid: bool = false, rot_deg: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var key := "box/%s" % [size]
	var mesh: BoxMesh = _meshes.get(key)
	if mesh == null:
		mesh = BoxMesh.new()
		mesh.size = size
		_meshes[key] = mesh
	var node := _spawn(parent, mesh, pos, rot_deg, material)
	if solid:
		var shape := BoxShape3D.new()
		shape.size = size
		_solidify(node, shape)
	return node


## Cylinder or cone (set `top_radius`). Low `sides` gives hexagonal or octagonal prisms.
static func cyl(parent: Node, radius: float, height: float, pos: Vector3, material: Material, solid: bool = false, rot_deg: Vector3 = Vector3.ZERO, top_radius: float = -1.0, sides: int = 16) -> MeshInstance3D:
	var top := radius if top_radius < 0.0 else top_radius
	var key := "cyl/%.4f/%.4f/%.4f/%d" % [radius, top, height, sides]
	var mesh: CylinderMesh = _meshes.get(key)
	if mesh == null:
		mesh = CylinderMesh.new()
		mesh.bottom_radius = radius
		mesh.top_radius = top
		mesh.height = height
		mesh.radial_segments = sides
		mesh.rings = 1
		_meshes[key] = mesh
	var node := _spawn(parent, mesh, pos, rot_deg, material)
	if solid:
		var shape := CylinderShape3D.new()
		shape.radius = maxf(radius, top)
		shape.height = height
		_solidify(node, shape)
	return node


## Cylinder stretched between two points (frame tubes, rails, chains, spokes).
static func tube(parent: Node, from: Vector3, to: Vector3, radius: float, material: Material, sides: int = 8) -> MeshInstance3D:
	var axis := to - from
	var node := cyl(parent, radius, axis.length(), (from + to) * 0.5, material, false, Vector3.ZERO, -1.0, sides)
	node.basis = basis_along(axis)
	return node


static func ball(parent: Node, radius: float, pos: Vector3, material: Material, squash: Vector3 = Vector3.ONE, sides: int = 12) -> MeshInstance3D:
	var key := "ball/%.4f/%d" % [radius, sides]
	var mesh: SphereMesh = _meshes.get(key)
	if mesh == null:
		mesh = SphereMesh.new()
		mesh.radius = radius
		mesh.height = radius * 2.0
		mesh.radial_segments = sides
		mesh.rings = maxi(ceili(sides * 0.5), 3)
		_meshes[key] = mesh
	var node := _spawn(parent, mesh, pos, Vector3.ZERO, material)
	node.scale = squash
	return node


## Triangular prism (gable roofs). The ridge runs along local Z.
static func prism(parent: Node, size: Vector3, pos: Vector3, material: Material, rot_deg: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var key := "prism/%s" % [size]
	var mesh: PrismMesh = _meshes.get(key)
	if mesh == null:
		mesh = PrismMesh.new()
		mesh.size = size
		_meshes[key] = mesh
	return _spawn(parent, mesh, pos, rot_deg, material)


## Torus lying flat in XZ: `radius` to the tube centre, `thickness` is the tube radius.
static func ring(parent: Node, radius: float, thickness: float, pos: Vector3, material: Material, rot_deg: Vector3 = Vector3.ZERO, sides: int = 24) -> MeshInstance3D:
	var key := "ring/%.4f/%.4f/%d" % [radius, thickness, sides]
	var mesh: TorusMesh = _meshes.get(key)
	if mesh == null:
		mesh = TorusMesh.new()
		mesh.inner_radius = radius - thickness
		mesh.outer_radius = radius + thickness
		mesh.rings = sides
		mesh.ring_segments = 8
		_meshes[key] = mesh
	return _spawn(parent, mesh, pos, rot_deg, material)


## Unshaded 3D text facing local +Z. `glow_boost` above 1 pushes it into the bloom range.
static func text(parent: Node, string: String, pos: Vector3, letter_height: float, color: Color, rot_deg: Vector3 = Vector3.ZERO, glow_boost: float = 1.0) -> Label3D:
	var label := Label3D.new()
	label.text = string
	label.font_size = 128
	label.pixel_size = letter_height / 128.0
	label.outline_size = 0
	label.modulate = Color(color.r * glow_boost, color.g * glow_boost, color.b * glow_boost, color.a)
	label.position = pos
	label.rotation_degrees = rot_deg
	parent.add_child(label)
	return label


## Invisible box collider.
static func blocker(parent: Node, size: Vector3, pos: Vector3, rot_deg: Vector3 = Vector3.ZERO) -> StaticBody3D:
	var shape := BoxShape3D.new()
	shape.size = size
	return _body(parent, shape, pos, rot_deg)


## Invisible upright cylinder collider.
static func drum_blocker(parent: Node, radius: float, height: float, pos: Vector3) -> StaticBody3D:
	var shape := CylinderShape3D.new()
	shape.radius = radius
	shape.height = height
	return _body(parent, shape, pos, Vector3.ZERO)


## Shadowless ceiling light pointing straight down, so it never leaks into the storey above.
static func spot_down(parent: Node, pos: Vector3, color: Color, energy: float, reach: float, angle_deg: float = 70.0) -> SpotLight3D:
	var light := SpotLight3D.new()
	light.position = pos
	light.rotation_degrees.x = -90.0
	light.light_color = color
	light.light_energy = energy
	light.spot_range = reach
	light.spot_angle = angle_deg
	light.spot_attenuation = 0.7
	parent.add_child(light)
	return light


static func omni(parent: Node, pos: Vector3, color: Color, energy: float, reach: float) -> OmniLight3D:
	var light := OmniLight3D.new()
	light.position = pos
	light.light_color = color
	light.light_energy = energy
	light.omni_range = reach
	parent.add_child(light)
	return light


## Wall slab along local X from `x0` to `x1`, spanning `y0`..`y1`, centred on z = 0.
## `openings` are Rect2s in wall space (x, y, width, height) left empty for doors and windows.
static func wall(parent: Node, x0: float, x1: float, y0: float, y1: float, thickness: float, material: Material, openings: Array[Rect2] = [], solid: bool = true) -> Node3D:
	var root := Node3D.new()
	parent.add_child(root)
	var sorted := openings.duplicate()
	sorted.sort_custom(func(a: Rect2, b: Rect2) -> bool: return a.position.x < b.position.x)
	var cursor := x0
	for opening: Rect2 in sorted:
		_wall_piece(root, cursor, opening.position.x, y0, y1, thickness, material, solid)
		_wall_piece(root, opening.position.x, opening.end.x, y0, opening.position.y, thickness, material, solid)
		_wall_piece(root, opening.position.x, opening.end.x, opening.end.y, y1, thickness, material, solid)
		cursor = opening.end.x
	_wall_piece(root, cursor, x1, y0, y1, thickness, material, solid)
	return root


## Straight flight climbing towards local -Z from `origin` (bottom front edge, centre).
## Visual steps sit on one smooth ramp collider, so a CharacterBody3D needs no step-up logic.
## `rail_sides` takes -1 (left when climbing) and/or 1 to add guarded handrails.
static func stairs(parent: Node, origin: Vector3, yaw_deg: float, steps: int, rise: float, tread: float, width: float, material: Material, rail_material: Material = null, rail_sides: Array[int] = []) -> Node3D:
	var root := group(parent, "Stairs", origin, yaw_deg)
	for i in steps:
		# The top tread is solid so the ramp hands over to the landing without a gap.
		box(root, Vector3(width, rise, tread), Vector3(0.0, rise * (i + 0.5), -tread * (i + 0.5)), material, i == steps - 1)
	var height := rise * steps
	var run := tread * steps
	var slope := atan2(rise, tread)
	var length := Vector2(run, height).length()
	var normal := Vector3(0.0, cos(slope), sin(slope))
	# The ramp follows the step nosings, starting one tread in front of the first riser.
	var mid := Vector3(0.0, height * 0.5, tread - run * 0.5)
	blocker(root, Vector3(width, 0.2, length), mid - normal * 0.1, Vector3(rad_to_deg(slope), 0.0, 0.0))
	for side: float in [-1.0, 1.0]:
		var x := side * (width * 0.5 - 0.05)
		box(root, Vector3(0.1, 0.32, length - tread), mid + Vector3(x, 0.0, -tread * 0.5) - normal * 0.28, material, false, Vector3(rad_to_deg(slope), 0.0, 0.0))
	for side: int in rail_sides:
		var x := side * (width * 0.5 - 0.06)
		var foot := Vector3(x, 0.0, tread)
		var head := Vector3(x, height, tread - run)
		tube(root, foot + Vector3.UP * 1.0, head + Vector3.UP * 1.0, 0.045, rail_material)
		for i in 5:
			var point := foot.lerp(head, i / 4.0)
			tube(root, point, point + Vector3.UP * 1.0, 0.03, rail_material)
		blocker(root, Vector3(0.1, 1.2, length), mid + Vector3(x, 0.0, 0.0) + normal * 0.6, Vector3(rad_to_deg(slope), 0.0, 0.0))
	return root


## Orthonormal basis whose Y axis points along `direction` (used to aim cylinders and limbs).
static func basis_along(direction: Vector3) -> Basis:
	var y := direction.normalized()
	var x := y.cross(Vector3.UP)
	if x.length_squared() < 0.0001:
		x = y.cross(Vector3.RIGHT)
	x = x.normalized()
	return Basis(x, y, x.cross(y))


static func _wall_piece(root: Node3D, xa: float, xb: float, ya: float, yb: float, thickness: float, material: Material, solid: bool) -> void:
	if xb - xa < 0.01 or yb - ya < 0.01:
		return
	box(root, Vector3(xb - xa, yb - ya, thickness), Vector3((xa + xb) * 0.5, (ya + yb) * 0.5, 0.0), material, solid)


static func _spawn(parent: Node, mesh: Mesh, pos: Vector3, rot_deg: Vector3, material: Material) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.position = pos
	node.rotation_degrees = rot_deg
	parent.add_child(node)
	return node


static func _solidify(node: Node3D, shape: Shape3D) -> void:
	_body(node, shape, Vector3.ZERO, Vector3.ZERO)


static func _body(parent: Node, shape: Shape3D, pos: Vector3, rot_deg: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = pos
	body.rotation_degrees = rot_deg
	var collider := CollisionShape3D.new()
	collider.shape = shape
	body.add_child(collider)
	parent.add_child(body)
	return body
