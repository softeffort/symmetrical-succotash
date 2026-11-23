class_name WorkoutStation
extends Node3D
## Base class for usable gym equipment. Interacting seats the player here: the camera eases to
## the station's view, input goes to the station, and `E` or `Esc` hands control back.
##
## Subclasses override `_begin`, `_end`, `_tick`, `_view`, `_torso`, `handle_input` and
## `request_exit`. Positions are in station space: the origin is on the floor and local +Z is
## the side the athlete walks up from. The station ticks on the physics step; the view is
## interpolated for rendering.

signal started(player: Player)
signal finished(player: Player)

const EYE_HEIGHT := 1.78

@export var title := "Station"
## Identifier for game logic, e.g. &"bench_press".
@export var station_type: StringName = &"generic"
@export var collider_size := Vector3.ONE
## Height of the collider's underside above the station origin.
@export var collider_lift := 0.0
@export_flags_3d_physics var collider_layer := 1

## Where the athlete's feet are while using the station, and which way they face (0 = local -Z).
var body_position := Vector3.ZERO
var body_yaw := 0.0
## Where the athlete steps off to.
var exit_position := Vector3(0.0, 0.0, 1.4)
var user: Player = null
var overlay: WorkoutOverlay = null
var reps := 0
## Walk cycle driven by the station (treadmill); the player rig reads these while seated.
var gait_phase := 0.0
var gait_move := 0.0
var gait_sprint := 0.0

var _interactable: Interactable
var _view_from := Transform3D.IDENTITY
var _view_to := Transform3D.IDENTITY
var _torso_from := Transform3D.IDENTITY
var _torso_to := Transform3D.IDENTITY


func _ready() -> void:
	add_to_group(&"gym_stations")
	var body := Build.blocker(self, collider_size, Vector3(0.0, collider_lift + collider_size.y * 0.5, 0.0))
	body.name = "Body"
	body.collision_layer = collider_layer
	_interactable = Interactable.new()
	_interactable.name = "Interactable"
	_interactable.action_text = title
	body.add_child(_interactable)
	_interactable.interacted.connect(_on_interacted)
	set_physics_process(false)
	_build()


func _physics_process(delta: float) -> void:
	_view_from = _view_to
	_torso_from = _torso_to
	_tick(delta)
	if user == null:
		return  # the tick ended the session
	_view_to = global_transform * _view()
	_torso_to = global_transform * _torso()


## Eye transform for this rendered frame, in world space.
func get_view_transform() -> Transform3D:
	return _view_from.interpolate_with(_view_to, Engine.get_physics_interpolation_fraction())


## Frame the first-person shoulders hang from, in world space.
func get_torso_transform() -> Transform3D:
	return _torso_from.interpolate_with(_torso_to, Engine.get_physics_interpolation_fraction())


func get_body_transform() -> Transform3D:
	return global_transform * Transform3D(Basis(Vector3.UP, body_yaw), body_position)


func get_exit_transform() -> Transform3D:
	return global_transform * Transform3D(Basis(Vector3.UP, body_yaw), exit_position)


## Hands control back to the player.
func leave() -> void:
	if user == null:
		return
	var athlete := user
	_end()
	user = null
	set_physics_process(false)
	if overlay != null:
		overlay.close()
		overlay = null
	athlete.model.pose = CharacterModel.Pose.NONE
	athlete.arms.set_grips(null, null)
	_interactable.enabled = true
	athlete.exit_station(get_exit_transform())
	finished.emit(athlete)
	# Every session is banked the moment it ends.
	SaveManager.save_game()


## Called when the player presses E or Esc. Stations with a loaded bar put it down first.
func request_exit() -> void:
	leave()


## Receives the player's unhandled input events while seated.
func handle_input(_event: InputEvent) -> void:
	pass


## True while the athlete is recovering here (doubles injury recovery).
func is_restful() -> bool:
	return false


## Creates the station's own moving parts. Runs once, before any static dressing is added.
func _build() -> void:
	pass


func _begin() -> void:
	pass


func _end() -> void:
	pass


func _tick(_delta: float) -> void:
	pass


## Eye transform in station space.
func _view() -> Transform3D:
	return eye_frame(body_position + Vector3.UP * EYE_HEIGHT, Vector3(0.0, 0.0, -1.0).rotated(Vector3.UP, body_yaw))


## Shoulder frame in station space: upright at the eye unless overridden.
func _torso() -> Transform3D:
	return Transform3D(Basis(Vector3.UP, body_yaw), _view().origin)


func popup(text: String, kind: StringName = &"gain") -> void:
	PlayerStats.popup_requested.emit(text, kind)


static func eye_frame(eye: Vector3, look: Vector3, up: Vector3 = Vector3.UP) -> Transform3D:
	return Transform3D(Basis.looking_at(look, up), eye)


static func set_render_layers(root: Node, layers: int) -> void:
	for mesh: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		mesh.layers = layers


func _on_interacted(player: Node) -> void:
	var athlete := player as Player
	if athlete == null or user != null or athlete.station != null:
		return
	user = athlete
	reps = 0
	_interactable.enabled = false
	overlay = get_tree().get_first_node_in_group(&"workout_overlay") as WorkoutOverlay
	if overlay != null:
		overlay.open(title)
	_begin()
	_view_to = global_transform * _view()
	_torso_to = global_transform * _torso()
	_view_from = _view_to
	_torso_from = _torso_to
	athlete.enter_station(self)
	set_physics_process(true)
	started.emit(athlete)
