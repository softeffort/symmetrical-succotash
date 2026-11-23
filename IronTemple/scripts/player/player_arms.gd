class_name PlayerArms
extends Node3D
## Procedural first-person arms. A two-bone IK solve keeps each hand on an animated target
## (idle breathing, walk and sprint swing) or on grips supplied by a vehicle or workout station,
## so a new pose only needs hand targets. `set_physique` thickens the arms as the player grows.
##
## The solve drives an ArmsRig: rigged, skinned arms with articulated hands whose fingers close
## into fists and around bars, and whose muscle, veins and sweat follow the player's training.
## They are drawn by a Viewmodel pass with its own depth and field of view, so they never clip
## into the world. If no arm model can be loaded the primitive arms below are shown instead.
##
## The fight stance (set by CombatController) raises the hands into a guard and plays punches,
## the block and a first-person kick. `set_gear` picks what the hands wear: bare, athletic
## wrist wraps for the weight room or fingerless MMA gloves over hand wraps; a fight always
## puts the gloves on. `play_drink` lifts a shaker to the mouth; `set_aura` makes the forearms
## steam at a full pump or on pre-workout.

const UPPER_LENGTH := 0.36
const FOREARM_LENGTH := 0.34
## Render layer 2: seen by the player camera, hidden from mirror cameras.
const FIRST_PERSON_LAYER := 2
## Render layer 4: drawn by the Viewmodel pass (the arms and everything attached to them).
const VIEWMODEL_LAYER := Viewmodel.LAYER
const DEPTH_PULL := 0.9
## Seconds the hands dip out of view to change what they wear.
const EQUIP_TIME := 0.45
## Shoulder position and elbow direction for the right arm in the torso frame; x mirrors for the left.
const DEFAULT_SHOULDER := Vector3(0.2, -0.25, -0.05)
const DEFAULT_POLE := Vector3(0.6, -1.0, 0.25)
## Distance from the wrist to the middle of the fist, so a held bar sits in the palm.
const PALM_OFFSET := 0.055
## The same for the rigged hand, whose palm is longer than the primitive fist.
const RIG_PALM_OFFSET := 0.085
## The shirt sleeve over the top of a rigged arm: its radius and how far down the arm it reaches.
const SLEEVE_RADIUS := 0.076
const SLEEVE_OVERLAP := 0.13
## The rigged forearms are fuller than the primitive ones: the high guard opens this much
## wider (metres per hand) so the opponent stays in view between the gloves.
const RIG_BLOCK_SPREAD := 0.04

# Fight stance in view space, for the right arm; x mirrors for the left.
const GUARD_SHOULDER := Vector3(0.2, -0.3, 0.07)
const GUARD_HAND := Vector3(0.165, -0.16, -0.4)
## The lead (left) hand rides a little further out.
const GUARD_LEAD := Vector3(0.0, 0.012, -0.05)
const GUARD_POLE := Vector3(0.45, -1.0, 0.5)
## Forearms up in front of the face.
const BLOCK_HAND := Vector3(0.085, -0.06, -0.29)
const BLOCK_POLE := Vector3(0.3, -1.0, 0.35)
## The body guard: elbows dropped onto the ribs, gloves at the bottom of the view.
const BLOCK_LOW_HAND := Vector3(0.1, -0.25, -0.36)
const BLOCK_LOW_POLE := Vector3(0.7, -0.6, 0.6)
## Seconds a feint's twitch lasts.
const FEINT_TIME := 0.16
## Hand path of each punch: from the guard the fist curves past `via` to `end` (beyond arm's
## length means full extension). `follow` is how far the shoulder goes with it, `pole` aims the
## elbow and `wind` is how far the hand draws back before it leaves.
const STRIKE_PATHS := {
	Strike.JAB: {"via": Vector3(0.1, -0.11, -0.6), "end": Vector3(0.015, -0.075, -0.88), "follow": Vector3(-0.07, 0.03, -0.16), "pole": Vector3(0.45, -1.0, 0.3), "wind": 0.03},
	Strike.CROSS: {"via": Vector3(0.12, -0.1, -0.6), "end": Vector3(-0.03, -0.065, -0.92), "follow": Vector3(-0.12, 0.03, -0.24), "pole": Vector3(0.6, -0.9, 0.3), "wind": 0.07},
	Strike.HOOK: {"via": Vector3(0.52, -0.05, -0.5), "end": Vector3(-0.16, -0.07, -0.52), "follow": Vector3(-0.05, 0.04, -0.14), "pole": Vector3(1.0, 0.05, 0.6), "wind": 0.06},
	Strike.OVERHAND: {"via": Vector3(0.34, 0.2, -0.42), "end": Vector3(-0.06, -0.04, -0.88), "follow": Vector3(-0.1, 0.06, -0.22), "pole": Vector3(0.9, 0.5, 0.4), "wind": 0.1},
	Strike.UPPERCUT: {"via": Vector3(0.14, -0.5, -0.42), "end": Vector3(0.02, 0.0, -0.56), "follow": Vector3(-0.06, 0.06, -0.12), "pole": Vector3(0.3, -1.0, 0.6), "wind": 0.05},
	# Body shots stay under the guard line: a hook that digs round low and a straight to the gut.
	Strike.BODY_HOOK: {"via": Vector3(0.46, -0.3, -0.44), "end": Vector3(-0.12, -0.27, -0.6), "follow": Vector3(-0.05, -0.03, -0.14), "pole": Vector3(1.0, -0.25, 0.6), "wind": 0.06},
	Strike.BODY_CROSS: {"via": Vector3(0.12, -0.27, -0.6), "end": Vector3(-0.02, -0.31, -0.9), "follow": Vector3(-0.12, -0.06, -0.24), "pole": Vector3(0.6, -0.9, 0.3), "wind": 0.07},
}
# The kicking leg swings up into view from a hip placed higher than the real one, so a front
# kick is visible without looking down.
const KICK_HIP := Vector3(0.09, -0.3, 0.1)
const KICK_THIGH := 0.42
const KICK_SHIN := 0.46
# Drinking: the right hand brings a shaker up under the view and tips it back.
const DRINK_TIME := 1.3
const DRINK_HAND := Vector3(0.1, -0.15, -0.3)
const DRINK_TIP := Vector3(-0.03, 0.045, 0.05)
const DRINK_SHOULDER := Vector3(0.2, -0.3, 0.07)
const DRINK_POLE := Vector3(0.9, -0.5, 0.3)

