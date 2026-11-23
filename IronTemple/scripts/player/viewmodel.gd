class_name Viewmodel
extends Node
## A second render pass for the first-person arms.
##
## Everything on the view-model render layer is drawn by its own camera into a transparent
## SubViewport and laid over the world, below the HUD. The pass has its own depth buffer and a
## narrower field of view, so hands and gloves can never clip into a wall, a heavy bag or an
## opponent, and they keep their shape however wide the world camera goes. The camera shares
## the world, so the arms are lit and shadowed by the same lights as everything else.
##
## While the hands hold real equipment (handlebars, a barbell) the arms have to sort against
## it, so `hold_world` hands them back to the world camera: the pass first eases its field of
## view to the world's, then switches, and nothing pops.

## Render layer 4 (bit value 8): the arms, the shaker, the kicking leg and the forearm aura.
const LAYER := 8
## Degrees per second the field of view eases at around a hand-over.
const FOV_EASE := 110.0

## Field of view of the pass, in degrees.
@export_range(40.0, 90.0) var fov := 68.0

## True while the arms are drawn by the world camera instead of the pass.
var in_world := false

var _eye: Camera3D
var _camera: Camera3D
var _viewport: SubViewport
var _screen: TextureRect
var _hold := false
var _shown_fov := 68.0
var _world_environment: Environment = null


## Starts the pass for `eye`, the player's camera, which stops drawing the layer itself.
func setup(eye: Camera3D) -> void:
	_eye = eye
	_eye.cull_mask &= ~LAYER
	_shown_fov = fov
	process_priority = 100

	_viewport = SubViewport.new()
	_viewport.name = "Pass"
	_viewport.transparent_bg = true
	_viewport.msaa_3d = get_viewport().msaa_3d if get_viewport() != null else Viewport.MSAA_4X
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_viewport.positional_shadow_atlas_size = 1024
	_viewport.handle_input_locally = false
	_viewport.gui_disable_input = true
	add_child(_viewport)

	_camera = Camera3D.new()
	_camera.name = "ViewmodelCamera"
	_camera.cull_mask = LAYER
	_camera.fov = fov
	_camera.near = 0.01
	# Short far plane: the sun's shadow cascades for this pass only span the arms.
	_camera.far = 8.0
	_camera.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	_viewport.add_child(_camera)
	_camera.current = true

	var layer := CanvasLayer.new()
	layer.name = "Overlay"
	layer.layer = -1
	add_child(layer)
	_screen = TextureRect.new()
	_screen.name = "Arms"
	_screen.texture = _viewport.get_texture()
	_screen.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_screen.stretch_mode = TextureRect.STRETCH_SCALE
	_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_screen.set_anchors_preset(Control.PRESET_FULL_RECT)
	# Edge pixels come out of the pass already weighted by coverage.
	var blend := CanvasItemMaterial.new()
	blend.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
	_screen.material = blend
	layer.add_child(_screen)

	get_tree().root.size_changed.connect(_fit_window)
	_fit_window()
	_sync_environment()


## Asks for the arms to be drawn in the world (true) or in their own pass (false).
func hold_world(hold: bool) -> void:
	_hold = hold


func _process(delta: float) -> void:
	if _eye == null:
		return
	_sync_environment()
	if _hold:
		if not in_world:
			_shown_fov = move_toward(_shown_fov, _eye.fov, FOV_EASE * delta)
			if absf(_shown_fov - _eye.fov) < 0.5:
				_enter_world(true)
	else:
		if in_world:
			_shown_fov = _eye.fov
			_enter_world(false)
		_shown_fov = move_toward(_shown_fov, fov, FOV_EASE * delta)
	_camera.fov = _shown_fov
	_camera.global_transform = _eye.global_transform


func _enter_world(world: bool) -> void:
	in_world = world
	if world:
		_eye.cull_mask |= LAYER
	else:
		_eye.cull_mask &= ~LAYER
	_screen.visible = not world
	_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED if world else SubViewport.UPDATE_ALWAYS


func _fit_window() -> void:
	var size := get_tree().root.size
	_viewport.size = Vector2i(maxi(size.x, 2), maxi(size.y, 2))


# The pass uses the world's light, tone mapping and grade, minus everything that needs the
# world's own depth: fog, glow, SDFGI and screen-space reflections.
func _sync_environment() -> void:
	var world := _eye.get_world_3d().environment if _eye.is_inside_tree() else null
	if world == _world_environment:
		return
	_world_environment = world
	if world == null:
		_camera.environment = null
		return
	var environment := world.duplicate() as Environment
	environment.fog_enabled = false
	environment.volumetric_fog_enabled = false
	environment.glow_enabled = false
	environment.sdfgi_enabled = false
	environment.ssil_enabled = false
	environment.ssr_enabled = false
	environment.ssao_enabled = true
	environment.ssao_radius = 0.12
	environment.ssao_intensity = 1.6
	_camera.environment = environment
