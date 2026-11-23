class_name CharacterModel
extends Node3D
## Stylized low-poly humanoid built from primitives on a simple joint hierarchy.
## The player uses it for the mirror reflection and shadow; NPCs can reuse it on the world layer.
## `set_physique` thickens arms, torso and legs separately. Faces local -Z.
## Fighters drive `fight_pose` from a FightAnimator for the guard, strikes and knockdowns.

## Workout poses blended over the walk cycle. `pose_progress` drives them.
enum Pose { NONE, BENCH, SQUAT, DEADLIFT, CURL, PUSHUP, STRETCH }

const HIP_HEIGHT := 1.0
const THIGH := 0.5
const SHIN := 0.44
const UPPER_ARM := 0.34
const FOREARM := 0.31
## Hip position while seated on the bicycle, relative to the rider root.
const RIDE_HIP := Vector3(0.0, 0.97, 0.27)

## Layer 3 keeps the body out of the first-person camera; use layer 1 for NPCs.
@export_flags_3d_render var render_layers := 4
@export var skin_color := Color(0.96, 0.76, 0.62)
@export var shirt_color := Color(0.16, 0.62, 0.86)
@export var shorts_color := Color(0.13, 0.15, 0.22)
@export var shoe_color := Color(0.93, 0.25, 0.2)
@export var hair_color := Color(0.26, 0.16, 0.1)

var pose := Pose.NONE
## Lift progress for the active pose, 0 (bottom) to 1 (top). x is the main value (the left arm
## for curls, the side for stretches via y); y is the right arm.
var pose_progress := Vector2.ONE
## Where a lying or planking pose puts the body, relative to the parent.
var pose_offset := Vector3.ZERO
## Fight layer: joint targets from a FightAnimator, blended over the walk cycle and the workout
## poses by `fight_blend` (0 to 1).
var fight_pose: FightPose = null
var fight_blend := 0.0
## Outfit overrides for the rigged body, read once when the model is built (see
## CharacterRig.dress): "body" (&"male" or &"female"), "hair", "top", "hands" and so on.
## Anything left out follows the colours above.
var look: Dictionary = {}
## The rigged body drawn over the joints, or null when no character model could be loaded and
## the primitive body below is shown instead.
var rig: CharacterRig = null

var _arms_girth := 0.0
var _torso_girth := 0.0
var _legs_girth := 0.0
var _pump := 0.0
# Stance set by the physique: arms carried wider and the chest held higher as the torso grows.
var _hang := 0.07
var _chest_out := 0.0

var _hips: Node3D
var _torso: Node3D
var _head: Node3D
var _pelvis: Node3D
var _waist: Node3D
var _chest: Node3D
var _neck: Node3D
var _shoulders: Array[Node3D] = []
var _elbows: Array[Node3D] = []
var _legs: Array[Node3D] = []
var _knees: Array[Node3D] = []
var _hands: Array[Node3D] = []
# Girth-dependent meshes, one entry per side.
var _parts: Array[Dictionary] = []
# Every mesh of the primitive body, hidden while the rig is shown.
var _primitives: Array[MeshInstance3D] = []

var _ride_blend := 0.0
var _pose_blend := 0.0
var _shown_pose := Pose.NONE
var _time := 0.0
# Joint targets for the current frame: index 0 is the left side.
var _leg := [0.0, 0.0]
var _knee := [0.0, 0.0]
var _arm_x := [0.0, 0.0]
var _arm_z := [0.0, 0.0]
var _elbow := [0.0, 0.0]
var _torso_rot := Vector3.ZERO
var _head_x := 0.0
var _root_pos := Vector3.ZERO
var _root_rot := Vector3.ZERO


func _ready() -> void:
	_build()
	_attach_rig()
	_apply_physique()


