extends Node
## Free-camera screenshot tour of the gym's three storeys, for checking the Step 7 look by eye:
##
##   godot --path . res://tests/visual/gym_tour.tscn -- --out=/tmp/tour [--only=1f,2f_cage]
##
## Shots are named by storey; `--only` keeps those whose name starts with one of the given
## prefixes. Positions are in the gym's own space (entrance at z = 0, ground floor at y = 0).
## Needs a display and a renderer, see tests/README.md.

const MAIN := preload("res://scenes/main.tscn")
const F2 := 5.0
const F3 := 10.0
## name, camera position, look-at point, field of view.
const SHOTS := [
	["1f_overview", Vector3(12.5, 3.0, -1.6), Vector3(-6.0, 1.0, -16.0), 75.0],
	["1f_entrance", Vector3(0.0, 1.7, -1.2), Vector3(0.0, 1.5, -14.0), 80.0],
	["1f_bench_press", Vector3(1.9, 1.6, -9.3), Vector3(0.0, 0.9, -12.5), 60.0],
	["1f_bench_detail", Vector3(1.05, 1.25, -11.4), Vector3(0.3, 1.0, -12.75), 55.0],
	["1f_squat_rack", Vector3(-3.0, 1.6, -20.3), Vector3(-5.5, 1.2, -23.8), 62.0],
	["1f_platforms", Vector3(1.8, 1.9, -20.2), Vector3(3.4, 0.4, -24.0), 65.0],
	["1f_dumbbells", Vector3(-10.6, 1.6, -19.9), Vector3(-13.9, 0.75, -22.4), 62.0],
	["1f_free_weights", Vector3(-8.2, 1.7, -8.4), Vector3(-12.5, 0.9, -13.5), 70.0],
	["1f_cardio", Vector3(5.0, 1.75, -5.9), Vector3(8.6, 1.0, -2.2), 68.0],
	["1f_treadmill_detail", Vector3(7.25, 1.55, -3.9), Vector3(6.25, 1.05, -1.8), 55.0],
	["1f_warmup", Vector3(-3.4, 1.9, -6.6), Vector3(-9.0, 0.2, -3.0), 68.0],
	["1f_mirror", Vector3(-7.6, 1.7, -11.2), Vector3(-14.5, 1.8, -14.0), 75.0],
	["1f_lockers", Vector3(9.2, 1.7, -22.6), Vector3(14.2, 1.1, -19.6), 70.0],
	["1f_stairs", Vector3(12.4, 1.7, -3.6), Vector3(12.4, 1.6, -12.0), 72.0],
	["1f_ceiling", Vector3(-2.0, 1.6, -9.0), Vector3(6.0, 4.9, -20.0), 80.0],
	["2f_overview", Vector3(8.6, F2 + 2.9, -2.0), Vector3(-3.0, F2 + 1.2, -14.5), 78.0],
	["2f_cage", Vector3(-1.5, F2 + 1.7, -5.6), Vector3(-1.5, F2 + 1.5, -13.5), 72.0],
	["2f_cage_inside", Vector3(-1.5, F2 + 2.4, -10.9), Vector3(-1.5, F2 + 1.2, -15.0), 82.0],
	["2f_cage_detail", Vector3(1.9, F2 + 1.7, -8.1), Vector3(0.6, F2 + 1.4, -10.2), 55.0],
	["2f_canvas", Vector3(-1.5, F2 + 4.3, -12.4), Vector3(-1.5, F2 + 0.7, -13.6), 85.0],
	["2f_rig", Vector3(4.6, F2 + 1.5, -7.6), Vector3(-1.5, F2 + 4.4, -13.5), 78.0],
	["2f_bags", Vector3(-8.6, F2 + 1.7, -9.6), Vector3(-12.8, F2 + 1.7, -12.2), 72.0],
	["2f_bag_detail", Vector3(-11.2, F2 + 1.9, -6.4), Vector3(-12.6, F2 + 2.2, -8.0), 55.0],
	["2f_speed_bag", Vector3(-11.0, F2 + 1.7, -21.6), Vector3(-14.4, F2 + 1.7, -23.2), 62.0],
	["2f_bleachers", Vector3(3.6, F2 + 1.8, -18.6), Vector3(-2.5, F2 + 0.9, -24.0), 75.0],
	["2f_fight_board", Vector3(8.6, F2 + 1.9, -19.4), Vector3(14.5, F2 + 3.1, -20.5), 62.0],
	["2f_stairs", Vector3(12.4, F2 + 1.7, -18.6), Vector3(12.4, F2 + 0.6, -14.0), 80.0],
	["2f_ceiling", Vector3(4.0, F2 + 1.6, -20.0), Vector3(-4.0, F2 + 4.9, -9.0), 82.0],
	["3f_overview", Vector3(8.4, F3 + 2.9, -3.0), Vector3(-4.0, F3 + 1.0, -17.0), 78.0],
	["3f_bar", Vector3(-3.0, F3 + 1.7, -16.4), Vector3(-3.0, F3 + 1.6, -24.0), 75.0],
	["3f_bar_stock", Vector3(-4.6, F3 + 1.75, -22.9), Vector3(-5.6, F3 + 1.7, -25.4), 62.0],
	["3f_bar_side", Vector3(5.4, F3 + 1.7, -19.0), Vector3(-2.0, F3 + 1.2, -22.6), 70.0],
	["3f_stools", Vector3(-7.0, F3 + 1.25, -18.6), Vector3(-4.6, F3 + 0.8, -20.6), 58.0],
	["3f_fridge", Vector3(1.2, F3 + 1.6, -22.9), Vector3(2.9, F3 + 1.2, -25.2), 58.0],
	["3f_lounge", Vector3(-5.4, F3 + 1.8, -3.2), Vector3(-10.4, F3 + 0.6, -6.6), 72.0],
	["3f_lounge_round", Vector3(6.6, F3 + 1.8, -9.0), Vector3(3.0, F3 + 0.5, -5.5), 68.0],
	["3f_neon", Vector3(-3.0, F3 + 2.2, -18.4), Vector3(-3.0, F3 + 3.5, -25.5), 60.0],
	["3f_stairs", Vector3(8.2, F3 + 1.7, -17.4), Vector3(12.4, F3 + 0.4, -15.4), 78.0],
	["3f_ceiling", Vector3(0.0, F3 + 1.6, -8.0), Vector3(-6.0, F3 + 5.2, -18.0), 82.0],
]

