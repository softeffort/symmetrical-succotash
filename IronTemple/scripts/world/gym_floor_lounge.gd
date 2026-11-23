extends Node3D
## Storey 3: supplement bar and lounge with neon accent lighting.
## The SupplementBar node at the counter adds the bartender and the shop prompt.
## Uses gym-local x/z; y = 0 is this storey's floor.

const CEILING := 5.0
const MAGENTA := Color(1.0, 0.2, 0.75)
const CYAN := Color(0.15, 0.9, 1.0)
const BAR_Z := -21.3
const BAR_WEST := -9.5
const BAR_EAST := 3.5
const BOTTLE_COLORS: Array[Color] = [
	Color(1.0, 0.25, 0.35), Color(1.0, 0.6, 0.1), Color(0.98, 0.9, 0.2), Color(0.3, 0.9, 0.4),
	Color(0.15, 0.85, 0.95), Color(0.3, 0.45, 1.0), Color(0.7, 0.35, 1.0), Color(1.0, 0.35, 0.8),
]


func _ready() -> void:
	_build_floor()
	_build_bar()
	_build_lounge()
	_build_neon()
	_build_lighting()


func _build_floor() -> void:
	var boards := Build.mat(Color(0.2, 0.14, 0.24), 0.7)
	Build.box(self, Vector3(24.8, 0.02, 25.2), Vector3(-2.2, 0.01, -13.0), boards)
	Build.box(self, Vector3(4.36, 0.02, 7.6), Vector3(12.4, 0.01, -4.2), boards)
	Build.box(self, Vector3(4.36, 0.02, 9.6), Vector3(12.4, 0.01, -20.8), boards)
	Build.box(self, Vector3(6.5, 0.02, 5.0), Vector3(-9.0, 0.03, -6.0), Build.mat(Color(0.1, 0.5, 0.55), 0.95))
	Build.cyl(self, 2.4, 0.02, Vector3(3.0, 0.03, -5.5), Build.mat(Color(0.75, 0.25, 0.55), 0.95), false, Vector3.ZERO, -1.0, 32)