## Each value runs 0 (lanky) to 1 (shredded); `pump` 0 to 1 adds a temporary swell to the arms.
func set_physique(arms: float, torso: float, legs: float, pump: float = 0.0) -> void:
	_arms_girth = clampf(arms, 0.0, 1.0)
	_torso_girth = clampf(torso, 0.0, 1.0)
	_legs_girth = clampf(legs, 0.0, 1.0)
	_pump = clampf(pump, 0.0, 1.0)
	if is_node_ready():
		_apply_physique()


## Attachment point at the end of a forearm (0 = left, 1 = right) for held props.
func get_hand(index: int) -> Node3D:
	return _hands[index]


## Dresses the rigged body from the colours above and `look`. Call again after changing either.
func refresh_look() -> void:
	if rig == null:
		return
	var bare := shirt_color.is_equal_approx(skin_color)
	var outfit := {
		"skin": skin_color,
		"hair_color": hair_color,
		"hair": "characters/hair_buzzed",
		"shorts": shorts_color,
		"shorts_trim": shorts_color.lightened(0.55),
		"top": CharacterRig.Top.BARE if bare else CharacterRig.Top.TEE,
		"top_color": shirt_color,
		"top_trim": shirt_color.darkened(0.3),
		"shoes": not shoe_color.is_equal_approx(skin_color),
		"shoe_color": shoe_color,
	}
	outfit.merge(look, true)
	rig.dress(outfit)


## Puts gear on the rigged hands (a CharacterRig.Hands value). Returns false when the body is
## the primitive one, which wears FightGear's own glove instead.
func set_hand_gear(style: int, color: Color = Color(0.1, 0.1, 0.13), trim: Color = Color(0.95, 0.95, 0.97)) -> bool:
	if rig == null:
		return false
	rig.dress({"hands": style, "glove_color": color, "glove_trim": trim})
	return true


## Lights one glove of the rigged body (0 = left, 1 = right) for a wind-up.
func set_glove_glow(side: int, amount: float, color: Color) -> void:
	if rig != null:
		rig.set_glove_glow(side, amount, color)


## Call once per physics tick. `stride_phase` advances with distance walked, `pedal_phase` with
## the bicycle crank; `lean` rolls the body with the bike.
func animate(delta: float, stride_phase: float, move_amount: float, look_pitch: float, riding: bool, pedal_phase: float = 0.0, lean: float = 0.0) -> void:
	_time += delta
	_ride_blend = move_toward(_ride_blend, 1.0 if riding else 0.0, delta * 5.0)
	_pose_blend = move_toward(_pose_blend, 1.0 if pose != Pose.NONE else 0.0, delta * 4.0)
	if pose != Pose.NONE:
		_shown_pose = pose

	var ride := smoothstep(0.0, 1.0, _ride_blend)
	var swing := sin(stride_phase) * 0.6 * move_amount
	var breath := sin(_time * 1.6) * 0.012
	for i in 2:
		var side := -1.0 if i == 0 else 1.0
		var step := swing * side
		var pedal := pedal_phase + (PI if i == 1 else 0.0)
		_leg[i] = lerpf(step, 1.28 + 0.3 * sin(pedal), ride)
		_knee[i] = -lerpf(maxf(-step, 0.0) * 1.1 + 0.05, 1.45 - 0.3 * cos(pedal), ride)
		_arm_x[i] = lerpf(-step * 0.8, 1.25, ride)
		_arm_z[i] = side * lerpf(_hang + breath, 0.12, ride)
		_elbow[i] = lerpf(0.12 + absf(step) * 0.5, 0.35, ride)
	_torso_rot = Vector3(lerpf(-0.05 * move_amount + breath + _chest_out, -0.3, ride), 0.0, 0.0)
	_head_x = lerpf(look_pitch * 0.6, 0.3 + look_pitch * 0.4, ride)
	var bob := absf(sin(stride_phase)) * 0.03 * move_amount * (1.0 - ride)
	_root_pos = Vector3(0.0, bob, 0.0).lerp(RIDE_HIP - Vector3(0.0, HIP_HEIGHT, 0.0), ride)
	_root_rot = Vector3(0.0, 0.0, lean * ride)

	if _pose_blend > 0.0:
		_blend_pose(smoothstep(0.0, 1.0, _pose_blend))
	if fight_pose != null and fight_blend > 0.0:
		_blend_fight(smoothstep(0.0, 1.0, fight_blend))

	for i in 2:
		_legs[i].rotation.x = _leg[i]
		_knees[i].rotation.x = _knee[i]
		_shoulders[i].rotation = Vector3(_arm_x[i], 0.0, _arm_z[i])
		_elbows[i].rotation.x = _elbow[i]
	_torso.rotation = _torso_rot
	_head.rotation.x = _head_x
	position = _root_pos
	rotation = _root_rot
	if rig != null:
		_pose_rig()


