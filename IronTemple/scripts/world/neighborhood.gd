class_name Neighborhood
extends Node3D
## Dresses the intro street procedurally: ground, road, houses, trees, street props, the plaza in
## front of the gym, the hedge boundary and a distant backdrop. Deterministic per `layout_seed`.
## The street runs along -Z from the cul-de-sac behind the player's house to the gym.

const ROAD_HALF_WIDTH := 4.0
const SIDEWALK_WIDTH := 2.5
const HOUSE_SETBACK := 18.0
const BOUNDARY_X := 28.0
const PLAZA_DEPTH := 30.0

const WALLS: Array[Color] = [
	Color(0.98, 0.93, 0.82), Color(0.72, 0.87, 0.95), Color(0.99, 0.78, 0.62), Color(0.8, 0.92, 0.75),
	Color(0.95, 0.72, 0.75), Color(0.86, 0.8, 0.95), Color(0.96, 0.96, 0.96), Color(0.62, 0.82, 0.85),
]
const ROOFS: Array[Color] = [
	Color(0.72, 0.26, 0.22), Color(0.25, 0.35, 0.5), Color(0.35, 0.3, 0.3), Color(0.2, 0.45, 0.42), Color(0.55, 0.33, 0.2),
]
const DOORS: Array[Color] = [
	Color(0.85, 0.2, 0.2), Color(0.15, 0.5, 0.75), Color(0.95, 0.75, 0.15), Color(0.2, 0.6, 0.4), Color(0.5, 0.3, 0.65),
]
const FOLIAGE: Array[Color] = [
	Color(0.24, 0.62, 0.27), Color(0.33, 0.72, 0.3), Color(0.18, 0.52, 0.3), Color(0.5, 0.76, 0.28),
]
const BLOSSOM: Array[Color] = [Color(0.98, 0.62, 0.75), Color(0.98, 0.72, 0.3)]
const CAR_PAINTS: Array[Color] = [
	Color(0.9, 0.25, 0.2), Color(0.2, 0.55, 0.9), Color(0.98, 0.8, 0.2), Color(0.95, 0.95, 0.95), Color(0.2, 0.75, 0.6),
]
const TRIM := Color(0.97, 0.97, 0.95)
const CONCRETE := Color(0.7, 0.7, 0.69)

@export var layout_seed := 11
@export var lot_count := 12
@export var lot_pitch := 20.0
## Z of the southernmost lot centre; lots continue towards -Z.
@export var first_lot_z := 20.0
## East-side lot index used as the player's house.
@export var home_lot := 1
## West-side lots replaced by a small park.
@export var park_lots: Array[int] = [6, 7]
## World Z of the gym's front wall, where the plaza ends.
@export var gym_front_z := -255.0

var _rng := RandomNumberGenerator.new()
var _south_z := 0.0
var _plaza_z := 0.0


## Models for the parked cars and the kerb furniture ([id, height in metres]); see ModelLoader.
const CAR_MODELS: Array[String] = ["street/car_sedan", "street/car_taxi", "street/car_suv", "street/car_hatchback", "street/car_van", "street/car_police"]
const KERB_MODELS: Array = [["street/fire_hydrant", 0.8], ["street/litter_bin", 1.0], ["street/bench_street", 0.9], ["street/traffic_cone", 0.7]]


func _ready() -> void:
	_rng.seed = layout_seed
	_south_z = first_lot_z + lot_pitch * 0.5 + 4.0
	_plaza_z = gym_front_z + PLAZA_DEPTH
	_build_ground()
	_build_road()
	_build_lots()
	_build_park()
	_build_street_props()
	_build_plaza()
	_build_boundary()
	_build_backdrop()


func _build_ground() -> void:
	Build.box(self, Vector3(1600.0, 1.0, 1600.0), Vector3(0.0, -0.5, -100.0), Build.mat(Color(0.4, 0.7, 0.32), 1.0), true)