## Pulls the view model towards the near plane so the arms never clip into nearby walls.
const VIEWMODEL_SHADER := """
shader_type spatial;
uniform vec3 albedo : source_color = vec3(1.0);
uniform float depth_pull = 0.0;

void vertex() {
	POSITION = PROJECTION_MATRIX * MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	POSITION.z = mix(POSITION.z, POSITION.w, depth_pull);
}

void fragment() {
	ALBEDO = albedo;
	ROUGHNESS = 0.8;
}
"""

@export var skin_color := Color(0.96, 0.76, 0.62)
@export var sleeve_color := Color(0.16, 0.62, 0.86)
@export var glove_color := Color(0.1, 0.1, 0.13)
@export var glove_trim_color := Color(0.66, 0.45, 1.0)
@export var wrap_color := Color(0.93, 0.92, 0.88)
@export var shorts_color := Color(0.13, 0.15, 0.22)
@export var shoe_color := Color(0.93, 0.25, 0.2)

## Hands up with the gloves on. Set by CombatController.
var fight_stance := false
var blocking := false
## The guard is the body guard: elbows down instead of forearms up.
var guard_low := false
## Rocked: the hands sag and drift.
var dazed := false
## Held in a clinch: the hands are up against the opponent's chest.
var clinched := false
## Speeds up the fight animations when the world is in slow motion.
var fight_time_scale := 1.0
## The rigged arms, or null when the primitive ones are shown.
var rig: ArmsRig = null
## The pass that draws the arms, or null when they are not under a camera.
var viewmodel: Viewmodel = null


class Arm:
	var side := 1.0
	var upper: MeshInstance3D
	var cuff: MeshInstance3D
	var bulge: MeshInstance3D
	var fore: MeshInstance3D
	var elbow: MeshInstance3D
	var hand: Node3D
	var grip: Node3D
	var wrist := Vector3.ZERO
	# Last grip pose in arm space, kept so the hand eases off after letting go.
	var held_hand := Vector3.ZERO
	var held_axis := Vector3.RIGHT
	var held_shoulder := Vector3.ZERO
	var held_pole := Vector3.DOWN
	# The last solve, for the rig.
	var shoulder_at := Vector3.ZERO
	var elbow_at := Vector3.ZERO
	var bend := Vector3.DOWN
	# Shirt sleeve from the real shoulder over the top of the rigged arm.
	var sleeve: MeshInstance3D
	var glove: Node3D
	# The punch in progress, or &"".
	var strike: StringName = &""
	var strike_time := 0.0
	var strike_startup := 0.1
	var strike_recovery := 0.2
	# How far the punch in progress is out, 0 to 1.
	var reach := 0.0
	# Seconds into a feint's twitch, or -1.
	var feint := -1.0
	var feint_low := false


var _arms: Array[Arm] = []
var _materials: Array[ShaderMaterial] = []
var _shoulder := DEFAULT_SHOULDER
var _pole := DEFAULT_POLE
var _girth := 0.0
var _grip_blend := 0.0
var _air_blend := 0.0
var _breath := 0.0
var _sway := Vector2.ZERO
var _stance := 0.0
var _block := 0.0
var _low := 0.0
var _daze := 0.0
var _clinch := 0.0
var _shove := 0.0
var _flinch := 0.0
# Scratch results of `_fight_arm`.
var _fight_shoulder := Vector3.ZERO
var _fight_hand := Vector3.ZERO
var _fight_pole := Vector3.DOWN
var _leg: Node3D
var _leg_knee: Node3D
var _leg_parts := {}
var _legs_girth := 0.0
var _kick: StringName = &""
var _kick_time := 0.0
var _kick_startup := 0.2
var _kick_recovery := 0.4
var _drink_time := -1.0
var _bottle: Node3D
var _drink_material: ShaderMaterial
var _auras: Array[GPUParticles3D] = []
var _aura_process: ParticleProcessMaterial
var _palm_offset := PALM_OFFSET
# What the hands wear outside a fight, what they wear now and the change in progress.
var _area_gear := CharacterRig.Hands.BARE
var _gear := CharacterRig.Hands.BARE
var _equip := -1.0


