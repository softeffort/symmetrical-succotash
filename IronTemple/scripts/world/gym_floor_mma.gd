extends Node3D
## Storey 2: MMA and boxing hall with a raised octagon, heavy bags and spectator seating.
## The bags are PunchingBag scenes; the RingManager at the cage runs the fights.
## Uses gym-local x/z; y = 0 is this storey's floor.
##
## Step 7 look: a dark hall around a championship cage. Printed canvas, padded posts and
## chain-link under a truss of stage spots with visible beams; stitched bags on chains under a
## steel beam; wall padding, bleachers and a live fight board. Every collider, the bags and
## the RingManager's dimensions are as they were.

const CEILING := 4.7
const CAGE_CENTRE := Vector3(-1.5, 0.02, -13.5)
const CAGE_RADIUS := 4.6
const CAGE_HEIGHT := 0.72
const FENCE_HEIGHT := 1.8
const RED := Color(0.9, 0.16, 0.16)
const BLUE := Color(0.16, 0.42, 0.95)
const WARM := Color(1.0, 0.88, 0.74)
const PUNCHING_BAG := preload("res://scenes/combat/punching_bag.tscn")


func _ready() -> void:
	_build_floor()
	_build_walls()
	_build_octagon()
	_build_ring()
	_build_bags()
	_build_seating()
	_build_dressing()
	_build_ceiling()
	_build_lighting()


func _build_floor() -> void:
	var rubber := GymKit.floor_material(&"fight")
	Build.box(self, Vector3(24.8, 0.02, 25.2), Vector3(-2.2, 0.01, -13.0), rubber)
	Build.box(self, Vector3(4.36, 0.02, 7.6), Vector3(12.4, 0.01, -4.2), rubber)
	Build.box(self, Vector3(4.36, 0.02, 9.6), Vector3(12.4, 0.01, -20.8), rubber)
	# Striking mats under the bags.
	for i in 5:
		var tile := GymKit.floor_material(&"tatami_red" if i % 2 == 0 else &"tatami_blue")
		Build.box(self, Vector3(4.2, 0.03, 3.6), Vector3(-12.4, 0.035, -4.4 - i * 3.6), tile)


func _build_walls() -> void:
	var dark := Color(0.035, 0.035, 0.045)
	GymKit.wainscot(self, Vector3(-14.6, 0.0, -25.6), Vector3(14.6, 0.0, -25.6), Vector3.BACK, 1.15, dark)
	GymKit.wainscot(self, Vector3(14.6, 0.0, -0.4), Vector3(14.6, 0.0, -8.0), Vector3.LEFT, 1.15, dark)
	GymKit.wainscot(self, Vector3(14.6, 0.0, -16.0), Vector3(14.6, 0.0, -25.6), Vector3.LEFT, 1.15, dark)
	GymKit.wainscot(self, Vector3(-14.6, 0.0, -0.4), Vector3(14.6, 0.0, -0.4), Vector3.FORWARD, 0.7, dark)
	# Protective padding behind the bags, from the library, in alternating corners' colours.
	for i in 10:
		var tone := RED.darkened(0.45) if i % 2 == 0 else BLUE.darkened(0.5)
		var paint := GymKit.palette(tone, {"blue": Stylized.leather(tone, 0.55), "red": Stylized.leather(tone, 0.55), "yellow": {"color": Color(0.8, 0.8, 0.78), "roughness": 0.6}})
		GymKit.model(self, "gym/wall_pad", Vector3(-14.55, 0.1, -2.3 - i * 2.02), 90.0, 2.0, {"fit": ModelLoader.Fit.WIDTH, "palette": paint})
	# Fight posters between the windows and by the stairs.
	var ink := Color(0.03, 0.03, 0.04)
	GymKit.poster(self, Vector3(-4.75, 2.45, -0.405), 180.0, Vector2(1.15, 1.7), 1, ink, RED, "FIGHT\nNIGHT", "EVERY FRIDAY  /  2F", true)
	GymKit.poster(self, Vector3(4.75, 2.45, -0.405), 180.0, Vector2(1.15, 1.7), 4, Color(0.04, 0.06, 0.14), BLUE.lightened(0.2), "TITLE\nBOUT", "FIVE ON THE LADDER", true)
	GymKit.poster(self, Vector3(14.595, 2.7, -2.4), -90.0, Vector2(1.5, 2.1), 0, ink, RED, "NO\nMERCY", "TRAIN HARD  /  FIGHT EASY")
	GymKit.poster(self, Vector3(14.595, 2.7, -5.4), -90.0, Vector2(1.5, 2.1), 2, ink, Color(0.95, 0.75, 0.15), "HANDS\nUP", "CHIN DOWN")
	GymKit.poster(self, Vector3(-10.4, 3.3, -25.595), 0.0, Vector2(3.0, 1.1), 3, ink, RED, "IRON TEMPLE  FIGHT CLUB", "")
	GymKit.poster(self, Vector3(7.6, 3.3, -25.595), 0.0, Vector2(3.0, 1.1), 3, Color(0.04, 0.06, 0.14), BLUE.lightened(0.15), "RESPECT  THE  CAGE", "")


