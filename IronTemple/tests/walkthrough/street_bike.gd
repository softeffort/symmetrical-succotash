extends "res://tests/walkthrough/walk.gd"
## Step 1: street, bicycle, beacon and the walk up through the three storeys.

var bike: Bicycle
var beacon: Beacon
var start_xf := Transform3D.IDENTITY
var ride_t0 := 0
var ride_z0 := 0.0


func _init() -> void:
	area = "street_bike"


func run() -> void:
	wipe_career()
	await boot()
	bike = main.get_node("Bicycle") as Bicycle
	beacon = main.get_node("GymBeacon") as Beacon
	start_xf = bike.global_transform

	_check_spawn()
	await _check_mount()
	await _check_ride_controls()
	await _ride_to_gym(false)
	await _check_arrival()
	await _check_dismount()
	await _check_on_foot_movement()
	await _check_walk_into_gym()
	await _check_stairs()
	await _check_sprint_ride()


func _check_spawn() -> void:
	check("fresh career: level 1 and the gym has not been reached", PlayerStats.level == 1 and not SaveManager.reached_gym)
	var home := main.get_node("Neighborhood/Home") as Node3D
	var spawn := player.global_position
	check("spawn: player starts on the ground at the house lot", spawn.distance_to(home.global_position) < 25.0 and absf(spawn.y) < 0.3 and player.is_on_floor(), "spawn=%s home=%s floor=%s" % [spawn, home.global_position, player.is_on_floor()])
	check("spawn: player is outside the gym, ~260 m up the street", spawn.z > -10.0 and spawn.z < 30.0, "spawn=%s" % spawn)
	check("objective at start: grab your bike and ride to the gym", GameState.objective == "Grab your bike and ride to the gym" and hud.objective_label.text == GameState.objective and hud.objective_label.visible, "state=%s label=%s" % [GameState.objective, hud.objective_label.text])
	check("beacon is active at start", beacon.active and beacon.visible)
	var marker := beacon.global_position + Vector3.UP * beacon.marker_height
	var camera := get_viewport().get_camera_3d()
	var expected := camera.global_position.distance_to(marker)
	var shown := hud.waypoint_label.text
	check("waypoint marker visible and names the gym with its distance", hud.waypoint.visible and shown.begins_with("GYM") and near(float(shown.split(" ", false)[1]), expected, 2.0), "text='%s' expected~%.1f visible=%s" % [shown, expected, hud.waypoint.visible])
	check("gym is about 250 m from the bike", near(bike.global_position.distance_to(Vector3(0, 0, -255)), 256.0, 8.0), "dist=%.1f" % bike.global_position.distance_to(Vector3(0, 0, -255)))


func _check_mount() -> void:
	var centre := bike.global_position + Vector3(0.0, 0.6, 0.0)
	await look_at_point(centre)
	key_down(KEY_W)
	var found := false
	for i in 600:
		await get_tree().physics_frame
		var offset := centre - player.head.global_position
		player._look(Vector2(-wrapf(atan2(-offset.x, -offset.z) - player._yaw, -PI, PI) / (player.mouse_sensitivity * SaveManager.get_mouse_sensitivity()), -(atan2(offset.y, Vector2(offset.x, offset.z).length()) - player._pitch) / (player.mouse_sensitivity * SaveManager.get_mouse_sensitivity())))
		if player._focus != null and player._focus == bike.interactable:
			found = true
			break
	key_up(KEY_W)
	await frames(3)
	check("walking up to the bike: crosshair prompt offers the bike", found and hud_prompt_text() == bike.interactable.action_text and hud_prompt_text() != "", "focus=%s prompt='%s' player=%s bike=%s" % [player._focus, hud_prompt_text(), player.global_position, bike.global_position])
	await press_e()
	await frames(3)
	check("E on the bike mounts it (player.vehicle is the bike)", player.vehicle == bike and bike.rider == player, "vehicle=%s rider=%s" % [player.vehicle, bike.rider])
	check("mounting changes the objective to follow the beacon", GameState.objective == "Follow the beacon to the gym" and hud.objective_label.text == "Follow the beacon to the gym", GameState.objective)
	check("bike interact prompt is gone while riding at rest only offers dismount", hud_prompt_text() == bike.dismount_text, "prompt='%s'" % hud_prompt_text())


