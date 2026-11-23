class_name Mirror
extends Node3D
## Planar mirror. A SubViewport camera sits at the viewer's reflected position and uses an
## off-axis frustum clipped to the glass, so its image maps 1:1 onto the quad with correct
## perspective. The reflective side faces local +Z. Mirror cameras see render layer 3 (the
## player's body) but not layer 2 (first-person arms).

const SURFACE_SHADER := """
shader_type spatial;
render_mode unshaded;
uniform sampler2D reflection : source_color, filter_linear, repeat_disable;
uniform vec3 tint : source_color = vec3(0.93, 0.97, 1.0);

void fragment() {
	// The reflection camera looks back at the viewer, so its image is flipped horizontally.
	ALBEDO = texture(reflection, vec2(1.0 - UV.x, UV.y)).rgb * tint;
}
"""

## Width and height of the glass in metres.
@export var size := Vector2(10.0, 3.0)
@export var pixels_per_meter := 128.0
## The reflection only renders while the viewer is in front of the glass and this close.
@export var active_distance := 30.0
@export var frame_color := Color(0.13, 0.14, 0.17)
## Shows the player's level, rank and tenure above their reflection.
@export var show_name_tag := true
## Height above the player's feet the tag appears to float at, and its letter height there.
@export var name_tag_height := 2.3
@export var name_tag_letter_height := 0.22

@onready var viewport: SubViewport = $SubViewport
@onready var mirror_camera: Camera3D = $SubViewport/MirrorCamera
@onready var surface: MeshInstance3D = $Surface
@onready var name_tag: Label3D = $NameTag


func _ready() -> void:
	# Run after the player has moved the view camera this frame.
	process_priority = 100
	viewport.size = Vector2i(size * pixels_per_meter)
	PlayerStats.rank_changed.connect(_refresh_name_tag.unbind(1))
	PlayerStats.level_up.connect(_refresh_name_tag.unbind(1))
	PlayerStats.tenure_changed.connect(_refresh_name_tag.unbind(1))
	_refresh_name_tag()

	var quad := QuadMesh.new()
	quad.size = size
	surface.mesh = quad
	var shader := Shader.new()
	shader.code = SURFACE_SHADER
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("reflection", viewport.get_texture())
	surface.material_override = material
	# The glass is tone mapped by the main view, so the reflection itself must stay linear.
	var world_environment := get_world_3d().environment
	if world_environment != null:
		var environment := world_environment.duplicate() as Environment
		environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
		environment.adjustment_enabled = false
		environment.glow_enabled = false
		environment.ssao_enabled = false
		mirror_camera.environment = environment
	_build_frame()


func _process(_delta: float) -> void:
	var view := get_viewport().get_camera_3d()
	if view == null:
		return
	var eye := to_local(view.global_position)
	var active := is_visible_in_tree() and _is_seen(view, eye)
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS if active else SubViewport.UPDATE_DISABLED
	name_tag.visible = false
	if not active:
		return
	# Reflect the eye through the glass and look back out through it. The near plane lies on the
	# glass, so nothing behind the mirror is drawn.
	mirror_camera.global_transform = global_transform * Transform3D(Basis(Vector3.UP, PI), Vector3(eye.x, eye.y, -eye.z))
	mirror_camera.set_frustum(size.y, Vector2(eye.x, -eye.y), eye.z, eye.z + 150.0)
	_place_name_tag(eye)


## Shows the player's rank where a tag floating above their head would appear in the reflection.
## The label sits on the sight line to that mirrored point, scaled to match, a little in front
## of the glass: it reads the right way round and stays sharp, which text inside the mirrored
## image would not.
func _place_name_tag(eye: Vector3) -> void:
	var player := get_tree().get_first_node_in_group(&"player") as Node3D
	if not show_name_tag or player == null:
		return
	var head := to_local(player.get_global_transform_interpolated().origin + Vector3.UP * name_tag_height)
	if head.z < 0.05:
		return
	var ray := Vector3(head.x, head.y, -head.z) - eye
	var on_glass := eye + ray * (eye.z / (eye.z + head.z))
	if absf(on_glass.x) > size.x * 0.5 - 0.4 or absf(on_glass.y) > size.y * 0.5 - 0.1:
		return
	# The label faces the viewer, so seen at an angle it needs room to clear the glass.
	var slant := Vector2(ray.x, ray.y).length() / ray.length()
	var half_width := name_tag.text.length() * name_tag_letter_height * 0.11
	var depth := minf(half_width * slant + 0.02, eye.z * 0.5)
	var share := (eye.z - depth) / (eye.z + head.z)
	name_tag.position = eye + ray * share
	name_tag.pixel_size = name_tag_letter_height / name_tag.font_size * share
	name_tag.visible = true


## "LVL 7 | Shredded Prospect | 14 Days", the same tag opponents carry over their heads.
func _refresh_name_tag() -> void:
	name_tag.text = PlayerStats.get_overhead_tag()


## True while the viewer is in front of the glass on the same storey and some of it is on screen.
func _is_seen(view: Camera3D, eye: Vector3) -> bool:
	if eye.z < 0.02 or eye.z > active_distance or absf(eye.y) > size.y * 0.5 + 2.5:
		return false
	var half := size * 0.5
	if eye.z < 4.0 and absf(eye.x) < half.x + 2.0:
		# Too close for the sample points below to be reliable: use the view direction.
		return (global_transform.basis.inverse() * view.global_transform.basis.z).z > -0.3
	for column in 7:
		for row in 3:
			var point := Vector3(lerpf(-half.x, half.x, column / 6.0), lerpf(-half.y, half.y, row / 2.0), 0.0)
			if view.is_position_in_frustum(to_global(point)):
				return true
	return false


func _build_frame() -> void:
	var frame := Build.mat(frame_color, 0.5, 0.3)
	var border := 0.12
	for side: float in [-1.0, 1.0]:
		Build.box(self, Vector3(size.x + border * 2.0, border, 0.08), Vector3(0.0, side * (size.y + border) * 0.5, 0.0), frame)
		Build.box(self, Vector3(border, size.y, 0.08), Vector3(side * (size.x + border) * 0.5, 0.0, 0.0), frame)
	# Seams between the glass panels of a mirror wall.
	var panels := maxi(roundi(size.x / 2.0), 1)
	for i in range(1, panels):
		Build.box(self, Vector3(0.016, size.y, 0.006), Vector3(-size.x * 0.5 + size.x * i / panels, 0.0, 0.002), frame)
