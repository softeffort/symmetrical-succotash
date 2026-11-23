class_name ModelFallbacks
extends RefCounted
## Procedural stand-ins for models that could not be loaded, so a failed download never leaves
## a hole in the world or an error in the log. Each one is assembled from several shaped parts
## and picked by keywords in the model id; anything unknown becomes a banded crate.

# keyword -> [builder name, height the builder works at]
const _KINDS := {
	"car": ["_car", 1.45], "sedan": ["_car", 1.45], "taxi": ["_car", 1.45], "truck": ["_car", 1.9], "van": ["_car", 1.9],
	"lamp": ["_lamp", 4.2], "light": ["_lamp", 4.2], "lantern": ["_lamp", 4.2],
	"tree": ["_tree", 4.5], "bush": ["_plant", 1.1], "plant": ["_plant", 1.1],
	"bench": ["_bench", 0.85], "sofa": ["_sofa", 0.85], "chair": ["_sofa", 0.85],
	"bin": ["_bin", 1.0], "trash": ["_bin", 1.0], "cone": ["_cone", 0.7], "hydrant": ["_hydrant", 0.8],
	"bottle": ["_bottle", 0.26], "boombox": ["_boombox", 0.32], "speaker": ["_boombox", 0.32],
	"dumbbell": ["_dumbbell", 0.2], "kettlebell": ["_kettlebell", 0.28],
	"superhero": ["_mannequin", 1.86], "character": ["_mannequin", 1.86], "mannequin": ["_mannequin", 1.86],
}


## Stand-in for `id`, `size` metres tall (0 keeps the builder's own height), pivot on the floor.
static func build(id: String, size: float = 0.0) -> Node3D:
	var root := Node3D.new()
	root.name = "Fallback"
	var name := id.get_file().to_lower()
	var kind: Array = ["_crate", 0.8]
	for keyword: String in _KINDS:
		if name.contains(keyword):
			kind = _KINDS[keyword]
			break
	match kind[0] as String:
		"_car": _car(root)
		"_lamp": _lamp(root)
		"_tree": _tree(root)
		"_plant": _plant(root)
		"_bench": _bench(root)
		"_sofa": _sofa(root)
		"_bin": _bin(root)
		"_cone": _cone(root)
		"_hydrant": _hydrant(root)
		"_bottle": _bottle(root)
		"_boombox": _boombox(root)
		"_dumbbell": _dumbbell(root)
		"_kettlebell": _kettlebell(root)
		"_mannequin": _mannequin(root)
		_: _crate(root)
	if size > 0.0:
		root.scale = Vector3.ONE * (size / (kind[1] as float))
	return root


static func _crate(root: Node3D) -> void:
	var wood := Stylized.standard(Color(0.62, 0.45, 0.28), 0.85, 0.0, Stylized.Surface.MASONRY)
	var band := Stylized.metal(Color(0.3, 0.31, 0.34))
	Build.box(root, Vector3(0.8, 0.8, 0.8), Vector3(0.0, 0.4, 0.0), wood)
	for y: float in [0.12, 0.68]:
		Build.box(root, Vector3(0.83, 0.07, 0.83), Vector3(0.0, y, 0.0), band)
	for x: float in [-0.36, 0.36]:
		for z: float in [-0.36, 0.36]:
			Build.box(root, Vector3(0.1, 0.82, 0.1), Vector3(x, 0.41, z), wood)