func _build_road() -> void:
	var length := _south_z - _plaza_z
	var mid := (_south_z + _plaza_z) * 0.5
	var asphalt := Build.mat(Color(0.27, 0.28, 0.32), 0.95)
	var paving := Build.mat(CONCRETE, 0.95)
	var paint := Build.mat(Color(0.96, 0.96, 0.92), 0.8)
	Build.box(self, Vector3(ROAD_HALF_WIDTH * 2.0, 0.04, length), Vector3(0.0, 0.0, mid), asphalt)
	Build.cyl(self, 9.5, 0.04, Vector3(0.0, 0.001, _south_z), asphalt, false, Vector3.ZERO, -1.0, 32)
	Build.cyl(self, 2.6, 0.3, Vector3(0.0, 0.15, _south_z), paving, true, Vector3.ZERO, -1.0, 16)
	Build.cyl(self, 2.3, 0.32, Vector3(0.0, 0.16, _south_z), Build.mat(Color(0.33, 0.66, 0.3), 1.0), false, Vector3.ZERO, -1.0, 16)
	_tree(self, Vector3(0.0, 0.3, _south_z), 1.5, false)
	for side: float in [-1.0, 1.0]:
		var x := side * (ROAD_HALF_WIDTH + SIDEWALK_WIDTH * 0.5)
		Build.box(self, Vector3(SIDEWALK_WIDTH, 0.1, length), Vector3(x, 0.0, mid), paving)
		Build.box(self, Vector3(0.2, 0.12, length), Vector3(side * (ROAD_HALF_WIDTH + 0.1), 0.0, mid), Build.mat(Color(0.9, 0.9, 0.88), 0.9))
	var z := _south_z - 14.0
	while z > _plaza_z + 8.0:
		Build.box(self, Vector3(0.16, 0.01, 3.0), Vector3(0.0, 0.021, z), Build.mat(Color(0.98, 0.85, 0.3), 0.8))
		z -= 8.0
	for crossing: float in [first_lot_z - home_lot * lot_pitch - 10.0, _park_centre_z(), _plaza_z + 3.0]:
		for i in 7:
			Build.box(self, Vector3(0.6, 0.01, 2.6), Vector3(-3.3 + i * 1.1, 0.022, crossing), paint)


func _build_lots() -> void:
	for i in lot_count:
		var z := first_lot_z - i * lot_pitch
		for side: float in [-1.0, 1.0]:
			if side < 0.0 and park_lots.has(i):
				continue
			_build_lot(Vector3(side * HOUSE_SETBACK, 0.0, z), side, side > 0.0 and i == home_lot)


