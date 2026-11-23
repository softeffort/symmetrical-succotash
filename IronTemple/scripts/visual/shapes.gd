class_name Shapes
extends RefCounted
## Meshes the engine primitives cannot give: rounded boxes for padding and cushions, and lathed
## profiles for plates, bottles, bags and anything else turned on an axis. Everything is cached
## by its parameters, so repeated shapes share one mesh and are drawn instanced.

static var _meshes: Dictionary = {}


## Box with every edge and corner rounded to `radius`. `steps` is the number of facets per
## 45 degrees of the rounding.
static func rounded_box(size: Vector3, radius: float, steps: int = 2) -> ArrayMesh:
	var key := "rbox/%s/%.4f/%d" % [size, radius, steps]
	if _meshes.has(key):
		return _meshes[key]
	var half := size * 0.5
	var r := minf(radius, minf(half.x, minf(half.y, half.z)))
	var core := half - Vector3.ONE * r
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	for w in 3:
		var u := (w + 1) % 3
		var v := (w + 2) % 3
		var us := _stations(half[u], r, steps)
		var vs := _stations(half[v], r, steps)
		for side: float in [-1.0, 1.0]:
			var base := verts.size()
			for a in us:
				for b in vs:
					var p := Vector3.ZERO
					p[u] = a
					p[v] = b
					p[w] = side * half[w]
					var anchor := Vector3(clampf(p.x, -core.x, core.x), clampf(p.y, -core.y, core.y), clampf(p.z, -core.z, core.z))
					var out := p - anchor
					var normal := Vector3.ZERO
					normal[w] = side
					if out.length_squared() > 0.0000001:
						normal = out.normalized()
					verts.append(anchor + normal * r)
					normals.append(normal)
					uvs.append(Vector2(a / size[u] + 0.5, b / size[v] + 0.5))
			for i in us.size() - 1:
				for j in vs.size() - 1:
					var a0 := base + i * vs.size() + j
					var b0 := a0 + vs.size()
					if side > 0.0:
						indices.append_array(PackedInt32Array([a0, a0 + 1, b0, b0, a0 + 1, b0 + 1]))
					else:
						indices.append_array(PackedInt32Array([a0, b0, a0 + 1, b0, b0 + 1, a0 + 1]))
	var mesh := _commit(verts, normals, uvs, indices)
	_meshes[key] = mesh
	return mesh


## Surface of revolution about +Y. `profile` holds (radius, height) points running from the
## bottom of the shape to its top; a corner sharper than `crease_deg` stays a hard edge.
## `flat` facets the sides, which with few `sides` gives hexagonal and octagonal prisms.
static func lathe(profile: PackedVector2Array, sides: int = 24, flat: bool = false, crease_deg: float = 38.0) -> ArrayMesh:
	var key := "lathe/%s/%d/%s/%.1f" % [profile, sides, flat, crease_deg]
	if _meshes.has(key):
		return _meshes[key]
	# Outward normal of every profile segment, in the (radius, height) plane.
	var points := PackedVector2Array()
	for point in profile:
		if points.is_empty() or not points[points.size() - 1].is_equal_approx(point):
			points.append(point)
	var segment_normals: Array[Vector2] = []
	var lengths := PackedFloat32Array()
	var total := 0.0
	for i in points.size() - 1:
		var along := points[i + 1] - points[i]
		segment_normals.append(Vector2(along.y, -along.x).normalized())
		lengths.append(total)
		total += along.length()
	lengths.append(total)
	var crease := cos(deg_to_rad(crease_deg))
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	var apothem := cos(PI / sides)
	for i in points.size() - 1:
		var own := segment_normals[i]
		var ends: Array[Vector2] = [own, own]
		if not flat:
			if i > 0 and segment_normals[i - 1].dot(own) > crease:
				ends[0] = (segment_normals[i - 1] + own).normalized()
			if i < points.size() - 2 and segment_normals[i + 1].dot(own) > crease:
				ends[1] = (segment_normals[i + 1] + own).normalized()
		for k in sides:
			var base := verts.size()
			var angles := [k * TAU / sides, (k + 1) * TAU / sides]
			var middle := (k + 0.5) * TAU / sides
			for end in 2:
				var point := points[i + end]
				for corner in 2:
					var angle: float = angles[corner]
					verts.append(Vector3(point.x * cos(angle), point.y, point.x * sin(angle)))
					if flat:
						normals.append(Vector3(own.x * cos(middle), own.y * apothem, own.x * sin(middle)).normalized())
					else:
						var lean: Vector2 = ends[end]
						normals.append(Vector3(lean.x * cos(angle), lean.y, lean.x * sin(angle)))
					uvs.append(Vector2((k + corner) / float(sides), lengths[i + end] / maxf(total, 0.0001)))
			indices.append_array(PackedInt32Array([base, base + 1, base + 2, base + 1, base + 3, base + 2]))
	var mesh := _commit(verts, normals, uvs, indices)
	_meshes[key] = mesh
	return mesh


