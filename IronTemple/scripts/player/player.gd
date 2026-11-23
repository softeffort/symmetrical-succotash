class_name Player
extends CharacterBody3D
## First-person controller: walking, sprinting, jumping, mouse look, interaction, riding,
## using workout stations and, through its CombatController, fighting.
##
## The body moves on the physics tick. `Head` is top-level with physics interpolation off: every
## rendered frame it follows the body's interpolated position (or a vehicle seat, or a station's
## view) and takes mouse rotation directly, which keeps the view smooth at any refresh rate.

signal interact_prompt_changed(text: String)
signal vehicle_changed(vehicle: Bicycle)
signal station_changed(station: WorkoutStation)
## Esc on foot or on the bike: the HUD opens the pause menu.
signal pause_requested

const RIDE_PITCH := -0.14
const VIEW_BLEND_TIME := 0.35
const DISMOUNT_PROMPT_SPEED := 2.5
## How far the head can turn (yaw, pitch) while seated at a station.
const STATION_LOOK_LIMIT := Vector2(0.9, 0.6)
## Standing this still counts as resting.
const REST_SPEED := 0.6
## View punch spring: stiffness, and the impulse that makes a punch peak at its given angle.
const PUNCH_STIFFNESS := 220.0
const PUNCH_IMPULSE := 40.0
## How far the eyes sink and roll when knocked out.
const KNOCKDOWN_DROP := 1.3
const KNOCKDOWN_ROLL := 0.55
## How far the eyes drop for a body shot or behind the body guard.
const CROUCH_DROP := 0.16
## Rocked: how far the view rolls and swims (radians) while the legs are gone.
const ROCKED_ROLL := 0.075
const ROCKED_DRIFT := Vector2(0.035, 0.05)
## Clinched: how fast the view is dragged onto the opponent, where it is held and the zoom.
const CLINCH_TURN := 12.0
const CLINCH_AIM_HEIGHT := 1.6
const CLINCH_ZOOM := 9.0
## The arms steam from this share of a full pump, and on pre-workout.
const AURA_PUMP := 0.92
const PUMP_AURA := Color(1.7, 0.6, 1.5)
const PREWORKOUT_AURA := Color(1.0, 0.75, 2.2)

@export_group("Movement")
@export var walk_speed := 4.2
@export var sprint_speed := 7.2
@export var ground_acceleration := 10.0
@export var air_acceleration := 2.5
@export var jump_velocity := 5.8
@export var gravity := 16.0
@export var sprint_stamina_cost := 18.0

@export_group("View")
@export var mouse_sensitivity := 0.0022
@export var eye_height := 1.78
@export var base_fov := 80.0
@export var speed_fov_boost := 7.0
## Share of the bike's lean that rolls the camera.
@export_range(0.0, 1.0) var ride_camera_lean := 0.6

## The bicycle currently ridden, or null.
var vehicle: Bicycle = null
## The workout station currently in use, or null.
var station: WorkoutStation = null
## Set false to freeze input (cutscenes).
var controls_enabled := true
var is_sprinting := false

var _yaw := 0.0
var _pitch := 0.0
var _ride_look := 0.0
var _station_look := Vector2.ZERO
var _stride := 0.0
var _move_amount := 0.0
var _sprint_amount := 0.0
var _camera_roll := 0.0
var _shake := 0.0
var _punch := Vector2.ZERO
var _punch_velocity := Vector2.ZERO
# A rattle along one line (pitch, yaw), for intercept counters.
var _rattle := Vector2.ZERO
var _rattle_time := 0.0
var _daze_time := 0.0
var _prompt := ""
var _focus: Interactable = null
var _view_blend := 1.0
var _view_from := Transform3D.IDENTITY
var _pump_step := -1
var _gym: Gym = null
var _body_gear := CharacterRig.Hands.BARE

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D
@onready var arms: PlayerArms = $Head/Camera3D/Arms
@onready var interact_ray: RayCast3D = $Head/Camera3D/InteractRay
@onready var model: CharacterModel = $Model
@onready var collision_shape: CollisionShape3D = $CollisionShape3D
@onready var combat: CombatController = $Combat


