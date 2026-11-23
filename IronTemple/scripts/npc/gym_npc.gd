class_name GymNpc
extends AnimatableBody3D
## A gym-goer: a CharacterModel body with its own colours and build, a floating name tag
## ("Mike | LVL 4 | 3 Months"), a speech bubble and one looping activity (curls, dumbbell
## lifts, squats, push-ups, stretching, bag work, a walk between the floors, a drink at the bar,
## watching the cage, serving).
##
## Positions are in the parent's space. A GymCrowd (or any owner) calls `observe()` every
## physics tick with the player's position, sends the NPC ringside with `join_crowd()` and
## makes it react with `say()`, `nod()` and `cheer()`.

enum Activity { IDLE, CURL, LIFT, SQUAT, PUSHUP, STRETCH, BAG, WALK, DRINK, WATCH, SERVE }
enum Mode { ROUTINE, TRAVEL, SPECTATE }

const WALK_SPEED := 1.35
const JOG_SPEED := 3.4
const TURN_SPEED := 7.0
## The player this close makes a yielding NPC step aside; it steps back once they are this far.
const YIELD_RANGE := 1.7
const YIELD_RELEASE := 2.6
## A walker stops for a player standing this close in front of it.
const BLOCK_RANGE := 1.15
const BUBBLE_SECONDS := 2.8
const BUBBLE_SIZE := 0.0026
## Bag work timing: wind-up, strike, recovery.
const PUNCH := Vector3(0.16, 0.09, 0.26)
const PUNCHES: Array[StringName] = [Strike.JAB, Strike.JAB, Strike.CROSS, Strike.HOOK]
## Regulars drawn with the female body.
const FEMALE_NAMES: Array[String] = ["Dana", "Lena", "Tasha", "Priya", "Chloe", "Kat", "Nora"]

var npc_name := "Mike"
var level := 1
var tenure := "First Week"
var activity := Activity.IDLE
## Where the NPC does its activity, and which way it faces there.
var home := Vector3.ZERO
var home_yaw := 0.0
## Waypoints a WALK activity loops through, and seconds to linger at some of them.
var route: Array[Vector3] = []
var route_pauses: Dictionary = {}
var route_index := 0
## The heavy bag a BAG activity works.
var bag: PunchingBag = null
## How far the NPC can sidestep for the player; 0 never moves.
var aside_room := 0.9
var mode := Mode.ROUTINE
## Seconds until the NPC may comment again. Counted down by its owner.
var cooldown := 0.0

var _height := 1.0
var _base := Vector3.ZERO
var _aside := Vector3.ZERO
var _aside_axis := Vector3.RIGHT
var _yielding := false
var _yields := false
var _player := Vector3.INF
var _yaw := 0.0
var _time := 0.0
var _stride := 0.0
var _move_amount := 0.0
var _speed := 0.0
var _pause := 0.0
var _path: Array[Vector3] = []
var _travel_speed := WALK_SPEED
var _travel_delay := 0.0
var _warp_start := false
var _warp_home := false
var _arrive_mode := Mode.ROUTINE
var _look_at := Vector3.ZERO
var _cheer := 0.0
var _nod := 0.0
var _bubble_left := 0.0
var _bubble_tween: Tween
var _fight := FightAnimator.new()
var _punch_time := -1.0
var _punch_kind: StringName = Strike.JAB
var _punch_side := 0
var _punch_landed := false
var _punch_wait := 1.0
var _sip_time := -1.0
var _sip_wait := 4.0
# Dumbbells, put down whenever the NPC leaves its spot.
var _weights: Array[Node3D] = []

@onready var model: CharacterModel = $Model
@onready var name_tag: Label3D = $NameTag
@onready var bubble: Label3D = $Bubble