## One residential lot in house-local space: the house front faces +Z (towards the street), the
## sidewalk edge is at z = 11.5 and the lot spans x = -10..10.
func _build_lot(centre: Vector3, side: float, is_home: bool) -> void:
	var lot := Build.group(self, "Home" if is_home else "House", centre, -90.0 * side)
	var wall_color := Color(0.99, 0.86, 0.45) if is_home else WALLS[_rng.randi() % WALLS.size()]
	var roof_color := Color(0.8, 0.25, 0.2) if is_home else ROOFS[_rng.randi() % ROOFS.size()]
	var door_color := Color(0.1, 0.55, 0.6) if is_home else DOORS[_rng.randi() % DOORS.size()]
	var two_storey := not is_home and _rng.randf() < 0.35
	var has_garage := is_home or _rng.randf() < 0.5
	var lawn := Color(0.36, 0.68, 0.3).lerp(Color(0.46, 0.76, 0.34), _rng.randf())
	Build.box(lot, Vector3(lot_pitch - 0.3, 0.03, 21.0), Vector3(0.0, 0.0, 1.0), Build.mat(lawn, 1.0))

	var width := 9.5
	var depth := 8.0
	var house_x := -2.2 if has_garage else 0.0
	var door_x := house_x - 1.7
	var front := depth * 0.5
	_build_house(lot, house_x, width, depth, wall_color, roof_color, door_color, two_storey)

	if has_garage:
		var garage_x := house_x + width * 0.5 + 2.3
		Build.box(lot, Vector3(4.6, 2.9, 6.4), Vector3(garage_x, 1.45, -0.8), Build.mat(wall_color, 0.9), true)
		Build.prism(lot, Vector3(6.8, 1.3, 5.0), Vector3(garage_x, 3.55, -0.8), Build.mat(roof_color, 0.8), Vector3(0.0, 90.0, 0.0))
		Build.box(lot, Vector3(3.6, 2.3, 0.08), Vector3(garage_x, 1.15, 2.42), Build.mat(TRIM, 0.6))
		for i in 3:
			Build.box(lot, Vector3(3.6, 0.03, 0.1), Vector3(garage_x, 0.6 + i * 0.55, 2.43), Build.mat(Color(0.75, 0.75, 0.75)))
		Build.box(lot, Vector3(4.2, 0.03, 9.0), Vector3(garage_x, 0.005, 7.0), Build.mat(CONCRETE.darkened(0.08), 0.95))

	# Path from the porch to the sidewalk, mailbox and front hedges with gaps for path and drive.
	Build.box(lot, Vector3(1.3, 0.03, 5.8), Vector3(door_x, 0.006, front + 4.6), Build.mat(CONCRETE.lightened(0.1), 0.95))
	_mailbox(lot, Vector3(door_x + 1.3, 0.0, 11.0), door_color)
	if not is_home:
		var hedge := Build.mat(FOLIAGE[_rng.randi() % FOLIAGE.size()].darkened(0.1), 1.0)
		var hedge_end := (house_x + width * 0.5 - 0.2) if has_garage else 9.6
		_hedge(lot, -9.6, door_x - 1.0, 11.0, hedge)
		_hedge(lot, door_x + 2.0, hedge_end, 11.0, hedge)

	# Yard trees, kept clear of the path and driveway.
	for i in _rng.randi_range(1, 2):
		var x := _rng.randf_range(-8.5, house_x + 3.5)
		if absf(x - door_x) < 2.2:
			x += 3.0
		_tree(lot, Vector3(x, 0.0, _rng.randf_range(6.5, 9.5)), _rng.randf_range(0.8, 1.15), _rng.randf() < 0.3)
	_tree(lot, Vector3(_rng.randf_range(-8.0, 8.0), 0.0, -7.5), _rng.randf_range(1.0, 1.4), _rng.randf() < 0.5)

	if is_home:
		Build.box(lot, Vector3(1.0, 0.03, 0.6), Vector3(door_x, 0.215, front + 1.0), Build.mat(Color(0.75, 0.3, 0.2)))
		Build.ball(lot, 0.12, Vector3(door_x + 1.0, 2.3, front + 0.12), Build.glow(Color(1.0, 0.85, 0.55), 2.0))


