extends Node3D
## Storey 2: MMA and boxing hall with a raised octagon, heavy bags and spectator seating.
## The bags are PunchingBag scenes; the RingManager at the cage runs the fights.
## Uses gym-local x/z; y = 0 is this storey's floor.

const CEILING := 4.7
const CAGE_CENTRE := Vector3(-1.5, 0.02, -13.5)
const CAGE_RADIUS := 4.6
const CAGE_HEIGHT := 0.72
const FENCE_HEIGHT := 1.8
const RED := Color(0.9, 0.16, 0.16)
const BLUE := Color(0.16, 0.42, 0.95)
const PUNCHING_BAG := preload("res://scenes/combat/punching_bag.tscn")


func _ready() -> void:
	_build_floor()
	_build_octagon()
	_build_ring()
	_build_bags()
	_build_seating()
	_build_dressing()
	_build_lighting()


func _build_floor() -> void:
	Build.box(self, Vector3(24.8, 0.02, 25.2), Vector3(-2.2, 0.01, -13.0), Build.mat(Color(0.2, 0.2, 0.24), 0.9))
	Build.box(self, Vector3(4.36, 0.02, 7.6), Vector3(12.4, 0.01, -4.2), Build.mat(Color(0.2, 0.2, 0.24), 0.9))
	Build.box(self, Vector3(4.36, 0.02, 9.6), Vector3(12.4, 0.01, -20.8), Build.mat(Color(0.2, 0.2, 0.24), 0.9))
	# Striking mats under the bags.
	for i in 5:
		var tile := Build.mat(RED.darkened(0.15) if i % 2 == 0 else BLUE.darkened(0.2), 0.95)
		Build.box(self, Vector3(4.2, 0.03, 3.6), Vector3(-12.4, 0.035, -4.4 - i * 3.6), tile)


func _build_octagon() -> void:
	var cage := Build.group(self, "Octagon", CAGE_CENTRE)
	var apothem := CAGE_RADIUS * cos(PI / 8.0)
	var side_length := 2.0 * CAGE_RADIUS * sin(PI / 8.0)
	var black := Build.mat(Color(0.08, 0.08, 0.1), 0.8)
	var pad := Build.mat(RED, 0.6)
	var mesh_wall := Build.mat(Color(0.05, 0.05, 0.07, 0.3), 0.6)
	var rope := Build.mat(Color(0.92, 0.92, 0.95), 0.5)

	# Raised platform: apron, canvas and centre logo. The 8-sided cylinder is turned so a flat
	# side faces +Z, where the gate and steps are.
	Build.cyl(cage, CAGE_RADIUS, CAGE_HEIGHT, Vector3(0.0, CAGE_HEIGHT * 0.5, 0.0), black, false, Vector3(0.0, 22.5, 0.0), -1.0, 8)
	Build.drum_blocker(cage, apothem, CAGE_HEIGHT, Vector3(0.0, CAGE_HEIGHT * 0.5, 0.0))
	Build.cyl(cage, CAGE_RADIUS - 0.3, 0.04, Vector3(0.0, CAGE_HEIGHT + 0.02, 0.0), Build.mat(Color(0.82, 0.84, 0.88), 0.9), false, Vector3(0.0, 22.5, 0.0), -1.0, 8)
	Build.ring(cage, 1.5, 0.05, Vector3(0.0, CAGE_HEIGHT + 0.03, 0.0), pad, Vector3.ZERO, 32)
	Build.text(cage, "IRON TEMPLE", Vector3(0.0, CAGE_HEIGHT + 0.05, 0.0), 0.36, RED, Vector3(-90.0, 0.0, 0.0))

	for k in 8:
		var angle := k * TAU / 8.0  # side centre; k = 0 faces +Z
		var out := Vector3(sin(angle), 0.0, cos(angle))
		var yaw := Vector3(0.0, rad_to_deg(angle), 0.0)
		var corner_angle := angle + PI / 8.0
		var corner := Vector3(sin(corner_angle), 0.0, cos(corner_angle)) * (CAGE_RADIUS - 0.14)
		var post_color := (RED if k == 0 else BLUE) if (k == 0 or k == 7) else Color(0.1, 0.1, 0.12)
		Build.cyl(cage, 0.12, FENCE_HEIGHT, corner + Vector3(0.0, CAGE_HEIGHT + FENCE_HEIGHT * 0.5, 0.0), Build.mat(post_color, 0.6), true)
		Build.ball(cage, 0.13, corner + Vector3(0.0, CAGE_HEIGHT + FENCE_HEIGHT, 0.0), Build.mat(post_color, 0.6), Vector3.ONE, 8)

		var mid := out * (apothem - 0.14) + Vector3(0.0, CAGE_HEIGHT, 0.0)
		Build.box(cage, Vector3(side_length, 0.12, 0.34), mid + Vector3(0.0, 0.06, 0.0) - out * 0.06, pad, false, yaw)
		if k == 0:
			continue  # gate side stays open
		Build.box(cage, Vector3(side_length - 0.2, FENCE_HEIGHT - 0.2, 0.02), mid + Vector3(0.0, FENCE_HEIGHT * 0.5, 0.0), mesh_wall, false, yaw)
		Build.blocker(cage, Vector3(side_length, FENCE_HEIGHT, 0.14), mid + Vector3(0.0, FENCE_HEIGHT * 0.5, 0.0), yaw)
		Build.box(cage, Vector3(side_length - 0.2, 0.14, 0.14), mid + Vector3(0.0, FENCE_HEIGHT, 0.0), pad, false, yaw)
		for height: float in [0.6, 1.2]:
			Build.box(cage, Vector3(side_length - 0.2, 0.035, 0.035), mid + Vector3(0.0, height, 0.0), rope, false, yaw)

	Build.stairs(cage, Vector3(0.0, 0.0, apothem + 1.05), 0.0, 3, CAGE_HEIGHT / 3.0, 0.35, 1.8, Build.mat(Color(0.3, 0.31, 0.36), 0.8))


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
	var rail := GymProps.frame()
	Build.tube(self, Vector3(-12.6, CEILING - 0.35, -2.5), Vector3(-12.6, CEILING - 0.35, -20.5), 0.07, rail)
	var colors: Array[Color] = [RED, Color(0.1, 0.1, 0.12), BLUE, Color(0.95, 0.75, 0.1), RED]
	for i in 5:
		var z := -4.4 - i * 3.6
		var bag: PunchingBag = PUNCHING_BAG.instantiate()
		bag.name = "HeavyBag%d" % (i + 1)
		bag.color = colors[i]
		bag.mount_height = CEILING - 0.35
		bag.position = Vector3(-12.6, 0.0, z)
		add_child(bag)
		Build.tube(self, Vector3(-14.6, CEILING - 0.35, z + 1.8), Vector3(-12.6, CEILING - 0.35, z + 1.8), 0.05, rail)
	# Glove shelf.
	Build.box(self, Vector3(0.4, 0.06, 3.0), Vector3(-14.35, 1.3, -22.6), Build.mat(GymProps.WOOD, 0.7))
	for i in 6:
		var glove := RED if i % 2 == 0 else BLUE
		Build.ball(self, 0.13, Vector3(-14.35, 1.46, -21.4 - i * 0.48), Build.mat(glove, 0.5), Vector3(0.9, 1.0, 1.2), 8)