## Call before adding the NPC to the tree: the body takes its colours when it is built.
## Keys: name, level, tenure, activity, home, yaw (degrees), room, build (arms, torso, legs),
## height, skin, hair, shirt, shorts, shoes.
func setup(spec: Dictionary) -> void:
	npc_name = spec.get("name", npc_name)
	level = spec.get("level", level)
	tenure = spec.get("tenure", tenure)
	activity = spec.get("activity", Activity.IDLE)
	home = spec.get("home", Vector3.ZERO)
	var yaw_degrees: float = spec.get("yaw", 0.0)
	home_yaw = deg_to_rad(yaw_degrees)
	aside_room = spec.get("room", aside_room)
	_height = spec.get("height", 1.0)
	_time = randf() * 10.0
	var build: Vector3 = spec.get("build", Vector3(0.3, 0.3, 0.3))
	var body: CharacterModel = $Model
	body.render_layers = 1
	body.skin_color = spec.get("skin", body.skin_color)
	body.hair_color = spec.get("hair", body.hair_color)
	body.shirt_color = spec.get("shirt", body.shirt_color)
	body.shorts_color = spec.get("shorts", body.shorts_color)
	body.shoe_color = spec.get("shoes", body.shoe_color)
	body.look = _look_of(npc_name, spec)
	body.scale = Vector3(1.0, _height, 1.0)
	body.set_physique(build.x, build.y, build.z)


func _ready() -> void:
	_base = route[route_index] if activity == Activity.WALK and not route.is_empty() else home
	_yaw = home_yaw
	position = _base
	rotation.y = _yaw
	name_tag.text = "%s | LVL %d | %s" % [npc_name, level, tenure]
	name_tag.position.y = 1.95 * _height + 0.3
	bubble.position.y = name_tag.position.y + 0.3
	bubble.visible = false
	model.fight_pose = _fight.pose
	_fight.bounce = 0.6
	_equip()


func _physics_process(delta: float) -> void:
	if not is_visible_in_tree():
		return
	_time += delta
	var before := _base + _aside
	if _travel_delay > 0.0:
		_travel_delay -= delta
		if _travel_delay <= 0.0:
			_begin_travel()
	match mode:
		Mode.TRAVEL:
			_travel(delta)
		Mode.SPECTATE:
			_face(_look_at - _base, delta)
		_:
			_routine(delta)
	_step_aside(delta)
	var spot := _base + _aside
	_speed = Vector2(spot.x - before.x, spot.z - before.z).length() / delta
	position = spot
	rotation.y = _yaw
	_animate(delta)
	_tick_bubble(delta)


# --- Owner interface -------------------------------------------------------------------------

## Tells the NPC where the player is (parent space) and whether it should step out of the way.
func observe(player_position: Vector3, yields: bool) -> void:
	_player = player_position
	_yields = yields


## Shows a speech bubble over the name tag.
func say(text: String, seconds: float = BUBBLE_SECONDS) -> void:
	bubble.text = text
	bubble.visible = true
	bubble.modulate.a = 1.0
	bubble.outline_modulate.a = 1.0
	bubble.pixel_size = BUBBLE_SIZE * 0.5
	_bubble_left = seconds
	if _bubble_tween != null:
		_bubble_tween.kill()
	_bubble_tween = create_tween()
	_bubble_tween.tween_property(bubble, "pixel_size", BUBBLE_SIZE, 0.16).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func is_speaking() -> bool:
	return _bubble_left > 0.0


## A respectful dip of the head.
func nod() -> void:
	_nod = 0.7


## Arms up for `seconds`.
func cheer(seconds: float = 1.0) -> void:
	_cheer = maxf(_cheer, seconds)


## True while standing ringside (not on the way there).
func is_watching() -> bool:
	return mode == Mode.SPECTATE or (activity == Activity.WATCH and mode == Mode.ROUTINE)


## Sends the NPC along `path` at a jog to stand at its end facing `look_at`. With `warp` it
## first appears at the path's start (it came up the stairs, out of sight).
func join_crowd(path: Array[Vector3], look_at: Vector3, delay: float = 0.0, warp: bool = false) -> void:
	_path = path.duplicate()
	_look_at = look_at
	_travel_speed = JOG_SPEED
	_arrive_mode = Mode.SPECTATE
	_warp_start = warp
	_warp_home = false
	_travel_delay = maxf(delay, 0.01)


## Walks the NPC along `path` and back into its routine. With `warp_home` it then reappears at
## its usual place (it left by the stairs).
func leave_crowd(path: Array[Vector3], warp_home: bool = false) -> void:
	_path = path.duplicate()
	_travel_speed = WALK_SPEED * 1.2
	_arrive_mode = Mode.ROUTINE
	_warp_start = false
	_warp_home = warp_home
	_travel_delay = 0.0
	mode = Mode.TRAVEL


