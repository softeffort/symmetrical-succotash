class_name Gym
extends Node3D
## Three-storey gym shell: facade, floor slabs, stairwell and entrance dressing.
## Each storey's contents live in a child node with its own script (Floor1/2/3 in the scene).
## Local space: the front wall is at z = 0, the interior extends towards -Z, ground floor at y = 0.

const WIDTH := 30.0
const DEPTH := 26.0
const STOREY_HEIGHT := 5.0
const STOREYS := 3
const WALL := 0.4
const SLAB := 0.3
const DOOR_WIDTH := 4.0
const DOOR_HEIGHT := 3.2
## Stairwell footprint shared by both flights: west edge and southern (lower) end.
const STAIR_WEST := 10.2
const STAIR_SOUTH := -8.0
const STAIR_STEPS := 20
const STEP_RISE := 0.25
const STEP_TREAD := 0.4
const ACCENT := Color(1.0, 0.5, 0.1)
const FACADE := Color(0.17, 0.18, 0.22)
const LININGS: Array[Color] = [Color(0.86, 0.87, 0.9), Color(0.25, 0.25, 0.3), Color(0.17, 0.13, 0.28)]

## The interior is hidden beyond this camera distance so the street view stays cheap.
@export var interior_draw_distance := 110.0
## The speakers can be heard this far outside the walls, and how much of them gets through.
@export var speaker_reach := 14.0
@export_range(0.0, 1.0) var speaker_leak := 0.4

var _interiors: Array[Node3D] = []


## Storey (0 weight room, 1 fight hall, 2 lounge) a world position is on, or -1 outside the gym.
func storey_at(world_position: Vector3) -> int:
	var local := to_local(world_position)
	if absf(local.x) > WIDTH * 0.5 or local.z > 0.0 or local.z < -DEPTH or local.y < -0.6:
		return -1
	return clampi(floori((local.y + 0.6) / STOREY_HEIGHT), 0, STOREYS - 1)


func _ready() -> void:
	add_to_group(&"gym")
	for child in get_children():
		if child is Node3D:
			_interiors.append(child)
	_build_walls()
	_build_slabs()
	_build_stairs()
	_build_exterior()


func _process(_delta: float) -> void:
	var view := get_viewport().get_camera_3d()
	if view == null:
		return
	var centre := global_transform * Vector3(0.0, STOREY_HEIGHT * 1.5, -DEPTH * 0.5)
	var near := view.global_position.distance_to(centre) < interior_draw_distance
	for interior in _interiors:
		interior.visible = near
	AudioManager.gym_presence = _speaker_presence(to_local(view.global_position))


## How well the gym speakers are heard from `spot` (local): 1 indoors, fading with distance outside.
func _speaker_presence(spot: Vector3) -> float:
	var half := Vector3(WIDTH * 0.5, STOREYS * STOREY_HEIGHT * 0.5, DEPTH * 0.5)
	var outside := (spot - Vector3(0.0, half.y, -half.z)).abs() - half
	var distance := Vector3(maxf(outside.x, 0.0), maxf(outside.y, 0.0), maxf(outside.z, 0.0)).length()
	if distance <= 0.0:
		return 1.0
	return speaker_leak * clampf(1.0 - distance / speaker_reach, 0.0, 1.0)


func _build_walls() -> void:
	var half := WIDTH * 0.5
	for storey in STOREYS:
		var base := storey * STOREY_HEIGHT
		var front: Array[Rect2] = []
		if storey == 0:
			front = [
				Rect2(-13.5, 0.7, 9.5, 3.3),
				Rect2(-DOOR_WIDTH * 0.5, 0.0, DOOR_WIDTH, DOOR_HEIGHT),
				Rect2(4.0, 0.7, 9.5, 3.3),
			]
		else:
			for x: float in [-13.5, -4.0, 5.5]:
				front.append(Rect2(x, base + 0.8, 8.0, 3.2))
		_wall(Vector3.ZERO, 0.0, -half, half, storey, front)
		_wall(Vector3(0.0, 0.0, -DEPTH), 180.0, -half, half, storey, [])
		_wall(Vector3(-half, 0.0, 0.0), -90.0, -DEPTH, 0.0, storey, [])
		_wall(Vector3(half, 0.0, 0.0), 90.0, 0.0, DEPTH, storey, [])