# Hands close around bars and into fists, and turn to the grip the pose calls for.
func _pose_rig() -> void:
	var lifting := _pose_blend if _shown_pose != Pose.STRETCH else 0.0
	var twist := 0.0
	match _shown_pose:
		Pose.CURL:
			twist = 1.35 * _pose_blend
		Pose.BENCH, Pose.SQUAT, Pose.DEADLIFT, Pose.PUSHUP:
			twist = -1.45 * _pose_blend
	for i in 2:
		var holding := 0.85 if _holds(_hands[i]) else 0.0
		var grip := 0.05 if _shown_pose == Pose.PUSHUP and _pose_blend > 0.5 else 0.9 * lifting
		rig.fist[i] = clampf(maxf(0.28, maxf(maxf(fight_blend, holding), grip)), 0.0, 1.0)
		rig.hand_twist[i] = twist
	rig.pose(transform)


## Overrides the walk targets with the workout pose, weighted by `blend`.
func _blend_pose(blend: float) -> void:
	var main := pose_progress.x
	var down := 1.0 - main
	var leg := [0.0, 0.0]
	var knee := [-0.05, -0.05]
	var arm_x := [0.0, 0.0]
	var arm_z := [0.1, 0.1]
	var elbow := [0.1, 0.1]
	var torso := Vector3.ZERO
	var head := 0.0
	var root_pos := Vector3.ZERO
	var root_rot := Vector3.ZERO
	match _shown_pose:
		Pose.BENCH:
			# Lying face up: the head ends up towards the body's +Z.
			root_rot.x = PI * 0.5
			root_pos = pose_offset
			leg = [0.1, 0.1]
			knee = [-1.45, -1.45]
			arm_x = [lerpf(0.0, 1.5, main), lerpf(0.0, 1.5, main)]
			arm_z = [lerpf(1.15, 0.2, main), lerpf(1.15, 0.2, main)]
			elbow = [lerpf(1.5, 0.05, main), lerpf(1.5, 0.05, main)]
		Pose.SQUAT:
			var hip := 1.4 * down
			var shin := 0.45 * down
			leg = [hip, hip]
			knee = [-(hip + shin), -(hip + shin)]
			# Keep the feet planted: drop the hips and sit them back.
			root_pos.y = THIGH * cos(hip) + SHIN * cos(shin) - THIGH - SHIN
			root_pos.z = THIGH * sin(hip) - SHIN * sin(shin)
			torso.x = -0.45 * down
			head = 0.3 * down
			arm_x = [1.25, 1.25]
			arm_z = [0.25, 0.25]
			elbow = [2.3, 2.3]
		Pose.DEADLIFT:
			var hip := 0.9 * down
			var shin := 0.1 * down
			leg = [hip, hip]
			knee = [-(hip + shin), -(hip + shin)]
			root_pos.y = THIGH * cos(hip) + SHIN * cos(shin) - THIGH - SHIN
			root_pos.z = THIGH * sin(hip) - SHIN * sin(shin)
			torso.x = -1.05 * down
			head = 0.5 * down
			arm_x = [1.05 * down, 1.05 * down]
			arm_z = [0.12, 0.12]
			elbow = [0.05, 0.05]
		Pose.CURL:
			arm_x = [0.1, 0.1]
			elbow = [0.15 + 2.2 * pose_progress.x, 0.15 + 2.2 * pose_progress.y]
		Pose.PUSHUP:
			# A plank pivoting on the toes, face down.
			root_rot.x = -lerpf(1.45, 1.19, main)
			root_pos = pose_offset
			arm_x = [lerpf(0.75, 1.45, main), lerpf(0.75, 1.45, main)]
			arm_z = [lerpf(0.5, 0.15, main), lerpf(0.5, 0.15, main)]
			elbow = [lerpf(1.5, 0.08, main), lerpf(1.5, 0.08, main)]
			head = 0.5
		Pose.STRETCH:
			arm_x = [lerpf(0.1, 2.9, main), lerpf(0.1, 2.9, main)]
			arm_z = [0.15, 0.15]
			torso = Vector3(0.08 * main, 0.0, 0.3 * main * pose_progress.y)
	for i in 2:
		var side := -1.0 if i == 0 else 1.0
		_leg[i] = lerpf(_leg[i], leg[i], blend)
		_knee[i] = lerpf(_knee[i], knee[i], blend)
		_arm_x[i] = lerpf(_arm_x[i], arm_x[i], blend)
		_arm_z[i] = lerpf(_arm_z[i], side * arm_z[i], blend)
		_elbow[i] = lerpf(_elbow[i], elbow[i], blend)
	_torso_rot = _torso_rot.lerp(torso, blend)
	_head_x = lerpf(_head_x, head, blend)
	_root_pos = _root_pos.lerp(root_pos, blend)
	_root_rot = _root_rot.lerp(root_rot, blend)