func _build_octagon() -> void:
	var cage := Build.group(self, "Octagon", CAGE_CENTRE)
	var apothem := CAGE_RADIUS * cos(PI / 8.0)
	var side_length := 2.0 * CAGE_RADIUS * sin(PI / 8.0)
	var fence_apothem := apothem - 0.14
	var bay := side_length - 0.38

	# Raised platform: apron, canvas and centre emblem. The 8-sided stage is turned so a flat
	# side faces +Z, where the gate and steps are.
	FightKit.octagon_stage(cage, CAGE_RADIUS, CAGE_HEIGHT, fence_apothem, RED, BLUE)
	Build.drum_blocker(cage, apothem, CAGE_HEIGHT, Vector3(0.0, CAGE_HEIGHT * 0.5, 0.0))
	var emblem := Build.text(cage, "IRON TEMPLE", Vector3(0.0, CAGE_HEIGHT + 0.045, 0.0), 0.3, Color(0.07, 0.07, 0.085), Vector3(-90.0, 0.0, 0.0))
	emblem.outline_size = 0
	# Banners round the apron.
	var slogans: Array[String] = ["IRON TEMPLE", "FIGHT NIGHT", "2F  MMA ARENA", "NO MERCY", "IRON TEMPLE", "NO MERCY", "2F  MMA ARENA", "FIGHT NIGHT"]

	for k in 8:
		var angle := k * TAU / 8.0  # side centre; k = 0 faces +Z
		var out := Vector3(sin(angle), 0.0, cos(angle))
		var yaw := Vector3(0.0, rad_to_deg(angle), 0.0)
		var corner_angle := angle + PI / 8.0
		var corner := Vector3(sin(corner_angle), 0.0, cos(corner_angle)) * (CAGE_RADIUS - 0.14)
		var post_color := (RED if k == 0 else BLUE) if (k == 0 or k == 7) else FightKit.VINYL
		# Padded post on the old post's collider.
		Build.drum_blocker(cage, 0.12, FENCE_HEIGHT, corner + Vector3(0.0, CAGE_HEIGHT + FENCE_HEIGHT * 0.5, 0.0))
		Assembly.place(cage, FightKit.corner_post_mesh(FENCE_HEIGHT, post_color), corner + Vector3(0.0, CAGE_HEIGHT, 0.0), Vector3(0.0, rad_to_deg(corner_angle), 0.0)).name = "Post%d" % k
		if k != 0:
			Build.text(cage, slogans[k], out * (apothem + 0.012) + Vector3(0.0, CAGE_HEIGHT * 0.42, 0.0), 0.2, Color(0.9, 0.9, 0.92) if k % 2 == 0 else RED.lightened(0.15), yaw, 1.1)

		var mid := out * fence_apothem + Vector3(0.0, CAGE_HEIGHT, 0.0)
		if k == 0:
			continue  # gate side stays open
		var stripe := RED if k <= 2 else (BLUE if k >= 6 else Color(0.85, 0.85, 0.88))
		Assembly.place(cage, FightKit.fence_bay_mesh(bay, FENCE_HEIGHT, stripe), mid, yaw).name = "Fence%d" % k
		FightKit.chain_link(cage, Vector2(bay, FENCE_HEIGHT - 0.2), mid + Vector3(0.0, FENCE_HEIGHT * 0.5 + 0.02, 0.0), yaw)
		Build.blocker(cage, Vector3(side_length, FENCE_HEIGHT, 0.14), mid + Vector3(0.0, FENCE_HEIGHT * 0.5, 0.0), yaw)

	var steps := Build.stairs(cage, Vector3(0.0, 0.0, apothem + 1.05), 0.0, 3, CAGE_HEIGHT / 3.0, 0.35, 1.8, GymKit.frame())
	for child in steps.get_children():
		var plain := child as MeshInstance3D
		if plain != null and plain.get_child_count() == 0:
			plain.free()
		elif plain != null:
			plain.mesh = null  # the top tread carries a collider
	FightKit.cage_steps(steps, 3, CAGE_HEIGHT / 3.0, 0.35, 1.8)


