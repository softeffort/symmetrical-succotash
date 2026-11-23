class_name ModelLoader
extends RefCounted
## Loads any `.glb` under `res://assets/models/`, normalises it and gives it the stylized pass.
##
##   var car := ModelLoader.instantiate("street/car_sedan", 1.45)
##   parent.add_child(car)
##
## The returned pivot sits on the floor (y = 0) under the middle of the model, the model faces
## local -Z and its height is exactly the one asked for, whatever units, pivot and orientation
## the file came with. A file that is missing or not a real binary glTF never raises an error:
## a procedural stand-in from ModelFallbacks is returned instead (`is_fallback` tells which).
##
## Models dropped into the folder are picked up by name; `list("gym")` enumerates a category.

const MODELS_DIR := "res://assets/models/"
## Anything smaller cannot be a real model (a saved error page, a truncated download).
const MIN_BYTES := 5120
## What `fit` in the options measures: the height, the longest side or the width (x).
enum Fit { HEIGHT, LONGEST, WIDTH }

static var _scenes: Dictionary = {}
static var _bad: Dictionary = {}


## Full resource path of a model id such as "characters/superhero_male".
static func path_of(id: String) -> String:
	if id.begins_with("res://"):
		return id
	return MODELS_DIR + id + ("" if id.ends_with(".glb") else ".glb")


## True when the model can be loaded: imported by the editor, or a valid raw `.glb` on disk.
static func has_model(id: String) -> bool:
	return _scene_of(path_of(id)) != null


## Ids of every model in a category folder ("characters", "hands", "gym", "street"), sorted.
static func list(category: String) -> PackedStringArray:
	var found := PackedStringArray()
	var dir := DirAccess.open(MODELS_DIR + category)
	if dir == null:
		return found
	for file in dir.get_files():
		# Exported builds only ship the import stubs.
		var name := file.trim_suffix(".import")
		if name.ends_with(".glb") and not found.has(category + "/" + name.trim_suffix(".glb")):
			found.append(category + "/" + name.trim_suffix(".glb"))
	found.sort()
	return found


## A fresh, untouched instance of the model's scene, or null if it cannot be loaded.
static func raw(id: String) -> Node3D:
	var scene := _scene_of(path_of(id))
	return scene.instantiate() as Node3D if scene != null else null


## Instance of `id` standing on its pivot, `size` metres tall (0 keeps the file's own scale).
## Options: "fit" (Fit, what `size` measures), "yaw" (extra degrees), "faces_plus_z" (true for
## glTF's own convention, the default), "stylize" (false keeps the file's materials), "tint",
## "surface" (Stylized.Surface for the detail noise), "layers", "shadows" (false to switch
## casting off) and "fallback" (Callable returning a Node3D built at the same size).
static func instantiate(id: String, size: float = 0.0, options: Dictionary = {}) -> Node3D:
	var pivot := Node3D.new()
	pivot.name = id.get_file().get_basename().to_pascal_case()
	pivot.set_meta("model_id", id)
	var model := raw(id)
	pivot.set_meta("model_source", "glb" if model != null else "fallback")
	if model == null:
		var custom: Callable = options.get("fallback", Callable())
		model = custom.call() as Node3D if custom.is_valid() else ModelFallbacks.build(id, size)
		pivot.add_child(model)
		_finish(pivot, options)
		return pivot

	var fit := Node3D.new()
	fit.name = "Fit"
	pivot.add_child(fit)
	fit.add_child(model)
	var yaw := deg_to_rad((180.0 if options.get("faces_plus_z", true) else 0.0) + (options.get("yaw", 0.0) as float))
	fit.basis = Basis(Vector3.UP, yaw)
	var bounds := measure(pivot)
	var measured := bounds.size.y
	match options.get("fit", Fit.HEIGHT) as int:
		Fit.LONGEST:
			measured = maxf(bounds.size.x, maxf(bounds.size.y, bounds.size.z))
		Fit.WIDTH:
			measured = bounds.size.x
	var factor := size / measured if size > 0.0 and measured > 0.0001 else 1.0
	fit.basis = fit.basis.scaled(Vector3.ONE * factor)
	# Floor under the feet, pivot under the middle.
	var centre := bounds.get_center()
	fit.position = -Vector3(centre.x, bounds.position.y, centre.z) * factor
	pivot.set_meta("model_scale", factor)
	pivot.set_meta("model_size", bounds.size * factor)
	if options.get("stylize", true):
		stylize(model, options.get("tint", Color.WHITE), options.get("surface", Stylized.Surface.PLAIN))
	_finish(pivot, options)
	return pivot


