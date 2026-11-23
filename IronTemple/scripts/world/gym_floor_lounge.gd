extends Node3D
## Storey 3: supplement bar and lounge.
## The SupplementBar node at the counter adds the bartender and the shop prompt.
## Uses gym-local x/z; y = 0 is this storey's floor.
##
## Step 7 look: the warm end of the building. Walnut boards, a fluted counter with a stone top
## and purple and amber LED strips, stocked back shelves, a lit glass-front fridge, tube neon
## behind the bar and low dome pendants over leather seating. The counters' colliders, the
## stools, the sofas' blockers and the SupplementBar are as they were.

const CEILING := 5.0
const PURPLE := BarKit.PURPLE
const AMBER := BarKit.AMBER
const NEON_PINK := Color(1.0, 0.22, 0.6)
const WARM := Color(1.0, 0.74, 0.48)
const OXBLOOD := Color(0.42, 0.08, 0.1)
const TAN := Color(0.62, 0.38, 0.2)
const PLUM := Color(0.34, 0.13, 0.42)
const BAR_Z := -21.3
const BAR_WEST := -9.5
const BAR_EAST := 3.5


func _ready() -> void:
	_build_floor()
	_build_walls()
	_build_bar()
	_build_lounge()
	_build_neon()
	_build_ceiling()
	_build_lighting()


func _build_floor() -> void:
	var boards := GymKit.floor_material(&"boards")
	Build.box(self, Vector3(24.8, 0.02, 25.2), Vector3(-2.2, 0.01, -13.0), boards)
	Build.box(self, Vector3(4.36, 0.02, 7.6), Vector3(12.4, 0.01, -4.2), boards)
	Build.box(self, Vector3(4.36, 0.02, 9.6), Vector3(12.4, 0.01, -20.8), boards)
	# Rugs under the two seating groups: a bound rectangle and a round one.
	var rugs := Assembly.new()
	rugs.rbox(Vector3(6.5, 0.024, 5.0), 0.01, Vector3(-9.0, 0.03, -6.0), Stylized.fabric(Color(0.16, 0.07, 0.2)), Vector3.ZERO, 1)
	rugs.rbox(Vector3(5.9, 0.026, 4.4), 0.01, Vector3(-9.0, 0.03, -6.0), Stylized.fabric(Color(0.24, 0.1, 0.27)), Vector3.ZERO, 1)
	rugs.lathe(PackedVector2Array([Vector2(2.4, 0.02), Vector2(2.4, 0.036), Vector2(2.36, 0.042), Vector2(0.0, 0.042)]), Vector3(3.0, 0.0, -5.5), Stylized.fabric(Color(0.3, 0.16, 0.07)), Vector3.ZERO, 40)
	rugs.lathe(PackedVector2Array([Vector2(1.9, 0.044), Vector2(1.6, 0.044)]), Vector3(3.0, 0.0, -5.5), Stylized.fabric(Color(0.5, 0.3, 0.12)), Vector3.ZERO, 40)
	rugs.commit(self, "Rugs").cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func _build_walls() -> void:
	var panel := Color(0.05, 0.035, 0.065)
	GymKit.wainscot(self, Vector3(-14.6, 0.0, -25.6), Vector3(14.6, 0.0, -25.6), Vector3.BACK, 1.15, panel)
	GymKit.wainscot(self, Vector3(-14.6, 0.0, -0.4), Vector3(-14.6, 0.0, -25.6), Vector3.RIGHT, 1.15, panel)
	GymKit.wainscot(self, Vector3(14.6, 0.0, -0.4), Vector3(14.6, 0.0, -8.0), Vector3.LEFT, 1.15, panel)
	GymKit.wainscot(self, Vector3(14.6, 0.0, -16.0), Vector3(14.6, 0.0, -25.6), Vector3.LEFT, 1.15, panel)
	GymKit.wainscot(self, Vector3(-14.6, 0.0, -0.4), Vector3(14.6, 0.0, -0.4), Vector3.FORWARD, 0.7, panel)
	var ink := Color(0.05, 0.03, 0.07)
	GymKit.poster(self, Vector3(14.595, 2.7, -2.4), -90.0, Vector2(1.5, 2.1), 2, ink, AMBER, "REST\nDAY", "RECOVERY IS TRAINING", true)
	GymKit.poster(self, Vector3(14.595, 2.7, -5.4), -90.0, Vector2(1.5, 2.1), 4, ink, PURPLE.lightened(0.2), "SHAKE\nIT", "WHEY  /  ISOTONIC  /  ELIXIR", true)
	GymKit.poster(self, Vector3(-4.75, 2.45, -0.405), 180.0, Vector2(1.15, 1.7), 1, ink, AMBER, "HAPPY\nHOUR", "AFTER EVERY SESSION", true)
	GymKit.poster(self, Vector3(4.75, 2.45, -0.405), 180.0, Vector2(1.15, 1.7), 0, ink, NEON_PINK, "IRON\nBAR", "3F  /  OPEN LATE", true)