func _ready() -> void:
	add_to_group(&"player")
	_yaw = rotation.y
	interact_ray.add_exception(self)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	PlayerStats.muscle_changed.connect(_apply_physique)
	PlayerStats.pump_changed.connect(_on_pump_changed)
	PlayerStats.injured.connect(_on_injured)
	# The mirror body wears what the first-person hands wear (see `_update_gear`).
	model.look["hands"] = CharacterRig.Hands.BARE
	combat.bind(self)
	_apply_physique()
	head.global_transform = Transform3D(Basis.from_euler(Vector3(_pitch, _yaw, 0.0)), global_position + Vector3.UP * eye_height)


func _unhandled_input(event: InputEvent) -> void:
	var captured := Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	if event is InputEventMouseMotion and captured:
		_look((event as InputEventMouseMotion).screen_relative)
	elif event is InputEventMouseButton and event.is_pressed() and not captured:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif station != null:
		if event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"interact"):
			station.request_exit()
		else:
			station.handle_input(event)
	elif event.is_action_pressed(&"ui_cancel"):
		if combat.in_bout:
			# No pausing mid-fight: Esc only frees the mouse, a click takes it back.
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		else:
			get_viewport().set_input_as_handled()
			pause_requested.emit()
	elif event.is_action_pressed(&"interact"):
		_interact()
	elif combat.stance:
		combat.handle_input(event)


func _physics_process(delta: float) -> void:
	if station != null:
		model.animate(delta, station.gait_phase, station.gait_move, 0.0, false)
	elif vehicle != null:
		# The bicycle carries this body; see Bicycle._physics_process.
		model.animate(delta, _stride, 0.0, _pitch, true, vehicle.model.pedal_phase, vehicle.lean)
	else:
		_move_on_foot(delta)
		combat.pose_body(delta, _stride, _move_amount)
		model.animate(delta, _stride, _move_amount, _pitch, false)
	_report_activity()
	_update_focus()