func _check_ride_controls() -> void:
	var z0 := bike.global_position.z
	var heading0 := bike.rotation.y
	ride_t0 = Engine.get_physics_frames()
	ride_z0 = z0
	key_down(KEY_W)
	await secs(2.5)
	var speed_early := bike.speed
	check("holding forward accelerates the bike up to cruising speed (6.5 m/s)", near(speed_early, bike.cruise_speed, 0.4), "speed=%.2f" % speed_early)
	check("riding forward moves the bike along -Z without drifting sideways", bike.global_position.z < z0 - 6.0 and near(bike.rotation.y, heading0, 0.02), "dz=%.2f heading=%.3f" % [bike.global_position.z - z0, bike.rotation.y])
	check("dismount prompt is hidden at cruising speed", hud_prompt_text() == "" and absf(bike.speed) > player.DISMOUNT_PROMPT_SPEED, "prompt='%s' speed=%.2f" % [hud_prompt_text(), bike.speed])
	var x_before := bike.global_position.x
	var yaw_before := bike.rotation.y
	key_down(KEY_A)
	await secs(0.8)
	key_up(KEY_A)
	var left_yaw := bike.rotation.y
	check("steering left (A) turns the bike left (heading increases) and moves it to -X", left_yaw > yaw_before + 0.2 and bike.global_position.x < x_before - 0.2, "yaw %.3f->%.3f x %.2f->%.2f" % [yaw_before, left_yaw, x_before, bike.global_position.x])
	var x_mid := bike.global_position.x
	key_down(KEY_D)
	await secs(0.4)
	var leans_right := bike.lean < 0.0
	await secs(0.4)
	key_up(KEY_D)
	check("steering right (D) turns the bike right (heading decreases) and back", bike.rotation.y < left_yaw - 0.5, "yaw %.3f->%.3f" % [left_yaw, bike.rotation.y])
	check("bike leans into a right turn (negative lean)", leans_right, "lean=%.3f" % bike.lean)
	# Straighten up before the ride proper.
	await secs(0.4)


## Rides W held (and Shift if `sprint`), steering along the road centre, until the beacon fires.
func _ride_to_gym(sprint: bool) -> void:
	var stamina_start := PlayerStats.stamina
	var t0 := Engine.get_physics_frames() if sprint else ride_t0
	var z_start := bike.global_position.z if sprint else ride_z0
	key_down(KEY_W)
	if sprint:
		key_down(KEY_SHIFT)
	var peak := 0.0
	var scrubbed := 0
	var mid_label := ""
	var limit := 120 * 60
	for i in limit:
		var here := bike.global_position
		var aim := Vector3(0.0, 0.0, maxf(here.z - 22.0, -250.0))
		var want := atan2(-(aim.x - here.x), -(aim.z - here.z))
		var err := wrapf(want - bike.rotation.y, -PI, PI)
		key_up(KEY_A)
		key_up(KEY_D)
		if err > 0.05:
			key_down(KEY_A)
		elif err < -0.05:
			key_down(KEY_D)
		peak = maxf(peak, bike.speed)
		if mid_label == "" and here.z < -120.0:
			mid_label = hud.waypoint_label.text
		if bike.is_on_wall():
			scrubbed += 1
		await get_tree().physics_frame
		if not beacon.active:
			break
	key_up(KEY_A)
	key_up(KEY_D)
	key_up(KEY_SHIFT)
	var elapsed := float(Engine.get_physics_frames() - t0) / FPS
	var travelled := z_start - bike.global_position.z
	note("%s ride: %.1f s, %.1f m of -Z travel, peak speed %.2f m/s, wall contacts %d, stamina %.0f->%.0f" % ["sprint" if sprint else "cruise", elapsed, travelled, peak, scrubbed, stamina_start, PlayerStats.stamina])
	if sprint:
		check("sprint ride: the bike hits boost speed (~14 m/s)", peak > 12.5, "peak=%.2f" % peak)
		check("sprint ride to the gym takes about 18 s (15-23 s)", elapsed >= 15.0 and elapsed <= 23.0 and not beacon.active, "elapsed=%.1f s active=%s" % [elapsed, beacon.active])
		check("sprint ride spends stamina", PlayerStats.stamina < stamina_start - 20.0, "stamina %.0f -> %.0f" % [stamina_start, PlayerStats.stamina])
	else:
		check("cruise ride: speed stays at cruising pace (6.5 m/s)", near(peak, bike.cruise_speed, 0.5), "peak=%.2f" % peak)
		check("cruise ride to the gym takes about 40 s (33-48 s)", elapsed >= 33.0 and elapsed <= 48.0 and not beacon.active, "elapsed=%.1f s active=%s" % [elapsed, beacon.active])
		check("ride covers about 250 m (230-260 m of travel)", travelled >= 230.0 and travelled <= 262.0, "travelled=%.1f" % travelled)
		check("waypoint distance counted down during the ride", mid_label.begins_with("GYM") and float(mid_label.split(" ", false)[1]) < 150.0, "mid label='%s'" % mid_label)
		check("the ride did not grind against obstacles", scrubbed < 30, "wall contacts=%d" % scrubbed)