## Overrides the targets with the fight layer, weighted by `blend`.
func _blend_fight(blend: float) -> void:
	for i in 2:
		var side := -1.0 if i == 0 else 1.0
		_leg[i] = lerpf(_leg[i], fight_pose.leg[i], blend)
		_knee[i] = lerpf(_knee[i], fight_pose.knee[i], blend)
		_arm_x[i] = lerpf(_arm_x[i], fight_pose.arm_x[i], blend)
		_arm_z[i] = lerpf(_arm_z[i], side * fight_pose.arm_z[i], blend)
		_elbow[i] = lerpf(_elbow[i], fight_pose.elbow[i], blend)
	_torso_rot = _torso_rot.lerp(fight_pose.torso, blend)
	_head_x = lerpf(_head_x, fight_pose.head, blend)
	_root_pos = _root_pos.lerp(fight_pose.root_pos, blend)
	_root_rot = _root_rot.lerp(fight_pose.root_rot, blend)


func _build() -> void:
	var skin := Build.mat(skin_color, 0.7)
	var shirt := Build.mat(shirt_color, 0.8)
	var shorts := Build.mat(shorts_color, 0.8)
	var shoes := Build.mat(shoe_color, 0.6)
	var hair := Build.mat(hair_color, 0.9)

	# Girth-dependent parts are unit meshes sized by `_apply_physique`.
	_hips = _pivot(self, Vector3(0.0, HIP_HEIGHT, 0.0))
	_pelvis = Build.box(_hips, Vector3.ONE, Vector3(0.0, 0.07, 0.0), shorts)
	_torso = _pivot(_hips, Vector3(0.0, 0.14, 0.0))
	_waist = Build.box(_torso, Vector3.ONE, Vector3(0.0, 0.11, 0.0), shirt)
	_chest = Build.box(_torso, Vector3.ONE, Vector3(0.0, 0.355, 0.0), shirt)
	_neck = Build.cyl(_torso, 1.0, 1.0, Vector3(0.0, 0.52, 0.0), skin)

	_head = _pivot(_torso, Vector3(0.0, 0.555, 0.0))
	Build.ball(_head, 0.115, Vector3(0.0, 0.115, 0.0), skin, Vector3(0.9, 1.08, 1.0))
	Build.ball(_head, 0.12, Vector3(0.0, 0.155, 0.022), hair, Vector3(0.94, 0.86, 1.0))
	var eyes := Build.mat(Color(0.1, 0.1, 0.12), 0.4)
	for side: float in [-1.0, 1.0]:
		Build.ball(_head, 0.014, Vector3(side * 0.04, 0.125, -0.103), eyes)
		Build.box(_head, Vector3(0.04, 0.008, 0.01), Vector3(side * 0.04, 0.152, -0.105), hair)
	Build.box(_head, Vector3(0.02, 0.03, 0.03), Vector3(0.0, 0.1, -0.115), skin)

	for side: float in [-1.0, 1.0]:
		var part := {}
		var shoulder := _pivot(_torso, Vector3.ZERO)
		part["delt"] = Build.ball(shoulder, 1.0, Vector3(0.0, -0.01, 0.0), shirt, Vector3.ONE, 10)
		part["upper"] = Build.cyl(shoulder, 1.0, 1.0, Vector3(0.0, -UPPER_ARM * 0.5, 0.0), skin, false, Vector3.ZERO, -1.0, 10)
		part["sleeve"] = Build.cyl(shoulder, 1.0, 1.0, Vector3(0.0, -0.06, 0.0), shirt, false, Vector3.ZERO, -1.0, 10)
		part["bicep"] = Build.ball(shoulder, 1.0, Vector3(0.0, -UPPER_ARM * 0.52, -0.008), skin, Vector3.ONE, 8)
		var elbow := _pivot(shoulder, Vector3(0.0, -UPPER_ARM, 0.0))
		part["elbow"] = Build.ball(elbow, 1.0, Vector3.ZERO, skin, Vector3.ONE, 8)
		# Tapered: thick below the elbow, slim at the wrist.
		part["forearm"] = Build.cyl(elbow, 0.68, 1.0, Vector3(0.0, -FOREARM * 0.5, 0.0), skin, false, Vector3.ZERO, 1.0, 10)
		Build.box(elbow, Vector3(0.045, 0.1, 0.07), Vector3(0.0, -FOREARM - 0.045, 0.0), skin)
		_hands.append(_pivot(elbow, Vector3(0.0, -FOREARM - 0.05, 0.0)))
		part["pec"] = Build.box(_torso, Vector3.ONE, Vector3.ZERO, shirt)
		_shoulders.append(shoulder)
		_elbows.append(elbow)

		var leg := _pivot(_hips, Vector3.ZERO)
		part["thigh"] = Build.cyl(leg, 0.8, 1.0, Vector3(0.0, -THIGH * 0.5, 0.0), skin, false, Vector3.ZERO, 1.0, 10)
		part["shorts"] = Build.cyl(leg, 1.0, 1.0, Vector3(0.0, -0.11, 0.0), shorts, false, Vector3.ZERO, -1.0, 10)
		var knee := _pivot(leg, Vector3(0.0, -THIGH, 0.0))
		part["knee"] = Build.ball(knee, 1.0, Vector3.ZERO, skin, Vector3.ONE, 8)
		part["shin"] = Build.cyl(knee, 0.72, 1.0, Vector3(0.0, -SHIN * 0.5, 0.0), skin, false, Vector3.ZERO, 1.0, 10)
		part["calf"] = Build.ball(knee, 1.0, Vector3(0.0, -SHIN * 0.34, 0.012), skin, Vector3.ONE, 8)
		Build.box(knee, Vector3(0.09, 0.07, 0.25), Vector3(0.0, -SHIN - 0.025, -0.055), shoes)
		_legs.append(leg)
		_knees.append(knee)
		_parts.append(part)

	for mesh: MeshInstance3D in find_children("*", "MeshInstance3D", true, false):
		mesh.layers = render_layers
		_primitives.append(mesh)