func _process(delta: float) -> void:
	var on_foot := vehicle == null and station == null
	var speed := Vector2(velocity.x, velocity.z).length() if on_foot else 0.0
	var grounded := on_foot and is_on_floor()
	_move_amount = lerpf(_move_amount, clampf(speed / walk_speed, 0.0, 1.0) if grounded else 0.0, 1.0 - exp(-10.0 * delta))
	_sprint_amount = lerpf(_sprint_amount, 1.0 if is_sprinting and grounded else 0.0, 1.0 - exp(-8.0 * delta))
	_stride = fmod(_stride + delta * TAU * lerpf(0.95, 1.4, _sprint_amount) * _move_amount, TAU)

	var torso := Transform3D.IDENTITY
	var view: Transform3D
	var roll := 0.0
	var fast := _sprint_amount
	if station != null:
		# The station owns the view and the gait; the mouse only turns the head.
		torso = station.get_torso_transform()
		var base := station.get_view_transform()
		view = Transform3D(base.basis * Basis.from_euler(Vector3(_station_look.y, _station_look.x, 0.0)), base.origin)
		_stride = station.gait_phase
		_move_amount = station.gait_move
		_sprint_amount = station.gait_sprint
		fast = 0.0
	elif vehicle != null:
		torso = vehicle.get_seat_transform()
		view = Transform3D(torso.basis * Basis.from_euler(Vector3(_pitch, _ride_look, 0.0)), torso.origin)
		roll = vehicle.lean * ride_camera_lean
		fast = clampf((vehicle.speed - vehicle.cruise_speed) / (vehicle.boost_speed - vehicle.cruise_speed), 0.0, 1.0)
	else:
		_follow_clinch(delta)
		var look := Basis.from_euler(Vector3(_pitch, _yaw, 0.0))
		var bob := Vector3.UP * sin(_stride * 2.0) * 0.032 + look.x * cos(_stride) * 0.018
		# A slip tilts the view, a body shot dips it, being rocked makes it swim and a knockdown
		# drops it to the canvas.
		var down := smoothstep(0.0, 1.0, combat.view_drop)
		_daze_time += delta
		roll = combat.view_roll + KNOCKDOWN_ROLL * down + sin(_daze_time * 3.1) * ROCKED_ROLL * combat.view_wobble
		var eyes := eye_height - KNOCKDOWN_DROP * down - CROUCH_DROP * combat.view_crouch
		view = Transform3D(look, get_global_transform_interpolated().origin + Vector3.UP * eyes + bob * _move_amount)

	# Ease the view when mounting, dismounting or changing station.
	if _view_blend < 1.0:
		_view_blend = minf(_view_blend + delta / VIEW_BLEND_TIME, 1.0)
		view = _view_from.interpolate_with(view, smoothstep(0.0, 1.0, _view_blend))
	head.global_transform = view

	_camera_roll = lerpf(_camera_roll, roll, 1.0 - exp(-(20.0 if combat.stance else 8.0) * delta))
	_shake = move_toward(_shake, 0.0, delta * 1.6)
	var jolt := _shake * _shake * 0.06
	# The punch offset springs back to centre, critically damped.
	_punch_velocity += (-_punch * PUNCH_STIFFNESS - _punch_velocity * 2.0 * sqrt(PUNCH_STIFFNESS)) * delta
	_punch += _punch_velocity * delta
	# The rattle rings along its line and dies in a fifth of a second; the daze drifts slowly.
	_rattle_time += delta
	var ring := _rattle * sin(_rattle_time * 75.0) * exp(-_rattle_time * 16.0)
	var daze := Vector2(sin(_daze_time * 2.3), sin(_daze_time * 1.7 + 1.0)) * ROCKED_DRIFT * combat.view_wobble
	camera.rotation = Vector3(_punch.x + ring.x + daze.x + randf_range(-jolt, jolt), _punch.y + ring.y + daze.y + randf_range(-jolt, jolt), _camera_roll + randf_range(-jolt, jolt))
	var zoom := CLINCH_ZOOM if combat.clinch != null else 0.0
	camera.fov = lerpf(camera.fov, base_fov + speed_fov_boost * fast - zoom, 1.0 - exp(-6.0 * delta))
	var preworkout := PlayerStats.has_preworkout()
	arms.set_aura(preworkout or PlayerStats.pump_level >= PlayerStats.PUMP_MAX * AURA_PUMP, PREWORKOUT_AURA if preworkout else PUMP_AURA)
	_update_gear()
	arms.animate(delta, _stride, _move_amount, _sprint_amount, on_foot and not is_on_floor(), torso)


## Shakes the camera; `amount` 1 is a hard jolt.
func add_shake(amount: float) -> void:
	_shake = maxf(_shake, amount)


## Knocks the view by about (pitch, yaw) radians in one direction; it springs straight back.
func add_view_punch(kick: Vector2) -> void:
	_punch_velocity += kick * PUNCH_IMPULSE


## Rattles the view back and forth along `direction` (pitch, yaw) by up to `strength` radians:
## the shake of a blow that landed flush.
func add_directional_shake(direction: Vector2, strength: float) -> void:
	_rattle = direction.normalized() * strength
	_rattle_time = 0.0


## Shoves the fighter along the floor (a push kick landing).
func apply_impulse(push: Vector3) -> void:
	velocity.x += push.x
	velocity.z += push.z


## Stands the fighter at `spot`, facing its -Z (ring corners, leaving the cage). `instant` cuts
## the view there instead of easing it.
func place_at(spot: Transform3D, instant: bool = false) -> void:
	if instant:
		_view_blend = 1.0
	else:
		_begin_view_blend()
	_yaw = spot.basis.get_euler().y
	_pitch = 0.0
	_stand_at(Transform3D(Basis(Vector3.UP, _yaw), spot.origin))