func _check_arrival() -> void:
	await secs(1.2)
	check("arrival: beacon deactivates and fades out", not beacon.active and not beacon.visible, "active=%s visible=%s" % [beacon.active, beacon.visible])
	check("arrival: waypoint marker is hidden", not hud.waypoint.visible)
	var text := "Warm up on the mats by the entrance, then hit the weights"
	check("arrival: objective switches to the warm-up hint", GameState.objective == text and hud.objective_label.text == text, "objective='%s'" % GameState.objective)
	check("arrival: reached_gym is remembered and written to the save file", SaveManager.reached_gym and FileAccess.file_exists(SAVE_PATH))
	if FileAccess.file_exists(SAVE_PATH):
		var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
		check("arrival: save file says ReachedGym true", data is Dictionary and (data as Dictionary).get("ReachedGym") == true)


func _check_dismount() -> void:
	key_up(KEY_W)
	key_down(KEY_S)
	await until(func() -> bool: return absf(bike.speed) < 1.0, 4.0)
	key_up(KEY_S)
	await until(func() -> bool: return absf(bike.speed) < 0.3, 3.0)
	check("braking with S brings the bike to a halt", absf(bike.speed) < 0.5, "speed=%.2f" % bike.speed)
	await frames(3)
	check("at walking pace the dismount prompt shows", hud_prompt_text() == bike.dismount_text, "prompt='%s'" % hud_prompt_text())
	await press_e()
	await frames(4)
	check("E dismounts: player is on foot and the bike is free again", player.vehicle == null and bike.rider == null and bike.interactable.enabled, "vehicle=%s rider=%s" % [player.vehicle, bike.rider])
	check("dismount puts the player beside the bike on the ground", player.global_position.distance_to(bike.global_position) < 2.5 and absf(player.global_position.y - bike.global_position.y) < 0.5, "dist=%.2f" % player.global_position.distance_to(bike.global_position))
	var spot := player.global_position
	key_down(KEY_W)
	await secs(1.0)
	key_up(KEY_W)
	check("after dismount the player walks (W moves them ~4 m/s)", player.global_position.distance_to(spot) > 2.5, "moved %.2f" % player.global_position.distance_to(spot))


func _check_on_foot_movement() -> void:
	PlayerStats.restore_stamina(PlayerStats.max_stamina)
	await secs(1.0)
	var start := player.global_position
	key_down(KEY_W)
	await secs(0.6)
	var mark := player.global_position
	await secs(0.6)
	var walked := Vector2(player.global_position.x - mark.x, player.global_position.z - mark.z).length() / 0.6
	key_up(KEY_W)
	check("walking pace is about 4.2 m/s (%.2f)" % walked, near(walked, player.walk_speed, 0.35), "speed=%.2f" % walked)
	await secs(0.6)
	var stamina_before := PlayerStats.stamina
	key_down(KEY_W)
	key_down(KEY_SHIFT)
	await secs(0.8)
	mark = player.global_position
	await secs(0.5)
	var sprinted := Vector2(player.global_position.x - mark.x, player.global_position.z - mark.z).length() / 0.5
	var stamina_after := PlayerStats.stamina
	key_up(KEY_SHIFT)
	key_up(KEY_W)
	check("Shift sprints at about 7.2 m/s (%.2f)" % sprinted, near(sprinted, player.sprint_speed, 0.5), "speed=%.2f" % sprinted)
	check("sprinting spends stamina (%.0f -> %.0f)" % [stamina_before, stamina_after], stamina_after < stamina_before - 10.0, "stamina %.1f -> %.1f" % [stamina_before, stamina_after])
	await secs(1.0)
	var floor_y := player.global_position.y
	var peak := floor_y
	key_down(KEY_SPACE)
	await frames(2)
	key_up(KEY_SPACE)
	for i in 60:
		await get_tree().physics_frame
		peak = maxf(peak, player.global_position.y)
	check("Space jumps about 1 m high (%.2f m) and the player lands again" % (peak - floor_y), peak - floor_y > 0.8 and peak - floor_y < 1.4 and player.is_on_floor() and near(player.global_position.y, floor_y, 0.05), "peak +%.2f floor=%s y=%.3f vs %.3f" % [peak - floor_y, player.is_on_floor(), player.global_position.y, floor_y])


