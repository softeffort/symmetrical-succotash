class_name CombatFx
extends RefCounted
## Lightweight GPU particle bursts and light flashes: sweat and sparks off heavy strikes, shards
## from a broken guard, confetti over the cage. Each burst is a one-shot GPUParticles3D that
## frees itself; process materials and meshes are built once and shared.

const SWEAT := &"sweat"
const SPARK := &"spark"
const SHATTER := &"shatter"
const CONFETTI := &"confetti"

## `speed` and `size` are (min, max); `gravity` is vertical acceleration.
const KINDS := {
	SWEAT: {"amount": 16, "lifetime": 0.55, "spread": 38.0, "speed": Vector2(1.8, 4.2), "gravity": -9.0, "size": Vector2(0.03, 0.06), "color": Color(0.82, 0.94, 1.0, 0.9), "additive": false},
	SPARK: {"amount": 20, "lifetime": 0.32, "spread": 70.0, "speed": Vector2(2.5, 6.0), "gravity": -4.0, "size": Vector2(0.035, 0.07), "color": Color(2.6, 1.9, 0.7), "additive": true},
	SHATTER: {"amount": 28, "lifetime": 0.6, "spread": 85.0, "speed": Vector2(2.0, 5.0), "gravity": -7.0, "size": Vector2(0.04, 0.085), "color": Color(1.9, 1.3, 2.8), "additive": true},
	CONFETTI: {"amount": 150, "lifetime": 3.4, "spread": 180.0, "speed": Vector2(1.5, 5.0), "gravity": -2.2, "size": Vector2(0.05, 0.09), "color": Color.WHITE, "additive": false},
}
const CONFETTI_COLORS: Array[Color] = [
	Color(0.66, 0.45, 1.0), Color(1.0, 0.45, 0.85), Color(0.96, 0.97, 1.0), Color(1.0, 0.82, 0.3), Color(0.3, 0.9, 1.0),
]

static var _processes: Dictionary = {}
static var _meshes: Dictionary = {}
static var _dot: GradientTexture2D


## Emits a burst of `kind` under `host` at world position `at`, thrown along `direction`.
## `scale` multiplies the particle count.
static func burst(host: Node, kind: StringName, at: Vector3, direction: Vector3 = Vector3.UP, scale: float = 1.0) -> GPUParticles3D:
	var settings: Dictionary = KINDS[kind]
	var amount: int = settings["amount"]
	var particles := GPUParticles3D.new()
	particles.amount = maxi(roundi(amount * scale), 1)
	particles.lifetime = settings["lifetime"]
	particles.one_shot = true
	particles.explosiveness = 0.8 if kind == CONFETTI else 0.95
	particles.emitting = false
	particles.process_material = _process_material(kind)
	particles.draw_pass_1 = _mesh(kind)
	particles.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	particles.visibility_aabb = AABB(Vector3(-6.0, -6.0, -6.0), Vector3(12.0, 12.0, 12.0))
	host.add_child(particles)
	particles.global_transform = Transform3D(Build.basis_along(direction), at)
	particles.finished.connect(particles.queue_free)
	particles.restart()
	return particles


## A short flash of light at `at`.
static func flash(host: Node, at: Vector3, color: Color, energy: float = 4.0, reach: float = 5.0, seconds: float = 0.2) -> void:
	var light := OmniLight3D.new()
	light.light_color = color
	light.light_energy = energy
	light.omni_range = reach
	host.add_child(light)
	light.global_position = at
	var tween := light.create_tween()
	tween.tween_property(light, "light_energy", 0.0, seconds)
	tween.tween_callback(light.queue_free)


## A camera-facing particle quad. `soft` draws a round dot, `additive` makes it glow, `overlay`
## draws it over everything (first-person effects).
static func particle_mesh(soft: bool, additive: bool, overlay: bool = false, size: Vector2 = Vector2.ONE) -> QuadMesh:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	material.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	material.billboard_keep_scale = true
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.no_depth_test = overlay
	if additive:
		material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	if soft:
		material.albedo_texture = soft_dot()
	var quad := QuadMesh.new()
	quad.size = size
	quad.material = material
	return quad


## Round dot fading to nothing at the rim, generated in memory.
static func soft_dot() -> GradientTexture2D:
	if _dot == null:
		var gradient := Gradient.new()
		gradient.set_color(0, Color.WHITE)
		gradient.set_color(1, Color(1.0, 1.0, 1.0, 0.0))
		_dot = GradientTexture2D.new()
		_dot.gradient = gradient
		_dot.fill = GradientTexture2D.FILL_RADIAL
		_dot.fill_from = Vector2(0.5, 0.5)
		_dot.fill_to = Vector2(1.0, 0.5)
		_dot.width = 32
		_dot.height = 32
	return _dot


## Ramp that holds a particle's colour and fades it out over the last part of its life.
static func fade_ramp(hold: float = 0.6) -> GradientTexture1D:
	var gradient := Gradient.new()
	gradient.set_color(0, Color.WHITE)
	gradient.set_color(1, Color(1.0, 1.0, 1.0, 0.0))
	gradient.add_point(hold, Color.WHITE)
	var ramp := GradientTexture1D.new()
	ramp.gradient = gradient
	return ramp


static func _process_material(kind: StringName) -> ParticleProcessMaterial:
	if _processes.has(kind):
		return _processes[kind]
	var settings: Dictionary = KINDS[kind]
	var speed: Vector2 = settings["speed"]
	var size: Vector2 = settings["size"]
	var gravity: float = settings["gravity"]
	var material := ParticleProcessMaterial.new()
	# Local +Y: the burst node is turned so that axis follows the blow.
	material.direction = Vector3.UP
	material.spread = settings["spread"]
	material.initial_velocity_min = speed.x
	material.initial_velocity_max = speed.y
	material.gravity = Vector3(0.0, gravity, 0.0)
	material.scale_min = size.x
	material.scale_max = size.y
	material.color = settings["color"]
	material.color_ramp = fade_ramp()
	material.damping_min = 1.0
	material.damping_max = 2.0
	if kind == CONFETTI:
		material.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
		material.emission_box_extents = Vector3(2.8, 0.2, 2.8)
		material.damping_min = 2.0
		material.damping_max = 3.5
		material.angle_min = -180.0
		material.angle_max = 180.0
		material.angular_velocity_min = -400.0
		material.angular_velocity_max = 400.0
		var colors := Gradient.new()
		colors.interpolation_mode = Gradient.GRADIENT_INTERPOLATE_CONSTANT
		colors.set_color(0, CONFETTI_COLORS[0])
		colors.set_color(1, CONFETTI_COLORS[CONFETTI_COLORS.size() - 1])
		for i in range(1, CONFETTI_COLORS.size() - 1):
			colors.add_point(float(i) / (CONFETTI_COLORS.size() - 1), CONFETTI_COLORS[i])
		var picker := GradientTexture1D.new()
		picker.gradient = colors
		material.color_initial_ramp = picker
	_processes[kind] = material
	return material


static func _mesh(kind: StringName) -> QuadMesh:
	if not _meshes.has(kind):
		var settings: Dictionary = KINDS[kind]
		var paper := kind == CONFETTI
		_meshes[kind] = particle_mesh(not paper, settings["additive"], false, Vector2(1.0, 0.6) if paper else Vector2.ONE)
	return _meshes[kind]