func _build_house(lot: Node3D, x: float, width: float, depth: float, wall_color: Color, roof_color: Color, door_color: Color, two_storey: bool) -> void:
	var wall_height := 5.9 if two_storey else 3.2
	var front := depth * 0.5
	var door_x := x - 1.7
	var walls := Build.mat(wall_color, 0.9)
	var roof := Build.mat(roof_color, 0.8)
	var trim := Build.mat(TRIM, 0.7)

	Build.box(lot, Vector3(width, wall_height, depth), Vector3(x, wall_height * 0.5, 0.0), walls, true)
	Build.box(lot, Vector3(width + 0.3, 0.35, depth + 0.3), Vector3(x, 0.175, 0.0), Build.mat(Color(0.6, 0.6, 0.62)))
	Build.box(lot, Vector3(width + 1.0, 0.16, depth + 1.4), Vector3(x, wall_height + 0.02, 0.0), trim)
	Build.prism(lot, Vector3(depth + 1.4, 2.5, width + 1.0), Vector3(x, wall_height + 1.35, 0.0), roof, Vector3(0.0, 90.0, 0.0))
	Build.box(lot, Vector3(0.7, 1.9, 0.7), Vector3(x + width * 0.28, wall_height + 1.5, -1.2), Build.mat(Color(0.62, 0.36, 0.3), 0.9))
	Build.box(lot, Vector3(0.85, 0.14, 0.85), Vector3(x + width * 0.28, wall_height + 2.5, -1.2), trim)

	# Door, porch and awning.
	Build.box(lot, Vector3(1.4, 2.35, 0.08), Vector3(door_x, 1.38, front + 0.02), trim)
	Build.box(lot, Vector3(1.1, 2.1, 0.1), Vector3(door_x, 1.26, front + 0.04), Build.mat(door_color, 0.5))
	Build.ball(lot, 0.05, Vector3(door_x + 0.38, 1.25, front + 0.12), Build.mat(Color(0.95, 0.8, 0.3), 0.3, 0.6), Vector3.ONE, 8)
	Build.box(lot, Vector3(3.2, 0.2, 1.8), Vector3(door_x, 0.1, front + 0.9), Build.mat(CONCRETE, 0.9))
	Build.box(lot, Vector3(3.4, 0.14, 2.0), Vector3(door_x, 2.75, front + 1.0), roof)
	for side: float in [-1.0, 1.0]:
		Build.tube(lot, Vector3(door_x + side * 1.5, 0.2, front + 1.75), Vector3(door_x + side * 1.5, 2.7, front + 1.75), 0.07, trim)

	# Windows: a picture window beside the door, an upper row on two-storey homes, one per side.
	_window(lot, Vector3(x + 2.1, 1.7, front), Vector2(2.4, 1.5), 0.0, door_color)
	_window(lot, Vector3(x - 3.9, 1.8, front), Vector2(0.9, 1.2), 0.0, door_color)
	if two_storey:
		for offset: float in [-3.0, 0.0, 3.0]:
			_window(lot, Vector3(x + offset, 4.5, front), Vector2(1.3, 1.3), 0.0, door_color)
	for side: float in [-1.0, 1.0]:
		_window(lot, Vector3(x + side * width * 0.5, 1.8, 0.5), Vector2(1.6, 1.2), 90.0 * side, door_color)

	# Shrubs and flowers against the front wall.
	for i in 4:
		var bush_x := x + 0.2 + i * 1.25
		Build.ball(lot, 0.55, Vector3(bush_x, 0.4, front + 0.6), Build.mat(FOLIAGE[i % FOLIAGE.size()], 1.0), Vector3(1.0, 0.8, 1.0), 8)
		Build.ball(lot, 0.12, Vector3(bush_x + 0.2, 0.82, front + 0.85), Build.mat(DOORS[(i + _rng.randi()) % DOORS.size()], 0.7), Vector3.ONE, 6)


func _window(parent: Node3D, pos: Vector3, size: Vector2, yaw: float, shutter_color: Color) -> void:
	var window := Build.group(parent, "Window", pos, yaw)
	var trim := Build.mat(TRIM, 0.7)
	Build.box(window, Vector3(size.x + 0.2, size.y + 0.2, 0.08), Vector3(0.0, 0.0, 0.02), trim)
	Build.box(window, Vector3(size.x, size.y, 0.1), Vector3(0.0, 0.0, 0.03), Build.mat(Color(0.45, 0.72, 0.92), 0.1, 0.3))
	Build.box(window, Vector3(0.06, size.y, 0.12), Vector3(0.0, 0.0, 0.03), trim)
	Build.box(window, Vector3(size.x, 0.06, 0.12), Vector3(0.0, 0.0, 0.03), trim)
	Build.box(window, Vector3(size.x + 0.4, 0.08, 0.22), Vector3(0.0, -size.y * 0.5 - 0.12, 0.08), trim)
	for side: float in [-1.0, 1.0]:
		Build.box(window, Vector3(0.34, size.y + 0.1, 0.06), Vector3(side * (size.x * 0.5 + 0.3), 0.0, 0.03), Build.mat(shutter_color, 0.7))


func _mailbox(parent: Node3D, pos: Vector3, color: Color) -> void:
	Build.tube(parent, pos, pos + Vector3(0.0, 1.05, 0.0), 0.04, Build.mat(Color(0.45, 0.3, 0.2)))
	Build.box(parent, Vector3(0.24, 0.22, 0.44), pos + Vector3(0.0, 1.15, 0.0), Build.mat(color, 0.5))
	Build.box(parent, Vector3(0.02, 0.16, 0.08), pos + Vector3(0.13, 1.24, 0.1), Build.mat(Color(0.95, 0.2, 0.2)))


