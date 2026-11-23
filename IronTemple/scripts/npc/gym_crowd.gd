class_name GymCrowd
extends Node3D
## NPC spawner and crowd controller. Sits under the Gym (same origin) and populates all three
## storeys with regulars from ROSTER, each a GymNpc with its own look and activity.
##
## Every physics tick it tells the regulars where the player is, lets the nearest one comment
## (the tone follows `Reputation.tier()`), and at the top tier has them step aside. When a bout
## starts it sends spectators to stand around the octagon, more of them the higher the
## player's level and win streak, and makes them cheer heavy hits and knockouts.

const NPC := preload("res://scenes/npc/gym_npc.tscn")
## Floor heights in gym space (the floor finish sits a little above each slab).
const F1 := 0.03
const F2 := 5.03
const F3 := 10.03
## A regular within this distance may comment on the player.
const REACT_RANGE := 3.4
## Seconds between remarks anywhere in the gym, and before the same person speaks again.
const REMARK_GAP := Vector2(4.0, 8.0)
const NPC_GAP := Vector2(16.0, 28.0)
## Spectators walk round the cage on this radius and stand on the inner one.
const RING_LANE := 7.0
const RING_SIDE := 6.15
## Standing places round the cage, degrees clockwise from the gate. The first two belong to
## the ringside regulars.
const SPOT_ANGLES: Array[float] = [258.0, 102.0, 232.0, 128.0, 284.0, 76.0, 206.0, 154.0, 310.0, 50.0, 180.0]
## Spectators from other storeys appear half-way up the stairs and leave the same way.
const STAIR_ENTRY: Array[Vector3] = [Vector3(13.4, 2.5, -11.6), Vector3(13.4, 5.0, -15.6), Vector3(13.4, F2, -17.2), Vector3(9.1, F2, -17.2)]
const STAIR_EXIT: Array[Vector3] = [Vector3(9.7, F2, -17.2), Vector3(11.4, F2, -17.2), Vector3(11.4, 5.0, -15.6), Vector3(11.4, 2.5, -11.6)]
## The walkers' lap: lobby, up both flights on the right, a stop at the bar, back down.
const WALK_ROUTE: Array[Vector3] = [
	Vector3(2.0, F1, -4.6), Vector3(9.5, F1, -5.8), Vector3(13.4, F1, -6.3), Vector3(13.4, 0.0, -7.6),
	Vector3(13.4, 5.0, -15.6), Vector3(13.4, F2, -17.2), Vector3(9.1, F2, -17.2), Vector3(9.1, F2, -6.3),
	Vector3(13.4, F2, -6.3), Vector3(13.4, 5.0, -7.6), Vector3(13.4, 10.0, -15.6), Vector3(13.4, F3, -17.2),
	Vector3(5.2, F3, -19.3), Vector3(11.4, F3, -17.2), Vector3(11.4, 10.0, -15.6), Vector3(11.4, 5.0, -7.6),
	Vector3(11.4, F2, -6.3), Vector3(9.7, F2, -6.3), Vector3(9.7, F2, -17.2), Vector3(11.4, F2, -17.2),
	Vector3(11.4, 5.0, -15.6), Vector3(11.4, 0.0, -7.6), Vector3(11.4, F1, -6.0), Vector3(6.0, F1, -5.4),
]
const WALK_PAUSES := {0: 5.0, 12: 8.0}

const SKIN_FAIR := Color(0.98, 0.84, 0.74)
const SKIN_TAN := Color(0.86, 0.66, 0.5)
const SKIN_BROWN := Color(0.62, 0.43, 0.3)
const SKIN_DEEP := Color(0.42, 0.28, 0.2)