## Called by a vehicle when the player mounts it.
func enter_vehicle(target: Bicycle) -> void:
	_begin_view_blend()
	vehicle = target
	velocity = Vector3.ZERO
	is_sprinting = false
	collision_shape.set_deferred(&"disabled", true)
	_ride_look = 0.0
	_pitch = RIDE_PITCH
	arms.set_grips(target.model.grip_left, target.model.grip_right)
	global_transform = target.global_transform
	reset_physics_interpolation()
	vehicle_changed.emit(vehicle)


## Called by the vehicle on dismount with the spot to stand on.
func exit_vehicle(exit_position: Vector3) -> void:
	_begin_view_blend()
	_yaw = wrapf(vehicle.global_rotation.y + _ride_look, -PI, PI)
	vehicle = null
	_stand_at(Transform3D(Basis(Vector3.UP, _yaw), exit_position))
	arms.set_grips(null, null)
	vehicle_changed.emit(null)


## Called by a workout station when the player starts using it.
func enter_station(target: WorkoutStation) -> void:
	_begin_view_blend()
	station = target
	velocity = Vector3.ZERO
	is_sprinting = false
	collision_shape.set_deferred(&"disabled", true)
	_station_look = Vector2.ZERO
	global_transform = target.get_body_transform()
	reset_physics_interpolation()
	station_changed.emit(station)


## Called by the station when the session ends, with where to stand and face.
func exit_station(exit: Transform3D) -> void:
	_begin_view_blend()
	station = null
	_yaw = exit.basis.get_euler().y
	_pitch = 0.0
	_stand_at(Transform3D(Basis(Vector3.UP, _yaw), exit.origin))
	station_changed.emit(null)


func _look(relative: Vector2) -> void:
	relative *= SaveManager.get_mouse_sensitivity()
	if station != null:
		_station_look.x = clampf(_station_look.x - relative.x * mouse_sensitivity, -STATION_LOOK_LIMIT.x, STATION_LOOK_LIMIT.x)
		_station_look.y = clampf(_station_look.y - relative.y * mouse_sensitivity, -STATION_LOOK_LIMIT.y, STATION_LOOK_LIMIT.y)
		return
	if combat.clinch != null:
		# Held chest to chest: the view belongs to the clinch until it breaks.
		return
	_pitch = clampf(_pitch - relative.y * mouse_sensitivity, -1.45, 1.45)
	if vehicle != null:
		_ride_look = clampf(_ride_look - relative.x * mouse_sensitivity, -1.9, 1.9)
	else:
		_yaw = wrapf(_yaw - relative.x * mouse_sensitivity, -PI, PI)
	arms.add_sway(relative)


func _move_on_foot(delta: float) -> void:
	rotation = Vector3(0.0, _yaw, 0.0)
	var input := Vector2.ZERO
	var wants_sprint := false
	var wants_jump := false
	# In the fight stance Shift blocks and Space slips, so there is no sprinting or jumping.
	var fighting := combat.stance
	if controls_enabled:
		input = Input.get_vector(&"move_left", &"move_right", &"move_forward", &"move_back")
		wants_sprint = not fighting and Input.is_action_pressed(&"sprint") and input.y < -0.1
		wants_jump = not fighting and Input.is_action_just_pressed(&"jump")

	# Sprinting only costs stamina while actually covering ground.
	var moving := Vector2(velocity.x, velocity.z).length() > 1.0
	is_sprinting = wants_sprint and (not moving or PlayerStats.spend_stamina(sprint_stamina_cost * delta))
	var target := transform.basis * Vector3(input.x, 0.0, input.y) * (sprint_speed if is_sprinting else walk_speed) * combat.get_move_factor()
	var acceleration := ground_acceleration if is_on_floor() else air_acceleration
	var planar := Vector3(velocity.x, 0.0, velocity.z).lerp(target, 1.0 - exp(-acceleration * delta))
	if combat.is_dashing():
		planar = combat.dash_velocity
	velocity.x = planar.x
	velocity.z = planar.z

	if not is_on_floor():
		velocity.y -= gravity * delta
	elif wants_jump:
		velocity.y = jump_velocity
	move_and_slide()