func _hedge(parent: Node3D, x0: float, x1: float, z: float, material: Material) -> void:
	if x1 - x0 < 1.0:
		return
	Build.box(parent, Vector3(x1 - x0, 0.75, 0.6), Vector3((x0 + x1) * 0.5, 0.375, z), material, true)


func _tree(parent: Node3D, pos: Vector3, size: float, pine: bool) -> void:
	var tree := Build.group(parent, "Tree", pos, _rng.randf_range(0.0, 360.0))
	var bark := Build.mat(Color(0.45, 0.3, 0.2), 1.0)
	var leaf_color := FOLIAGE[_rng.randi() % FOLIAGE.size()]
	if not pine and _rng.randf() < 0.18:
		leaf_color = BLOSSOM[_rng.randi() % BLOSSOM.size()]
	var leaves := Build.mat(leaf_color, 1.0)
	if pine:
		Build.cyl(tree, 0.16 * size, 1.4 * size, Vector3(0.0, 0.7 * size, 0.0), bark, true, Vector3.ZERO, 0.12 * size, 8)
		for i in 3:
			Build.cyl(tree, (1.5 - i * 0.35) * size, 1.9 * size, Vector3(0.0, (1.9 + i * 1.2) * size, 0.0), leaves, false, Vector3.ZERO, 0.0, 8)
	else:
		Build.cyl(tree, 0.2 * size, 2.4 * size, Vector3(0.0, 1.2 * size, 0.0), bark, true, Vector3.ZERO, 0.14 * size, 8)
		Build.ball(tree, 1.5 * size, Vector3(0.0, 3.5 * size, 0.0), leaves, Vector3(1.0, 0.9, 1.0), 10)
		Build.ball(tree, 1.05 * size, Vector3(0.9 * size, 2.9 * size, 0.3 * size), Build.mat(leaf_color.darkened(0.08), 1.0), Vector3.ONE, 8)
		Build.ball(tree, 0.95 * size, Vector3(-0.8 * size, 3.1 * size, -0.4 * size), Build.mat(leaf_color.lightened(0.08), 1.0), Vector3.ONE, 8)


func _park_centre_z() -> float:
	var total := 0.0
	for index in park_lots:
		total += first_lot_z - index * lot_pitch
	return total / maxi(park_lots.size(), 1)


func _build_park() -> void:
	if park_lots.is_empty():
		return
	var depth := park_lots.size() * lot_pitch
	var centre := Vector3(-17.0, 0.0, _park_centre_z())
	var park := Build.group(self, "Park", centre)
	Build.box(park, Vector3(20.0, 0.03, depth - 0.4), Vector3.ZERO, Build.mat(Color(0.48, 0.78, 0.36), 1.0))
	Build.box(park, Vector3(1.6, 0.03, depth - 2.0), Vector3(6.5, 0.006, 0.0), Build.mat(Color(0.87, 0.8, 0.66), 1.0))
	Build.cyl(park, 4.2, 0.06, Vector3(-2.5, 0.03, 0.0), Build.mat(Color(0.7, 0.68, 0.62)), false, Vector3.ZERO, -1.0, 24)
	Build.cyl(park, 3.8, 0.08, Vector3(-2.5, 0.035, 0.0), Build.mat(Color(0.25, 0.62, 0.9), 0.1, 0.2), false, Vector3.ZERO, -1.0, 24)
	for i in 5:
		var angle := i * 1.3
		Build.ball(park, 0.4, Vector3(-2.5 + cos(angle) * 4.1, 0.2, sin(angle) * 4.1), Build.mat(Color(0.6, 0.6, 0.6)), Vector3(1.2, 0.7, 1.0), 6)
	for z: float in [-8.0, 8.0]:
		GymProps.bench(park, Vector3(5.0, 0.0, z), 90.0, 2.2, Color(0.6, 0.4, 0.25))
	for i in 9:
		var spot := Vector3(_rng.randf_range(-9.0, 4.0), 0.0, _rng.randf_range(-depth * 0.45, depth * 0.45))
		if Vector2(spot.x + 2.5, spot.z).length() < 6.0:
			spot.z += 9.0 * signf(spot.z + 0.01)
		_tree(park, spot, _rng.randf_range(0.9, 1.4), _rng.randf() < 0.4)
	for i in 14:
		var bloom := DOORS[_rng.randi() % DOORS.size()]
		Build.ball(park, 0.14, Vector3(5.2 + _rng.randf_range(-0.3, 0.3), 0.14, -depth * 0.4 + i * depth * 0.06), Build.mat(bloom, 0.7), Vector3.ONE, 6)