## The RingManager adds the gate, the fight card terminal and the fight zone to the cage.
func _build_ring() -> void:
	var apothem := CAGE_RADIUS * cos(PI / 8.0)
	var ring := RingManager.new()
	ring.name = "RingManager"
	ring.position = CAGE_CENTRE
	ring.platform_height = CAGE_HEIGHT
	ring.fence_height = FENCE_HEIGHT
	ring.arena_radius = apothem - 0.3
	ring.gate_distance = apothem - 0.14
	ring.side_length = 2.0 * CAGE_RADIUS * sin(PI / 8.0)
	ring.pad_color = RED
	add_child(ring)


func _build_bags() -> void:
	var mount := CEILING - 0.35
	# Steel the bags hang from: a beam down the row, tied back to the wall and up to the slab.
	var steel := Assembly.new()
	var beam_y := mount + 0.117
	FightKit.i_beam(steel, Vector3(-12.6, beam_y, -2.5), Vector3(-12.6, beam_y, -20.7))
	var colors: Array[Color] = [RED, Color(0.1, 0.1, 0.12), BLUE, Color(0.95, 0.75, 0.1), RED]
	for i in 5:
		var z := -4.4 - i * 3.6
		var bag: PunchingBag = PUNCHING_BAG.instantiate()
		bag.name = "HeavyBag%d" % (i + 1)
		bag.color = colors[i]
		bag.mount_height = mount
		bag.position = Vector3(-12.6, 0.0, z)
		add_child(bag)
		FightKit.i_beam(steel, Vector3(-14.6, beam_y, z + 1.8), Vector3(-12.67, beam_y, z + 1.8), 0.14)
		steel.box(Vector3(0.05, CEILING - beam_y - 0.09, 0.012), Vector3(-12.6, (CEILING + beam_y + 0.09) * 0.5, z + 1.8), GymKit.frame())
		steel.box(Vector3(0.16, 0.012, 0.16), Vector3(-12.6, CEILING - 0.006, z + 1.8), GymKit.frame())
		# A tight spot over every bag.
		GymKit.stage_spot(self, Vector3(-11.3, CEILING - 0.42, z), Vector3(-12.6, 1.3, z), WARM, 3.2, 24.0, false, 0.1)
	steel.commit(self, "BagSteel").cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

	# Speed bag on the wall, and the kit corner: gloves, mitts, shields and head guards.
	var kit := GymKit.palette(RED, {"timber": {"color": Color(0.2, 0.13, 0.08), "roughness": 0.55, "surface": Stylized.Surface.WOOD}, "red": {"color": RED.darkened(0.2), "roughness": 0.5, "surface": Stylized.Surface.LEATHER, "bump": 0.3}})
	GymKit.model(self, "gym/speed_bag", Vector3(-14.15, 1.55, -20.6), 90.0, 0.75, {"palette": kit})
	var bracket := Assembly.new()
	for z: float in [-20.9, -20.3]:
		bracket.beam(Vector3(-14.6, 2.32, z), Vector3(-13.85, 2.32, z), 0.04, 0.04, GymKit.frame())
		bracket.beam(Vector3(-14.6, 1.95, z), Vector3(-13.95, 2.3, z), 0.03, 0.03, GymKit.frame())
		bracket.box(Vector3(0.012, 0.5, 0.09), Vector3(-14.594, 2.12, z), GymKit.frame())
	bracket.commit(self, "SpeedBagBracket")
	GymKit.stage_spot(self, Vector3(-12.6, CEILING - 0.42, -22.4), Vector3(-14.0, 1.0, -22.4), WARM, 2.6, 30.0, false, 0.08)
	GymKit.model(self, "gym/gloves_shelf", Vector3(-14.3, 0.02, -22.0), 90.0, 1.09, {"palette": kit})
	GymKit.model(self, "gym/gloves_shelf", Vector3(-14.3, 0.02, -22.75), 90.0, 1.09, {"palette": GymKit.palette(BLUE, {"timber": kit["timber"], "red": {"color": BLUE.darkened(0.25), "roughness": 0.5, "surface": Stylized.Surface.LEATHER, "bump": 0.3}})})
	GymKit.model(self, "gym/kick_shield", Vector3(-14.25, 0.02, -23.6), 80.0, 0.8, {"palette": kit})
	GymKit.model(self, "gym/headgear", Vector3(-13.55, 0.02, -24.6), 140.0, 0.3, {"palette": kit})
	GymKit.model(self, "gym/focus_mitts", Vector3(-13.3, 0.02, -23.9), 35.0, 0.12, {"palette": kit})