func _build_bar() -> void:
	var length := BAR_EAST - BAR_WEST
	var mid_x := (BAR_WEST + BAR_EAST) * 0.5
	var carcass := Stylized.wood(Color(0.06, 0.045, 0.065), 0.5)

	# Counter with a return leg at the west end; staff enter from the east. The colliders
	# are the three boxes the bar has always been.
	Build.blocker(self, Vector3(length, 1.05, 0.7), Vector3(mid_x, 0.525, BAR_Z))
	Build.blocker(self, Vector3(0.7, 1.05, 3.6), Vector3(BAR_WEST + 0.35, 0.525, BAR_Z - 2.15))
	Build.blocker(self, Vector3(length, 0.95, 0.6), Vector3(mid_x, 0.475, -25.25))
	Build.box(self, Vector3(length - 0.02, 1.03, 0.66), Vector3(mid_x, 0.515, BAR_Z - 0.01), carcass)
	Build.box(self, Vector3(0.66, 1.03, 3.6), Vector3(BAR_WEST + 0.36, 0.515, BAR_Z - 2.15), carcass)
	Assembly.place(self, BarKit.counter_front_mesh(length, 1.05), Vector3(mid_x, 0.0, BAR_Z + 0.35)).name = "CounterFront"
	Assembly.place(self, BarKit.counter_front_mesh(4.3, 1.05), Vector3(BAR_WEST, 0.0, BAR_Z - 1.8), Vector3(0.0, -90.0, 0.0)).name = "CounterReturn"
	Assembly.place(self, BarKit.counter_top_mesh(Vector3(length + 0.3, 0.07, 1.0)), Vector3(mid_x, 1.085, BAR_Z + 0.05)).name = "CounterTop"
	Assembly.place(self, BarKit.counter_top_mesh(Vector3(0.95, 0.07, 3.6)), Vector3(BAR_WEST + 0.35, 1.085, BAR_Z - 2.15)).name = "ReturnTop"

	var seats: Array[Color] = [OXBLOOD, Color(0.07, 0.07, 0.08), TAN]
	for i in 7:
		GymProps.stool(self, Vector3(BAR_WEST + 1.2 + i * 1.75, 0.02, BAR_Z + 1.0), seats[i % seats.size()])

	# Back bar: a slatted wall, a cupboard run under a stone top and three lit shelves of stock.
	var back := Assembly.new()
	var slat := Stylized.wood(Color(0.1, 0.065, 0.085), 0.45)
	back.box(Vector3(length, 3.0, 0.08), Vector3(mid_x, 2.0, -25.52), carcass)
	for i in floori(length / 0.16):
		back.box(Vector3(0.07, 2.96, 0.03), Vector3(BAR_WEST + 0.08 + i * 0.16, 2.0, -25.47), slat)
	back.box(Vector3(length, 0.95, 0.6), Vector3(mid_x, 0.475, -25.25), carcass)
	for i in floori(length / 0.65):
		var x := BAR_WEST + 0.325 + i * 0.65
		back.box(Vector3(0.61, 0.8, 0.012), Vector3(x, 0.5, -24.945), slat)
		back.tube(Vector3(x + 0.24, 0.4, -24.93), Vector3(x + 0.24, 0.6, -24.93), 0.008, GymKit.chrome(), 6)
	for shelf in 3:
		var y := 1.35 + shelf * 0.62
		back.box(Vector3(length - 0.4, 0.035, 0.36), Vector3(mid_x, y, -25.3), BarKit.stone())
		back.box(Vector3(length - 0.44, 0.012, 0.014), Vector3(mid_x, y - 0.024, -25.135), Build.glow(AMBER, 2.6))
		for i in 9:
			back.box(Vector3(0.02, 0.1, 0.3), Vector3(BAR_WEST + 0.5 + i * (length - 1.0) / 8.0, y - 0.065, -25.31), GymKit.frame())
	back.commit(self, "BackBar")
	Assembly.place(self, BarKit.counter_top_mesh(Vector3(length, 0.04, 0.66)), Vector3(mid_x, 0.97, -25.24)).name = "BackTop"
	BarKit.shelf_stock(self, &"cans", length - 0.9, Vector3(mid_x, 1.3675, -25.3))
	BarKit.shelf_stock(self, &"shakers", length - 0.9, Vector3(mid_x, 1.9875, -25.3), 2)
	BarKit.shelf_stock(self, &"tubs", length - 0.9, Vector3(mid_x, 2.6075, -25.3), 1)
	# More tubs and a blender on the back counter, where the shakes are made.
	BarKit.shelf_stock(self, &"tubs", 3.4, Vector3(BAR_WEST + 2.4, 0.99, -25.25), 4)
	GymProps.prop(self, "gym/blender", Vector3(BAR_WEST + 5.4, 0.99, -25.2), 180.0, 0.44, {"tint": Color(0.7, 0.74, 0.82)})
	GymProps.prop(self, "gym/blender", Vector3(BAR_WEST + 6.1, 0.99, -25.25), 160.0, 0.44, {"tint": Color(0.7, 0.74, 0.82)})
	BarKit.shelf_stock(self, &"shakers", 2.6, Vector3(BAR_EAST - 2.2, 0.99, -25.25), 5)

	# Counter dressing: a blender, shakers ready to go, cans, the fruit bowl and the menu.
	var top := 1.12
	var dressing := Assembly.new()
	for i in 6:
		var x := BAR_WEST + 2.0 + i * 1.9
		dressing.stamp(BarKit.shaker_mesh(BarKit.FLAVOURS[(i * 2 + 1) % BarKit.FLAVOURS.size()]), Vector3(x, top, BAR_Z - 0.1), Vector3(0.0, i * 40.0, 0.0))
		dressing.stamp(BarKit.can_mesh(BarKit.FLAVOURS[(i * 3 + 4) % BarKit.FLAVOURS.size()]), Vector3(x + 0.22, top, BAR_Z - 0.2))
	dressing.lathe(PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.09, 0.0), Vector2(0.1, 0.012), Vector2(0.2, 0.07), Vector2(0.21, 0.085), Vector2(0.2, 0.085), Vector2(0.1, 0.03), Vector2(0.0, 0.025)]), Vector3(BAR_WEST + 1.0, top, BAR_Z), Stylized.standard(Color(0.85, 0.85, 0.88), 0.3, 0.0, Stylized.Surface.PLAIN), Vector3.ZERO, 20)
	var fruit: Array[Color] = [Color(1.0, 0.55, 0.05), Color(0.9, 0.15, 0.15), Color(1.0, 0.85, 0.15), Color(0.45, 0.8, 0.2), Color(1.0, 0.55, 0.05)]
	for i in 4:
		var angle := i * TAU / 4.0 + 0.4
		dressing.ball(0.062, Vector3(BAR_WEST + 1.0 + cos(angle) * 0.085, top + 0.095, BAR_Z + sin(angle) * 0.085), Build.mat(fruit[i], 0.5), Vector3.ONE, 10)
	dressing.ball(0.062, Vector3(BAR_WEST + 1.0, top + 0.17, BAR_Z), Build.mat(fruit[4], 0.5), Vector3.ONE, 10)
	# Menu stand and a till tablet.
	dressing.box(Vector3(0.3, 0.42, 0.012), Vector3(BAR_EAST - 2.6, top + 0.21, BAR_Z + 0.05), GymKit.plastic(Color(0.02, 0.02, 0.025)), Vector3(-12.0, 0.0, 0.0))
	dressing.box(Vector3(0.26, 0.38, 0.004), Vector3(BAR_EAST - 2.6, top + 0.21, BAR_Z + 0.06), Build.glow(Color(0.16, 0.08, 0.3), 1.2), Vector3(-12.0, 0.0, 0.0))
	dressing.box(Vector3(0.3, 0.2, 0.012), Vector3(BAR_EAST - 0.9, top + 0.12, BAR_Z - 0.15), GymKit.plastic(Color(0.02, 0.02, 0.025)), Vector3(25.0, 180.0, 0.0))
	dressing.box(Vector3(0.27, 0.17, 0.004), Vector3(BAR_EAST - 0.9, top + 0.12, BAR_Z - 0.159), Build.glow(Color(0.5, 0.75, 1.0), 1.0), Vector3(25.0, 180.0, 0.0))
	dressing.commit(self, "CounterDressing")
	Build.text(self, "MENU", Vector3(BAR_EAST - 2.6, top + 0.34, BAR_Z + 0.075), 0.05, AMBER, Vector3(-12.0, 0.0, 0.0), 1.8)
	var menu := PackedStringArray()
	for item in Supplements.ITEMS:
		menu.append("%s   $%d" % [(item["name"] as String).to_upper(), item["price"]])
	Build.text(self, "\n".join(menu), Vector3(BAR_EAST - 2.6, top + 0.18, BAR_Z + 0.07), 0.021, Color(0.9, 0.88, 1.0), Vector3(-12.0, 0.0, 0.0), 1.4)
	GymProps.prop(self, "gym/blender", Vector3(BAR_EAST - 1.6, top, BAR_Z - 0.1), 20.0, 0.44, {"tint": Color(0.7, 0.74, 0.82)})
	GymKit.model(self, "gym/towel_folded", Vector3(BAR_WEST + 3.0, top, BAR_Z - 0.15), 15.0, 0.07)
	for i in 3:
		var sleeve := BarKit.FLAVOURS[(i * 3) % BarKit.FLAVOURS.size()]
		GymKit.model(self, "gym/drinks_can", Vector3(BAR_WEST + 6.9 + i * 0.09, top, BAR_Z + 0.12 - i * 0.05), i * 70.0, 0.135, {"palette": {"berry": {"color": sleeve, "roughness": 0.4}, "metal": {"color": Color(0.8, 0.82, 0.86), "roughness": 0.25, "metallic": 1.0}}})

	# Fridges at the open east end: a stocked glass-front under-counter unit and a tall one.
	BarKit.mini_fridge(self, Vector3(BAR_EAST + 0.85, 0.02, -25.27), 0.0)
	GymKit.model(self, "gym/fridge_glass", Vector3(BAR_EAST + 1.95, 0.02, -25.2), 180.0, 1.9, {"palette": GymKit.palette(AMBER, {
		"carcass": {"color": Color(0.05, 0.05, 0.06), "roughness": 0.4, "metallic": 0.3},
		"glass": {"color": Color(0.5, 0.62, 0.7), "roughness": 0.08, "emission": Color(0.6, 0.85, 1.0), "energy": 0.7},
	})})

	# The sign over it all, bent from tube, with the house line under it.
	BarKit.neon_text(self, "IRON BAR", Vector3(mid_x, 4.05, -25.47), 0.0, 0.78, NEON_PINK)
	Build.text(self, "SHAKES  •  SUPPS  •  RECOVERY", Vector3(mid_x, 3.32, -25.46), 0.2, AMBER, Vector3.ZERO, 2.0)

	var bar := SupplementBar.new()
	bar.name = "SupplementBar"
	bar.position = Vector3(mid_x, 0.0, BAR_Z)
	bar.counter_length = length
	add_child(bar)