func _build_street_props() -> void:
	# Street lamps alternate sides down the road.
	var index := 0
	var z := _south_z - 16.0
	while z > _plaza_z + 5.0:
		_lamp(Vector3((1.0 if index % 2 == 0 else -1.0) * (ROAD_HALF_WIDTH + 0.5), 0.0, z))
		index += 1
		z -= 26.0
	# Parked cars hug the kerbs, leaving the lane clear for the bike.
	var slots: Array[Vector2] = [Vector2(-1.0, 12.0), Vector2(1.0, -28.0), Vector2(-1.0, -52.0), Vector2(1.0, -86.0), Vector2(-1.0, -150.0), Vector2(1.0, -176.0)]
	for i in slots.size():
		_car(Vector3(slots[i].x * 2.95, 0.0, slots[i].y), 0.0 if slots[i].x > 0.0 else 180.0, CAR_PAINTS[i % CAR_PAINTS.size()], CAR_MODELS[i % CAR_MODELS.size()])
	_dress_kerbs()


## Small street furniture from the model library on the kerb beside every lamp: purely for
## show, with no colliders, so the walk and the ride to the gym are exactly as before.
func _dress_kerbs() -> void:
	var index := 0
	var z := _south_z - 16.0
	while z > _plaza_z + 5.0:
		var side := 1.0 if index % 2 == 0 else -1.0
		var spec: Array = KERB_MODELS[index % KERB_MODELS.size()]
		var prop := ModelLoader.instantiate(spec[0], spec[1])
		prop.position = Vector3(side * (ROAD_HALF_WIDTH + 1.25), 0.0, z + 1.6)
		prop.rotation_degrees.y = -90.0 * side
		add_child(prop)
		index += 1
		z -= 26.0


func _lamp(pos: Vector3) -> void:
	var lamp := Build.group(self, "StreetLamp", pos)
	var pole := Build.mat(Color(0.2, 0.22, 0.26), 0.5, 0.3)
	var inward := -signf(pos.x)
	Build.cyl(lamp, 0.09, 5.2, Vector3(0.0, 2.6, 0.0), pole, true, Vector3.ZERO, 0.06, 8)
	Build.tube(lamp, Vector3(0.0, 5.1, 0.0), Vector3(inward * 1.5, 5.4, 0.0), 0.05, pole)
	Build.box(lamp, Vector3(0.7, 0.14, 0.34), Vector3(inward * 1.6, 5.38, 0.0), pole)
	Build.box(lamp, Vector3(0.5, 0.05, 0.26), Vector3(inward * 1.6, 5.29, 0.0), Build.glow(Color(1.0, 0.92, 0.7), 2.0))