func _build_seating() -> void:
	# Timber-and-steel bleachers along the north wall, standing on the old tiers' colliders.
	for tier in 3:
		var height := 0.42 * (tier + 1)
		Build.blocker(self, Vector3(15.0, height, 0.9), Vector3(-1.5, height * 0.5, -22.9 - tier * 0.9))
	var paint := {
		"steel": {"color": GymKit.STEEL_DARK, "roughness": 0.5, "metallic": 0.35, "surface": Stylized.Surface.STEEL},
		"dark": {"color": Color(0.4, 0.26, 0.14), "roughness": 0.55, "surface": Stylized.Surface.WOOD},
	}
	var section := ModelLoader.flat("gym/bleacher_section", 2.2, {"palette": paint, "yaw": 180.0})
	var wide := section.get_aabb().size.x
	for i in 3:
		var stand := Assembly.place(self, section, Vector3(-6.5 + i * 5.0, 0.02, -24.1))
		stand.name = "Bleacher%d" % (i + 1)
		stand.scale.x = 5.0 / wide
	for x: float in [-8.0, -1.5, 5.0]:
		GymProps.changing_bench(self, Vector3(x, 0.02, -1.5), 0.0, 3.4, Color(0.3, 0.1, 0.08))
	GymProps.changing_bench(self, Vector3(8.6, 0.02, -19.5), 90.0, 3.0, Color(0.08, 0.14, 0.3))


