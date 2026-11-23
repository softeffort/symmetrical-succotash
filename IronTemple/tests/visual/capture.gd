extends Node
## Screenshot tour of the real main scene, for checking the HUD and the fight effects by eye.
## Needs a display and a renderer (Xvfb with a software Vulkan driver is enough):
##
##   godot --path . --fixed-fps 60 res://tests/visual/capture.tscn -- --out=/tmp/shots [--only=fight,bar]
##
## Rendering is switched off between shots, so the tour runs much faster than real time.

const MAIN := preload("res://scenes/main.tscn")
const Builds := preload("res://tests/combat/builds.gd")

var _out := "/tmp/shots"
var _only := PackedStringArray()
var _player: Player
var _ring: RingManager
var _combat: CombatController
var _taps: Array[StringName] = []
var _viewports: Array[Viewport] = []


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
	await _wait(1.0)
	_player = get_tree().get_first_node_in_group(&"player") as Player
	_ring = get_tree().get_first_node_in_group(&"ring") as RingManager
	_combat = _player.combat
	var groups := {"street": _street, "gym": _gym, "fight": _fight, "ends": _ends, "bar": _bar, "pause": _pause, "crowd": _crowd}
	for group: String in groups:
		if _only.is_empty() or _only.has(group):
			print("GROUP ", group)
			await groups[group].call()
	print("DONE")
	get_tree().quit(0)


# --- Helpers ---------------------------------------------------------------------------------

## Rendering on or off. Switching the render loop off is not enough: the engine still draws
## while the renderer has resources pending (a glove's glow changes every frame of a wind-up),
## so the viewports are put to sleep as well.
func _set_drawing(on: bool) -> void:
	RenderingServer.render_loop_enabled = on
	if _viewports.is_empty():
		_viewports.append(get_tree().root)
		for node in get_tree().root.find_children("*", "SubViewport", true, false):
			_viewports.append(node as Viewport)
	for viewport in _viewports:
		if is_instance_valid(viewport):
			RenderingServer.viewport_set_active(viewport.get_viewport_rid(), on)


func _wait(seconds: float) -> void:
	_set_drawing(false)
	for i in maxi(roundi(seconds * 60.0), 1):
		await get_tree().physics_frame
		for action in _taps:
			_send(action, false)
		_taps.clear()


func _shot(shot_name: String) -> void:
	_set_drawing(true)
	for i in 3:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [_out, shot_name])
	_set_drawing(false)
	print("SHOT ", shot_name)


func _send(action: StringName, pressed: bool) -> void:
	var event := InputEventAction.new()
	event.action = action
	event.pressed = pressed
	Input.parse_input_event(event)


func _tap(action: StringName) -> void:
	_send(action, true)
	_taps.append(action)


## Gets up from `station`. A loaded bar is racked by the first request and left by the second.
func _leave(station: WorkoutStation) -> void:
	for attempt in 4:
		if _player.station == null:
			break
		station.request_exit()
		await _wait(1.5)
	if _player.station != null:
		print("STUCK on ", station.name)


func _find(match_node: Callable, from: Node = null) -> Node:
	var start := from if from != null else get_tree().root
	for child in start.get_children():
		if match_node.call(child):
			return child
		var found := _find(match_node, child)
		if found != null:
			return found
	return null


func _stand(at: Vector3, look_at_point: Vector3) -> void:
	var toward := look_at_point - at
	_player.place_at(Transform3D(Basis(Vector3.UP, atan2(-toward.x, -toward.z)), at), true)


# --- Street, bike, first floor ---------------------------------------------------------------

func _street() -> void:
	await _shot("01_street")
	var bike := _find(func(node: Node) -> bool: return node is Bicycle) as Bicycle
	bike.mount(_player)
	_send(&"move_forward", true)
	await _wait(4.0)
	await _shot("02_bike")
	_send(&"move_forward", false)
	await _wait(3.5)
	bike.dismount()
	await _wait(0.5)