## A parked car: the model from the library when there is one, else the boxy one built here.
func _car(pos: Vector3, yaw: float, paint: Color, model: String = "") -> void:
	var car := Build.group(self, "Car", pos, yaw)
	if ModelLoader.has_model(model):
		Build.blocker(car, Vector3(1.85, 1.5, 4.3), Vector3(0.0, 0.75, 0.0))
		car.add_child(ModelLoader.instantiate(model, 4.3, {"fit": ModelLoader.Fit.LONGEST}))
		return
	var body := Build.mat(paint, 0.35, 0.2)
	var dark_glass := Build.mat(Color(0.12, 0.16, 0.22), 0.1, 0.3)
	Build.blocker(car, Vector3(1.85, 1.5, 4.3), Vector3(0.0, 0.75, 0.0))
	Build.box(car, Vector3(1.8, 0.6, 4.2), Vector3(0.0, 0.62, 0.0), body)
	Build.box(car, Vector3(1.6, 0.55, 2.2), Vector3(0.0, 1.18, 0.25), dark_glass)
	Build.box(car, Vector3(1.64, 0.08, 2.24), Vector3(0.0, 1.48, 0.25), body)
	for side: float in [-1.0, 1.0]:
		Build.box(car, Vector3(0.1, 0.55, 0.1), Vector3(side * 0.77, 1.18, -0.8), body)
		Build.box(car, Vector3(0.1, 0.55, 0.1), Vector3(side * 0.77, 1.18, 0.3), body)
		Build.box(car, Vector3(0.36, 0.14, 0.06), Vector3(side * 0.6, 0.72, -2.11), Build.glow(Color(1.0, 0.97, 0.85), 1.2))
		Build.box(car, Vector3(0.36, 0.12, 0.06), Vector3(side * 0.6, 0.74, 2.11), Build.glow(Color(0.95, 0.12, 0.1), 1.2))
		for z: float in [-1.35, 1.35]:
			Build.cyl(car, 0.34, 0.24, Vector3(side * 0.82, 0.34, z), Build.mat(Color(0.08, 0.08, 0.1)), false, Vector3(0.0, 0.0, 90.0))
			Build.cyl(car, 0.18, 0.25, Vector3(side * 0.83, 0.34, z), Build.mat(Color(0.8, 0.82, 0.86), 0.3, 0.6), false, Vector3(0.0, 0.0, 90.0), -1.0, 8)
	Build.box(car, Vector3(1.84, 0.14, 0.12), Vector3(0.0, 0.4, -2.1), Build.mat(Color(0.2, 0.2, 0.22)))
	Build.box(car, Vector3(1.84, 0.14, 0.12), Vector3(0.0, 0.4, 2.1), Build.mat(Color(0.2, 0.2, 0.22)))


func _build_plaza() -> void:
	var centre_z := gym_front_z + PLAZA_DEPTH * 0.5
	var plaza := Build.group(self, "GymPlaza", Vector3(0.0, 0.0, centre_z))
	var half := PLAZA_DEPTH * 0.5
	Build.box(plaza, Vector3(52.0, 0.06, PLAZA_DEPTH), Vector3.ZERO, Build.mat(Color(0.7, 0.69, 0.67), 0.95))
	Build.box(plaza, Vector3(5.0, 0.02, PLAZA_DEPTH), Vector3(0.0, 0.025, 0.0), Build.mat(Color(0.3, 0.31, 0.36), 0.9))
	for side: float in [-1.0, 1.0]:
		Build.box(plaza, Vector3(0.2, 0.02, PLAZA_DEPTH), Vector3(side * 2.6, 0.026, 0.0), Build.mat(Gym.ACCENT, 0.7))
		# Planters with shrubs flank the approach.
		for z: float in [-9.0, 0.0, 9.0]:
			var planter := Vector3(side * 6.0, 0.0, z)
			Build.box(plaza, Vector3(2.2, 0.7, 2.2), planter + Vector3(0.0, 0.35, 0.0), Build.mat(Color(0.74, 0.74, 0.72), 0.9), true)
			Build.ball(plaza, 1.0, planter + Vector3(0.0, 1.15, 0.0), Build.mat(FOLIAGE[int(z + 9.0) % FOLIAGE.size()], 1.0), Vector3(1.0, 0.8, 1.0), 8)
		GymProps.bench(plaza, Vector3(side * 6.0, 0.03, -4.5), 90.0 * side, 2.4, Color(0.6, 0.4, 0.25))
		GymProps.bench(plaza, Vector3(side * 6.0, 0.03, 4.5), 90.0 * side, 2.4, Color(0.6, 0.4, 0.25))
		# Flag poles.
		var pole := Vector3(side * 10.5, 0.0, half - 3.0)
		Build.cyl(plaza, 0.07, 9.0, pole + Vector3(0.0, 4.5, 0.0), Build.mat(Color(0.85, 0.86, 0.9), 0.3, 0.5), true, Vector3.ZERO, 0.05, 8)
		Build.box(plaza, Vector3(0.04, 1.3, 2.2), pole + Vector3(0.0, 8.2, -1.15), Build.mat(Gym.ACCENT if side < 0.0 else Color(0.15, 0.5, 0.95), 0.8))
		_tree(plaza, Vector3(side * 16.0, 0.03, 8.0), 1.3, false)
		_tree(plaza, Vector3(side * 19.0, 0.03, -4.0), 1.2, true)
		_tree(plaza, Vector3(side * 21.5, 0.0, -26.0), 1.4, true)
	# Bike rack by the entrance.
	var steel := GymProps.steel()
	for i in 4:
		Build.ring(plaza, 0.45, 0.03, Vector3(8.5 + i * 0.8, 0.3, -half + 2.5), steel, Vector3(90.0, 0.0, 0.0), 16)
	Build.blocker(plaza, Vector3(3.4, 0.8, 0.2), Vector3(9.7, 0.4, -half + 2.5))