func _build_dressing() -> void:
	Build.text(self, "FIGHT HALL", Vector3(-1.5, 3.7, -25.55), 0.9, RED, Vector3.ZERO, 1.8)
	Build.text(self, "TRAIN HARD  •  FIGHT EASY", Vector3(-1.5, 2.9, -25.55), 0.3, Color(0.9, 0.9, 0.95), Vector3.ZERO, 1.1)
	var stripe := Build.mat(RED.darkened(0.25), 0.6)
	Build.box(self, Vector3(29.2, 0.3, 0.02), Vector3(0.0, 1.32, -25.57), stripe)
	Build.box(self, Vector3(0.02, 0.3, 7.6), Vector3(14.57, 1.32, -4.2), stripe)
	Build.box(self, Vector3(0.02, 0.3, 9.6), Vector3(14.57, 1.32, -20.8), stripe)
	# Fight board and round timer on the east wall.
	var board := FightBoard.new()
	board.name = "FightBoard"
	board.position = Vector3(14.595, 3.15, -22.7)
	board.rotation_degrees.y = -90.0
	add_child(board)
	# Ringside: the bell table, the corner stools and bucket, and the belt on its stand.
	var ringside := GymKit.palette(RED, {"timber": {"color": Color(0.2, 0.13, 0.08), "roughness": 0.55, "surface": Stylized.Surface.WOOD}})
	# They stand tight to the apron, inside the lane the spectators walk round the cage.
	GymKit.model(self, "gym/ring_bell", Vector3(-3.5, 0.02, -8.75), 160.0, 1.0, {"palette": ringside})
	GymKit.model(self, "gym/corner_stool", Vector3(-4.35, 0.02, -9.3), 20.0, 0.56, {"palette": ringside})
	GymKit.model(self, "gym/spit_bucket", Vector3(-4.85, 0.02, -9.75), 0.0, 0.36, {"palette": ringside})
	GymKit.model(self, "gym/trophy_belt", Vector3(7.6, 0.02, -24.6), 200.0, 1.65, {"palette": ringside})
	# Library props in the back corners.
	GymKit.model(self, "gym/fan_standing", Vector3(13.9, 0.02, -24.8), -40.0, 1.5)
	GymKit.model(self, "gym/medicine_ball_rack", Vector3(-13.6, 0.02, -25.0), 0.0, 1.1, {"palette": GymKit.palette(RED)})
	GymKit.model(self, "gym/water_bottle", Vector3(-12.6, 0.02, -24.9), 30.0, 0.26, {"palette": GymKit.palette(BLUE, {"carcass": Color(0.8, 0.82, 0.86)})})


func _build_ceiling() -> void:
	for z: float in [-3.0, -7.3, -11.6, -15.9, -20.2, -24.4]:
		var east := 10.2 if z < -8.0 and z > -16.0 else 14.6
		GymKit.joist(self, Vector3(-14.6, CEILING, z), Vector3(east, CEILING, z))
	GymKit.duct(self, Vector3(-8.6, CEILING - 0.5, -1.2), Vector3(-8.6, CEILING - 0.5, -24.8))
	GymKit.duct(self, Vector3(6.4, CEILING - 0.5, -1.2), Vector3(6.4, CEILING - 0.5, -24.8))


func _build_lighting() -> void:
	# The hall itself is kept low so the cage carries the room.
	for x: float in [-10.0, 9.2]:
		for z: float in [-4.5, -21.5]:
			GymKit.led_pendant(self, Vector3(x, CEILING, z), 0.0, WARM, 2.2, 8.5, 76.0, RED)
	GymKit.led_pendant(self, Vector3(3.2, CEILING, -21.5), 0.0, WARM, 1.9, 8.5, 76.0, RED)
	# Red wash along the head of the walls.
	GymKit.led_strip(self, Vector3(0.0, CEILING - 0.3, -25.57), Vector3(-90.0, 0.0, 0.0), 28.6, RED, 3.0)
	GymKit.led_strip(self, Vector3(-14.57, CEILING - 0.3, -13.0), Vector3(-90.0, 90.0, 0.0), 24.6, RED, 3.0)
	Build.omni(self, Vector3(-1.5, 3.6, -24.6), RED, 1.4, 9.0)
	Build.omni(self, Vector3(-13.6, 3.4, -13.0), RED, 0.9, 9.0)
	# Fight-night rig over the cage: a square truss of spots converging on the canvas, with a
	# soft fill straight down so the fighters never fall into black.
	var over := Vector3(CAGE_CENTRE.x, CEILING - 0.62, CAGE_CENTRE.z)
	FightKit.light_rig(self, over, 2.07, CEILING, CAGE_CENTRE.y + CAGE_HEIGHT + 0.06, RED, BLUE)
	Build.spot_down(self, over - Vector3(0.0, 0.4, 0.0), Color(1.0, 0.97, 0.92), 0.9, 8.0, 56.0)
	GymKit.room_probe(self, Vector3(0.0, CEILING * 0.5, -13.0), Vector3(29.2, CEILING, 25.2), Color(0.22, 0.22, 0.32), 0.36)