func _gym() -> void:
	Builds.apply(Builds.train_to(6, 2), 2)
	var bench := _find(func(node: Node) -> bool: return node is BarbellStation and node.lift == &"bench_press") as BarbellStation
	_player.place_at(bench.get_exit_transform(), true)
	await _wait(0.5)
	await _shot("03_floor1")
	bench._on_interacted(_player)
	await _wait(1.6)
	await _shot("04_bench_racked")
	_send(&"lift", true)
	await _wait(0.2)
	_send(&"lift", false)
	await _wait(0.4)
	_send(&"lift", true)
	await _wait(0.7)
	await _shot("05_bench_lifting")
	_send(&"lift", false)
	await _wait(1.5)
	await _leave(bench)
	for entry: Array in [["06_squat", func(node: Node) -> bool: return node is BarbellStation and node.lift == &"squat"], ["07_curls", func(node: Node) -> bool: return node is CurlStation], ["08_treadmill", func(node: Node) -> bool: return node is TreadmillStation], ["09_warmup", func(node: Node) -> bool: return node is WarmupStation]]:
		var station := _find(entry[1]) as WorkoutStation
		if station == null:
			print("MISSING ", entry[0])
			continue
		_player.place_at(station.get_exit_transform(), true)
		await _wait(0.3)
		station._on_interacted(_player)
		await _wait(1.6)
		_tap(&"lift")
		_send(&"move_forward", true)
		await _wait(1.2)
		_send(&"move_forward", false)
		await _shot(entry[0])
		await _leave(station)
	var mirror := _find(func(node: Node) -> bool: return node is Mirror) as Node3D
	if mirror != null:
		var front := mirror.global_transform * Vector3(0.0, 0.0, 2.6)
		front.y = _player.global_position.y
		_stand(front, mirror.global_position)
		await _wait(0.6)
		await _shot("10_mirror")
	var npc := _find(func(node: Node) -> bool: return node is GymNpc) as Node3D
	if npc != null:
		_stand(npc.global_position + Vector3(1.6, 0.0, 1.6), npc.global_position)
		await _wait(0.8)
		await _shot("11_npc")


# --- Second floor ----------------------------------------------------------------------------

func _passive(foe: EnemyFighter) -> void:
	var style := FightStyle.new()
	style.attack_delay = Vector2(9999.0, 9999.0)
	style.move_speed = 0.0
	style.block_reaction = 0.0
	foe.brain.style = style
	foe.brain._lead_timer = 9999.0
	foe.brain._burst_timer = 9999.0
	foe.on_style_changed()
	foe.set_guard(EnemyFighter.Guard.NONE)


func _face_off(gap: float = 1.7) -> void:
	var foe := _ring.opponent
	var canvas := _ring.platform_height
	foe.global_position = _ring.global_transform * Vector3(0.0, canvas + 0.02, -gap * 0.5)
	_stand(_ring.global_transform * Vector3(0.0, canvas, gap * 0.5), foe.global_position)
	foe.face(_player.global_position)
	foe.velocity = Vector3.ZERO
	_player.velocity = Vector3.ZERO


func _start_bout(index: int, level: int) -> void:
	Builds.apply(Builds.train_to(level, index), index)
	if _ring.state == RingManager.State.RESULT:
		_ring.exit_ring()
		await _wait(0.3)
	_ring.start_bout(FighterRoster.ladder()[index])


func _until_fight() -> void:
	while _ring.state != RingManager.State.FIGHT:
		await _wait(0.1)


func _fight() -> void:
	_stand(_ring.global_transform * Vector3(0.0, 0.05, _ring.gate_distance + 2.6), _ring.global_position)
	await _wait(0.6)
	await _shot("20_cage_outside")
	_ring.open_fight_card(_player)
	await _wait(0.5)
	await _shot("21_fight_card")
	var card := get_tree().get_first_node_in_group(&"fight_card") as FightCard
	card.close()
	await _start_bout(2, 6)
	await _wait(0.8)
	await _shot("22_countdown")
	await _until_fight()
	await _wait(0.25)
	await _shot("23_fight_start")
	var foe := _ring.opponent
	_passive(foe)
	for entry: Array in [["24_tell_light", [Strike.JAB], 0.22], ["25_tell_heavy", [Strike.OVERHAND], 0.45], ["26_tell_low", [Strike.BODY_HOOK], 0.3]]:
		_face_off(2.6)
		await _wait(0.4)
		foe.start_attack(entry[1])
		await _wait(entry[2])
		await _shot(entry[0])
		await _wait(1.6)
	_face_off(2.6)
	await _wait(0.4)
	foe.start_feint(Strike.CROSS)
	await _wait(0.12)
	await _shot("27_tell_feint")
	await _wait(0.8)
	_face_off(2.6)
	await _wait(0.3)
	foe.start_burst([Strike.CROSS, Strike.BODY_HOOK, Strike.OVERHAND])
	await _wait(0.3)
	await _shot("28_tell_burst")
	await _wait(3.0)
	# Guards, on both sides.
	_face_off()
	foe.set_guard(EnemyFighter.Guard.HIGH)
	foe.brain._guard_timer = 99.0
	_send(&"block", true)
	await _wait(0.5)
	await _shot("29_guard_high")
	_send(&"body_mod", true)
	foe.set_guard(EnemyFighter.Guard.LOW)
	await _wait(0.5)
	await _shot("30_guard_low")
	_send(&"body_mod", false)
	_send(&"block", false)
	foe.set_guard(EnemyFighter.Guard.NONE)
	await _wait(0.5)
	# A blocked strike, then the arm punches of a masher.
	foe.set_guard(EnemyFighter.Guard.HIGH)
	_tap(&"strike_left")
	await _wait(0.16)
	await _shot("31_blocked")
	for i in 5:
		_tap(&"strike_left" if i % 2 == 0 else &"strike_right")
		await _wait(0.24)
	await _shot("32_sloppy")
	foe.set_guard(EnemyFighter.Guard.NONE)
	await _wait(1.5)
	# Intercept counter.
	_face_off()
	PlayerStats.restore_stamina(PlayerStats.max_stamina)
	await _wait(0.5)
	foe.start_attack([Strike.OVERHAND])
	await _wait(0.3)
	_tap(&"strike_right")
	await _wait(0.24)
	await _shot("33_intercept")
	await _wait(2.0)
	# Clinch.
	_face_off(1.3)
	await _wait(0.3)
	foe.start_clinch()
	await _wait(0.3)
	await _shot("34_tell_grab")
	await _wait(0.75)
	await _shot("35_clinch")
	for i in 3:
		_tap(&"clinch_break")
		await _wait(0.12)
	await _shot("36_clinch_struggle")
	for i in 10:
		_tap(&"clinch_break")
		await _wait(0.1)
	await _shot("37_clinch_broken")
	await _wait(2.0)