func _build_boundary() -> void:
	# Tall hedges and invisible walls keep the player inside the playable strip.
	var hedge := Build.mat(Color(0.2, 0.5, 0.25), 1.0)
	var south := _south_z + 13.0
	var north := gym_front_z - 30.0
	var length := south - north
	var mid := (south + north) * 0.5
	for side: float in [-1.0, 1.0]:
		Build.box(self, Vector3(1.6, 3.2, length), Vector3(side * BOUNDARY_X, 1.6, mid), hedge)
		Build.blocker(self, Vector3(1.6, 14.0, length), Vector3(side * BOUNDARY_X, 7.0, mid))
	for z: float in [south, north]:
		Build.box(self, Vector3(BOUNDARY_X * 2.0, 3.2, 1.6), Vector3(0.0, 1.6, z), hedge)
		Build.blocker(self, Vector3(BOUNDARY_X * 2.0, 14.0, 1.6), Vector3(0.0, 7.0, z))


func _build_backdrop() -> void:
	# Trees beyond the hedge, rolling hills on the horizon and a few drifting clouds.
	for i in 44:
		var side := 1.0 if i % 2 == 0 else -1.0
		var spot := Vector3(side * _rng.randf_range(BOUNDARY_X + 4.0, BOUNDARY_X + 30.0), 0.0, _rng.randf_range(gym_front_z - 50.0, _south_z + 30.0))
		_tree(self, spot, _rng.randf_range(1.3, 2.2), _rng.randf() < 0.5)
	for i in 14:
		var angle := i * TAU / 14.0 + _rng.randf_range(-0.15, 0.15)
		var radius := _rng.randf_range(90.0, 170.0)
		# Keep every hill's edge well outside the playable strip and the gym.
		var distance := radius + _rng.randf_range(210.0, 300.0)
		var hill_color := Color(0.36, 0.62, 0.38).lerp(Color(0.5, 0.72, 0.6), _rng.randf())
		var hill := Build.ball(self, 1.0, Vector3(cos(angle) * distance, -radius * 0.12, -110.0 + sin(angle) * distance), Build.mat(hill_color, 1.0), Vector3(radius, radius * _rng.randf_range(0.3, 0.55), radius), 16)
		hill.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var cloud := StandardMaterial3D.new()
	cloud.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	cloud.albedo_color = Color(1.0, 1.0, 1.0)
	for i in 16:
		var centre := Vector3(_rng.randf_range(-320.0, 320.0), _rng.randf_range(110.0, 170.0), _rng.randf_range(-480.0, 200.0))
		for puff in 4:
			var offset := Vector3(puff * 13.0 - 20.0, _rng.randf_range(-3.0, 3.0), _rng.randf_range(-6.0, 6.0))
			var size := _rng.randf_range(10.0, 17.0)
			var node := Build.ball(self, 1.0, centre + offset, cloud, Vector3(size * 1.5, size * 0.6, size), 10)
			node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