func _ready() -> void:
	var shader := Shader.new()
	shader.code = VIEWMODEL_SHADER
	var skin := _material(shader, skin_color)
	var sleeve := _material(shader, sleeve_color)
	var padding := _material(shader, glove_color)
	var trim := _material(shader, glove_trim_color)
	for side: float in [-1.0, 1.0]:
		var arm := Arm.new()
		arm.side = side
		arm.upper = _part(self, CapsuleMesh.new(), skin)
		arm.cuff = _part(arm.upper, CapsuleMesh.new(), sleeve)
		arm.cuff.position.y = -UPPER_LENGTH * 0.3
		arm.bulge = _part(arm.upper, _sphere(), skin)
		arm.bulge.position.y = 0.02
		arm.fore = _part(self, CylinderMesh.new(), skin)
		arm.elbow = _part(arm.fore, _sphere(), skin)
		arm.elbow.position.y = -FOREARM_LENGTH * 0.5
		arm.hand = _hand(side, skin)
		arm.glove = _glove(arm.hand, side, padding, trim)
		_arms.append(arm)
	_build_leg(skin, _material(shader, shorts_color), _material(shader, shoe_color))
	_build_bottle(_arms[1].hand, shader)
	_build_auras()
	_build_rig()
	if get_parent() is Camera3D:
		viewmodel = Viewmodel.new()
		viewmodel.name = "Viewmodel"
		add_child(viewmodel)
		viewmodel.setup(get_parent() as Camera3D)
	set_physique(0.0, 0.0)


## `arms` 0 (lanky) to 1 (shredded) sets the girth; `pump` 0 to 1 adds a temporary swell.
## `legs` thickens the kicking leg.
func set_physique(arms: float, pump: float = 0.0, legs: float = 0.0) -> void:
	_girth = clampf(arms, 0.0, 1.0)
	_legs_girth = clampf(legs, 0.0, 1.0)
	var thigh_radius := lerpf(0.05, 0.085, _legs_girth)
	var shin_radius := lerpf(0.04, 0.052, _legs_girth)
	(_leg_parts["thigh"] as Node3D).scale = Vector3(thigh_radius, KICK_THIGH, thigh_radius)
	(_leg_parts["shorts"] as Node3D).scale = Vector3(thigh_radius * 1.35, KICK_THIGH * 0.55, thigh_radius * 1.35)
	(_leg_parts["knee"] as Node3D).scale = Vector3.ONE * thigh_radius * 0.85
	(_leg_parts["shin"] as Node3D).scale = Vector3(shin_radius, KICK_SHIN, shin_radius)
	var swell := 1.0 + 0.1 * clampf(pump, 0.0, 1.0)
	var upper_radius := lerpf(0.03, 0.05, _girth) * swell
	var elbow_radius := lerpf(0.026, 0.044, _girth) * swell
	var wrist_radius := lerpf(0.022, 0.03, _girth)
	# Thicker than the arm itself once trained, so the biceps and triceps read as a belly.
	var belly := upper_radius * lerpf(0.9, 1.24, _girth)
	for arm in _arms:
		_capsule(arm.upper, upper_radius, UPPER_LENGTH)
		_capsule(arm.cuff, upper_radius * 1.3, UPPER_LENGTH * 0.45)
		arm.bulge.scale = Vector3(belly, belly * 2.6, belly)
		var fore := arm.fore.mesh as CylinderMesh
		fore.height = FOREARM_LENGTH
		fore.bottom_radius = elbow_radius
		fore.top_radius = wrist_radius
		fore.radial_segments = 10
		fore.rings = 1
		arm.elbow.scale = Vector3.ONE * elbow_radius
		arm.hand.scale = Vector3.ONE * lerpf(1.0, 1.15, _girth)
	if rig != null:
		rig.set_arm_physique(_girth, clampf(pump, 0.0, 1.0))


## Hands hold these nodes (handlebar grips, a barbell, dumbbells) until called again with nulls.
## Each grip's local X axis is the bar the fist wraps around. `shoulder` and `pole` place the
## right shoulder and aim the elbow in the torso frame passed to `animate`.
func set_grips(left: Node3D, right: Node3D, shoulder: Vector3 = DEFAULT_SHOULDER, pole: Vector3 = DEFAULT_POLE) -> void:
	_arms[0].grip = left
	_arms[1].grip = right
	if left != null or right != null:
		_shoulder = shoulder
		_pole = pole