static func is_fallback(model: Node) -> bool:
	return model.get_meta("model_source", "fallback") == "fallback"


## Bounding box of every mesh below `root`, in `root`'s own space. Skinned meshes are measured
## in their rest pose.
static func measure(root: Node3D) -> AABB:
	var bounds := AABB()
	var first := true
	for node in root.find_children("*", "MeshInstance3D", true, false):
		var instance := node as MeshInstance3D
		if instance.mesh == null:
			continue
		var to_root := Transform3D.IDENTITY
		var walker: Node = instance
		while walker != root and walker != null:
			if walker is Node3D:
				to_root = (walker as Node3D).transform * to_root
			walker = walker.get_parent()
		var box := to_root * instance.mesh.get_aabb()
		bounds = box if first else bounds.merge(box)
		first = false
	return bounds


## Replaces every surface material below `root` with its stylized PBR version.
static func stylize(root: Node, tint: Color = Color.WHITE, surface: Stylized.Surface = Stylized.Surface.PLAIN) -> void:
	for node in root.find_children("*", "MeshInstance3D", true, false):
		var instance := node as MeshInstance3D
		if instance.mesh == null:
			continue
		for index in instance.mesh.get_surface_count():
			var source := instance.get_active_material(index)
			if source != null:
				instance.set_surface_override_material(index, Stylized.convert(source, tint, surface))


## Checks the 12-byte binary glTF header, so a saved web page is never parsed as a model.
static func is_valid_glb(path: String) -> bool:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return false
	var length := file.get_length()
	if length <= MIN_BYTES:
		return false
	var magic := file.get_buffer(4).get_string_from_ascii()
	var version := file.get_32()
	var declared := file.get_32()
	return magic == "glTF" and version == 2 and declared == length


static func _finish(pivot: Node3D, options: Dictionary) -> void:
	var layers: int = options.get("layers", 0)
	var shadows: bool = options.get("shadows", true)
	if layers == 0 and shadows:
		return
	for node in pivot.find_children("*", "GeometryInstance3D", true, false):
		var instance := node as GeometryInstance3D
		if layers != 0:
			instance.layers = layers
		if not shadows:
			instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


static func _scene_of(path: String) -> PackedScene:
	if _scenes.has(path):
		return _scenes[path]
	if _bad.has(path):
		return null
	var scene: PackedScene = null
	if _is_imported(path):
		scene = load(path) as PackedScene
	elif is_valid_glb(path):
		scene = _parse(path)
	if scene == null:
		_bad[path] = true
		return null
	_scenes[path] = scene
	return scene


# An import stub alone is not enough: on a fresh clone the imported scene does not exist yet.
static func _is_imported(path: String) -> bool:
	if not FileAccess.file_exists(path + ".import"):
		return false
	var stub := ConfigFile.new()
	if stub.load(path + ".import") != OK:
		return false
	var imported: String = stub.get_value("remap", "path", "")
	return imported != "" and FileAccess.file_exists(imported)


# Reads a raw `.glb` at run time, for files the editor has not imported.
static func _parse(path: String) -> PackedScene:
	var document := GLTFDocument.new()
	var state := GLTFState.new()
	if document.append_from_file(path, state) != OK:
		return null
	var root := document.generate_scene(state)
	if root == null:
		return null
	_own(root, root)
	var scene := PackedScene.new()
	var packed := scene.pack(root)
	root.free()
	return scene if packed == OK else null


static func _own(node: Node, owner: Node) -> void:
	for child in node.get_children():
		child.owner = owner
		_own(child, owner)
