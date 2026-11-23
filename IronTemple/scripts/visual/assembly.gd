class_name Assembly
extends RefCounted
## Bakes many primitive parts into one mesh with a surface per material, so a detailed prop
## (a rack, a treadmill, a stocked shelf) is a single node and a handful of draw calls.
##
##   var mesh := Assembly.cached("stool", func(a: Assembly) -> void:
##       a.cyl(0.19, 0.07, Vector3(0.0, 0.77, 0.0), leather)
##       a.tube(Vector3.ZERO, Vector3(0.0, 0.74, 0.0), 0.03, chrome))
##
## The part helpers mirror Build: positions are in the prop's own space, rotations in degrees.

class Part:
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()

static var _arrays: Dictionary = {}
static var _baked: Dictionary = {}

var _order: Array[Material] = []
var _parts: Dictionary = {}


## The mesh `builder` assembles, built once per `key` and shared afterwards.
static func cached(key: String, builder: Callable) -> ArrayMesh:
	if not _baked.has(key):
		var assembly := Assembly.new()
		builder.call(assembly)
		_baked[key] = assembly.bake()
	return _baked[key]


## Node showing a cached assembly (see `cached`).
static func spawn(parent: Node, key: String, builder: Callable, pos: Vector3 = Vector3.ZERO, rot_deg: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	return place(parent, cached(key, builder), pos, rot_deg)


static func place(parent: Node, mesh: Mesh, pos: Vector3 = Vector3.ZERO, rot_deg: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.position = pos
	node.rotation_degrees = rot_deg
	parent.add_child(node)
	return node


func is_empty() -> bool:
	return _order.is_empty()


## Adds `mesh` (its first surface) transformed by `xform`.
func add(mesh: Mesh, xform: Transform3D, material: Material) -> void:
	var id := mesh.get_instance_id()
	if not _arrays.has(id):
		_arrays[id] = mesh.surface_get_arrays(0)
	_append(_arrays[id], xform, material)


## Adds every surface of an already baked mesh, keeping its materials (plates on a horn,
## bottles on a shelf).
func stamp(baked: Mesh, pos: Vector3 = Vector3.ZERO, rot_deg: Vector3 = Vector3.ZERO, scale: Vector3 = Vector3.ONE) -> void:
	var xform := Transform3D(_basis(rot_deg) * Basis.from_scale(scale), pos)
	for index in baked.get_surface_count():
		var key := "%d/%d" % [baked.get_instance_id(), index]
		if not _arrays.has(key):
			_arrays[key] = baked.surface_get_arrays(index)
		_append(_arrays[key], xform, baked.surface_get_material(index))


## Adds every mesh below `source` (a model from ModelLoader.instantiate) with the materials it
## is drawn with, placed as it sits under `source`.
func model(source: Node3D, xform: Transform3D = Transform3D.IDENTITY) -> void:
	for node in source.find_children("*", "MeshInstance3D", true, false):
		var instance := node as MeshInstance3D
		if instance.mesh == null:
			continue
		var to_root := Transform3D.IDENTITY
		var walker: Node = instance
		while walker != source and walker != null:
			if walker is Node3D:
				to_root = (walker as Node3D).transform * to_root
			walker = walker.get_parent()
		for index in instance.mesh.get_surface_count():
			_append(instance.mesh.surface_get_arrays(index), xform * to_root, instance.get_active_material(index))


func _append(source: Array, xform: Transform3D, material: Material) -> void:
	var part: Part = _parts.get(material)
	if part == null:
		part = Part.new()
		_parts[material] = part
		_order.append(material)
	var base := part.verts.size()
	var source_verts: PackedVector3Array = source[Mesh.ARRAY_VERTEX]
	part.verts.append_array(xform * source_verts)
	var source_normals: PackedVector3Array = source[Mesh.ARRAY_NORMAL]
	var scale := xform.basis.get_scale()
	if scale.is_equal_approx(Vector3.ONE):
		part.normals.append_array(Transform3D(xform.basis, Vector3.ZERO) * source_normals)
	else:
		var turned := Transform3D(xform.basis.inverse().transposed(), Vector3.ZERO) * source_normals
		for i in turned.size():
			turned[i] = turned[i].normalized()
		part.normals.append_array(turned)
	if source[Mesh.ARRAY_TEX_UV] != null:
		part.uvs.append_array(source[Mesh.ARRAY_TEX_UV] as PackedVector2Array)
	else:
		part.uvs.resize(part.verts.size())
	var mirrored := xform.basis.determinant() < 0.0
	if source[Mesh.ARRAY_INDEX] != null:
		var source_indices: PackedInt32Array = source[Mesh.ARRAY_INDEX]
		var count := source_indices.size()
		var start := part.indices.size()
		part.indices.resize(start + count)
		for i in count:
			# A mirrored part keeps facing outwards by reversing each triangle.
			var from := i if not mirrored else i - i % 3 + 2 - i % 3
			part.indices[start + i] = base + source_indices[from]
	else:
		for i in source_verts.size():
			part.indices.append(base + (i if not mirrored else i - i % 3 + 2 - i % 3))


func mesh(shape: Mesh, pos: Vector3, material: Material, rot_deg: Vector3 = Vector3.ZERO, scale: Vector3 = Vector3.ONE) -> void:
	add(shape, Transform3D(_basis(rot_deg) * Basis.from_scale(scale), pos), material)


func box(size: Vector3, pos: Vector3, material: Material, rot_deg: Vector3 = Vector3.ZERO) -> void:
	add(Shapes.box(size), Transform3D(_basis(rot_deg), pos), material)


## Box with rounded edges (padding, cushions, moulded plastic).
func rbox(size: Vector3, radius: float, pos: Vector3, material: Material, rot_deg: Vector3 = Vector3.ZERO, steps: int = 2) -> void:
	add(Shapes.rounded_box(size, radius, steps), Transform3D(_basis(rot_deg), pos), material)


func cyl(radius: float, height: float, pos: Vector3, material: Material, rot_deg: Vector3 = Vector3.ZERO, top_radius: float = -1.0, sides: int = 16) -> void:
	add(Shapes.cylinder(radius, height, top_radius, sides), Transform3D(_basis(rot_deg), pos), material)


## Cylinder stretched between two points.
func tube(from: Vector3, to: Vector3, radius: float, material: Material, sides: int = 8) -> void:
	var axis := to - from
	if axis.length_squared() < 0.00000001:
		return
	add(Shapes.cylinder(radius, axis.length(), -1.0, sides), Transform3D(Build.basis_along(axis), (from + to) * 0.5), material)


## Square-section bar stretched between two points (rack uprights, rails, stringers).
func beam(from: Vector3, to: Vector3, width: float, depth: float, material: Material) -> void:
	var axis := to - from
	if axis.length_squared() < 0.00000001:
		return
	add(Shapes.box(Vector3(width, axis.length(), depth)), Transform3D(Build.basis_along(axis), (from + to) * 0.5), material)


## Tube bent through `points`, with a ball at every bend.
func path(points: Array[Vector3], radius: float, material: Material, sides: int = 8) -> void:
	for i in points.size() - 1:
		tube(points[i], points[i + 1], radius, material, sides)
	for i in range(1, points.size() - 1):
		ball(radius, points[i], material, Vector3.ONE, sides)


func ball(radius: float, pos: Vector3, material: Material, squash: Vector3 = Vector3.ONE, sides: int = 12) -> void:
	add(Shapes.sphere(radius, sides), Transform3D(Basis.from_scale(squash), pos), material)


## Torus lying flat in XZ before `rot_deg` is applied.
func ring(radius: float, thickness: float, pos: Vector3, material: Material, rot_deg: Vector3 = Vector3.ZERO, sides: int = 24, squash: Vector3 = Vector3.ONE) -> void:
	add(Shapes.torus(radius, thickness, sides), Transform3D(_basis(rot_deg) * Basis.from_scale(squash), pos), material)


## Lathed profile of (radius, height) points standing on `pos` (see Shapes.lathe).
func lathe(profile: PackedVector2Array, pos: Vector3, material: Material, rot_deg: Vector3 = Vector3.ZERO, sides: int = 24, flat: bool = false) -> void:
	add(Shapes.lathe(profile, sides, flat), Transform3D(_basis(rot_deg), pos), material)


## Chain of interlocked oval links from `from` to `to`.
func chain(from: Vector3, to: Vector3, link: float, wire: float, material: Material) -> void:
	var span := to - from
	var count := maxi(roundi(span.length() / (link * 1.5)), 1)
	var along := Build.basis_along(span)
	for i in count:
		var centre := from + span * ((i + 0.5) / count)
		# Links alternate a quarter turn about the chain, standing on edge along it.
		var turn := Basis(Vector3.UP, PI * 0.5 * (i % 2)) * Basis(Vector3.RIGHT, PI * 0.5)
		add(Shapes.torus(link * 0.5, wire, 10, 5), Transform3D(along * turn * Basis.from_scale(Vector3(1.0, 1.0, 1.0 + span.length() / count / link * 0.55)), centre), material)


func bake() -> ArrayMesh:
	var baked := ArrayMesh.new()
	for material in _order:
		var part: Part = _parts[material]
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = part.verts
		arrays[Mesh.ARRAY_NORMAL] = part.normals
		arrays[Mesh.ARRAY_TEX_UV] = part.uvs
		arrays[Mesh.ARRAY_INDEX] = part.indices
		baked.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		baked.surface_set_material(baked.get_surface_count() - 1, material)
	return baked


## Bakes the parts and adds them to `parent` as one node.
func commit(parent: Node, node_name: String = "", pos: Vector3 = Vector3.ZERO, rot_deg: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var node := place(parent, bake(), pos, rot_deg)
	if node_name != "":
		node.name = node_name
	return node


static func _basis(rot_deg: Vector3) -> Basis:
	if rot_deg == Vector3.ZERO:
		return Basis.IDENTITY
	return Basis.from_euler(Vector3(deg_to_rad(rot_deg.x), deg_to_rad(rot_deg.y), deg_to_rad(rot_deg.z)))