static func _car(root: Node3D) -> void:
	var paint := Stylized.standard(Color(0.78, 0.16, 0.14), 0.3, 0.3, Stylized.Surface.PLAIN)
	var dark := Stylized.rubber(Color(0.07, 0.07, 0.08))
	var chrome := Stylized.metal(Color(0.8, 0.82, 0.86), 0.2)
	Build.box(root, Vector3(1.75, 0.5, 4.2), Vector3(0.0, 0.55, 0.0), paint)
	Build.box(root, Vector3(1.6, 0.14, 4.0), Vector3(0.0, 0.26, 0.0), dark)
	Build.box(root, Vector3(1.55, 0.55, 2.1), Vector3(0.0, 1.05, 0.2), paint)
	Build.box(root, Vector3(1.57, 0.4, 1.9), Vector3(0.0, 1.07, 0.2), Build.glass(Color(0.2, 0.3, 0.4, 0.75)))
	for x: float in [-0.82, 0.82]:
		for z: float in [-1.3, 1.35]:
			Build.cyl(root, 0.33, 0.24, Vector3(x, 0.33, z), dark, false, Vector3(0.0, 0.0, 90.0))
			Build.cyl(root, 0.18, 0.25, Vector3(x, 0.33, z), chrome, false, Vector3(0.0, 0.0, 90.0))
	for x: float in [-0.6, 0.6]:
		Build.box(root, Vector3(0.32, 0.14, 0.06), Vector3(x, 0.62, -2.1), Build.glow(Color(1.0, 0.95, 0.8), 1.5))
		Build.box(root, Vector3(0.32, 0.12, 0.06), Vector3(x, 0.62, 2.1), Build.glow(Color(1.0, 0.1, 0.1), 1.2))
	Build.box(root, Vector3(1.8, 0.12, 0.12), Vector3(0.0, 0.36, -2.12), chrome)
	Build.box(root, Vector3(1.8, 0.12, 0.12), Vector3(0.0, 0.36, 2.12), chrome)


static func _lamp(root: Node3D) -> void:
	var iron := Stylized.metal(Color(0.16, 0.17, 0.2), 0.5)
	Build.cyl(root, 0.16, 0.3, Vector3(0.0, 0.15, 0.0), iron, false, Vector3.ZERO, 0.1, 10)
	Build.cyl(root, 0.06, 3.7, Vector3(0.0, 2.05, 0.0), iron, false, Vector3.ZERO, 0.045, 10)
	Build.tube(root, Vector3(0.0, 3.85, 0.0), Vector3(0.0, 4.05, -0.7), 0.04, iron)
	Build.box(root, Vector3(0.3, 0.1, 0.5), Vector3(0.0, 4.08, -0.75), iron)
	Build.box(root, Vector3(0.24, 0.04, 0.42), Vector3(0.0, 4.02, -0.75), Build.glow(Color(1.0, 0.9, 0.7), 3.0))


static func _tree(root: Node3D) -> void:
	var bark := Stylized.standard(Color(0.36, 0.25, 0.17), 0.9, 0.0, Stylized.Surface.MASONRY)
	Build.cyl(root, 0.22, 2.0, Vector3(0.0, 1.0, 0.0), bark, false, Vector3.ZERO, 0.14, 9)
	var leaves := [Color(0.2, 0.5, 0.24), Color(0.26, 0.58, 0.28), Color(0.17, 0.44, 0.22)]
	var blobs := [Vector4(0.0, 3.0, 0.0, 1.3), Vector4(0.7, 2.6, 0.3, 0.9), Vector4(-0.6, 2.7, -0.4, 0.95), Vector4(0.1, 3.7, -0.2, 0.9), Vector4(-0.2, 2.5, 0.7, 0.8)]
	for i in blobs.size():
		var blob: Vector4 = blobs[i]
		Build.ball(root, blob.w, Vector3(blob.x, blob.y, blob.z), Stylized.fabric(leaves[i % 3]), Vector3(1.0, 0.85, 1.0), 10)


static func _plant(root: Node3D) -> void:
	Build.cyl(root, 0.2, 0.36, Vector3(0.0, 0.18, 0.0), Stylized.standard(Color(0.72, 0.42, 0.3), 0.8, 0.0, Stylized.Surface.MASONRY), false, Vector3.ZERO, 0.26, 12)
	var leaf := Stylized.fabric(Color(0.2, 0.52, 0.26))
	for i in 7:
		var angle := TAU * i / 7.0
		var out := Vector3(cos(angle), 0.0, sin(angle))
		Build.ball(root, 0.2, Vector3(0.0, 0.62, 0.0) + out * 0.17 + Vector3.UP * 0.07 * (i % 3), leaf, Vector3(0.55, 1.5, 0.55), 8).rotation = Vector3(out.z * 0.5, 0.0, -out.x * 0.5)
	Build.ball(root, 0.22, Vector3(0.0, 0.8, 0.0), leaf, Vector3(0.7, 1.4, 0.7), 8)