## Puts the NPC straight back at its usual place.
func return_home() -> void:
	_path.clear()
	_travel_delay = 0.0
	_warp_home = true
	_arrive_mode = Mode.ROUTINE
	_arrive()


# --- Behaviour -------------------------------------------------------------------------------

func _routine(delta: float) -> void:
	if activity == Activity.WALK and not route.is_empty():
		_walk_route(delta)
		return
	_base = home
	var facing := home_yaw
	# People who are only standing around turn to whoever they are talking to.
	var sociable := activity == Activity.IDLE or activity == Activity.DRINK or activity == Activity.SERVE or activity == Activity.WATCH
	var attentive := _yielding or (sociable and is_speaking()) or (activity == Activity.SERVE and _is_player_near(4.5))
	if attentive and _player.is_finite():
		var toward := _player - _base
		facing = atan2(-toward.x, -toward.z)
	_yaw = lerp_angle(_yaw, facing, 1.0 - exp(-TURN_SPEED * delta))


func _walk_route(delta: float) -> void:
	if _pause > 0.0:
		_pause -= delta
		return
	var target := route[route_index]
	var toward := target - _base
	var distance := toward.length()
	var heading := Vector3(toward.x, 0.0, toward.z).normalized()
	if _is_blocked(heading):
		return
	var step := WALK_SPEED * delta
	if distance <= step:
		_base = target
		_pause = route_pauses.get(route_index, 0.0)
		route_index = (route_index + 1) % route.size()
	else:
		_base += toward / distance * step
		_face(heading, delta)


## A walker waits for a player standing in its way, unless it has already stepped around them.
func _is_blocked(heading: Vector3) -> bool:
	if not _player.is_finite() or _aside.length() > 0.5:
		return false
	var offset := _player - _base
	if absf(offset.y) > 1.2:
		return false
	offset.y = 0.0
	return offset.length() < BLOCK_RANGE and heading.dot(offset.normalized()) > 0.3


func _begin_travel() -> void:
	if _path.is_empty():
		return
	if _warp_start:
		_base = _path.pop_front()
		_aside = Vector3.ZERO
		position = _base
		reset_physics_interpolation()
	mode = Mode.TRAVEL


func _travel(delta: float) -> void:
	if _path.is_empty():
		_arrive()
		return
	var target := _path[0]
	var toward := target - _base
	var distance := toward.length()
	var step := _travel_speed * delta
	if distance <= step:
		_base = target
		_path.pop_front()
	else:
		_base += toward / distance * step
		_face(toward, delta)


func _arrive() -> void:
	mode = _arrive_mode
	if mode != Mode.ROUTINE:
		return
	var walker := activity == Activity.WALK and not route.is_empty()
	if _warp_home:
		_warp_home = false
		route_index = 0
		_base = route[0] if walker else home
		_aside = Vector3.ZERO
		_yaw = home_yaw
		position = _base
		reset_physics_interpolation()
	if walker:
		_pause = 2.0


func _step_aside(delta: float) -> void:
	var target := Vector3.ZERO
	if _yields and aside_room > 0.0 and mode != Mode.TRAVEL and _player.is_finite():
		var offset := _base - _player
		var same_floor := absf(offset.y) < 1.2
		offset.y = 0.0
		var was_yielding := _yielding
		_yielding = same_floor and offset.length() < (YIELD_RELEASE if _yielding else YIELD_RANGE)
		if _yielding and not was_yielding:
			# Sidestep along the NPC's own left-right axis, to whichever side is away from the player.
			var right := Vector3(cos(_yaw), 0.0, -sin(_yaw))
			_aside_axis = right * (1.0 if right.dot(offset) >= 0.0 else -1.0)
		if _yielding:
			target = _aside_axis * aside_room
	else:
		_yielding = false
	_aside = _aside.lerp(target, 1.0 - exp(-6.0 * delta))


func _is_player_near(distance: float) -> bool:
	if not _player.is_finite():
		return false
	var offset := _player - _base
	return absf(offset.y) < 1.5 and Vector2(offset.x, offset.z).length() < distance


func _face(direction: Vector3, delta: float) -> void:
	if Vector2(direction.x, direction.z).length() > 0.01:
		_yaw = lerp_angle(_yaw, atan2(-direction.x, -direction.z), 1.0 - exp(-TURN_SPEED * delta))