## Everyone who trains here. `home` is in gym space, `yaw` in degrees (0 faces -Z).
const ROSTER: Array[Dictionary] = [
	# Storey 1: free weights by the mirror, the open floor, the warm-up tiles.
	{"name": "Mike", "level": 4, "tenure": "3 Months", "activity": GymNpc.Activity.CURL, "home": Vector3(-13.1, F1, -11.9), "yaw": 90.0, "build": Vector3(0.55, 0.5, 0.4), "height": 1.0, "skin": SKIN_TAN, "hair": Color(0.2, 0.13, 0.08), "shirt": Color(0.85, 0.2, 0.2), "shorts": Color(0.1, 0.1, 0.12), "shoes": Color(0.95, 0.95, 0.97)},
	{"name": "Dana", "level": 6, "tenure": "8 Months", "activity": GymNpc.Activity.LIFT, "home": Vector3(-13.1, F1, -14.3), "yaw": 90.0, "build": Vector3(0.4, 0.35, 0.45), "height": 0.94, "skin": SKIN_FAIR, "hair": Color(0.75, 0.55, 0.2), "shirt": Color(0.2, 0.75, 0.7), "shorts": Color(0.15, 0.15, 0.2), "shoes": Color(1.0, 0.45, 0.8)},
	{"name": "Rocco", "level": 9, "tenure": "2 Years", "activity": GymNpc.Activity.SQUAT, "home": Vector3(8.2, F1, -18.6), "yaw": 90.0, "build": Vector3(0.8, 0.85, 0.9), "height": 1.04, "skin": SKIN_BROWN, "hair": Color(0.06, 0.05, 0.05), "shirt": Color(0.12, 0.12, 0.14), "shorts": Color(0.75, 0.1, 0.1), "shoes": Color(0.1, 0.1, 0.12)},
	{"name": "Lena", "level": 3, "tenure": "5 Weeks", "activity": GymNpc.Activity.STRETCH, "home": Vector3(-8.5, 0.07, -2.5), "yaw": -90.0, "build": Vector3(0.2, 0.22, 0.35), "height": 0.96, "skin": SKIN_FAIR, "hair": Color(0.45, 0.12, 0.1), "shirt": Color(0.66, 0.45, 1.0), "shorts": Color(0.12, 0.12, 0.16), "shoes": Color(0.3, 0.9, 1.0)},
	# Storey 2: the bags, ringside, the open floor.
	{"name": "Tasha", "level": 8, "tenure": "1 Year", "activity": GymNpc.Activity.BAG, "home": Vector3(-11.72, F2, -15.2), "yaw": 90.0, "build": Vector3(0.6, 0.5, 0.6), "height": 0.98, "skin": SKIN_DEEP, "hair": Color(0.05, 0.04, 0.05), "shirt": Color(1.0, 0.82, 0.3), "shorts": Color(0.1, 0.1, 0.12), "shoes": Color(0.95, 0.95, 0.97)},
	{"name": "Ivan", "level": 11, "tenure": "3 Years", "activity": GymNpc.Activity.WATCH, "build": Vector3(0.75, 0.8, 0.7), "height": 1.06, "skin": SKIN_FAIR, "hair": Color(0.85, 0.8, 0.6), "shirt": Color(0.16, 0.42, 0.95), "shorts": Color(0.1, 0.1, 0.12), "shoes": Color(0.9, 0.2, 0.2)},
	{"name": "Priya", "level": 7, "tenure": "10 Months", "activity": GymNpc.Activity.WATCH, "build": Vector3(0.4, 0.4, 0.5), "height": 0.95, "skin": SKIN_BROWN, "hair": Color(0.08, 0.06, 0.06), "shirt": Color(1.0, 0.45, 0.85), "shorts": Color(0.2, 0.2, 0.26), "shoes": Color(0.95, 0.95, 0.97)},
	{"name": "Omar", "level": 5, "tenure": "4 Months", "activity": GymNpc.Activity.PUSHUP, "home": Vector3(-6.5, F2, -4.2), "yaw": 90.0, "build": Vector3(0.5, 0.6, 0.4), "height": 1.0, "skin": SKIN_TAN, "hair": Color(0.1, 0.08, 0.07), "shirt": Color(0.3, 0.8, 0.4), "shorts": Color(0.1, 0.1, 0.12), "shoes": Color(0.2, 0.2, 0.24)},
	# Storey 3: the bar and the high tables.
	{"name": "Chloe", "level": 2, "tenure": "2 Weeks", "activity": GymNpc.Activity.DRINK, "home": Vector3(-5.68, F3, -20.15), "yaw": 0.0, "room": 0.4, "build": Vector3(0.12, 0.15, 0.25), "height": 0.93, "skin": SKIN_FAIR, "hair": Color(0.1, 0.08, 0.1), "shirt": Color(0.96, 0.97, 1.0), "shorts": Color(0.66, 0.45, 1.0), "shoes": Color(0.95, 0.95, 0.97)},
	{"name": "Deshawn", "level": 12, "tenure": "4 Years", "activity": GymNpc.Activity.DRINK, "home": Vector3(-1.0, F3, -14.72), "yaw": 0.0, "room": 0.45, "build": Vector3(0.9, 0.9, 0.8), "height": 1.08, "skin": SKIN_DEEP, "hair": Color(0.05, 0.05, 0.05), "shirt": Color(0.5, 0.1, 0.6), "shorts": Color(0.1, 0.1, 0.12), "shoes": Color(1.0, 0.82, 0.3)},
	{"name": "Kat", "level": 6, "tenure": "7 Months", "activity": GymNpc.Activity.DRINK, "home": Vector3(6.0, F3, -15.4), "yaw": 180.0, "room": 0.45, "build": Vector3(0.35, 0.4, 0.45), "height": 0.97, "skin": SKIN_TAN, "hair": Color(0.9, 0.3, 0.6), "shirt": Color(0.1, 0.1, 0.12), "shorts": Color(0.15, 0.9, 1.0), "shoes": Color(1.0, 0.2, 0.75)},
	# Always on the move between the storeys.
	{"name": "Felix", "level": 4, "tenure": "10 Weeks", "activity": GymNpc.Activity.WALK, "start": 0, "room": 0.8, "build": Vector3(0.3, 0.3, 0.3), "height": 1.02, "skin": SKIN_FAIR, "hair": Color(0.35, 0.2, 0.1), "shirt": Color(1.0, 0.5, 0.1), "shorts": Color(0.15, 0.15, 0.2), "shoes": Color(0.95, 0.95, 0.97)},
	{"name": "Nora", "level": 10, "tenure": "18 Months", "activity": GymNpc.Activity.WALK, "start": 12, "room": 0.8, "build": Vector3(0.55, 0.55, 0.65), "height": 0.99, "skin": SKIN_BROWN, "hair": Color(0.12, 0.08, 0.06), "shirt": Color(0.15, 0.9, 1.0), "shorts": Color(0.1, 0.1, 0.12), "shoes": Color(0.66, 0.45, 1.0)},
]