## Throws a punch with one arm (0 left, 1 right): the fist lands after `startup` seconds and is
## back in the guard `recovery` seconds later.
func play_strike(kind: StringName, arm_index: int, startup: float, recovery: float) -> void:
	if not STRIKE_PATHS.has(kind):
		return
	var arm := _arms[arm_index]
	arm.strike = kind
	arm.strike_time = 0.0
	arm.strike_startup = maxf(startup, 0.01)
	arm.strike_recovery = maxf(recovery, 0.01)


## A feint: the shoulder and glove of one arm (0 left, 1 right) twitch forward and snap back.
## `low` sells a body shot.
func play_feint(arm_index: int, low: bool = false) -> void:
	var arm := _arms[arm_index]
	arm.strike = &""
	arm.feint = 0.0
	arm.feint_low = low


## Both hands push out hard: one heave against a clinch.
func shove() -> void:
	_shove = 1.0


## Throws the right leg: Strike.KICK is a front kick, Strike.KNEE a knee to the body.
func play_kick(kind: StringName, startup: float, recovery: float) -> void:
	_kick = kind
	_kick_time = 0.0
	_kick_startup = maxf(startup, 0.01)
	_kick_recovery = maxf(recovery, 0.01)
	_leg.visible = true
	_pose_leg(0.0)


## Lifts a shaker of `color` to the mouth and drinks: about DRINK_TIME seconds.
func play_drink(color: Color) -> void:
	_drink_material.set_shader_parameter("albedo", color)
	_drink_time = 0.0


func is_drinking() -> bool:
	return _drink_time >= 0.0


## What the hands wear outside a fight (a CharacterRig.Hands value): the hands dip out of
## view, change and come back. A fight stance always wears the gloves.
func set_gear(style: int) -> void:
	_area_gear = style as CharacterRig.Hands


## What the hands are wearing right now (a CharacterRig.Hands value).
func get_gear() -> int:
	return _gear


## Turns the glow rising off the forearms on or off.
func set_aura(active: bool, color: Color = Color.WHITE) -> void:
	if active:
		_aura_process.color = color
	for aura in _auras:
		if aura.emitting != active:
			aura.emitting = active


## Drops whatever is being thrown and brings the hands straight back to the guard.
func cancel_strikes() -> void:
	for arm in _arms:
		arm.strike = &""
		arm.feint = -1.0
	_kick = &""
	_leg.visible = false


## Jolts the hands when the fighter takes a hit.
func flinch(amount: float = 1.0) -> void:
	_flinch = clampf(maxf(_flinch, amount), 0.0, 1.0)


## Mouse movement makes the hands trail slightly behind the view.
func add_sway(mouse_delta: Vector2) -> void:
	_sway = (_sway + Vector2(-mouse_delta.x, mouse_delta.y) * 0.00012).limit_length(0.03)