func _build_lounge() -> void:
	GymProps.sofa(self, Vector3(-12.6, 0.02, -6.0), 90.0, OXBLOOD, 3.0)
	GymProps.sofa(self, Vector3(-9.0, 0.02, -9.4), 180.0, TAN, 2.4)
	GymProps.sofa(self, Vector3(-9.0, 0.02, -2.6), 0.0, TAN, 2.4)
	GymProps.round_table(self, Vector3(-9.2, 0.02, -6.0), 0.75, 0.42, Color(0.08, 0.08, 0.1))
	for i in 3:
		var angle := i * TAU / 3.0 + 0.5
		GymProps.sofa(self, Vector3(3.0 + cos(angle) * 1.9, 0.02, -5.5 + sin(angle) * 1.9), rad_to_deg(-angle) - 90.0, OXBLOOD if i != 1 else PLUM, 1.1)
	GymProps.round_table(self, Vector3(3.0, 0.02, -5.5), 0.55, 0.45, Color(0.08, 0.08, 0.1))
	var cups := Assembly.new()
	cups.stamp(BarKit.shaker_mesh(BarKit.FLAVOURS[1]), Vector3(-9.0, 0.44, -5.8))
	cups.stamp(BarKit.can_mesh(BarKit.FLAVOURS[4]), Vector3(-9.45, 0.44, -6.2))
	cups.stamp(BarKit.can_mesh(BarKit.FLAVOURS[0]), Vector3(-9.36, 0.44, -6.27))
	cups.stamp(BarKit.shaker_mesh(BarKit.FLAVOURS[6]), Vector3(3.15, 0.47, -5.4))
	cups.stamp(BarKit.can_mesh(BarKit.FLAVOURS[2]), Vector3(2.85, 0.47, -5.65))
	for spot: Vector3 in [Vector3(-6.5, 0.02, -15.0), Vector3(-1.0, 0.02, -15.6), Vector3(6.0, 0.02, -14.5)]:
		GymProps.round_table(self, spot, 0.45, 1.05, Color(0.08, 0.08, 0.1))
		GymProps.stool(self, spot + Vector3(0.75, 0.0, 0.1), OXBLOOD)
		GymProps.stool(self, spot + Vector3(-0.7, 0.0, -0.25), TAN)
		cups.stamp(BarKit.shaker_mesh(BarKit.FLAVOURS[int(absf(spot.x)) % BarKit.FLAVOURS.size()]), spot + Vector3(0.12, 1.05, 0.08))
		cups.stamp(BarKit.can_mesh(BarKit.FLAVOURS[int(absf(spot.z)) % BarKit.FLAVOURS.size()]), spot + Vector3(-0.15, 1.05, -0.1))
	cups.commit(self, "TableDrinks").cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	GymProps.plant(self, Vector3(-13.8, 0.02, -1.2), 1.4)
	GymProps.plant(self, Vector3(-13.8, 0.02, -10.6), 1.2)
	GymProps.plant(self, Vector3(8.8, 0.02, -1.2), 1.4)
	GymProps.plant(self, Vector3(13.6, 0.02, -24.6), 1.3)
	# Floor lamp by the sofas, and the lounge's speakers.
	BarKit.floor_lamp(self, Vector3(-13.6, 0.02, -8.6), Color(1.0, 0.8, 0.55))
	GymProps.prop(self, "gym/speaker", Vector3(-14.0, 0.02, -12.2), 60.0, 1.1, {"tint": Color(0.16, 0.16, 0.19)})
	GymProps.prop(self, "gym/speaker", Vector3(8.6, 0.02, -12.4), -70.0, 1.1, {"tint": Color(0.16, 0.16, 0.19)})


