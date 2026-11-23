class_name Beacon
extends Node3D
## Glowing waypoint beam visible from far away. Emits `reached` once when the player arrives,
## then fades out. The HUD reads `title`, `active` and `marker_height` for its screen marker.

signal reached

@export var title := "GYM"
@export var color := Color(1.0, 0.68, 0.16)
@export var beam_height := 110.0
@export var reach_radius := 12.0
@export var marker_height := 5.0

var active := true

var _time := 0.0
var _pulse: MeshInstance3D
var _gem: Node3D


func _ready() -> void:
	add_to_group(&"waypoint")
	# Animated every rendered frame, so there is nothing for physics interpolation to smooth.
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	var hot := Color(color.r * 1.7, color.g * 1.7, color.b * 1.7)
	_no_shadow(Build.cyl(self, 0.7, beam_height, Vector3(0.0, beam_height * 0.5, 0.0), _beam_material(hot, 0.95), false, Vector3.ZERO, 0.45))
	_no_shadow(Build.cyl(self, 2.0, beam_height, Vector3(0.0, beam_height * 0.5, 0.0), _beam_material(hot, 0.2), false, Vector3.ZERO, 1.4))

	var neon := Build.glow(color, 3.5)
	Build.ring(self, 2.6, 0.08, Vector3(0.0, 0.14, 0.0), neon)
	_pulse = Build.ring(self, 2.6, 0.04, Vector3(0.0, 0.14, 0.0), neon)

	_gem = Build.group(self, "Gem", Vector3(0.0, marker_height, 0.0))
	Build.cyl(_gem, 0.55, 0.75, Vector3(0.0, 0.375, 0.0), neon, false, Vector3.ZERO, 0.0, 4)
	Build.cyl(_gem, 0.55, 0.75, Vector3(0.0, -0.375, 0.0), neon, false, Vector3(180.0, 0.0, 0.0), 0.0, 4)
	var label := Build.text(self, title, Vector3(0.0, marker_height + 1.7, 0.0), 1.1, color, Vector3.ZERO, 1.6)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	Build.omni(self, Vector3(0.0, 2.0, 0.0), color, 2.5, 12.0)


func _process(delta: float) -> void:
	_time += delta
	_gem.rotation.y = _time * 1.5
	_gem.position.y = marker_height + sin(_time * 2.0) * 0.25
	var wave := fmod(_time * 0.6, 1.0)
	_pulse.scale = Vector3.ONE * (1.0 + wave * 1.2)
	_pulse.visible = wave < 0.9

	if not active:
		return
	var player := get_tree().get_first_node_in_group(&"player") as Node3D
	if player == null:
		return
	var offset := player.global_position - global_position
	if Vector2(offset.x, offset.z).length() < reach_radius:
		active = false
		reached.emit()
		var tween := create_tween()
		tween.tween_property(self, "scale", Vector3(0.01, 1.0, 0.01), 0.8).set_trans(Tween.TRANS_CUBIC)
		tween.tween_callback(hide)


func _beam_material(beam_color: Color, alpha: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.albedo_color = Color(beam_color.r, beam_color.g, beam_color.b, alpha)
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	# Distance fog would hide the beam from the far end of the street.
	material.disable_fog = true
	return material


func _no_shadow(mesh: MeshInstance3D) -> void:
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