static func box(size: Vector3) -> BoxMesh:
	var key := "box/%s" % [size]
	if not _meshes.has(key):
		var mesh := BoxMesh.new()
		mesh.size = size
		_meshes[key] = mesh
	return _meshes[key]


static func cylinder(radius: float, height: float, top_radius: float = -1.0, sides: int = 16) -> CylinderMesh:
	var top := radius if top_radius < 0.0 else top_radius
	var key := "cyl/%.4f/%.4f/%.4f/%d" % [radius, top, height, sides]
	if not _meshes.has(key):
		var mesh := CylinderMesh.new()
		mesh.bottom_radius = radius
		mesh.top_radius = top
		mesh.height = height
		mesh.radial_segments = sides
		mesh.rings = 1
		_meshes[key] = mesh
	return _meshes[key]


static func sphere(radius: float, sides: int = 12) -> SphereMesh:
	var key := "ball/%.4f/%d" % [radius, sides]
	if not _meshes.has(key):
		var mesh := SphereMesh.new()
		mesh.radius = radius
		mesh.height = radius * 2.0
		mesh.radial_segments = sides
		mesh.rings = maxi(ceili(sides * 0.5), 3)
		_meshes[key] = mesh
	return _meshes[key]


## Torus lying flat in XZ: `radius` to the tube centre, `thickness` is the tube radius.
static func torus(radius: float, thickness: float, sides: int = 24, tube_sides: int = 8) -> TorusMesh:
	var key := "ring/%.4f/%.4f/%d/%d" % [radius, thickness, sides, tube_sides]
	if not _meshes.has(key):
		var mesh := TorusMesh.new()
		mesh.inner_radius = radius - thickness
		mesh.outer_radius = radius + thickness
		mesh.rings = sides
		mesh.ring_segments = tube_sides
		_meshes[key] = mesh
	return _meshes[key]


## Flat rectangle in the XZ plane facing +Y, with UVs running 0..1 across it.
static func plane(size: Vector2) -> PlaneMesh:
	var key := "plane/%s" % [size]
	if not _meshes.has(key):
		var mesh := PlaneMesh.new()
		mesh.size = size
		_meshes[key] = mesh
	return _meshes[key]


## Flat strip in the XZ plane facing +Y, `length` along X, whose UV.x counts `repeats`
## along it: dashed stitching and tapes drawn with a small repeating texture.
static func strip(length: float, width: float, repeats: float) -> ArrayMesh:
	var key := "strip/%.4f/%.4f/%.2f" % [length, width, repeats]
	if _meshes.has(key):
		return _meshes[key]
	var half := Vector2(length, width) * 0.5
	var verts := PackedVector3Array([Vector3(-half.x, 0.0, -half.y), Vector3(half.x, 0.0, -half.y), Vector3(half.x, 0.0, half.y), Vector3(-half.x, 0.0, half.y)])
	var normals := PackedVector3Array([Vector3.UP, Vector3.UP, Vector3.UP, Vector3.UP])
	var uvs := PackedVector2Array([Vector2(0.0, 0.0), Vector2(repeats, 0.0), Vector2(repeats, 1.0), Vector2(0.0, 1.0)])
	var mesh := _commit(verts, normals, uvs, PackedInt32Array([0, 1, 2, 0, 2, 3]))
	_meshes[key] = mesh
	return mesh


# Coordinates along one axis of a rounded box: the facets of each rounded end, spaced evenly
# around the arc, either side of the flat middle.
static func _stations(half: float, radius: float, steps: int) -> PackedFloat32Array:
	var list := PackedFloat32Array()
	for k in range(steps, -1, -1):
		list.append(-half + radius - radius * tan(k / float(steps) * PI * 0.25))
	var flat := half - radius > 0.00001
	for k in range(0 if flat else 1, steps + 1):
		list.append(half - radius + radius * tan(k / float(steps) * PI * 0.25))
	return list


static func _commit(verts: PackedVector3Array, normals: PackedVector3Array, uvs: PackedVector2Array, indices: PackedInt32Array) -> ArrayMesh:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh
