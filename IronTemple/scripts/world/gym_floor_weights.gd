extends Node3D
## Storey 1: weight and cardio room.
## Gym-local coordinates: entrance at z = 0, room spans x -14.6..14.6 and z -0.4..-25.6.
## The mirror wall is a scene instance (MirrorWall) so it can be tuned in the editor.
##
## Step 7 look: speckled rubber flooring with a seam grid, painted concrete over a dark
## wainscot, framed posters and an LED clock, exposed joists and ducting overhead and cool
## linear pendants. The stations stand exactly where they did.

const CEILING := 4.7
const ACCENT := Color(1.0, 0.5, 0.1)
const STEEL_BLUE := Color(0.22, 0.38, 0.6)
const LIGHT := Color(0.92, 0.96, 1.0)


func _ready() -> void:
	_build_floor()
	_build_walls()
	_build_free_weights()
	_build_strength()
	_build_cardio()
	_build_warmup()
	_build_dressing()
	_build_ceiling()
	_build_lighting()


func _build_floor() -> void:
	# Finishes stay within a few centimetres of the ground collider at y = 0.
	Build.box(self, Vector3(29.6, 0.04, 26.0), Vector3(0.0, 0.0, -13.0), GymKit.floor_material(&"weights"))
	Build.box(self, Vector3(5.2, 0.02, 12.8), Vector3(-11.9, 0.025, -13.0), GymKit.floor_material(&"oak"))
	Build.box(self, Vector3(13.0, 0.02, 5.0), Vector3(0.0, 0.025, -12.3), GymKit.floor_material(&"lifting"))
	Build.box(self, Vector3(11.6, 0.02, 3.6), Vector3(8.6, 0.025, -2.4), GymKit.floor_material(&"cardio"))
	# Inlaid lines around the zones.
	var lines := Assembly.new()
	var paint := Build.mat(ACCENT.darkened(0.15), 0.6)
	for zone: Rect2 in [Rect2(-14.5, -19.4, 5.2, 12.8), Rect2(-6.5, -14.8, 13.0, 5.0), Rect2(2.8, -4.2, 11.6, 3.6)]:
		lines.box(Vector3(zone.size.x, 0.004, 0.05), Vector3(zone.get_center().x, 0.037, zone.position.y), paint)
		lines.box(Vector3(zone.size.x, 0.004, 0.05), Vector3(zone.get_center().x, 0.037, zone.end.y), paint)
		lines.box(Vector3(0.05, 0.004, zone.size.y), Vector3(zone.position.x, 0.037, zone.get_center().y), paint)
		lines.box(Vector3(0.05, 0.004, zone.size.y), Vector3(zone.end.x, 0.037, zone.get_center().y), paint)
	lines.commit(self, "ZoneLines").cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func _build_walls() -> void:
	# Dark wainscot under the painted concrete; low under the windows and the mirror.
	GymKit.wainscot(self, Vector3(-14.6, 0.0, -25.6), Vector3(14.6, 0.0, -25.6), Vector3.BACK)
	GymKit.wainscot(self, Vector3(14.6, 0.0, -8.0), Vector3(14.6, 0.0, -0.4), Vector3.LEFT)
	GymKit.wainscot(self, Vector3(-14.6, 0.0, -0.4), Vector3(-14.6, 0.0, -6.75), Vector3.RIGHT)
	GymKit.wainscot(self, Vector3(-14.6, 0.0, -19.25), Vector3(-14.6, 0.0, -25.6), Vector3.RIGHT)
	GymKit.wainscot(self, Vector3(-14.6, 0.0, -6.75), Vector3(-14.6, 0.0, -19.25), Vector3.RIGHT, 0.34)
	GymKit.wainscot(self, Vector3(-2.3, 0.0, -0.4), Vector3(-14.6, 0.0, -0.4), Vector3.FORWARD, 0.6)
	GymKit.wainscot(self, Vector3(14.6, 0.0, -0.4), Vector3(2.3, 0.0, -0.4), Vector3.FORWARD, 0.6)

	# Posters and banners.
	var ink := Color(0.035, 0.035, 0.045)
	GymKit.poster(self, Vector3(8.9, 2.75, -25.595), 0.0, Vector2(1.5, 2.1), 0, ink, ACCENT, "NO\nEXCUSES", "IRON TEMPLE  /  EST. 1F")
	GymKit.poster(self, Vector3(11.3, 2.75, -25.595), 0.0, Vector2(1.5, 2.1), 1, Color(0.05, 0.09, 0.16), Color(0.95, 0.75, 0.15), "EARN\nIT", "ONE MORE REP")
	GymKit.poster(self, Vector3(-10.9, 2.9, -25.595), 0.0, Vector2(3.4, 1.3), 3, ink, STEEL_BLUE.lightened(0.15), "LIFT  HEAVY", "RE-RACK YOUR WEIGHTS")
	GymKit.poster(self, Vector3(-14.595, 2.75, -2.1), 90.0, Vector2(1.5, 2.1), 2, Color(0.04, 0.12, 0.13), Color(0.3, 0.9, 0.6), "WARM\nUP", "MOVE BEFORE YOU LOAD")
	GymKit.poster(self, Vector3(-14.595, 2.75, -4.5), 90.0, Vector2(1.5, 2.1), 4, ink, Color(0.9, 0.2, 0.18), "FOCUS", "EVERY SET COUNTS")
	GymKit.poster(self, Vector3(14.595, 2.75, -2.6), -90.0, Vector2(1.5, 2.1), 3, Color(0.05, 0.08, 0.14), Color(0.3, 0.8, 1.0), "RUN\nIT", "TRAINING PACE 7 KM/H +")
	GymKit.poster(self, Vector3(14.595, 3.2, -20.6), -90.0, Vector2(3.4, 1.1), 0, ink, ACCENT, "MEMBERS  LOCKERS", "", true)

	# LED clock where the runners can watch it.
	var clock := GymClock.new()
	clock.name = "GymClock"
	clock.position = Vector3(3.15, 3.45, -0.405)
	clock.rotation_degrees.y = 180.0
	add_child(clock)


func _build_free_weights() -> void:
	GymProps.dumbbell_rack(self, Vector3(-13.9, 0.02, -22.4), 90.0)
	for z: float in [-10.0, -16.0]:
		GymProps.weight_bench(self, Vector3(-11.0, 0.02, z), 90.0)
		GymProps.dumbbell(self, Vector3(-10.2, 0.11, z + 1.0), 0.08, Color(0.2, 0.8, 0.9), 20.0)
		GymProps.dumbbell(self, Vector3(-10.5, 0.11, z + 1.3), 0.08, Color(0.2, 0.8, 0.9), -35.0)
	Build.text(self, "FREE WEIGHTS", Vector3(-14.55, 4.15, -13.0), 0.5, ACCENT, Vector3(0.0, 90.0, 0.0), 1.4)


func _build_strength() -> void:
	var plates := GymProps.PLATES
	for i in 3:
		GymProps.bench_press(self, Vector3(-4.2 + i * 4.2, 0.02, -12.4), 0.0, plates[i])
	GymProps.squat_rack(self, Vector3(-5.5, 0.02, -23.8), 0.0, ACCENT)
	GymProps.squat_rack(self, Vector3(-1.0, 0.02, -23.8), 0.0, Color(0.95, 0.8, 0.1))
	GymProps.deadlift_platform(self, Vector3(4.2, 0.02, -23.4), 0.0)
	# Plate tree between the racks.
	var tree := Build.group(self, "PlateTree", Vector3(-3.25, 0.02, -24.6))
	Build.blocker(tree, Vector3(0.7, 1.3, 0.7), Vector3(0.0, 0.65, 0.0))
	GymKit.model(tree, "gym/weight_plate_tree", Vector3.ZERO, 90.0, 1.3)
	# Spare bumpers and the chalk bowl by the deadlift platform.
	GymKit.model(self, "gym/bumper_plate_stack", Vector3(6.35, 0.02, -24.6), 25.0, 0.42)
	GymKit.model(self, "gym/bumper_plate_stack", Vector3(1.95, 0.02, -24.75), -40.0, 0.3, {"palette": GymKit.palette(Color(0.16, 0.47, 0.96))})
	_chalk_bowl(Vector3(6.55, 0.02, -22.6))
	Build.text(self, "STRENGTH", Vector3(-1.0, 4.0, -25.55), 0.6, ACCENT, Vector3.ZERO, 1.4)


func _chalk_bowl(pos: Vector3) -> void:
	var bowl := Assembly.spawn(self, "chalk_bowl", func(a: Assembly) -> void:
		var steel := GymKit.frame()
		a.lathe(PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.2, 0.0), Vector2(0.2, 0.012), Vector2(0.04, 0.03), Vector2(0.025, 0.06), Vector2(0.025, 0.74), Vector2(0.06, 0.78)]), Vector3.ZERO, steel, Vector3.ZERO, 16)
		a.lathe(PackedVector2Array([Vector2(0.06, 0.78), Vector2(0.2, 0.86), Vector2(0.23, 0.95), Vector2(0.22, 0.95), Vector2(0.19, 0.87), Vector2(0.0, 0.83)]), Vector3.ZERO, GymKit.chrome(), Vector3.ZERO, 20)
		a.lathe(PackedVector2Array([Vector2(0.0, 0.9), Vector2(0.12, 0.895), Vector2(0.195, 0.885)]), Vector3.ZERO, Build.mat(Color(0.93, 0.93, 0.9), 0.95), Vector3.ZERO, 14)
		for i in 3:
			a.rbox(Vector3(0.07, 0.05, 0.05), 0.012, Vector3(-0.06 + i * 0.06, 0.915, 0.03 - i * 0.04), Build.mat(Color(0.96, 0.96, 0.94), 0.95), Vector3(0.0, i * 35.0, 0.0), 1)
	)
	bowl.position = pos
	bowl.name = "ChalkBowl"


func _build_cardio() -> void:
	var bottles: Array[Color] = [Color(0.2, 0.6, 1.0), ACCENT, Color(0.3, 0.85, 0.5), Color(0.9, 0.25, 0.3), Color(0.75, 0.75, 0.8)]
	for i in 5:
		GymProps.treadmill(self, Vector3(4.0 + i * 2.2, 0.02, -2.4), 0.0, bottles[i])
	Build.text(self, "CARDIO", Vector3(8.6, 4.25, -0.45), 0.5, Color(0.3, 0.85, 1.0), Vector3(0.0, 180.0, 0.0), 1.4)