## Call every rendered frame. `torso` is the eye-level body frame used while holding grips.
func animate(delta: float, stride_phase: float, move_amount: float, sprint_amount: float, airborne: bool, torso: Transform3D) -> void:
	_breath += delta
	_sway = _sway.lerp(Vector2.ZERO, 1.0 - exp(-8.0 * delta))
	_air_blend = move_toward(_air_blend, 1.0 if airborne else 0.0, delta * 6.0)
	var gripping := _arms[0].grip != null or _arms[1].grip != null
	_grip_blend = move_toward(_grip_blend, 1.0 if gripping else 0.0, delta * 4.0)
	var fight_delta := delta * fight_time_scale
	_stance = move_toward(_stance, 1.0 if fight_stance and not gripping else 0.0, delta * 5.5)
	_block = move_toward(_block, 1.0 if blocking else 0.0, fight_delta * 11.0)
	_low = move_toward(_low, 1.0 if guard_low else 0.0, fight_delta * 11.0)
	_daze = move_toward(_daze, 1.0 if dazed else 0.0, delta * 5.0)
	_clinch = move_toward(_clinch, 1.0 if clinched else 0.0, delta * 8.0)
	_shove = move_toward(_shove, 0.0, delta * 6.0)
	_flinch = move_toward(_flinch, 0.0, delta * 5.0)
	if _stance <= 0.0:
		cancel_strikes()
	var stance := smoothstep(0.0, 1.0, _stance)
	# 0 to 1 as the shaker comes up and goes back down, and how far it is tipped at the top.
	var drink := 0.0
	var tip := 0.0
	if _drink_time >= 0.0:
		_drink_time += delta
		if _drink_time >= DRINK_TIME or gripping:
			_drink_time = -1.0
		else:
			drink = smoothstep(0.0, 0.3, _drink_time) * (1.0 - smoothstep(DRINK_TIME - 0.35, DRINK_TIME, _drink_time))
			tip = sin(clampf((_drink_time - 0.3) / (DRINK_TIME - 0.65), 0.0, 1.0) * PI)
	_bottle.visible = drink > 0.02
	# Holding real geometry needs true depth so hands and equipment sort correctly: the pass
	# hands the arms to the world camera for as long as they grip.
	var pull := 0.0 if _grip_blend > 0.0 or viewmodel != null else DEPTH_PULL
	for material in _materials:
		material.set_shader_parameter("depth_pull", pull)
	if viewmodel != null:
		viewmodel.hold_world(_grip_blend > 0.0)
	var dip := _update_gear(delta, gripping)

	var blend := smoothstep(0.0, 1.0, _grip_blend)
	var to_arm_space := global_transform.basis.inverse()
	for index in 2:
		var arm := _arms[index]
		var side := arm.side
		arm.glove.visible = rig == null and (_stance > 0.02 or _gear == CharacterRig.Hands.GLOVES)
		if arm.grip != null:
			var grip := arm.grip.get_global_transform_interpolated()
			arm.held_hand = to_local(grip.origin)
			arm.held_axis = (to_arm_space * grip.basis.x).normalized()
			arm.held_shoulder = to_local(torso * Vector3(_shoulder.x * side, _shoulder.y, _shoulder.z))
			arm.held_pole = to_arm_space * (torso.basis * Vector3(_pole.x * side, _pole.y, _pole.z))
		var shoulder := Vector3(0.21 * side, -0.27, 0.1)
		var hand := _free_hand(side, stride_phase, move_amount, sprint_amount)
		var pole := Vector3(0.55 * side, -1.0, 0.1)
		if stance > 0.0:
			_fight_arm(arm, index, fight_delta, stride_phase, move_amount)
			shoulder = shoulder.lerp(_fight_shoulder, stance)
			hand = hand.lerp(_fight_hand, stance)
			pole = pole.lerp(_fight_pole, stance)
		# Thumbs up at ease; in the guard the gloves turn their padding to the view, and a
		# punch lands with the fist level.
		var roll := side * deg_to_rad(lerpf(lerpf(66.0, 30.0, stance), 8.0, arm.reach * stance))
		if index == 1 and drink > 0.0:
			shoulder = shoulder.lerp(DRINK_SHOULDER, drink)
			hand = hand.lerp(DRINK_HAND + DRINK_TIP * tip, drink)
			pole = pole.lerp(DRINK_POLE, drink)
			roll = lerpf(roll, deg_to_rad(100.0 + 40.0 * tip), drink)
		hand.y -= dip * (1.0 - blend)
		shoulder = shoulder.lerp(arm.held_shoulder, blend)
		hand = hand.lerp(arm.held_hand, blend)
		pole = pole.lerp(arm.held_pole, blend)
		if rig != null:
			# Loose fingers at rest, fists in the guard, open palms in a clinch, a full grip on a bar.
			var closed := lerpf(0.34 + 0.03 * sin(_breath * 1.3 + side), 1.0, stance)
			closed = lerpf(closed, 0.2, smoothstep(0.0, 1.0, _clinch) * stance)
			closed = lerpf(closed, 0.9, drink if index == 1 else 0.0)
			rig.fist[index] = lerpf(closed, 0.95, blend)
		_solve(arm, shoulder, hand, pole, roll * (1.0 - blend), blend)
	_animate_kick(fight_delta)


func _free_hand(side: float, phase: float, move: float, sprint: float) -> Vector3:
	# A trained fighter carries the hands a little higher and steadier.
	var steady := 1.0 - 0.45 * _girth
	var target := Vector3(0.24 * side, -0.27 + 0.02 * _girth, -0.5)
	# Idle breathing.
	target.y += sin(_breath * 1.6) * 0.006 * steady
	target.z += sin(_breath * 0.8 + side) * 0.004 * steady
	# Arms swing opposite each other while walking and pump harder in a sprint.
	var swing := sin(phase + (PI if side > 0.0 else 0.0))
	target.z += swing * (0.035 * move + 0.07 * sprint)
	target.y += -swing * (0.012 * move + 0.05 * sprint) + absf(cos(phase)) * 0.012 * move + 0.03 * sprint
	target.x += _sway.x * steady + side * (0.02 * sprint + 0.04 * _air_blend)
	target.y += _sway.y * steady + 0.05 * _air_blend
	return target