func _check_walk_into_gym() -> void:
	var door_front := gym_point(0.0, 3.0)
	var inside := [gym_point(0.0, 3.0), gym_point(0.0, -2.0), gym_point(0.0, -5.0)]
	var ok := await walk_path(inside, 0.9, 15.0)
	check("player walks through the gym door into the weight room", ok and player.global_position.z < -257.0 and player.global_position.z > -280.0, "pos=%s" % player.global_position)
	check("inside the gym the player stands on the ground floor (1F)", absf(player.global_position.y) < 0.3 and player.is_on_floor(), "y=%.2f" % player.global_position.y)


func _check_stairs() -> void:
	var to_stairs := [gym_point(0.0, -4.8), gym_point(11.7, -4.8), gym_point(12.4, -6.4)]
	var ok := await walk_path(to_stairs, 0.7, 20.0)
	check("player crosses the weight room to the foot of the stairs", ok, "pos=%s" % player.global_position)
	await look_at_point(player.global_position + Vector3(0, 0, -5), false)
	var up1 := await walk_path([gym_point(12.4, -15.6)], 0.5, 15.0)
	await frames(10)
	var y2 := player.global_position.y
	check("first flight of stairs: the player climbs to 2F (y ~5)", up1 and y2 > 4.5 and y2 < 5.6, "y=%.2f pos=%s" % [y2, player.global_position])
	# Around the stairwell opening and back to the foot of the second flight.
	var around := [gym_point(12.4, -17.2, 1), gym_point(9.5, -17.2, 1), gym_point(8.0, -16.4, 1), gym_point(8.0, -5.5, 1), gym_point(12.4, -5.5, 1), gym_point(12.4, -6.4, 1)]
	var ok_around := await walk_path(around, 0.7, 20.0)
	check("on 2F the player walks around the stairwell to the second flight", ok_around and absf(player.global_position.y - 5.0) < 0.6, "pos=%s" % player.global_position)
	await look_at_point(player.global_position + Vector3(0, 0, -5), false)
	var up2 := await walk_path([gym_point(12.4, -15.6, 1)], 0.5, 15.0)
	await frames(10)
	var y3 := player.global_position.y
	check("second flight of stairs: the player climbs to 3F (y ~10)", up2 and y3 > 9.5 and y3 < 10.6, "y=%.2f pos=%s" % [y3, player.global_position])
	check("each storey is 5 m higher than the last", y3 - y2 > 4.4 and y3 - y2 < 5.6, "2F=%.2f 3F=%.2f" % [y2, y3])


func _check_sprint_ride() -> void:
	# Re-arm the ride: park the bike at the start again and mount it.
	bike.global_transform = start_xf
	bike.speed = 0.0
	beacon.active = true
	beacon.scale = Vector3.ONE
	beacon.show()
	PlayerStats.restore_stamina(PlayerStats.max_stamina)
	await place_player(start_xf.origin + Vector3(2.5, 0.05, 3.0), 0.0)
	await look_at_point(bike.global_position + Vector3(0.0, 0.6, 0.0))
	key_down(KEY_W)
	await until(func() -> bool: return player._focus == bike.interactable, 4.0)
	key_up(KEY_W)
	await press_e()
	await frames(3)
	if not check("(sprint run) the bike can be mounted again", player.vehicle == bike):
		return
	await _ride_to_gym(true)