var _out := "/tmp/tour"
var _only := PackedStringArray()


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="):
			_out = arg.trim_prefix("--out=")
		elif arg.begins_with("--only="):
			_only = arg.trim_prefix("--only=").split(",")
	DirAccess.make_dir_recursive_absolute(_out)
	seed(7)
	add_child(MAIN.instantiate())
	_run.call_deferred()


func _run() -> void:
	for i in 60:
		await get_tree().physics_frame
	var gym := get_tree().get_first_node_in_group(&"gym") as Node3D
	for layer in get_tree().root.find_children("*", "CanvasLayer", true, false):
		(layer as CanvasLayer).visible = false
	var camera := Camera3D.new()
	add_child(camera)
	camera.current = true
	var settled := ""
	for shot: Array in SHOTS:
		var shot_name: String = shot[0]
		if not _wanted(shot_name):
			continue
		camera.fov = shot[3]
		camera.look_at_from_position(gym.to_global(shot[1]), gym.to_global(shot[2]))
		# The first view of a storey waits for its interior to show and its probe to render.
		var frames := 6 if settled == shot_name.left(2) else 24
		settled = shot_name.left(2)
		for i in frames:
			await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [_out, shot_name])
		print("SHOT ", shot_name)
	print("DONE")
	get_tree().quit(0)


func _wanted(shot_name: String) -> bool:
	if _only.is_empty():
		return true
	for prefix in _only:
		if shot_name.begins_with(prefix):
			return true
	return false