## Works out one arm's guard, block or punch for this frame into the `_fight_*` scratch values.
func _fight_arm(arm: Arm, index: int, delta: float, phase: float, move: float) -> void:
	var side := arm.side
	var hand := _mirrored(GUARD_HAND, side)
	if index == 0:
		hand += GUARD_LEAD
	# Breathing and footwork keep the guard alive; a hit knocks it back.
	hand.x += _sway.x
	hand.y += sin(_breath * 1.7 + side) * 0.005 + absf(cos(phase + index * PI * 0.5)) * 0.012 * move + _sway.y - 0.05 * _flinch
	hand.z += 0.06 * _flinch
	var shoulder := _mirrored(GUARD_SHOULDER, side)
	var pole := _mirrored(GUARD_POLE, side)
	var block := smoothstep(0.0, 1.0, _block)
	var low := smoothstep(0.0, 1.0, _low)
	hand = hand.lerp(_mirrored(BLOCK_HAND.lerp(BLOCK_LOW_HAND, low), side), block)
	if rig != null:
		hand.x += side * RIG_BLOCK_SPREAD * block * (1.0 - low)
	pole = pole.lerp(_mirrored(BLOCK_POLE.lerp(BLOCK_LOW_POLE, low), side), block)
	if _clinch > 0.0:
		# Palms on the opponent's chest, heaving at every push.
		var press := Vector3(0.13 * side, -0.13 + sin(_breath * 23.0 + side) * 0.006, -0.36 - 0.14 * _shove)
		hand = hand.lerp(press, smoothstep(0.0, 1.0, _clinch))
	if _daze > 0.0:
		# Rocked: the guard sags and the hands drift on their own.
		hand += Vector3(sin(_breath * 4.3 + side * 2.0) * 0.035, -0.12 + sin(_breath * 3.1 + side) * 0.02, 0.05) * smoothstep(0.0, 1.0, _daze)

	if arm.feint >= 0.0:
		arm.feint += delta
		if arm.feint >= FEINT_TIME:
			arm.feint = -1.0
		else:
			var twitch := sin(arm.feint / FEINT_TIME * PI)
			hand += Vector3(-0.02 * side, -0.09 if arm.feint_low else 0.012, -0.17) * twitch
			shoulder += Vector3(-0.03 * side, 0.0, -0.09) * twitch

	arm.reach = 0.0
	if arm.strike != &"":
		arm.strike_time += delta
		var path: Dictionary = STRIKE_PATHS[arm.strike]
		var reach := 0.0
		var drawn := 0.0
		if arm.strike_time < arm.strike_startup:
			var progress := arm.strike_time / arm.strike_startup
			# Accelerates into the target so the punch snaps at the end.
			reach = pow(progress, 1.8)
			var wind: float = path["wind"]
			drawn = sin(minf(progress * 2.5, 1.0) * PI) * wind
		else:
			var back := (arm.strike_time - arm.strike_startup) / arm.strike_recovery
			if back >= 1.0:
				arm.strike = &""
			else:
				reach = 1.0 - smoothstep(0.0, 1.0, back)
		var via := _mirrored(path["via"], side)
		var end := _mirrored(path["end"], side)
		hand = hand.lerp(via, reach).lerp(via.lerp(end, reach), reach)
		hand.z += drawn
		shoulder += _mirrored(path["follow"], side) * reach
		arm.reach = reach
		pole = pole.lerp(_mirrored(path["pole"], side), minf(reach * 1.6, 1.0))
	_fight_shoulder = shoulder
	_fight_hand = hand
	_fight_pole = pole


func _animate_kick(delta: float) -> void:
	if _kick == &"":
		return
	_kick_time += delta
	if _kick_time < _kick_startup:
		_pose_leg(_kick_time / _kick_startup)
		return
	var back := (_kick_time - _kick_startup) / _kick_recovery
	if back >= 1.0:
		_kick = &""
		_leg.visible = false
	else:
		_pose_leg(1.0 - smoothstep(0.0, 1.0, back))


## `thrust` 0 is the leg hanging below the view, 1 the kick fully out.
func _pose_leg(thrust: float) -> void:
	if _kick == Strike.KNEE:
		_leg.rotation.x = lerpf(0.3, 1.62, smoothstep(0.0, 1.0, thrust))
		_leg_knee.rotation.x = -2.0
	else:
		# The knee comes up first, then the shin snaps out.
		_leg.rotation.x = lerpf(0.3, 1.45, smoothstep(0.0, 0.6, thrust))
		_leg_knee.rotation.x = -lerpf(1.9, 0.08, smoothstep(0.4, 1.0, thrust))


func _solve(arm: Arm, shoulder: Vector3, target: Vector3, pole: Vector3, roll: float, hold: float) -> void:
	var forearm := _place(arm, shoulder, target, pole)
	if hold > 0.0:
		# Second pass: back the wrist off so the grip sits in the palm.
		forearm = _place(arm, shoulder, target - forearm * _palm_offset * hold, pole)
	var orientation := Build.basis_along(forearm) * Basis(Vector3.UP, roll)
	var across := arm.held_axis - forearm * arm.held_axis.dot(forearm)
	if hold > 0.0 and across.length_squared() > 0.001:
		# Wrap the fist around the held bar; keep the thumb on the inside.
		across = across.normalized() * (1.0 if across.x >= 0.0 else -1.0)
		orientation = orientation.slerp(Basis(across, forearm, across.cross(forearm)), hold)
	arm.hand.transform = Transform3D(orientation, arm.wrist)
	if rig != null:
		var index := 0 if arm.side < 0.0 else 1
		rig.pose_arm(index, arm.shoulder_at, arm.elbow_at, arm.wrist, arm.bend, orientation)
		# The rig keeps its own bone lengths from the wrist back, so its shoulder floats ahead
		# of the real one: the sleeve bridges the two and hides the cut.
		var top := rig.shoulder_of(index)
		var into := top + (arm.elbow_at - arm.shoulder_at).normalized() * SLEEVE_OVERLAP
		var span := into - arm.shoulder_at
		(arm.sleeve.mesh as CapsuleMesh).height = maxf(span.length(), SLEEVE_RADIUS * 2.0)
		arm.sleeve.transform = Transform3D(Build.basis_along(span), (into + arm.shoulder_at) * 0.5)