static func _bench(root: Node3D) -> void:
	var wood := Stylized.standard(Color(0.5, 0.33, 0.2), 0.8, 0.0, Stylized.Surface.MASONRY)
	var iron := Stylized.metal(Color(0.15, 0.16, 0.18), 0.5)
	for i in 4:
		Build.box(root, Vector3(1.7, 0.04, 0.1), Vector3(0.0, 0.45, -0.18 + 0.12 * i), wood)
	for i in 3:
		Build.box(root, Vector3(1.7, 0.1, 0.035), Vector3(0.0, 0.58 + 0.12 * i, 0.26), wood, false, Vector3(-10.0, 0.0, 0.0))
	for x: float in [-0.75, 0.75]:
		Build.box(root, Vector3(0.06, 0.45, 0.5), Vector3(x, 0.225, 0.0), iron)
		Build.box(root, Vector3(0.06, 0.42, 0.06), Vector3(x, 0.64, 0.27), iron, false, Vector3(-10.0, 0.0, 0.0))


static func _sofa(root: Node3D) -> void:
	var cloth := Stylized.fabric(Color(0.32, 0.2, 0.5))
	Build.box(root, Vector3(1.6, 0.3, 0.8), Vector3(0.0, 0.27, 0.0), cloth)
	Build.box(root, Vector3(1.6, 0.5, 0.22), Vector3(0.0, 0.6, 0.3), cloth)
	for x: float in [-0.72, 0.72]:
		Build.box(root, Vector3(0.2, 0.42, 0.8), Vector3(x, 0.42, 0.0), cloth)
	for x: float in [-0.36, 0.36]:
		Build.box(root, Vector3(0.62, 0.12, 0.56), Vector3(x, 0.46, -0.08), Stylized.fabric(Color(0.4, 0.27, 0.6)))
	for x: float in [-0.7, 0.7]:
		for z: float in [-0.3, 0.3]:
			Build.cyl(root, 0.03, 0.12, Vector3(x, 0.06, z), Stylized.metal(Color(0.2, 0.2, 0.22)))


static func _bin(root: Node3D) -> void:
	var body := Stylized.metal(Color(0.2, 0.3, 0.24), 0.55)
	Build.cyl(root, 0.26, 0.85, Vector3(0.0, 0.43, 0.0), body, false, Vector3.ZERO, 0.3, 12)
	Build.cyl(root, 0.32, 0.06, Vector3(0.0, 0.88, 0.0), Stylized.metal(Color(0.14, 0.15, 0.17)), false, Vector3.ZERO, -1.0, 12)
	Build.cyl(root, 0.2, 0.1, Vector3(0.0, 0.95, 0.0), body, false, Vector3.ZERO, 0.05, 12)
	for y: float in [0.25, 0.6]:
		Build.ring(root, 0.285, 0.012, Vector3(0.0, y, 0.0), Stylized.metal(Color(0.6, 0.62, 0.66)), Vector3.ZERO, 12)


static func _cone(root: Node3D) -> void:
	var orange := Stylized.rubber(Color(0.95, 0.42, 0.1))
	Build.box(root, Vector3(0.42, 0.04, 0.42), Vector3(0.0, 0.02, 0.0), Stylized.rubber(Color(0.1, 0.1, 0.11)))
	Build.cyl(root, 0.17, 0.66, Vector3(0.0, 0.37, 0.0), orange, false, Vector3.ZERO, 0.03, 12)
	Build.cyl(root, 0.125, 0.1, Vector3(0.0, 0.33, 0.0), Stylized.fabric(Color(0.95, 0.95, 0.97)), false, Vector3.ZERO, 0.098, 12)
	Build.cyl(root, 0.082, 0.08, Vector3(0.0, 0.5, 0.0), Stylized.fabric(Color(0.95, 0.95, 0.97)), false, Vector3.ZERO, 0.062, 12)