## Two-layer wall (facade outside, storey lining inside) whose interior lies towards local -Z.
func _wall(origin: Vector3, yaw: float, x0: float, x1: float, storey: int, openings: Array[Rect2]) -> void:
	var y0 := storey * STOREY_HEIGHT
	var y1 := y0 + STOREY_HEIGHT
	var holder := Build.group(self, "Wall", origin, yaw)
	Build.wall(holder, x0, x1, y0, y1, WALL * 0.5, Build.mat(FACADE, 0.8), openings).position.z = -WALL * 0.25
	Build.wall(holder, x0, x1, y0, y1, WALL * 0.5, Build.mat(LININGS[storey], 0.9), openings).position.z = -WALL * 0.75
	var trim := Build.mat(Color(0.09, 0.1, 0.12), 0.5)
	for opening in openings:
		if opening.position.y - y0 < 0.05:
			continue  # the doorway stays open
		var centre := opening.get_center()
		Build.box(holder, Vector3(opening.size.x, opening.size.y, 0.05), Vector3(centre.x, centre.y, -WALL * 0.5), Build.glass(), true)
		var panes := maxi(roundi(opening.size.x / 2.4), 1)
		for i in panes + 1:
			var x := opening.position.x + opening.size.x * i / panes
			Build.box(holder, Vector3(0.09, opening.size.y, 0.14), Vector3(x, centre.y, -WALL * 0.5), trim)
		for y: float in [opening.position.y, opening.end.y]:
			Build.box(holder, Vector3(opening.size.x, 0.09, 0.14), Vector3(centre.x, y, -WALL * 0.5), trim)


func _build_slabs() -> void:
	var concrete := Build.mat(Color(0.8, 0.81, 0.84), 0.9)
	var inner := WIDTH * 0.5 - WALL
	var north := -DEPTH + WALL
	var stair_north := STAIR_SOUTH - STAIR_STEPS * STEP_TREAD
	for storey in range(1, STOREYS):
		var top := storey * STOREY_HEIGHT
		_slab(-inner, STAIR_WEST, -WALL, north, top, concrete)
		_slab(STAIR_WEST, inner, -WALL, STAIR_SOUTH, top, concrete)
		_slab(STAIR_WEST, inner, stair_north, north, top, concrete)
	_slab(-WIDTH * 0.5, WIDTH * 0.5, 0.0, -DEPTH, STOREYS * STOREY_HEIGHT + SLAB, Build.mat(FACADE.darkened(0.2)))


func _slab(x0: float, x1: float, z0: float, z1: float, top: float, material: Material) -> void:
	Build.box(self, Vector3(x1 - x0, SLAB, absf(z1 - z0)), Vector3((x0 + x1) * 0.5, top - SLAB * 0.5, (z0 + z1) * 0.5), material, true)


func _build_stairs() -> void:
	var inner := WIDTH * 0.5 - WALL
	var steps := Build.mat(Color(0.3, 0.31, 0.36), 0.8)
	var rail := Build.mat(ACCENT, 0.4, 0.2)
	var run := STAIR_STEPS * STEP_TREAD
	for flight in STOREYS - 1:
		var origin := Vector3((STAIR_WEST + inner) * 0.5, flight * STOREY_HEIGHT, STAIR_SOUTH)
		Build.stairs(self, origin, 0.0, STAIR_STEPS, STEP_RISE, STEP_TREAD, inner - STAIR_WEST - 0.04, steps, rail, [-1])
		# Guard rails around the opening in the slab above this flight.
		var level := (flight + 1) * STOREY_HEIGHT
		_guard_rail(Vector3(STAIR_WEST, level, STAIR_SOUTH), Vector3(STAIR_WEST, level, STAIR_SOUTH - run), rail)
		if flight == STOREYS - 2:
			_guard_rail(Vector3(STAIR_WEST, level, STAIR_SOUTH), Vector3(inner, level, STAIR_SOUTH), rail)
	Build.text(self, "1F  WEIGHTS + CARDIO\n2F  FIGHT HALL\n3F  PROTEIN BAR", Vector3(inner - 0.02, 2.6, -4.2), 0.34, ACCENT, Vector3(0.0, -90.0, 0.0), 1.3)