func _build_bar() -> void:
	var length := BAR_EAST - BAR_WEST
	var mid_x := (BAR_WEST + BAR_EAST) * 0.5
	var body := Build.mat(Color(0.12, 0.09, 0.2), 0.6)
	var top := Build.mat(Color(0.05, 0.05, 0.08), 0.15, 0.3)

	# Counter with a return leg at the west end; staff enter from the east.
	Build.box(self, Vector3(length, 1.05, 0.7), Vector3(mid_x, 0.525, BAR_Z), body, true)
	Build.box(self, Vector3(length + 0.3, 0.07, 1.0), Vector3(mid_x, 1.085, BAR_Z + 0.05), top)
	Build.box(self, Vector3(0.7, 1.05, 3.6), Vector3(BAR_WEST + 0.35, 0.525, BAR_Z - 2.15), body, true)
	Build.box(self, Vector3(0.95, 0.07, 3.6), Vector3(BAR_WEST + 0.35, 1.085, BAR_Z - 2.15), top)
	Build.box(self, Vector3(length, 0.05, 0.05), Vector3(mid_x, 1.02, BAR_Z + 0.5), Build.glow(MAGENTA, 3.0))
	Build.box(self, Vector3(length, 0.05, 0.05), Vector3(mid_x, 0.05, BAR_Z + 0.37), Build.glow(CYAN, 3.0))
	for i in 9:
		Build.box(self, Vector3(0.04, 0.8, 0.02), Vector3(BAR_WEST + 0.8 + i * (length - 1.6) / 8.0, 0.52, BAR_Z + 0.36), Build.glow(CYAN, 1.6))

	for i in 7:
		var seat := MAGENTA if i % 2 == 0 else CYAN
		GymProps.stool(self, Vector3(BAR_WEST + 1.2 + i * 1.75, 0.02, BAR_Z + 1.0), seat.darkened(0.15))

	# Back bar: lit shelves of bottles and protein tubs.
	Build.box(self, Vector3(length, 3.0, 0.1), Vector3(mid_x, 2.0, -25.5), Build.mat(Color(0.08, 0.06, 0.14), 0.5))
	Build.box(self, Vector3(length, 0.95, 0.6), Vector3(mid_x, 0.475, -25.25), body, true)
	for shelf in 3:
		var y := 1.35 + shelf * 0.62
		Build.box(self, Vector3(length - 0.4, 0.05, 0.36), Vector3(mid_x, y, -25.3), top)
		Build.box(self, Vector3(length - 0.4, 0.03, 0.03), Vector3(mid_x, y - 0.03, -25.13), Build.glow(Color(1.0, 0.75, 0.85), 2.0))
		if shelf == 2:
			for i in 12:
				var tub := BOTTLE_COLORS[(i * 3) % BOTTLE_COLORS.size()]
				var x := BAR_WEST + 0.8 + i * (length - 1.6) / 11.0
				Build.cyl(self, 0.15, 0.34, Vector3(x, y + 0.195, -25.3), Build.mat(Color(0.1, 0.1, 0.13), 0.5))
				Build.cyl(self, 0.152, 0.16, Vector3(x, y + 0.2, -25.3), Build.glow(tub, 0.5))
				Build.cyl(self, 0.155, 0.05, Vector3(x, y + 0.39, -25.3), Build.mat(tub.darkened(0.3), 0.5))
		else:
			for i in 24:
				var x := BAR_WEST + 0.6 + i * (length - 1.2) / 23.0
				_bottle(Vector3(x, y + 0.025, -25.3), BOTTLE_COLORS[(i + shelf * 3) % BOTTLE_COLORS.size()])

	# Counter dressing: shakers, blender and fruit.
	for i in 6:
		var x := BAR_WEST + 2.0 + i * 1.9
		var color := BOTTLE_COLORS[(i * 2 + 1) % BOTTLE_COLORS.size()]
		Build.cyl(self, 0.045, 0.2, Vector3(x, 1.22, BAR_Z - 0.1), Build.mat(Color(0.9, 0.92, 0.96, 0.55), 0.2))
		Build.cyl(self, 0.043, 0.12, Vector3(x, 1.18, BAR_Z - 0.1), Build.glow(color, 0.4))
		Build.cyl(self, 0.048, 0.05, Vector3(x, 1.345, BAR_Z - 0.1), Build.mat(color, 0.4))
	Build.box(self, Vector3(0.2, 0.16, 0.2), Vector3(BAR_EAST - 1.0, 1.2, BAR_Z - 0.1), Build.mat(Color(0.75, 0.77, 0.82), 0.3, 0.6))
	Build.cyl(self, 0.08, 0.28, Vector3(BAR_EAST - 1.0, 1.42, BAR_Z - 0.1), Build.mat(Color(0.5, 1.0, 0.6, 0.6), 0.1), false, Vector3.ZERO, 0.1)
	Build.cyl(self, 0.2, 0.08, Vector3(BAR_WEST + 1.0, 1.16, BAR_Z), Build.mat(Color(0.9, 0.9, 0.93), 0.4), false, Vector3.ZERO, 0.24)
	var fruit: Array[Color] = [Color(1.0, 0.55, 0.05), Color(0.9, 0.15, 0.15), Color(1.0, 0.85, 0.15), Color(0.45, 0.8, 0.2)]
	for i in 4:
		Build.ball(self, 0.065, Vector3(BAR_WEST + 0.92 + (i % 2) * 0.15, 1.23 + (i / 2) * 0.02, BAR_Z - 0.07 + (i / 2) * 0.14), Build.mat(fruit[i], 0.5), Vector3.ONE, 8)

	Build.text(self, "PROTEIN BAR", Vector3(mid_x, 4.05, -25.5), 0.85, MAGENTA, Vector3.ZERO, 2.4)

	var bar := SupplementBar.new()
	bar.name = "SupplementBar"
	bar.position = Vector3(mid_x, 0.0, BAR_Z)
	bar.counter_length = length
	add_child(bar)
	Build.text(self, "SHAKES  •  SUPPS  •  RECOVERY", Vector3(mid_x, 3.42, -25.5), 0.26, CYAN, Vector3.ZERO, 2.0)


func _bottle(pos: Vector3, color: Color) -> void:
	var liquid := Build.glow(color, 0.45)
	Build.cyl(self, 0.045, 0.22, pos + Vector3(0.0, 0.11, 0.0), liquid, false, Vector3.ZERO, -1.0, 8)
	Build.cyl(self, 0.045, 0.1, pos + Vector3(0.0, 0.27, 0.0), liquid, false, Vector3.ZERO, 0.018, 8)
	Build.cyl(self, 0.02, 0.04, pos + Vector3(0.0, 0.33, 0.0), Build.mat(Color(0.1, 0.1, 0.12)), false, Vector3.ZERO, -1.0, 8)