func _interact() -> void:
	if not controls_enabled:
		return
	if vehicle != null:
		vehicle.dismount()
	elif _focus != null:
		_focus.interact(self)


func _update_focus() -> void:
	var prompt := ""
	_focus = null
	if station != null:
		pass  # the workout overlay shows the station's own controls
	elif vehicle != null:
		# Only offered at walking pace, so the prompt stays out of the way while riding.
		if absf(vehicle.speed) < DISMOUNT_PROMPT_SPEED:
			prompt = vehicle.dismount_text
	elif controls_enabled and interact_ray.is_colliding():
		_focus = Interactable.find_for(interact_ray.get_collider())
		if _focus != null:
			prompt = _focus.action_text
	if prompt != _prompt:
		_prompt = prompt
		interact_prompt_changed.emit(prompt)


## Tells PlayerStats whether the fighter is resting (heals strains faster) or training.
func _report_activity() -> void:
	if station != null:
		PlayerStats.training = true
		PlayerStats.resting = station.is_restful()
	else:
		# Bag work and bouts count as training; a bout is never rest.
		PlayerStats.training = combat.is_working()
		PlayerStats.resting = vehicle == null and not combat.in_bout and is_on_floor() and Vector2(velocity.x, velocity.z).length() < REST_SPEED


func _stand_at(spot: Transform3D) -> void:
	global_transform = spot
	velocity = Vector3.ZERO
	reset_physics_interpolation()
	collision_shape.set_deferred(&"disabled", false)


func _begin_view_blend() -> void:
	_view_from = head.global_transform
	_view_blend = 0.0


## While an opponent holds a clinch the view is dragged onto them and locked there.
func _follow_clinch(delta: float) -> void:
	var holder := combat.clinch
	if holder == null or not is_instance_valid(holder):
		return
	var aim := holder.global_position + Vector3.UP * CLINCH_AIM_HEIGHT - (global_position + Vector3.UP * eye_height)
	var weight := 1.0 - exp(-CLINCH_TURN * delta)
	_yaw = lerp_angle(_yaw, atan2(-aim.x, -aim.z), weight)
	_pitch = lerpf(_pitch, clampf(atan2(aim.y, Vector2(aim.x, aim.z).length()), -0.5, 0.3), weight)


func _apply_physique() -> void:
	var pump := PlayerStats.pump_level / PlayerStats.PUMP_MAX
	arms.set_physique(PlayerStats.get_muscle_visual(&"arms"), pump, PlayerStats.get_muscle_visual(&"legs"))
	model.set_physique(PlayerStats.get_muscle_visual(&"arms"), PlayerStats.get_muscle_visual(&"torso"), PlayerStats.get_muscle_visual(&"legs"), pump)


func _on_pump_changed(pump_level: float) -> void:
	# The swell is subtle, so only rebuild the arms when it moves a visible step.
	var step := roundi(pump_level / PlayerStats.PUMP_MAX * 20.0)
	if step != _pump_step:
		_pump_step = step
		_apply_physique()


func _on_injured(_duration: float) -> void:
	add_shake(1.0)


## What the hands wear follows the place: athletic wrist wraps in the weight room, MMA gloves
## on the fight floor (and in any fight), bare everywhere else. The body in the mirror matches.
func _update_gear() -> void:
	if _gym == null:
		_gym = get_tree().get_first_node_in_group(&"gym") as Gym
	var gear := CharacterRig.Hands.BARE
	match _gym.storey_at(global_position) if _gym != null else -1:
		0:
			gear = CharacterRig.Hands.WRIST_WRAPS
		1:
			gear = CharacterRig.Hands.GLOVES
	arms.set_gear(gear)
	var worn := arms.get_gear() as CharacterRig.Hands
	if worn != _body_gear:
		_body_gear = worn
		model.set_hand_gear(worn, arms.glove_color, arms.glove_trim_color)