## Every regular, in ROSTER order.
var npcs: Array[GymNpc] = []
## Regulars sent to the cage for the current bout.
var spectators: Array[GymNpc] = []

var _player: Player = null
var _ring: RingManager = null
var _ring_centre := Vector3(-1.5, F2, -13.5)
var _free_angles: Array[float] = []
var _remark_timer := 3.0
var _cheer_cooldown := 0.0


func _ready() -> void:
	_ring = get_tree().get_first_node_in_group(&"ring") as RingManager
	if _ring != null:
		_ring_centre = to_local(_ring.global_position)
		_ring_centre.y = F2
		_ring.bout_started.connect(_on_bout_started)
	_free_angles = SPOT_ANGLES.duplicate()
	_spawn()
	# The player is further down the scene tree and not ready yet.
	_bind_player.call_deferred()


func _physics_process(delta: float) -> void:
	if _player == null or not is_visible_in_tree():
		return
	var spot := to_local(_player.global_position)
	var yields := Reputation.tier() == Reputation.Tier.HIGH
	for npc in npcs:
		npc.cooldown = maxf(npc.cooldown - delta, 0.0)
		npc.observe(spot, yields)
	_cheer_cooldown = maxf(_cheer_cooldown - delta, 0.0)
	_tick_remarks(delta, spot)


## Regulars standing at the cage right now: the ringside pair and any spectators who have arrived.
func get_audience() -> Array[GymNpc]:
	var audience: Array[GymNpc] = []
	for npc in npcs:
		if npc.is_watching():
			audience.append(npc)
	return audience


# --- Spawning --------------------------------------------------------------------------------

