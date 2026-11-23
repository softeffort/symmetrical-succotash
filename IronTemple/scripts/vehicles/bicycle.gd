class_name Bicycle
extends CharacterBody3D
## Arcade bicycle. While ridden: W/S accelerate and brake, A/D steer, Shift sprints on stamina.
## The rider's body is carried along each physics tick; the player reads `get_seat_transform()`
## and `lean` to place the first-person view.

signal rider_changed(rider: Player)

## Where the rider may step off, tried in order (bike space).
const EXIT_OFFSETS: Array[Vector3] = [Vector3(-0.95, 0.0, 0.0), Vector3(0.95, 0.0, 0.0), Vector3(0.0, 0.0, 1.6), Vector3(0.0, 0.0, -1.6)]
const PARKED_LEAN := 0.11

@export_group("Speed")
@export var cruise_speed := 6.5
@export var boost_speed := 14.0
@export var reverse_speed := 2.0
@export var acceleration := 5.0
@export var boost_acceleration := 8.0
@export var brake_deceleration := 14.0
@export var rolling_drag := 1.4
@export var boost_stamina_cost := 5.0

@export_group("Handling")
## Turn rate in rad/s at low speed, easing to `fast_turn_rate` at boost speed.
@export var turn_rate := 1.9
@export var fast_turn_rate := 1.1
@export var steer_response := 7.0
@export var max_lean_degrees := 16.0
@export var gravity := 20.0

var rider: Player = null
var speed := 0.0
## Smoothed steering input, -1 (left) to 1 (right).
var steer := 0.0
## Roll in radians applied to the model; negative leans right.
var lean := PARKED_LEAN
var is_boosting := false
var dismount_text := "Dismount"

@onready var model: BicycleModel = $Model
@onready var interactable: Interactable = $Interactable


func _ready() -> void:
	interactable.interacted.connect(mount)


func mount(player: Player) -> void:
	if rider != null:
		return
	rider = player
	interactable.enabled = false
	player.enter_vehicle(self)
	rider_changed.emit(rider)


func dismount() -> void:
	if rider == null:
		return
	var player := rider
	rider = null
	is_boosting = false
	interactable.enabled = true
	player.exit_vehicle(_find_exit_spot(player))
	rider_changed.emit(null)


## Eye-level frame for the rider: upright bike orientation at the (leaning) seat anchor.
func get_seat_transform() -> Transform3D:
	var anchor := model.rider_anchor.get_global_transform_interpolated().origin
	return Transform3D(get_global_transform_interpolated().basis, anchor)


func _physics_process(delta: float) -> void:
	var throttle := 0.0
	var steer_input := 0.0
	var wants_boost := false
	if rider != null and rider.controls_enabled:
		throttle = Input.get_axis(&"move_back", &"move_forward")
		steer_input = Input.get_axis(&"move_left", &"move_right")
		wants_boost = Input.is_action_pressed(&"sprint")

	_update_speed(delta, throttle, wants_boost)
	_update_steering(delta, steer_input)

	var forward := -global_transform.basis.z
	var fall := 0.0 if is_on_floor() else velocity.y - gravity * delta
	velocity = forward * speed + Vector3.UP * fall
	move_and_slide()
	if is_on_wall():
		# Scrub the speed lost to the obstacle instead of grinding against it.
		speed = Vector3(velocity.x, 0.0, velocity.z).dot(forward)

	if rider != null:
		rider.global_transform = global_transform
	var bar_angle := -steer * deg_to_rad(lerpf(32.0, 9.0, clampf(absf(speed) / boost_speed, 0.0, 1.0)))
	model.animate(delta, speed, bar_angle, lean, throttle > 0.0)


func _update_speed(delta: float, throttle: float, wants_boost: bool) -> void:
	is_boosting = throttle > 0.0 and wants_boost and PlayerStats.spend_stamina(boost_stamina_cost * delta)
	if throttle > 0.0:
		var top := boost_speed if is_boosting else cruise_speed
		if speed <= top:
			speed = minf(speed + (boost_acceleration if is_boosting else acceleration) * delta, top)
		else:
			speed = maxf(speed - rolling_drag * 2.0 * delta, top)
	elif throttle < 0.0:
		if speed > 0.1:
			speed = maxf(speed - brake_deceleration * delta, 0.0)
		else:
			speed = maxf(speed - acceleration * 0.6 * delta, -reverse_speed)
	else:
		speed = move_toward(speed, 0.0, rolling_drag * delta)


func _update_steering(delta: float, steer_input: float) -> void:
	steer = lerpf(steer, steer_input, 1.0 - exp(-steer_response * delta))
	var pace := clampf(absf(speed) / boost_speed, 0.0, 1.0)
	# A bike has to roll to turn: no spinning on the spot.
	var rate := lerpf(turn_rate, fast_turn_rate, pace) * clampf(absf(speed) / 2.5, 0.0, 1.0)
	rotate_y(-steer * rate * signf(speed) * delta)

	var target_lean := -steer * deg_to_rad(max_lean_degrees) * clampf(absf(speed) / cruise_speed, 0.0, 1.0)
	if rider == null and absf(speed) < 0.3:
		target_lean = PARKED_LEAN
	lean = lerpf(lean, target_lean, 1.0 - exp(-6.0 * delta))


func _find_exit_spot(player: Player) -> Vector3:
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = player.collision_shape.shape
	query.collision_mask = 1
	var space := get_world_3d().direct_space_state
	var lift := player.collision_shape.position + Vector3.UP * 0.1
	for offset in EXIT_OFFSETS:
		var spot := global_transform * offset
		query.transform = Transform3D(Basis.IDENTITY, spot + lift)
		if space.intersect_shape(query, 1).is_empty():
			return spot
	return global_transform * EXIT_OFFSETS[0]