## Positions the upper arm and forearm so the wrist reaches `target`; returns the forearm direction.
func _place(arm: Arm, shoulder: Vector3, target: Vector3, pole: Vector3) -> Vector3:
	var reach := target - shoulder
	var distance := clampf(reach.length(), 0.05, UPPER_LENGTH + FOREARM_LENGTH - 0.005)
	var direction := reach.normalized()
	arm.wrist = shoulder + direction * distance
	var along := (UPPER_LENGTH * UPPER_LENGTH - FOREARM_LENGTH * FOREARM_LENGTH + distance * distance) / (2.0 * distance)
	var out := sqrt(maxf(UPPER_LENGTH * UPPER_LENGTH - along * along, 0.0))
	var bend := (pole - direction * pole.dot(direction)).normalized()
	var elbow := shoulder + direction * along + bend * out
	var forearm := (arm.wrist - elbow).normalized()
	arm.shoulder_at = shoulder
	arm.elbow_at = elbow
	arm.bend = bend
	arm.upper.transform = Transform3D(Build.basis_along(elbow - shoulder), (shoulder + elbow) * 0.5)
	arm.fore.transform = Transform3D(Build.basis_along(forearm), (elbow + arm.wrist) * 0.5)
	return forearm


func _material(shader: Shader, color: Color) -> ShaderMaterial:
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("albedo", color)
	_materials.append(material)
	return material


func _sphere() -> SphereMesh:
	var mesh := SphereMesh.new()
	mesh.radius = 1.0
	mesh.height = 2.0
	mesh.radial_segments = 10
	mesh.rings = 5
	return mesh


func _capsule(segment: MeshInstance3D, radius: float, length: float) -> void:
	var mesh := segment.mesh as CapsuleMesh
	mesh.radius = radius
	mesh.height = length + radius * 2.0
	mesh.radial_segments = 10
	mesh.rings = 4


func _hand(side: float, material: Material) -> Node3D:
	var wrist := Node3D.new()
	add_child(wrist)
	# A loose fist: back of the hand, curled fingers and thumb. Local +Z is the back of the hand.
	var palm := BoxMesh.new()
	palm.size = Vector3(0.078, 0.085, 0.046)
	_part(wrist, palm, material).position = Vector3(0.0, 0.043, 0.0)
	var fingers := BoxMesh.new()
	fingers.size = Vector3(0.076, 0.05, 0.05)
	_part(wrist, fingers, material).position = Vector3(0.0, 0.098, -0.014)
	var thumb := BoxMesh.new()
	thumb.size = Vector3(0.026, 0.06, 0.03)
	_part(wrist, thumb, material).position = Vector3(-side * 0.048, 0.06, -0.012)
	return wrist


## Open-fingered MMA glove: padding over the knuckles and the back of the hand, a wrist strap.
func _glove(hand: Node3D, side: float, padding: Material, trim: Material) -> Node3D:
	var glove := Node3D.new()
	hand.add_child(glove)
	var knuckles := BoxMesh.new()
	knuckles.size = Vector3(0.096, 0.066, 0.052)
	_part(glove, knuckles, padding).position = Vector3(0.0, 0.1, 0.012)
	var back := BoxMesh.new()
	back.size = Vector3(0.09, 0.09, 0.03)
	_part(glove, back, padding).position = Vector3(0.0, 0.045, 0.026)
	var thumb := BoxMesh.new()
	thumb.size = Vector3(0.034, 0.05, 0.04)
	_part(glove, thumb, padding).position = Vector3(-side * 0.05, 0.058, -0.008)
	_part(glove, _tube(0.037, 0.052), padding).position = Vector3(0.0, -0.012, 0.0)
	_part(glove, _tube(0.0385, 0.014), trim).position = Vector3(0.0, -0.012, 0.0)
	glove.visible = false
	return glove


## The kicking leg: thigh, knee, shin and shoe on a hip pivot, hidden until a kick is thrown.
func _build_leg(skin: Material, shorts: Material, shoes: Material) -> void:
	_leg = Node3D.new()
	_leg.position = KICK_HIP
	_leg.rotation.z = 0.06
	add_child(_leg)
	_leg_parts["thigh"] = _part(_leg, _tube(1.0, 1.0), skin)
	(_leg_parts["thigh"] as Node3D).position.y = -KICK_THIGH * 0.5
	_leg_parts["shorts"] = _part(_leg, _tube(1.0, 1.0), shorts)
	(_leg_parts["shorts"] as Node3D).position.y = -KICK_THIGH * 0.27
	_leg_knee = Node3D.new()
	_leg_knee.position.y = -KICK_THIGH
	_leg.add_child(_leg_knee)
	_leg_parts["knee"] = _part(_leg_knee, _sphere(), skin)
	_leg_parts["shin"] = _part(_leg_knee, _tube(1.0, 1.0), skin)
	(_leg_parts["shin"] as Node3D).position.y = -KICK_SHIN * 0.5
	var shoe := BoxMesh.new()
	shoe.size = Vector3(0.1, 0.085, 0.27)
	_part(_leg_knee, shoe, shoes).position = Vector3(0.0, -KICK_SHIN - 0.03, -0.06)
	_leg.visible = false