func _spawn() -> void:
	for spec in ROSTER:
		var npc: GymNpc = NPC.instantiate()
		var entry := spec.duplicate()
		var kind: GymNpc.Activity = entry["activity"]
		if kind == GymNpc.Activity.WATCH:
			# The ringside pair take the first standing places and face the cage.
			var angle: float = _free_angles.pop_front()
			var place := _ring_point(angle, RING_SIDE)
			entry["home"] = place
			entry["yaw"] = rad_to_deg(atan2(place.x - _ring_centre.x, place.z - _ring_centre.z))
		npc.name = entry["name"]
		npc.setup(entry)
		if kind == GymNpc.Activity.WALK:
			npc.route = WALK_ROUTE.duplicate()
			npc.route_pauses = WALK_PAUSES
			npc.route_index = entry.get("start", 0)
		elif kind == GymNpc.Activity.BAG:
			npc.bag = get_node_or_null("../Floor2_FightHall/HeavyBag4") as PunchingBag
		add_child(npc)
		npcs.append(npc)


func _bind_player() -> void:
	_player = get_tree().get_first_node_in_group(&"player") as Player
	if _player == null:
		return
	_player.combat.strike_resolved.connect(_on_strike_resolved)
	_player.combat.knocked_out.connect(_on_player_down)
	_player.combat.knocked_down.connect(func(_count: int) -> void: _on_player_down())
	_player.combat.bout_changed.connect(_on_bout_changed)


# --- Remarks ---------------------------------------------------------------------------------

## Lets the nearest regular who has not spoken lately say something about the player.
func _tick_remarks(delta: float, spot: Vector3) -> void:
	_remark_timer -= delta
	if _remark_timer > 0.0 or _player.combat.in_bout:
		return
	var nearest: GymNpc = null
	var best := REACT_RANGE
	for npc in npcs:
		if npc.cooldown > 0.0 or npc.mode == GymNpc.Mode.TRAVEL:
			continue
		var offset := npc.position - spot
		if absf(offset.y) > 1.5:
			continue
		var distance := Vector2(offset.x, offset.z).length()
		if distance < best:
			best = distance
			nearest = npc
	if nearest == null:
		return
	_remark_timer = randf_range(REMARK_GAP.x, REMARK_GAP.y)
	nearest.cooldown = randf_range(NPC_GAP.x, NPC_GAP.y)
	var tier := Reputation.tier()
	# Rookies only get noticed some of the time.
	if tier == Reputation.Tier.LOW and randf() < 0.3:
		return
	nearest.say(Reputation.pick_line())
	if tier != Reputation.Tier.LOW:
		nearest.nod()


# --- The crowd at the cage -------------------------------------------------------------------

func _on_bout_started(_profile: FighterProfile) -> void:
	var wanted := Reputation.crowd_size()
	if spectators.size() >= wanted:
		return
	# Whoever is already on the fight floor comes first, the nearest of them before the rest.
	var candidates: Array[GymNpc] = []
	for npc in npcs:
		if npc.activity != GymNpc.Activity.WATCH and not spectators.has(npc):
			candidates.append(npc)
	candidates.sort_custom(func(a: GymNpc, b: GymNpc) -> bool: return _walk_cost(a) < _walk_cost(b))
	var arrivals := 0
	for npc in candidates:
		if spectators.size() >= wanted or _free_angles.is_empty():
			break
		var here := _is_on_fight_floor(npc)
		var start: Vector3 = npc.position if here else STAIR_ENTRY[STAIR_ENTRY.size() - 1]
		var angle := _claim_angle(start)
		var path: Array[Vector3] = []
		if not here:
			path.append_array(STAIR_ENTRY)
		path.append_array(_ring_path(start, angle, RING_SIDE))
		# People coming up the stairs arrive one after another.
		npc.join_crowd(path, _ring_centre, 0.2 if here else 0.5 + 0.7 * arrivals, not here)
		npc.set_meta(&"ring_angle", angle)
		if not here:
			arrivals += 1
		spectators.append(npc)