static func _hydrant(root: Node3D) -> void:
	var red := Stylized.standard(Color(0.8, 0.14, 0.12), 0.45, 0.4, Stylized.Surface.PLAIN)
	Build.cyl(root, 0.17, 0.08, Vector3(0.0, 0.04, 0.0), red, false, Vector3.ZERO, -1.0, 10)
	Build.cyl(root, 0.12, 0.52, Vector3(0.0, 0.34, 0.0), red, false, Vector3.ZERO, -1.0, 10)
	Build.ball(root, 0.13, Vector3(0.0, 0.62, 0.0), red, Vector3(1.0, 0.8, 1.0), 10)
	Build.cyl(root, 0.04, 0.08, Vector3(0.0, 0.76, 0.0), Stylized.metal(Color(0.7, 0.72, 0.75)), false, Vector3.ZERO, -1.0, 6)
	for x: float in [-0.15, 0.15]:
		Build.cyl(root, 0.06, 0.1, Vector3(x, 0.42, 0.0), red, false, Vector3(0.0, 0.0, 90.0), -1.0, 8)
	Build.cyl(root, 0.07, 0.1, Vector3(0.0, 0.42, -0.15), red, false, Vector3(90.0, 0.0, 0.0), -1.0, 8)


static func _bottle(root: Node3D) -> void:
	var steel := Stylized.metal(Color(0.75, 0.78, 0.82), 0.28)
	Build.cyl(root, 0.036, 0.18, Vector3(0.0, 0.09, 0.0), steel, false, Vector3.ZERO, -1.0, 14)
	Build.cyl(root, 0.036, 0.04, Vector3(0.0, 0.2, 0.0), steel, false, Vector3.ZERO, 0.02, 14)
	Build.cyl(root, 0.022, 0.04, Vector3(0.0, 0.24, 0.0), Stylized.rubber(Color(0.1, 0.1, 0.12)), false, Vector3.ZERO, -1.0, 12)
	Build.cyl(root, 0.037, 0.05, Vector3(0.0, 0.1, 0.0), Stylized.rubber(Color(0.66, 0.45, 1.0)), false, Vector3.ZERO, -1.0, 14)


static func _boombox(root: Node3D) -> void:
	var shell := Stylized.standard(Color(0.12, 0.12, 0.14), 0.5, 0.2, Stylized.Surface.PLAIN)
	Build.box(root, Vector3(0.6, 0.26, 0.16), Vector3(0.0, 0.13, 0.0), shell)
	for x: float in [-0.19, 0.19]:
		Build.cyl(root, 0.1, 0.02, Vector3(x, 0.12, -0.085), Stylized.rubber(Color(0.05, 0.05, 0.06)), false, Vector3(90.0, 0.0, 0.0), -1.0, 16)
		Build.cyl(root, 0.045, 0.03, Vector3(x, 0.12, -0.09), Stylized.metal(Color(0.7, 0.72, 0.76)), false, Vector3(90.0, 0.0, 0.0), 0.02, 16)
	Build.box(root, Vector3(0.14, 0.07, 0.02), Vector3(0.0, 0.17, -0.085), Build.glow(Color(0.66, 0.45, 1.0), 1.8))
	Build.tube(root, Vector3(-0.24, 0.26, 0.0), Vector3(-0.24, 0.31, 0.0), 0.012, Stylized.metal(Color(0.6, 0.62, 0.66)))
	Build.tube(root, Vector3(0.24, 0.26, 0.0), Vector3(0.24, 0.31, 0.0), 0.012, Stylized.metal(Color(0.6, 0.62, 0.66)))
	Build.tube(root, Vector3(-0.24, 0.31, 0.0), Vector3(0.24, 0.31, 0.0), 0.014, Stylized.metal(Color(0.6, 0.62, 0.66)))