# --- Animation -------------------------------------------------------------------------------

func _animate(delta: float) -> void:
	var jog := clampf((_speed - WALK_SPEED) / (JOG_SPEED - WALK_SPEED), 0.0, 1.0)
	_move_amount = lerpf(_move_amount, clampf(_speed / WALK_SPEED, 0.0, 1.0), 1.0 - exp(-10.0 * delta))
	_stride = fmod(_stride + delta * TAU * lerpf(0.95, 1.6, jog) * _move_amount, TAU)

	# The activity only plays while the NPC is in place, not while it steps aside or travels.
	var settled := mode == Mode.ROUTINE and _travel_delay <= 0.0 and _aside.length() < 0.12
	var pose := CharacterModel.Pose.NONE
	var progress := Vector2.ONE
	if settled:
		match activity:
			Activity.CURL:
				var swing := 0.5 - 0.5 * cos(_time * 2.4)
				pose = CharacterModel.Pose.CURL
				progress = Vector2(swing, 1.0 - swing)
			Activity.LIFT:
				# Dumbbells raised overhead with straight arms.
				pose = CharacterModel.Pose.STRETCH
				progress = Vector2(0.3 + 0.7 * (0.5 - 0.5 * cos(_time * 2.0)), 0.0)
			Activity.SQUAT:
				pose = CharacterModel.Pose.SQUAT
				progress.x = 0.5 + 0.5 * cos(_time * 1.7)
			Activity.PUSHUP:
				pose = CharacterModel.Pose.PUSHUP
				progress.x = 0.5 + 0.5 * cos(_time * 2.3)
			Activity.STRETCH:
				pose = CharacterModel.Pose.STRETCH
				progress = Vector2(0.5 - 0.5 * cos(_time * 0.8), sin(_time * 0.4))
			Activity.DRINK:
				var sip := _tick_sip(delta, 1.9, Vector2(5.0, 11.0))
				if sip > 0.0:
					pose = CharacterModel.Pose.CURL
					progress = Vector2(0.0, sin(sip * PI))
			Activity.SERVE:
				# Shakes a shaker with both hands now and then.
				var shake := _tick_sip(delta, 1.5, Vector2(4.0, 8.0))
				if shake > 0.0:
					var height := 0.5 + 0.12 * sin(_time * 22.0)
					pose = CharacterModel.Pose.CURL
					progress = Vector2(height, height)
	model.pose = pose
	model.pose_progress = progress
	model.pose_offset = Vector3.ZERO
	for weight in _weights:
		weight.visible = mode == Mode.ROUTINE

	# The fight layer plays bag work, and arms-up cheering anywhere else.
	_cheer = maxf(_cheer - delta, 0.0)
	var boxing := settled and activity == Activity.BAG
	_fight.victory = 0.0 if boxing else 1.0
	if boxing:
		_tick_bag(delta)
	else:
		_fight.clear_strike()
		_punch_time = -1.0
	var layered := boxing or _cheer > 0.0
	model.fight_blend = move_toward(model.fight_blend, 1.0 if layered else 0.0, delta * 5.0)
	if model.fight_blend > 0.0:
		_fight.update(delta)

	var look := 0.0
	if _nod > 0.0:
		_nod = maxf(_nod - delta, 0.0)
		look = -0.6 * absf(sin(_nod / 0.7 * TAU))
	model.animate(delta, _stride, _move_amount, look, false)


## Runs a now-and-then gesture lasting `length` seconds with `gap` (min, max) seconds between.
## Returns its progress, 0 to 1, or 0 while waiting.
func _tick_sip(delta: float, length: float, gap: Vector2) -> float:
	if _sip_time < 0.0:
		_sip_wait -= delta
		if _sip_wait <= 0.0:
			_sip_time = 0.0
		return 0.0
	_sip_time += delta
	if _sip_time >= length:
		_sip_time = -1.0
		_sip_wait = randf_range(gap.x, gap.y)
		return 0.0
	return _sip_time / length