func _build_warmup() -> void:
	# Interlocking foam tiles from the library, two tones, with a bevelled edging strip.
	var teal := {"floor": {"color": Color(0.05, 0.2, 0.23), "roughness": 0.9, "surface": Stylized.Surface.FOAM}}
	var slate := {"accent": {"color": Color(0.075, 0.08, 0.095), "roughness": 0.9, "surface": Stylized.Surface.FOAM}}
	for column in 8:
		for row in 4:
			var spot := Vector3(-12.75 + column * 1.1, 0.0325, -1.45 - row * 1.1)
			if (column + row) % 2 == 0:
				GymKit.model(self, "gym/floor_tile_rubber", spot, 0.0, 1.1, {"fit": ModelLoader.Fit.WIDTH, "palette": teal, "shadows": false})
			else:
				GymKit.model(self, "gym/floor_tile_accent", spot, 0.0, 1.1, {"fit": ModelLoader.Fit.WIDTH, "palette": slate, "shadows": false})
	var edging := Assembly.new()
	var ramp := Stylized.foam(Color(0.03, 0.03, 0.036))
	edging.rbox(Vector3(9.0, 0.07, 0.16), 0.03, Vector3(-8.9, 0.025, -0.86), ramp, Vector3.ZERO, 1)
	edging.rbox(Vector3(9.0, 0.07, 0.16), 0.03, Vector3(-8.9, 0.025, -5.34), ramp, Vector3.ZERO, 1)
	edging.rbox(Vector3(0.16, 0.07, 4.64), 0.03, Vector3(-13.34, 0.025, -3.1), ramp, Vector3.ZERO, 1)
	edging.rbox(Vector3(0.16, 0.07, 4.64), 0.03, Vector3(-4.46, 0.025, -3.1), ramp, Vector3.ZERO, 1)
	edging.commit(self, "MatEdging")

	for i in 3:
		var mat_color := Color.from_hsv(0.78 + i * 0.09, 0.55, 0.9)
		GymProps.yoga_mat(self, Vector3(-12.3 + i * 1.3, 0.06, -3.0), 0.0, mat_color)
	# Rollers, balls, bells and a plyo box.
	GymKit.model(self, "gym/foam_roller", Vector3(-8.2, 0.06, -4.6), 30.0, 0.15, {"palette": GymKit.palette(ACCENT, {"rubber": {"color": Color(0.75, 0.2, 0.4), "roughness": 0.9, "surface": Stylized.Surface.FOAM}})})
	GymKit.model(self, "gym/foam_roller", Vector3(-8.05, 0.06, -4.15), 75.0, 0.15, {"palette": GymKit.palette(ACCENT, {"rubber": {"color": Color(0.1, 0.3, 0.75), "roughness": 0.9, "surface": Stylized.Surface.FOAM}})})
	GymKit.model(self, "gym/medicine_ball", Vector3(-7.4, 0.06, -2.0), 0.0, 0.34, {"palette": GymKit.palette(Color(0.8, 0.2, 0.16), {"leather": {"color": Color(0.5, 0.1, 0.08), "roughness": 0.6, "surface": Stylized.Surface.LEATHER}})})
	GymKit.model(self, "gym/medicine_ball", Vector3(-7.0, 0.06, -2.5), 50.0, 0.28, {"palette": GymKit.palette(STEEL_BLUE, {"leather": {"color": Color(0.08, 0.16, 0.42), "roughness": 0.6, "surface": Stylized.Surface.LEATHER}})})
	GymKit.model(self, "gym/yoga_mat_rolled", Vector3(-5.2, 0.06, -4.9), 80.0, 0.14)
	GymKit.model(self, "gym/jump_rope", Vector3(-9.6, 0.06, -4.7), 15.0, 0.07)
	for i in 4:
		GymProps.kettlebell(self, Vector3(-5.3, 0.06, -1.6 - i * 0.45), Color.from_hsv(0.12 - i * 0.03, 0.8, 0.95), 0.85 + i * 0.12)
	var box := Build.group(self, "PlyoBox", Vector3(-6.0, 0.06, -4.6))
	Build.blocker(box, Vector3(0.7, 0.6, 0.7), Vector3(0.0, 0.3, 0.0))
	GymKit.model(box, "gym/plyo_box", Vector3.ZERO, 0.0, 0.6)
	Build.text(self, "WARM-UP", Vector3(-8.7, 4.25, -0.45), 0.5, Color(0.35, 0.9, 0.55), Vector3(0.0, 180.0, 0.0), 1.4)


