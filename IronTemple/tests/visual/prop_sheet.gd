extends Node3D
## Contact sheet of the model library, for choosing and checking props by eye:
##
##   godot --path . res://tests/visual/prop_sheet.tscn -- --out=/tmp/sheet [--category=gym] [--match=bag,stool]
##
## Every model is loaded through ModelLoader (so it is shown with the stylized pass, exactly as
## the game draws it) scaled to fill its cell. The label gives the id and the native size
## in metres. Needs a display and a renderer, see tests/README.md.

const COLUMNS := 5
const ROWS := 3
const CELL := 2.6
## Every model is scaled so its longest side is this many metres.
const FILL := 1.9

var _out := "/tmp/sheet"
var _category := "gym"
var _match := PackedStringArray()


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="):
			_out = arg.trim_prefix("--out=")
		elif arg.begins_with("--category="):
			_category = arg.trim_prefix("--category=")
		elif arg.begins_with("--match="):
			_match = arg.trim_prefix("--match=").split(",")
	DirAccess.make_dir_recursive_absolute(_out)
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.2, 0.22, 0.27)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.75, 0.8, 0.95)
	environment.ambient_light_energy = 0.6
	environment.tonemap_mode = Environment.TONE_MAPPER_ACES
	environment.tonemap_white = 6.0
	environment.ssao_enabled = true
	var world := WorldEnvironment.new()
	world.environment = environment
	add_child(world)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-42.0, 150.0, 0.0)
	sun.light_energy = 1.3
	sun.shadow_enabled = true
	add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-20.0, -40.0, 0.0)
	fill.light_energy = 0.6
	fill.light_color = Color(0.7, 0.8, 1.0)
	add_child(fill)
	_run.call_deferred()


func _run() -> void:
	var ids: Array[String] = []
	for id in ModelLoader.list(_category):
		if _match.is_empty():
			ids.append(id)
			continue
		for part in _match:
			if id.contains(part):
				ids.append(id)
				break
	var per_page := COLUMNS * ROWS
	var pages := ceili(ids.size() / float(per_page))
	for page in pages:
		var holder := Node3D.new()
		add_child(holder)
		Build.box(holder, Vector3(COLUMNS * CELL + 2.0, 0.1, ROWS * CELL + 2.0), Vector3(0.0, -0.05, 0.0), Build.mat(Color(0.3, 0.31, 0.34), 0.9))
		for slot in per_page:
			var index := page * per_page + slot
			if index >= ids.size():
				break
			_place(holder, ids[index], slot)
		var camera := Camera3D.new()
		camera.projection = Camera3D.PROJECTION_ORTHOGONAL
		camera.size = ROWS * CELL * 0.86
		camera.far = 100.0
		holder.add_child(camera)
		# Models face local -Z, so the camera stands on that side.
		camera.look_at_from_position(Vector3(9.0, 16.0, -24.0), Vector3(0.0, 0.55, 0.0))
		camera.current = true
		for i in 6:
			await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("%s/%s_%02d.png" % [_out, _category, page + 1])
		print("SHEET %s %d/%d" % [_category, page + 1, pages])
		holder.queue_free()
		await get_tree().process_frame
	print("DONE")
	get_tree().quit(0)


func _place(holder: Node3D, id: String, slot: int) -> void:
	var column := slot % COLUMNS
	var row := slot / COLUMNS
	var spot := Vector3((COLUMNS - 1) * 0.5 * CELL - column * CELL, 0.0, (row - (ROWS - 1) * 0.5) * CELL)
	var model := ModelLoader.instantiate(id)
	var size: Vector3 = model.get_meta("model_size", Vector3.ONE)
	var longest := maxf(size.x, maxf(size.y, size.z))
	if longest > 0.0001:
		model.scale = Vector3.ONE * (FILL / longest)
	model.position = spot
	holder.add_child(model)
	var tag := "%s\n%.2f x %.2f x %.2f" % [id.get_file(), size.x, size.y, size.z]
	if ModelLoader.is_fallback(model):
		tag += "\nFALLBACK"
	var label := Build.text(holder, tag, spot + Vector3(0.0, 0.02, -CELL * 0.42), 0.16, Color(1.0, 0.9, 0.5), Vector3(-90.0, 180.0, 0.0))
	label.outline_size = 12
	label.outline_modulate = Color(0.0, 0.0, 0.0)