## Throws jabs, crosses and hooks at the bag, which swings with each one.
func _tick_bag(delta: float) -> void:
	if _punch_time < 0.0:
		_punch_wait -= delta
		if _punch_wait <= 0.0:
			_punch_kind = PUNCHES.pick_random()
			_punch_side = 0 if _punch_kind == Strike.JAB or _punch_kind == Strike.HOOK else 1
			_punch_time = 0.0
			_punch_landed = false
		return
	_punch_time += delta
	if _punch_time < PUNCH.x:
		_fight.set_strike(_punch_kind, _punch_side, _punch_time / PUNCH.x, 0.0)
		return
	if _punch_time < PUNCH.x + PUNCH.y:
		_fight.set_strike(_punch_kind, _punch_side, 1.0, (_punch_time - PUNCH.x) / PUNCH.y)
		return
	if not _punch_landed:
		_punch_landed = true
		var heavy := _punch_kind != Strike.JAB
		if bag != null:
			bag.nudge(-global_transform.basis.z, 1.0 if heavy else 0.55)
		# Heard from across the mats, quieter with distance.
		if _player.is_finite():
			var volume := 0.4 * clampf(1.0 - (_player - _base).length() / 14.0, 0.0, 1.0)
			if volume > 0.02:
				AudioManager.play_varied(&"hit_heavy" if heavy else &"hit_light", volume)
	var back := (_punch_time - PUNCH.x - PUNCH.y) / PUNCH.z
	if back >= 1.0:
		_punch_time = -1.0
		_fight.clear_strike()
		# Mostly combinations, with a breather now and then.
		_punch_wait = randf_range(0.05, 0.3) if randf() < 0.65 else randf_range(0.8, 1.6)
	else:
		_fight.set_strike(_punch_kind, _punch_side, 0.0, 1.0 - back)


func _tick_bubble(delta: float) -> void:
	if _bubble_left <= 0.0:
		return
	_bubble_left -= delta
	var alpha := clampf(_bubble_left / 0.3, 0.0, 1.0)
	bubble.modulate.a = alpha
	bubble.outline_modulate.a = alpha
	if _bubble_left <= 0.0:
		bubble.visible = false


## Hands out what the activity needs: dumbbells, a shaker, gloves.
func _equip() -> void:
	match activity:
		Activity.CURL, Activity.LIFT:
			var color := Color.from_hsv(randf(), 0.7, 0.9)
			for i in 2:
				_weights.append(GymProps.dumbbell(model.get_hand(i), Vector3.ZERO, 0.06, color))
		Activity.DRINK, Activity.SERVE, Activity.WALK:
			var hand := model.get_hand(1)
			Build.cyl(hand, 0.034, 0.13, Vector3(0.0, 0.0, -0.01), Build.mat(Color(0.9, 0.92, 0.96), 0.3), false, Vector3.ZERO, -1.0, 10)
			Build.cyl(hand, 0.036, 0.03, Vector3(0.0, 0.075, -0.01), Build.mat(Color.from_hsv(randf(), 0.6, 0.9), 0.4), false, Vector3.ZERO, -1.0, 10)
		Activity.BAG:
			var padding := Build.mat(Color(0.85, 0.15, 0.15), 0.5)
			for i in 2:
				FightGear.glove(model.get_hand(i), padding, Color(0.95, 0.95, 0.97))


## Body, hair and cut of the top for a regular, steady per name so everyone is recognisable.
## A spec may override any of it with a "look" dictionary (see CharacterRig.dress).
@warning_ignore("integer_division")
static func _look_of(regular: String, spec: Dictionary) -> Dictionary:
	var pick := absi(regular.hash())
	var female := FEMALE_NAMES.has(regular)
	var look := {"body": &"female" if female else &"male"}
	if female:
		look["hair"] = ["characters/hair_long", "characters/hair_buns", "characters/hair_buzzed_female"][pick % 3]
		look["top"] = [CharacterRig.Top.CROP, CharacterRig.Top.TANK, CharacterRig.Top.TEE][(pick / 3) % 3]
		look["shorts_len"] = 0.2 + 0.05 * ((pick / 9) % 3)
	else:
		look["hair"] = ["characters/hair_buzzed", "characters/hair_parted", ["characters/hair_buzzed", "characters/hair_beard"], ""][pick % 4]
		look["top"] = [CharacterRig.Top.TEE, CharacterRig.Top.TANK, CharacterRig.Top.TEE][(pick / 4) % 3]
		look["shorts_len"] = 0.24 + 0.05 * ((pick / 12) % 3)
	look.merge(spec.get("look", {}), true)
	return look