func _build_dressing() -> void:
	# Locker banks along the east wall beyond the stairs, on the old lockers' colliders.
	for i in 7:
		Build.blocker(self, Vector3(0.5, 1.9, 0.98), Vector3(14.3, 0.97, -17.6 - i * 1.02))
	for i in 5:
		var doors := STEEL_BLUE if i % 2 == 0 else ACCENT.darkened(0.1)
		var id := "gym/locker_bank_open" if i == 3 else "gym/locker_bank"
		GymKit.model(self, id, Vector3(14.29, 0.02, -17.8 - i * 1.43), 90.0, 1.9, {"palette": GymKit.palette(doors, {"accent": {"color": doors, "roughness": 0.45, "metallic": 0.3, "surface": Stylized.Surface.STEEL}})})
	GymProps.changing_bench(self, Vector3(12.6, 0.02, -20.6), 90.0, 3.0)
	GymKit.model(self, "gym/towel_shelf", Vector3(12.4, 0.02, -25.3), 180.0, 1.35, {"palette": GymKit.palette(ACCENT, {"carcass": {"color": Color(0.14, 0.15, 0.18), "roughness": 0.5}})})
	GymProps.plant(self, Vector3(-2.9, 0.02, -1.1), 1.2)
	GymProps.plant(self, Vector3(2.9, 0.02, -1.1), 1.2)
	GymProps.plant(self, Vector3(9.4, 0.02, -24.8), 1.3)
	# Library props tucked against the walls, clear of every station and walkway.
	GymKit.model(self, "gym/water_cooler", Vector3(4.5, 0.02, -0.75), 180.0, 1.35, {"palette": GymKit.palette(STEEL_BLUE, {"carcass": {"color": Color(0.62, 0.64, 0.68), "roughness": 0.4}})})
	GymKit.model(self, "gym/fan_standing", Vector3(-4.6, 0.02, -0.9), 160.0, 1.5)
	GymProps.prop(self, "gym/radio_boombox", Vector3(8.2, 0.02, -25.1), 0.0, 0.34)
	GymProps.prop(self, "gym/trashcan", Vector3(10.5, 0.02, -25.0), 0.0, 0.7)
	# Accent stripe around the room at rail height.
	var stripe := Build.mat(ACCENT, 0.6)
	Build.box(self, Vector3(29.2, 0.14, 0.02), Vector3(0.0, 4.45, -25.58), stripe)
	Build.box(self, Vector3(0.02, 0.14, 25.2), Vector3(14.58, 4.45, -13.0), stripe)
	Build.box(self, Vector3(0.02, 0.14, 25.2), Vector3(-14.58, 4.45, -13.0), stripe)


func _build_ceiling() -> void:
	# Open-web joists across the room; the two over the stairwell stop at its edge.
	for z: float in [-3.0, -7.3, -11.6, -15.9, -20.2, -24.4]:
		var east := 10.2 if z < -8.0 and z > -16.0 else 14.6
		GymKit.joist(self, Vector3(-14.6, CEILING, z), Vector3(east, CEILING, z))
	GymKit.duct(self, Vector3(-6.2, CEILING - 0.5, -1.2), Vector3(-6.2, CEILING - 0.5, -24.8))
	GymKit.duct(self, Vector3(4.2, CEILING - 0.5, -1.2), Vector3(4.2, CEILING - 0.5, -24.8))
	# Sprinkler main with drops.
	var pipes := Assembly.new()
	var red := Stylized.standard(Color(0.55, 0.07, 0.06), 0.45, 0.4, Stylized.Surface.STEEL)
	for x: float in [-11.8, 9.4]:
		pipes.tube(Vector3(x, CEILING - 0.62, -0.6), Vector3(x, CEILING - 0.62, -25.4), 0.03, red, 8)
		for i in 6:
			var z := -2.5 - i * 4.2
			pipes.tube(Vector3(x, CEILING - 0.62, z), Vector3(x, CEILING - 0.76, z), 0.012, red, 6)
			pipes.cyl(0.03, 0.012, Vector3(x, CEILING - 0.77, z), GymKit.chrome(), Vector3.ZERO, -1.0, 8)
	pipes.commit(self, "Sprinklers").cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func _build_lighting() -> void:
	for x: float in [-9.5, -0.5, 7.2]:
		for z: float in [-4.5, -13.0, -21.5]:
			GymProps.ceiling_light(self, Vector3(x, CEILING, z), LIGHT, 4.6)
	# A warm wash on the back wall behind the racks.
	Build.omni(self, Vector3(-3.3, 3.4, -24.4), Color(1.0, 0.72, 0.45), 1.3, 7.0)
	GymKit.room_probe(self, Vector3(0.0, CEILING * 0.5, -13.0), Vector3(29.2, CEILING, 25.2), Color(0.5, 0.55, 0.66), 0.36)