func _build_neon() -> void:
	# LED coves at the head of the walls: purple along the long sides, amber across the ends.
	var y := CEILING - 0.12
	Build.box(self, Vector3(28.6, 0.05, 0.05), Vector3(0.0, y, -25.4), Build.glow(PURPLE, 3.0))
	Build.box(self, Vector3(28.6, 0.05, 0.05), Vector3(0.0, y, -0.6), Build.glow(PURPLE, 3.0))
	Build.box(self, Vector3(0.05, 0.05, 24.6), Vector3(-14.4, y, -13.0), Build.glow(AMBER, 3.0))
	Build.box(self, Vector3(0.05, 0.05, 24.6), Vector3(14.4, y, -13.0), Build.glow(AMBER, 3.0))
	# Vertical tubes on the west wall.
	for i in 6:
		var z := -3.0 - i * 4.0
		Build.box(self, Vector3(0.04, 3.0, 0.04), Vector3(-14.54, 2.8, z), Build.glow(PURPLE if i % 2 == 0 else AMBER, 2.6))
	Build.text(self, "NO PAIN\nNO GAIN", Vector3(-14.5, 3.0, -17.0), 0.6, PURPLE.lightened(0.25), Vector3(0.0, 90.0, 0.0), 2.4)
	BarKit.neon_text(self, "FUEL", Vector3(14.57, 3.5, -21.0), -90.0, 0.7, AMBER)
	# Halo rings over the lounge tables.
	Build.ring(self, 1.3, 0.03, Vector3(-9.2, CEILING - 1.5, -6.0), Build.glow(AMBER, 3.0), Vector3.ZERO, 40)
	Build.ring(self, 1.0, 0.03, Vector3(3.0, CEILING - 1.5, -5.5), Build.glow(PURPLE, 3.0), Vector3.ZERO, 40)