func _guard_rail(from: Vector3, to: Vector3, rail: Material) -> void:
	var span := to - from
	var holder := Build.group(self, "GuardRail", from, rad_to_deg(atan2(-span.z, span.x)))
	var length := span.length()
	Build.blocker(holder, Vector3(length, 1.15, 0.1), Vector3(length * 0.5, 0.575, 0.0))
	Build.box(holder, Vector3(length, 0.9, 0.03), Vector3(length * 0.5, 0.5, 0.0), Build.glass(Color(0.7, 0.9, 1.0, 0.25)))
	Build.tube(holder, Vector3(0.0, 1.05, 0.0), Vector3(length, 1.05, 0.0), 0.045, rail)
	var posts := maxi(roundi(length / 2.0), 1)
	for i in posts + 1:
		var x := length * i / posts
		Build.tube(holder, Vector3(x, 0.0, 0.0), Vector3(x, 1.05, 0.0), 0.03, rail)


func _build_exterior() -> void:
	var half := WIDTH * 0.5
	var roof := STOREYS * STOREY_HEIGHT + SLAB
	var accent := Build.mat(ACCENT, 0.5)
	var dark := Build.mat(FACADE.darkened(0.25), 0.8)
	var neon := Build.glow(ACCENT, 2.2)

	# Parapet with the sign, accent bands at each floor line and corner fins.
	Build.box(self, Vector3(WIDTH + 0.4, 2.2, 0.6), Vector3(0.0, roof + 1.1, -0.2), dark)
	for side: float in [-1.0, 1.0]:
		Build.box(self, Vector3(0.4, 0.9, DEPTH), Vector3(side * (half - 0.2), roof + 0.45, -DEPTH * 0.5), dark)
		Build.box(self, Vector3(0.6, roof + 2.2, 0.6), Vector3(side * (half + 0.05), (roof + 2.2) * 0.5, 0.05), accent)
	Build.box(self, Vector3(WIDTH, 0.9, 0.4), Vector3(0.0, roof + 0.45, -DEPTH + 0.2), dark)
	for storey in range(1, STOREYS):
		Build.box(self, Vector3(WIDTH, 0.22, 0.12), Vector3(0.0, storey * STOREY_HEIGHT, 0.06), accent)
	Build.text(self, "IRON TEMPLE GYM", Vector3(0.0, roof + 1.1, 0.12), 1.35, ACCENT, Vector3.ZERO, 1.3)
	Build.box(self, Vector3(WIDTH - 2.0, 0.08, 0.08), Vector3(0.0, roof + 0.2, 0.14), neon)

	# Entrance: framed doorway, canopy and open glass doors.
	var door_half := DOOR_WIDTH * 0.5
	for side: float in [-1.0, 1.0]:
		Build.box(self, Vector3(0.3, DOOR_HEIGHT + 0.3, WALL + 0.2), Vector3(side * (door_half + 0.15), (DOOR_HEIGHT + 0.3) * 0.5, -WALL * 0.5), accent)
		Build.box(self, Vector3(0.06, DOOR_HEIGHT - 0.2, 1.9), Vector3(side * (door_half + 0.06), (DOOR_HEIGHT - 0.2) * 0.5, 1.05), Build.glass())
		Build.tube(self, Vector3(side * 3.3, 0.0, 2.8), Vector3(side * 3.3, 3.5, 2.8), 0.09, dark)
	Build.box(self, Vector3(DOOR_WIDTH + 0.6, 0.3, WALL + 0.2), Vector3(0.0, DOOR_HEIGHT + 0.15, -WALL * 0.5), accent)
	Build.box(self, Vector3(7.4, 0.3, 3.2), Vector3(0.0, 3.65, 1.6), accent)
	Build.box(self, Vector3(6.6, 0.05, 0.12), Vector3(0.0, 3.48, 3.0), Build.glow(Color(1.0, 0.9, 0.7), 2.0))
	Build.box(self, Vector3(3.6, 0.03, 1.5), Vector3(0.0, 0.045, 1.2), Build.mat(Color(0.1, 0.1, 0.12)))
	Build.text(self, "WELCOME", Vector3(0.0, 0.065, 1.2), 0.42, ACCENT, Vector3(-90.0, 0.0, 0.0))