func _on_bout_changed(active: bool) -> void:
	if active:
		return
	# The fighter has left the cage: everyone drifts back to what they were doing.
	for npc in spectators:
		var angle: float = npc.get_meta(&"ring_angle", 180.0)
		_free_angles.append(angle)
		if not _is_on_fight_floor(npc):
			# Still on the stairs on the way in.
			npc.return_home()
		elif npc.activity != GymNpc.Activity.WALK and absf(npc.home.y - F2) < 0.6:
			var offset := npc.home - _ring_centre
			npc.leave_crowd(_ring_path(npc.position, rad_to_deg(atan2(offset.x, offset.z)), Vector2(offset.x, offset.z).length()))
		else:
			var door := STAIR_EXIT[0] - _ring_centre
			var path := _ring_path(npc.position, rad_to_deg(atan2(door.x, door.z)), Vector2(door.x, door.z).length())
			path.append_array(STAIR_EXIT.slice(1))
			npc.leave_crowd(path, true)
	spectators.clear()


func _on_strike_resolved(strike: Strike) -> void:
	if not _player.combat.in_bout:
		return
	if strike.outcome == Strike.Outcome.KNOCKOUT:
		_cheer(2.6, 1.0, Reputation.KO_CHEERS)
	elif strike.knockdown:
		_cheer(1.8, 0.85, Reputation.CHEERS)
	elif _cheer_cooldown <= 0.0 and Reputation.tier() != Reputation.Tier.LOW:
		var clean := strike.outcome == Strike.Outcome.HIT and (strike.heavy or strike.counter or strike.counter_hit or strike.combo != &"")
		if clean or strike.outcome == Strike.Outcome.GUARD_BREAK:
			_cheer(1.0, 0.5, Reputation.CHEERS)


func _on_player_down() -> void:
	var audience := get_audience()
	if audience.is_empty():
		return
	AudioManager.play(&"crowd", 0.35, 0.72)
	audience.shuffle()
	for i in mini(2, audience.size()):
		audience[i].say(Reputation.GROANS.pick_random(), 2.2)


## Arms up round the cage, a roar that grows with the crowd and a few shouts.
func _cheer(seconds: float, loudness: float, lines: Array[String]) -> void:
	var audience := get_audience()
	if audience.is_empty():
		return
	_cheer_cooldown = 1.2
	for npc in audience:
		npc.cheer(seconds + randf_range(0.0, 0.5))
	AudioManager.play_varied(&"crowd", loudness * clampf(audience.size() / 7.0, 0.3, 1.0))
	audience.shuffle()
	for i in mini(1 + audience.size() / 4, audience.size()):
		audience[i].say(lines.pick_random(), 1.6)


func _is_on_fight_floor(npc: GymNpc) -> bool:
	return absf(npc.position.y - F2) < 0.3


## Sorting key for picking spectators: distance to the cage, with other storeys last.
func _walk_cost(npc: GymNpc) -> float:
	var offset := npc.position - _ring_centre
	return Vector2(offset.x, offset.z).length() + (0.0 if _is_on_fight_floor(npc) else 100.0)


## Takes the free standing place nearest in angle to `from`.
func _claim_angle(from: Vector3) -> float:
	var offset := from - _ring_centre
	var bearing := wrapf(rad_to_deg(atan2(offset.x, offset.z)), 0.0, 360.0)
	var best := 0
	for i in _free_angles.size():
		if absf(_free_angles[i] - bearing) < absf(_free_angles[best] - bearing):
			best = i
	var angle := _free_angles[best]
	_free_angles.remove_at(best)
	return angle


func _ring_point(angle_degrees: float, radius: float) -> Vector3:
	var angle := deg_to_rad(angle_degrees)
	return _ring_centre + Vector3(sin(angle), 0.0, cos(angle)) * radius


## Waypoints from `from` round the outside of the cage to (`to_angle`, `to_radius`). The way
## round never crosses the gate at 0 degrees, where the fighter walks in and out.
func _ring_path(from: Vector3, to_angle: float, to_radius: float) -> Array[Vector3]:
	var path: Array[Vector3] = []
	var offset := from - _ring_centre
	var bearing := wrapf(rad_to_deg(atan2(offset.x, offset.z)), 0.0, 360.0)
	var target := wrapf(to_angle, 0.0, 360.0)
	if absf(Vector2(offset.x, offset.z).length() - RING_LANE) > 0.3:
		path.append(_ring_point(bearing, RING_LANE))
	var steps := ceili(absf(target - bearing) / 18.0)
	for i in range(1, steps + 1):
		path.append(_ring_point(lerpf(bearing, target, float(i) / steps), RING_LANE))
	path.append(_ring_point(target, to_radius))
	return path