static func _dumbbell(root: Node3D) -> void:
	var iron := Stylized.metal(Color(0.2, 0.21, 0.24), 0.5)
	Build.cyl(root, 0.018, 0.2, Vector3(0.0, 0.1, 0.0), Stylized.metal(Color(0.75, 0.77, 0.8), 0.25), false, Vector3(0.0, 0.0, 90.0), -1.0, 10)
	for x: float in [-0.13, 0.13]:
		Build.cyl(root, 0.1, 0.07, Vector3(x, 0.1, 0.0), iron, false, Vector3(0.0, 0.0, 90.0), -1.0, 8)
		Build.cyl(root, 0.075, 0.03, Vector3(x * 1.4, 0.1, 0.0), iron, false, Vector3(0.0, 0.0, 90.0), -1.0, 8)


static func _kettlebell(root: Node3D) -> void:
	var iron := Stylized.metal(Color(0.16, 0.17, 0.2), 0.55)
	Build.ball(root, 0.1, Vector3(0.0, 0.1, 0.0), iron, Vector3(1.0, 0.95, 1.0), 14)
	Build.ring(root, 0.06, 0.016, Vector3(0.0, 0.21, 0.0), iron, Vector3(90.0, 0.0, 0.0), 14)
	Build.cyl(root, 0.07, 0.02, Vector3(0.0, 0.01, 0.0), iron, false, Vector3.ZERO, -1.0, 12)


## A posed display dummy: used only if no character model could be loaded at all.
static func _mannequin(root: Node3D) -> void:
	var body := Stylized.standard(Color(0.78, 0.74, 0.7), 0.6, 0.0, Stylized.Surface.PLAIN)
	var joint := Stylized.metal(Color(0.3, 0.31, 0.34), 0.45)
	Build.ball(root, 0.11, Vector3(0.0, 1.74, 0.0), body, Vector3(0.9, 1.1, 1.0), 14)
	Build.cyl(root, 0.045, 0.1, Vector3(0.0, 1.6, 0.0), body)
	Build.ball(root, 0.2, Vector3(0.0, 1.4, 0.0), body, Vector3(1.0, 0.95, 0.6), 14)
	Build.ball(root, 0.16, Vector3(0.0, 1.16, 0.0), body, Vector3(1.0, 1.0, 0.62), 14)
	Build.ball(root, 0.17, Vector3(0.0, 0.98, 0.0), body, Vector3(1.0, 0.8, 0.66), 14)
	for side: float in [-1.0, 1.0]:
		Build.ball(root, 0.07, Vector3(side * 0.23, 1.5, 0.0), joint, Vector3.ONE, 10)
		Build.cyl(root, 0.045, 0.3, Vector3(side * 0.25, 1.33, 0.0), body, false, Vector3.ZERO, 0.055, 10)
		Build.ball(root, 0.048, Vector3(side * 0.25, 1.17, 0.0), joint, Vector3.ONE, 10)
		Build.cyl(root, 0.035, 0.28, Vector3(side * 0.25, 1.02, 0.0), body, false, Vector3.ZERO, 0.045, 10)
		Build.ball(root, 0.05, Vector3(side * 0.25, 0.85, 0.0), body, Vector3(0.7, 1.2, 1.0), 10)
		Build.cyl(root, 0.06, 0.44, Vector3(side * 0.1, 0.74, 0.0), body, false, Vector3.ZERO, 0.08, 10)
		Build.ball(root, 0.062, Vector3(side * 0.1, 0.51, 0.0), joint, Vector3.ONE, 10)
		Build.cyl(root, 0.042, 0.42, Vector3(side * 0.1, 0.29, 0.0), body, false, Vector3.ZERO, 0.058, 10)
		Build.box(root, Vector3(0.09, 0.07, 0.25), Vector3(side * 0.1, 0.035, -0.05), body)