## A shaker held in the fist, lid towards the thumb. Hidden until a drink is played.
func _build_bottle(hand: Node3D, shader: Shader) -> void:
	_bottle = Node3D.new()
	_bottle.position = Vector3(0.0, 0.07, -0.02)
	_bottle.rotation.z = PI * 0.5
	hand.add_child(_bottle)
	_drink_material = _material(shader, Color.WHITE)
	_part(_bottle, _tube(0.03, 0.15), _drink_material)
	_part(_bottle, _tube(0.032, 0.035), _material(shader, Color(0.1, 0.1, 0.13))).position.y = 0.09
	_bottle.visible = false


## Soft glowing motes that rise off each forearm, drawn only for the first-person camera.
func _build_auras() -> void:
	_aura_process = ParticleProcessMaterial.new()
	_aura_process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	_aura_process.emission_box_extents = Vector3(0.04, FOREARM_LENGTH * 0.5, 0.04)
	_aura_process.spread = 180.0
	_aura_process.initial_velocity_min = 0.02
	_aura_process.initial_velocity_max = 0.1
	_aura_process.gravity = Vector3(0.0, 0.45, 0.0)
	_aura_process.scale_min = 0.012
	_aura_process.scale_max = 0.028
	_aura_process.color_ramp = CombatFx.fade_ramp(0.3)
	var mote := CombatFx.particle_mesh(true, true, true)
	for arm in _arms:
		var aura := GPUParticles3D.new()
		aura.amount = 14
		aura.lifetime = 0.6
		aura.emitting = false
		aura.process_material = _aura_process
		aura.draw_pass_1 = mote
		aura.layers = VIEWMODEL_LAYER
		aura.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		aura.visibility_aabb = AABB(Vector3(-1.0, -1.0, -1.0), Vector3(2.0, 2.0, 2.0))
		arm.fore.add_child(aura)
		_auras.append(aura)


func _tube(radius: float, length: float) -> CylinderMesh:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = length
	mesh.radial_segments = 10
	mesh.rings = 1
	return mesh


static func _mirrored(point: Vector3, side: float) -> Vector3:
	return Vector3(point.x * side, point.y, point.z)


func _part(parent: Node3D, mesh: Mesh, material: Material) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.layers = VIEWMODEL_LAYER
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(node)
	return node


## Loads the rigged arms and, if they are there, takes the primitive ones out of every camera
## (their nodes stay: the shaker and the aura hang off them).
func _build_rig() -> void:
	rig = ArmsRig.create_arms(VIEWMODEL_LAYER)
	if rig == null:
		return
	add_child(rig)
	rig.dress({"skin": skin_color, "top": CharacterRig.Top.TEE, "top_color": sleeve_color, "top_trim": sleeve_color.darkened(0.3), "hands": _gear, "glove_color": glove_color, "glove_trim": glove_trim_color, "wrap_color": wrap_color})
	_palm_offset = RIG_PALM_OFFSET
	var cloth := Stylized.fabric(sleeve_color)
	for arm in _arms:
		var capsule := CapsuleMesh.new()
		capsule.radius = SLEEVE_RADIUS
		capsule.radial_segments = 16
		capsule.rings = 6
		arm.sleeve = _part(self, capsule, cloth)
		for mesh: MeshInstance3D in [arm.upper, arm.cuff, arm.bulge, arm.fore, arm.elbow]:
			mesh.layers = 0
		for mesh in arm.hand.find_children("*", "MeshInstance3D", true, false):
			if not _bottle.is_ancestor_of(mesh):
				(mesh as MeshInstance3D).layers = 0


## Works out what the hands should wear and runs the change: returns how far (in metres) the
## free hands are dipped out of view while it happens.
func _update_gear(delta: float, gripping: bool) -> float:
	var wanted := _area_gear
	if fight_stance and not gripping:
		wanted = CharacterRig.Hands.GLOVES
	if wanted != _gear and _equip < 0.0:
		_equip = 0.0
	if _equip < 0.0:
		return 0.0
	_equip += delta / EQUIP_TIME
	# Swap at the bottom of the dip, or at once when the hands are busy on a grip.
	if (_equip >= 0.5 or gripping) and wanted != _gear:
		_gear = wanted
		if rig != null:
			rig.dress({"hands": _gear})
	if _equip >= 1.0:
		_equip = -1.0
		return 0.0
	return sin(_equip * PI) * 0.26