func _build_ceiling() -> void:
	for z: float in [-3.0, -7.3, -11.6, -15.9, -20.2, -24.4]:
		GymKit.joist(self, Vector3(-14.6, CEILING, z), Vector3(14.6, CEILING, z))
	GymKit.duct(self, Vector3(-11.6, CEILING - 0.5, -1.2), Vector3(-11.6, CEILING - 0.5, -24.8), 0.45)
	GymKit.duct(self, Vector3(8.6, CEILING - 0.5, -1.2), Vector3(8.6, CEILING - 0.5, -24.8), 0.45)


func _build_lighting() -> void:
	# Low dome pendants: a row over the counter and one over each seating group.
	# Four, with the middle pair set wide so it frames the neon sign instead of hanging across it.
	for along: float in [1.4, 4.2, 8.8, 11.6]:
		BarKit.pendant(self, Vector3(BAR_WEST + along, CEILING, BAR_Z + 0.25), 2.25, WARM, 3.3)
	BarKit.pendant(self, Vector3(-9.2, CEILING, -6.0), 2.5, WARM, 3.4, 7.0)
	BarKit.pendant(self, Vector3(3.0, CEILING, -5.5), 2.5, WARM, 3.2, 7.0)
	for spot: Vector3 in [Vector3(-6.5, 0.0, -15.0), Vector3(-1.0, 0.0, -15.6), Vector3(6.0, 0.0, -14.5)]:
		BarKit.pendant(self, Vector3(spot.x, CEILING, spot.z), 2.1, WARM, 1.8, 4.5)
	Build.spot_down(self, Vector3(-3.0, CEILING - 0.6, -23.6), Color(1.0, 0.82, 0.7), 2.4, 9.0, 75.0)
	# Soft warm downlight between the pendants, so the room reads amber rather than violet.
	for x: float in [-9.0, 3.0]:
		for z: float in [-11.0, -18.0]:
			Build.spot_down(self, Vector3(x, CEILING - 0.6, z), WARM, 1.5, 9.0, 80.0)
	Build.spot_down(self, Vector3(10.5, CEILING - 0.6, -21.0), WARM, 1.4, 9.0, 80.0)
	Build.spot_down(self, Vector3(-3.0, CEILING - 0.6, -3.5), WARM, 1.3, 9.0, 80.0)
	# Colour from the strips: purple under the counter's lip, amber along the floor and shelves.
	for x: float in [-7.4, -3.0, 1.4]:
		Build.omni(self, Vector3(x, 0.8, BAR_Z + 0.75), PURPLE, 0.7, 3.0)
		Build.omni(self, Vector3(x, 0.16, BAR_Z + 0.6), AMBER, 0.5, 2.2)
		Build.omni(self, Vector3(x, 2.2, -24.7), AMBER, 0.8, 4.0)
	Build.omni(self, Vector3(-13.4, 3.4, -13.0), PURPLE, 0.7, 8.0)
	Build.omni(self, Vector3(12.0, 3.2, -21.0), AMBER, 0.9, 7.0)
	GymKit.room_probe(self, Vector3(0.0, CEILING * 0.5, -13.0), Vector3(29.2, CEILING, 25.2), Color(0.62, 0.42, 0.32), 0.44)