func _build_seating() -> void:
	# Three-tier bleachers along the north wall.
	var riser := Build.mat(Color(0.28, 0.29, 0.34), 0.8)
	for tier in 3:
		var height := 0.42 * (tier + 1)
		var z := -22.9 - tier * 0.9
		Build.box(self, Vector3(15.0, height, 0.9), Vector3(-1.5, height * 0.5, z), riser, true)
		var seat := Build.mat(RED if tier % 2 == 0 else BLUE, 0.7)
		Build.box(self, Vector3(15.0, 0.06, 0.5), Vector3(-1.5, height + 0.03, z + 0.15), seat)
	for x: float in [-8.0, -1.5, 5.0]:
		GymProps.bench(self, Vector3(x, 0.02, -1.5), 0.0, 3.4, Color(0.75, 0.2, 0.2))
	GymProps.bench(self, Vector3(8.6, 0.02, -19.5), 90.0, 3.0, Color(0.2, 0.4, 0.8))


func _build_dressing() -> void:
	Build.text(self, "FIGHT HALL", Vector3(-1.5, 3.7, -25.55), 0.9, RED, Vector3.ZERO, 1.8)
	Build.text(self, "TRAIN HARD  •  FIGHT EASY", Vector3(-1.5, 2.9, -25.55), 0.3, Color(0.9, 0.9, 0.95), Vector3.ZERO, 1.1)
	var stripe := Build.mat(RED, 0.6)
	Build.box(self, Vector3(29.2, 0.3, 0.02), Vector3(0.0, 1.2, -25.58), stripe)
	Build.box(self, Vector3(0.02, 0.3, 25.2), Vector3(-14.58, 1.2, -13.0), stripe)
	Build.box(self, Vector3(0.02, 0.3, 25.2), Vector3(14.58, 1.2, -13.0), stripe)
	# Round timer on the east wall.
	Build.box(self, Vector3(0.1, 0.8, 1.8), Vector3(14.5, 3.2, -20.5), Build.mat(Color(0.05, 0.05, 0.07)))
	Build.text(self, "05:00", Vector3(14.43, 3.2, -20.5), 0.55, RED, Vector3(0.0, -90.0, 0.0), 2.2)
	# Library props in the back corners.
	GymProps.prop(self, "gym/fan_standing", Vector3(13.9, 0.02, -24.8), -40.0, 1.5)
	GymProps.prop(self, "gym/medicine_ball_rack", Vector3(-13.6, 0.02, -24.9), 0.0, 1.1)
	GymProps.prop(self, "gym/water_bottle", Vector3(-12.6, 0.02, -24.9), 30.0, 0.26)


func _build_lighting() -> void:
	var warm := Color(1.0, 0.95, 0.88)
	for x: float in [-10.0, 7.0]:
		for z: float in [-4.5, -21.5]:
			GymProps.ceiling_light(self, Vector3(x, CEILING - 0.04, z), warm, 2.2)
	GymProps.ceiling_light(self, Vector3(-12.2, CEILING - 0.04, -13.0), warm, 2.0)
	# Lighting truss over the cage.
	var truss := GymProps.frame()
	var centre := Vector3(CAGE_CENTRE.x, CEILING - 0.5, CAGE_CENTRE.z)
	for i in 4:
		var angle := i * PI * 0.5
		var a := centre + Vector3(cos(angle), 0.0, sin(angle)).rotated(Vector3.UP, PI * 0.25) * 3.6
		var b := centre + Vector3(cos(angle + PI * 0.5), 0.0, sin(angle + PI * 0.5)).rotated(Vector3.UP, PI * 0.25) * 3.6
		Build.tube(self, a, b, 0.06, truss)
		Build.tube(self, a, a + Vector3(0.0, 0.5, 0.0), 0.04, truss)
		Build.box(self, Vector3(0.5, 0.12, 0.5), (a + b) * 0.5 - Vector3(0.0, 0.1, 0.0), Build.glow(Color(1.0, 0.97, 0.9), 3.0))
	Build.spot_down(self, centre, Color(1.0, 0.97, 0.92), 4.0, 8.0, 52.0)