func _build_lounge() -> void:
	var teal := Color(0.1, 0.55, 0.6)
	var plum := Color(0.55, 0.2, 0.6)
	GymProps.sofa(self, Vector3(-12.6, 0.02, -6.0), 90.0, teal, 3.0)
	GymProps.sofa(self, Vector3(-9.0, 0.02, -9.4), 180.0, plum, 2.4)
	GymProps.sofa(self, Vector3(-9.0, 0.02, -2.6), 0.0, plum, 2.4)
	GymProps.round_table(self, Vector3(-9.2, 0.02, -6.0), 0.75, 0.42, Color(0.08, 0.08, 0.1))
	for i in 3:
		var angle := i * TAU / 3.0 + 0.5
		GymProps.sofa(self, Vector3(3.0 + cos(angle) * 1.9, 0.02, -5.5 + sin(angle) * 1.9), rad_to_deg(-angle) - 90.0, teal if i != 1 else plum, 1.1)
	GymProps.round_table(self, Vector3(3.0, 0.02, -5.5), 0.55, 0.45, Color(0.08, 0.08, 0.1))
	for spot: Vector3 in [Vector3(-6.5, 0.02, -15.0), Vector3(-1.0, 0.02, -15.6), Vector3(6.0, 0.02, -14.5)]:
		GymProps.round_table(self, spot, 0.45, 1.05, Color(0.08, 0.08, 0.1))
		GymProps.stool(self, spot + Vector3(0.75, 0.0, 0.1), MAGENTA.darkened(0.2))
		GymProps.stool(self, spot + Vector3(-0.7, 0.0, -0.25), CYAN.darkened(0.2))
	GymProps.plant(self, Vector3(-13.8, 0.02, -1.2), 1.4)
	GymProps.plant(self, Vector3(-13.8, 0.02, -10.6), 1.2)
	GymProps.plant(self, Vector3(8.8, 0.02, -1.2), 1.4)
	GymProps.plant(self, Vector3(13.6, 0.02, -24.6), 1.3)
	# Floor lamp by the sofas.
	Build.tube(self, Vector3(-13.6, 0.02, -8.6), Vector3(-13.6, 1.7, -8.6), 0.025, GymProps.steel())
	Build.ball(self, 0.2, Vector3(-13.6, 1.8, -8.6), Build.glow(Color(1.0, 0.8, 0.55), 2.5))
	Build.omni(self, Vector3(-13.3, 1.8, -8.6), Color(1.0, 0.8, 0.55), 1.2, 5.0)


func _build_neon() -> void:
	# Ceiling perimeter strips.
	var y := CEILING - 0.12
	Build.box(self, Vector3(28.6, 0.06, 0.06), Vector3(0.0, y, -25.4), Build.glow(MAGENTA, 3.0))
	Build.box(self, Vector3(28.6, 0.06, 0.06), Vector3(0.0, y, -0.6), Build.glow(MAGENTA, 3.0))
	Build.box(self, Vector3(0.06, 0.06, 24.6), Vector3(-14.4, y, -13.0), Build.glow(CYAN, 3.0))
	Build.box(self, Vector3(0.06, 0.06, 24.6), Vector3(14.4, y, -13.0), Build.glow(CYAN, 3.0))
	# Vertical tubes on the side walls.
	for i in 6:
		var z := -3.0 - i * 4.0
		Build.box(self, Vector3(0.05, 3.2, 0.05), Vector3(-14.5, 2.4, z), Build.glow(MAGENTA if i % 2 == 0 else CYAN, 2.6))
	Build.text(self, "NO PAIN\nNO GAIN", Vector3(-14.5, 2.6, -17.0), 0.7, CYAN, Vector3(0.0, 90.0, 0.0), 2.4)
	Build.text(self, "REFUEL", Vector3(14.5, 3.4, -21.0), 0.8, MAGENTA, Vector3(0.0, -90.0, 0.0), 2.4)
	# Neon rings over the lounge tables.
	Build.ring(self, 1.3, 0.035, Vector3(-9.2, CEILING - 0.9, -6.0), Build.glow(CYAN, 3.0), Vector3.ZERO, 32)
	Build.ring(self, 1.0, 0.035, Vector3(3.0, CEILING - 0.9, -5.5), Build.glow(MAGENTA, 3.0), Vector3.ZERO, 32)


func _build_lighting() -> void:
	var warm := Color(1.0, 0.85, 0.7)
	for x: float in [-9.0, 3.0]:
		for z: float in [-6.0, -16.0]:
			Build.spot_down(self, Vector3(x, CEILING - 0.1, z), warm, 2.0, 9.0, 75.0)
	Build.spot_down(self, Vector3(-3.0, CEILING - 0.1, -22.5), Color(1.0, 0.8, 0.9), 2.6, 9.0, 75.0)
	Build.omni(self, Vector3(-6.5, 2.4, -21.5), MAGENTA, 2.2, 10.0)
	Build.omni(self, Vector3(1.0, 2.4, -21.5), MAGENTA, 2.2, 10.0)
	Build.omni(self, Vector3(-9.2, 3.6, -6.0), CYAN, 2.0, 9.0)
	Build.omni(self, Vector3(3.0, 3.6, -5.5), MAGENTA, 1.6, 8.0)
	Build.omni(self, Vector3(8.0, 3.0, -15.0), CYAN, 1.4, 9.0)