# True when something other than a glove hangs off the hand attachment.
func _holds(hand: Node3D) -> bool:
	for child in hand.get_children():
		if not String(child.name).begins_with("Glove"):
			return true
	return false


# Swaps the primitive body for the rigged one when a character model is available.
func _attach_rig() -> void:
	rig = CharacterRig.create(look.get("body", &"male"), render_layers)
	if rig == null:
		return
	add_child(rig)
	rig.bind(_hips, _torso, _head, _shoulders, _elbows, _hands, _legs, _knees)
	for mesh in _primitives:
		mesh.visible = false
	refresh_look()


func _apply_physique() -> void:
	var arm := _arms_girth
	var torso := _torso_girth
	var leg := _legs_girth
	var swell := 1.0 + 0.08 * _pump
	# An athletic V: the chest and shoulders widen far more than the waist.
	var chest := Vector2(lerpf(0.27, 0.42, torso), lerpf(0.14, 0.215, torso))
	var waist := Vector2(lerpf(0.245, 0.3, torso), lerpf(0.13, 0.17, torso))
	var upper := lerpf(0.03, 0.05, arm) * swell
	var fore := lerpf(0.027, 0.045, arm) * swell
	var thigh := lerpf(0.045, 0.078, leg)
	var shin := lerpf(0.036, 0.048, leg)
	var neck := lerpf(0.04, 0.062, torso)

	_pelvis.scale = Vector3(waist.x + 0.02, 0.2, waist.y + 0.03)
	_waist.scale = Vector3(waist.x, 0.24, waist.y)
	_chest.scale = Vector3(chest.x, 0.27, chest.y)
	_neck.scale = Vector3(neck, 0.1, neck)
	for i in 2:
		var side := -1.0 if i == 0 else 1.0
		var part := _parts[i]
		_shoulders[i].position = Vector3(side * (chest.x * 0.5 + upper * 0.7), 0.43, 0.0)
		_legs[i].position = Vector3(side * lerpf(0.075, 0.105, maxf(torso, leg)), 0.0, 0.0)
		_scale(part, "delt", Vector3.ONE * lerpf(0.045, 0.084, maxf(arm, torso)) * swell)
		_scale(part, "upper", Vector3(upper, UPPER_ARM, upper))
		_scale(part, "sleeve", Vector3(upper * 1.4, 0.15, upper * 1.4))
		_scale(part, "bicep", Vector3(1.0, 2.4, 1.0) * upper * lerpf(0.85, 1.28, arm))
		_scale(part, "elbow", Vector3.ONE * fore)
		_scale(part, "forearm", Vector3(fore, FOREARM, fore))
		_scale(part, "thigh", Vector3(thigh, THIGH, thigh))
		_scale(part, "shorts", Vector3(thigh * 1.35, 0.26, thigh * 1.35))
		_scale(part, "knee", Vector3.ONE * thigh * 0.8)
		_scale(part, "shin", Vector3(shin, SHIN, shin))
		_scale(part, "calf", Vector3(1.0, 2.3, 1.15) * shin * lerpf(0.9, 1.42, leg))
		var pec := part["pec"] as Node3D
		pec.visible = torso > 0.12 and rig == null
		pec.scale = Vector3(chest.x * 0.43, 0.11, 0.012 + 0.02 * torso)
		pec.position = Vector3(side * chest.x * 0.235, 0.405, 0.004 - (chest.y + pec.scale.z) * 0.5)
	_hang = 0.07 + 0.11 * torso
	_chest_out = 0.035 * torso
	if rig != null:
		rig.set_physique(arm, torso, leg, _pump)


func _scale(part: Dictionary, key: String, size: Vector3) -> void:
	(part[key] as Node3D).scale = size


func _pivot(parent: Node3D, pos: Vector3) -> Node3D:
	var node := Node3D.new()
	node.position = pos
	parent.add_child(node)
	return node