func _ends() -> void:
	if _ring.state != RingManager.State.FIGHT:
		await _start_bout(2, 6)
		await _until_fight()
	var foe := _ring.opponent
	_passive(foe)
	PlayerStats.restore_stamina(PlayerStats.max_stamina)
	# The opponent rocked, then put down.
	_face_off()
	await _wait(0.5)
	foe.chin.stagger = foe.chin.maximum - 1.0
	foe.chin._quiet = 0.0
	_tap(&"strike_left")
	await _wait(0.3)
	await _shot("40_foe_rocked")
	_tap(&"strike_right")
	await _wait(0.5)
	await _shot("41_foe_knockdown")
	await _wait(3.2)
	# The player rocked, then put down, then back up.
	_passive(foe)
	_face_off()
	await _wait(0.4)
	_combat.chin.stagger = _combat.chin.maximum - 1.0
	_combat.chin._quiet = 0.0
	foe.start_attack([Strike.JAB])
	await _wait(0.9)
	await _shot("42_player_rocked")
	foe.start_attack([Strike.CROSS])
	await _wait(1.3)
	await _shot("43_player_down")
	await _wait(1.6)
	await _shot("44_player_back_up")
	await _wait(1.2)
	# A win on the health bar.
	_passive(foe)
	_face_off()
	await _wait(0.4)
	foe.health = 1.0
	_tap(&"strike_right")
	await _wait(0.5)
	await _shot("45_knockout")
	while _ring.state != RingManager.State.RESULT:
		await _wait(0.1)
	await _wait(0.6)
	await _shot("46_result_win")
	# And a loss.
	_ring.rematch()
	await _until_fight()
	foe = _ring.opponent
	_passive(foe)
	_face_off()
	await _wait(0.3)
	_combat.health = 1.0
	foe.start_attack([Strike.CROSS])
	await _wait(1.2)
	await _shot("47_knocked_out")
	while _ring.state != RingManager.State.RESULT:
		await _wait(0.1)
	await _wait(0.6)
	await _shot("48_result_loss")
	_ring.exit_ring()
	await _wait(1.0)
	await _shot("49_after_exit")


# --- Third floor, menus, crowd ---------------------------------------------------------------

func _bar() -> void:
	var bar := _find(func(node: Node) -> bool: return node is SupplementBar) as SupplementBar
	var shop := _find(func(node: Node) -> bool: return node is BarShop) as BarShop
	_stand(bar.global_position + bar.global_transform.basis.z * 2.2 + Vector3.UP * 0.05, bar.global_position)
	PlayerStats.add_cash(500)
	await _wait(0.8)
	await _shot("50_bar")
	bar._on_used(_player)
	await _wait(0.5)
	await _shot("51_bar_shop")
	shop._buy(Supplements.PROTEIN)
	await _wait(2.5)
	shop._buy(Supplements.PREWORKOUT)
	await _wait(2.5)
	shop.close()
	await _wait(0.6)
	await _shot("52_buffs")


func _pause() -> void:
	var menu := _find(func(node: Node) -> bool: return node is PauseMenu) as PauseMenu
	menu.open()
	await _wait(0.2)
	await _shot("60_pause_menu")
	menu.close()
	await _wait(0.3)


func _crowd() -> void:
	await _start_bout(4, 15)
	await _until_fight()
	_passive(_ring.opponent)
	await _wait(9.0)
	_face_off()
	await _wait(0.3)
	await _shot("70_crowd")
	_player._yaw += PI * 0.5
	await _wait(0.3)
	await _shot("71_crowd_side")
