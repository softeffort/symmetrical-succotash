class_name CharacterRig
extends Node3D
## The rigged body a CharacterModel shows instead of its primitive joints.
##
## CharacterModel keeps animating its own joint hierarchy exactly as before (walk cycle, workout
## poses, the whole fight layer); every tick this node copies that pose onto the bones of an
## imported humanoid: the spine shares the torso's lean and twist, the arms follow the shoulder
## and elbow angles, the legs are solved so the feet land where the joints put them, and the
## fingers close into fists. Clothing, hand wraps and gloves are drawn by the body shader from
## rest-pose masks, so one mesh dresses every fighter and gym-goer.
##
## Any humanoid `.glb` whose bones can be matched by name (see BONES) works; if none loads,
## `create` returns null and the model simply keeps its primitive body.

const BODY_SHADER := "res://shaders/character_body.gdshader"
const BODIES := {&"male": "characters/superhero_male", &"female": "characters/superhero_female"}
const HIP_HEIGHT := 1.0
## Arms are drawn a little longer than the mesh's own, towards the reach the fight is tuned for.
const ARM_STRETCH := 1.1
## Share of the torso's rotation each spine bone has reached, bottom to top.
const SPINE_SHARE: Array[float] = [0.3, 0.65, 1.0]
enum Top { BARE, TANK, TEE, OVERSIZED, CROP }
enum Hands { BARE, WRIST_WRAPS, TAPED, GLOVES }

## Names each joint goes by in the common free rigs (Quaternius / Unreal, Mixamo, Godot's
## humanoid profile, KayKit). The left side is listed; the right is derived.
const BONES := {
	"pelvis": ["pelvis", "Hips", "mixamorig:Hips", "hips"],
	"spine1": ["spine_01", "Spine", "mixamorig:Spine", "spine"],
	"spine2": ["spine_02", "Chest", "mixamorig:Spine1"],
	"spine3": ["spine_03", "UpperChest", "mixamorig:Spine2", "chest"],
	"neck": ["neck_01", "Neck", "mixamorig:Neck", "neck"],
	"head": ["Head", "head", "mixamorig:Head"],
	"clav": ["clavicle_l", "LeftShoulder", "mixamorig:LeftShoulder"],
	"upper": ["upperarm_l", "LeftUpperArm", "mixamorig:LeftArm", "upperarm.l"],
	"lower": ["lowerarm_l", "LeftLowerArm", "mixamorig:LeftForeArm", "lowerarm.l"],
	"hand": ["hand_l", "LeftHand", "mixamorig:LeftHand", "hand.l"],
	"thigh": ["thigh_l", "LeftUpperLeg", "mixamorig:LeftUpLeg", "upperleg.l"],
	"calf": ["calf_l", "LeftLowerLeg", "mixamorig:LeftLeg", "lowerleg.l"],
	"foot": ["foot_l", "LeftFoot", "mixamorig:LeftFoot", "foot.l"],
}
const FINGERS: Array[String] = ["index", "middle", "ring", "pinky"]
## Bones a first-person arm is skinned to; see `_arms_only`.
const ARM_BONES: Array[String] = ["upperarm", "lowerarm", "hand", "index", "middle", "ring", "pinky", "thumb", "UpperArm", "LowerArm", "ForeArm", "Hand", "Arm"]
## Flexion of the three finger joints and the three thumb joints at a full fist, in radians.
const FINGER_CURL: Array[float] = [1.35, 1.65, 1.15]
const THUMB_CURL: Array[float] = [0.5, 0.45, 0.95]

static var _baked: Dictionary = {}

var skeleton: Skeleton3D
var material: ShaderMaterial
## 0 (open hand) to 1 (fist) per hand; set by CharacterModel every tick.
var fist: Array[float] = [0.25, 0.25]
## Forearm rotation per hand in radians: 0 has the palms facing the thighs, positive turns
## them forwards (the grip of a curl), negative backwards (an overhand grip on a bar).
var hand_twist: Array[float] = [0.0, 0.0]
## Posture: radians the upper back rounds forward, and metres each shoulder sits further out.
var slouch := 0.0
var shoulders := 0.0

var _body: MeshInstance3D
var _parts: Array[MeshInstance3D] = []
var _to_model := Transform3D.IDENTITY
var _from_model := Transform3D.IDENTITY
var _turn := Basis.IDENTITY
var _turn_inv := Basis.IDENTITY
var _scale := 1.0
var _parent: PackedInt32Array = []
var _rest_local: Array[Transform3D] = []
var _rest_basis: Array[Basis] = []
var _gb: Array[Basis] = []
var _go: PackedVector3Array = []
var _spine: PackedInt32Array = []
var _neck := -1
var _head := -1
# Per side (0 left, 1 right).
var _clav: PackedInt32Array = [-1, -1]
var _upper: PackedInt32Array = [-1, -1]
var _lower: PackedInt32Array = [-1, -1]
var _hand: PackedInt32Array = [-1, -1]
var _thigh: PackedInt32Array = [-1, -1]
var _calf: PackedInt32Array = [-1, -1]
var _foot: PackedInt32Array = [-1, -1]
var _arm_ref: Array = [[], []]
var _leg_rest_inv: Array = [[], []]
var _leg_length: Array = [Vector2.ZERO, Vector2.ZERO]
var _hip_x: Array[float] = [0.0, 0.0]
var _ankle_height := 0.09
var _palm: Array[Vector3] = [Vector3.ZERO, Vector3.ZERO]
var _fingers: Array = [[], []]
var _shown_fist: Array[float] = [-1.0, -1.0]
var _base_skin := Color(0.8, 0.56, 0.44)
# Set before `_load` by ArmsRig: skin the mesh to the arm bones alone.
var _arms_only := false
var _glow := Vector2.ZERO
# Driver joints of the CharacterModel.
var _d_hips: Node3D
var _d_torso: Node3D
var _d_head: Node3D
var _d_shoulders: Array[Node3D]
var _d_elbows: Array[Node3D]
var _d_hands: Array[Node3D]
var _d_legs: Array[Node3D]
var _d_knees: Array[Node3D]


## Builds the rig for `body` ("male" or "female", or a model id) on render `layers`, or returns
## null when the model or one of its main bones is missing.
static func create(body: StringName, layers: int) -> CharacterRig:
	var id: String = BODIES.get(body, String(body))
	if not ModelLoader.has_model(id):
		return null
	var rig := CharacterRig.new()
	rig.name = "Rig"
	if not rig._load(id, layers):
		rig.free()
		return null
	return rig


## Hands over the CharacterModel joints this rig copies its pose from.
func bind(hips: Node3D, torso: Node3D, head: Node3D, shoulders: Array[Node3D], elbows: Array[Node3D], hands: Array[Node3D], legs: Array[Node3D], knees: Array[Node3D]) -> void:
	_d_hips = hips
	_d_torso = torso
	_d_head = head
	_d_shoulders = shoulders
	_d_elbows = elbows
	_d_hands = hands
	_d_legs = legs
	_d_knees = knees


## Colours and outfit. Keys (all optional): "skin", "hair_color", "hair" (model id or ""),
## "shorts", "shorts_trim", "shorts_len", "top" (Top), "top_color", "top_trim", "shoes" (bool),
## "shoe_color", "hands" (Hands), "glove_color", "glove_trim", "wrap_color", "slouch" and
## "shoulders" (see the posture variables). "hair" may also be a list of pieces.
func dress(look: Dictionary) -> void:
	slouch = look.get("slouch", slouch)
	shoulders = look.get("shoulders", shoulders)
	if look.has("skin"):
		var skin := (look["skin"] as Color).srgb_to_linear()
		material.set_shader_parameter("skin_tint", Vector3(clampf(skin.r / _base_skin.r, 0.25, 1.8), clampf(skin.g / _base_skin.g, 0.25, 1.8), clampf(skin.b / _base_skin.b, 0.25, 1.8)))
	_set_color(look, "shorts", "shorts_color")
	_set_color(look, "shorts_trim", "shorts_trim")
	_set_color(look, "top_color", "top_color")
	_set_color(look, "top_trim", "top_trim")
	_set_color(look, "shoe_color", "shoe_color")
	_set_color(look, "glove_color", "glove_color")
	_set_color(look, "glove_trim", "glove_trim")
	_set_color(look, "wrap_color", "wrap_color")
	if look.has("shorts_len"):
		material.set_shader_parameter("shorts_len", look["shorts_len"])
	if look.has("top"):
		material.set_shader_parameter("top_style", look["top"])
	if look.has("shoes"):
		material.set_shader_parameter("shoe_style", 1 if look["shoes"] else 0)
	if look.has("hands"):
		material.set_shader_parameter("hand_style", look["hands"])
	if look.has("hair_color"):
		var hair: Color = look["hair_color"]
		for part in _parts:
			if part.has_meta("hair"):
				part.material_override = Stylized.standard(hair, 0.72, 0.0, Stylized.Surface.FABRIC)
	if look.has("hair"):
		_set_hair(look["hair"], look.get("hair_color", Color(0.2, 0.14, 0.1)))


## Arms, torso and legs from 0 (lean) to 1 (shredded); `pump` 0 to 1 swells the arms and
## brings out the veins and a sheen of sweat.
func set_physique(arms: float, torso: float, legs: float, pump: float = 0.0) -> void:
	var units := 1.0 / _scale
	material.set_shader_parameter("girth", Vector3(lerpf(-0.011, 0.005, arms) + 0.003 * pump, lerpf(-0.013, 0.004, torso), lerpf(-0.011, 0.004, legs)) * units)
	material.set_shader_parameter("definition", 0.2 + 0.2 * (arms + torso + legs) + 0.15 * pump)
	material.set_shader_parameter("veins", clampf(smoothstep(0.4, 1.0, arms) * 0.75 + 0.35 * pump, 0.0, 1.0))
	material.set_shader_parameter("sweat", pump)


## Lights the left (0) or right (1) glove: the tell of a heavy strike.
func set_glove_glow(side: int, amount: float, color: Color) -> void:
	if is_equal_approx(_glow[side], amount):
		return
	_glow[side] = amount
	material.set_shader_parameter("glove_glow", _glow)
	material.set_shader_parameter("glow_color", Color(color.r, color.g, color.b))


func set_layers(layers: int) -> void:
	for part in _parts:
		part.layers = layers


## Copies the bound joints' pose onto the skeleton. `model` is the CharacterModel's transform
## in its parent, whose y = 0 plane is the floor the feet flatten onto.
func pose(model: Transform3D) -> void:
	var torso := _d_torso.transform.basis
	var torso_q := Quaternion(_local(torso))
	var slouch_q := Quaternion(_local(Basis(Vector3.RIGHT, -slouch)))
	for index in _spine.size():
		var bone := _spine[index]
		var share := SPINE_SHARE[index] if index < _spine.size() - 1 else 1.0
		var bend := Quaternion.IDENTITY.slerp(torso_q, share) * Quaternion.IDENTITY.slerp(slouch_q, share * share)
		_write(bone, Basis(bend) * _rest_basis[bone], _fk(bone))
	var chest := Basis(torso_q * slouch_q)
	var spread := chest.x * (shoulders / _scale)
	var head_q := Quaternion(_local(torso * _d_head.transform.basis))
	if _neck >= 0:
		_write(_neck, Basis(torso_q.slerp(head_q, 0.5)) * _rest_basis[_neck], _fk(_neck))
	if _head >= 0:
		_write(_head, Basis(head_q) * _rest_basis[_head], _fk(_head))

	var floor_up := (model.basis.inverse() * Vector3.UP).normalized()
	var hips := _d_hips.transform
	for i in 2:
		# Arm: the clavicle rides the chest, then shoulder and elbow angles as they are.
		var clav := _clav[i]
		if clav >= 0:
			_write(clav, chest * _rest_basis[clav], _fk(clav))
		var shoulder := torso * _d_shoulders[i].transform.basis
		var elbow := shoulder * _d_elbows[i].transform.basis
		var refs: Array = _arm_ref[i]
		var upper := _upper[i]
		var lower := _lower[i]
		var hand := _hand[i]
		var twist := hand_twist[i] * (1.0 if i == 0 else -1.0)
		_write(upper, _local(shoulder) * (refs[0] as Basis), _fk(upper) + spread * (1.0 if i == 0 else -1.0))
		var fore: Basis = _local(elbow) * (refs[1] as Basis) * Basis(Vector3.UP, twist * 0.5)
		_write(lower, fore, _go[upper] + _gb[upper] * _rest_local[lower].origin * ARM_STRETCH)
		_write(hand, _local(elbow) * (refs[2] as Basis) * Basis(Vector3.UP, twist), _go[lower] + fore * _rest_local[hand].origin * ARM_STRETCH)
		if not is_equal_approx(fist[i], _shown_fist[i]):
			_curl(i, fist[i])
		# The attachment point for gloves, dumbbells and bottles sits in the rigged palm.
		var arm := _d_hips.transform * _d_torso.transform * _d_shoulders[i].transform * _d_elbows[i].transform
		var grip := _to_model * (_go[hand] + _gb[hand] * _palm[i])
		_d_hands[i].transform = arm.affine_inverse() * Transform3D(elbow, grip)

		# Leg: two-bone solve from the rigged hip to where the joints put the sole.
		var thigh_frame := hips * _d_legs[i].transform
		var knee_frame := thigh_frame * _d_knees[i].transform
		var sole := knee_frame * Vector3(0.0, -(CharacterModel.SHIN + 0.06), 0.0)
		sole.x += _hip_x[i] - _d_legs[i].position.x
		var shin_up := knee_frame.basis.y
		var planted := (1.0 - smoothstep(0.08, 0.2, (model * sole).y)) * smoothstep(0.35, 0.7, (model.basis * shin_up).normalized().y)
		var up := shin_up.lerp(floor_up, planted).normalized()
		var ankle := _from_model * (sole + up * _ankle_height)
		var forward := _turn_inv * (thigh_frame.basis.z + knee_frame.basis.z) * -1.0
		_solve_leg(i, ankle, forward.normalized(), _turn_inv * up)


func _solve_leg(i: int, ankle: Vector3, forward: Vector3, up: Vector3) -> void:
	var thigh := _thigh[i]
	var calf := _calf[i]
	var foot := _foot[i]
	var hip := _fk(thigh)
	var lengths: Vector2 = _leg_length[i]
	var reach := ankle - hip
	var distance := clampf(reach.length(), 0.05, (lengths.x + lengths.y) * 1.04)
	var direction := reach.normalized()
	# A leg at full stretch gives a little rather than leaving the foot short of the floor.
	var give := maxf(distance / (lengths.x + lengths.y - 0.002), 1.0)
	var a := lengths.x * give
	var b := lengths.y * give
	var along := (a * a - b * b + distance * distance) / (2.0 * distance)
	var out := sqrt(maxf(a * a - along * along, 0.0))
	var bend := forward - direction * forward.dot(direction)
	bend = bend.normalized() if bend.length_squared() > 0.0001 else _turn_inv * Vector3.FORWARD
	var knee := hip + direction * along + bend * out
	var foot_at := hip + direction * distance
	var rest_inv: Array = _leg_rest_inv[i]
	_write(thigh, _frame(knee - hip, bend) * (rest_inv[0] as Basis) * _rest_basis[thigh], hip)
	_write(calf, _frame(foot_at - knee, bend) * (rest_inv[1] as Basis) * _rest_basis[calf], knee)
	var toe := bend - up * bend.dot(up)
	toe = toe.normalized() if toe.length_squared() > 0.01 else (foot_at - knee).normalized()
	_write(foot, Basis(up.cross(toe), up, toe) * _rest_basis[foot], foot_at)


## Closes hand `i` by `amount`: 0 is the open rest pose, 1 a fist with the thumb across.
func _curl(i: int, amount: float) -> void:
	_shown_fist[i] = amount
	for joint: Array in _fingers[i]:
		skeleton.set_bone_pose_rotation(joint[0], (joint[1] as Quaternion) * Quaternion(joint[2] as Vector3, amount * (joint[3] as float)))


# Orthonormal frame whose -Y runs along `direction`, +Z as close to `forward` as that allows.
func _frame(direction: Vector3, forward: Vector3) -> Basis:
	var y := -direction.normalized()
	var z := forward - y * forward.dot(y)
	z = z.normalized() if z.length_squared() > 0.000001 else y.cross(Vector3.RIGHT).normalized()
	return Basis(y.cross(z), y, z)


# A rotation given in the CharacterModel's space, expressed in the skeleton's.
func _local(rotation: Basis) -> Basis:
	return _turn_inv * rotation * _turn


# Where the bone's rest offset puts it under its parent's current pose.
func _fk(bone: int) -> Vector3:
	var parent := _parent[bone]
	return _go[parent] + _gb[parent] * _rest_local[bone].origin


func _write(bone: int, basis: Basis, origin: Vector3) -> void:
	_gb[bone] = basis
	_go[bone] = origin
	var parent := _parent[bone]
	var inverse := _gb[parent].transposed()
	skeleton.set_bone_pose_rotation(bone, (inverse * basis).orthonormalized().get_rotation_quaternion())
	skeleton.set_bone_pose_position(bone, inverse * (origin - _go[parent]))


func _load(id: String, layers: int) -> bool:
	var pivot := ModelLoader.instantiate(id, 0.0, {"stylize": false})
	add_child(pivot)
	var found := pivot.find_children("*", "Skeleton3D", true, false)
	if found.is_empty():
		return false
	skeleton = found[0]
	if not _map_bones():
		return false
	# Scale the model so its hip joints stand exactly where CharacterModel's do.
	var fit := pivot.get_node("Fit") as Node3D
	_to_model = _chain(skeleton, self)
	_scale = HIP_HEIGHT / (_to_model * skeleton.get_bone_global_rest(_thigh[0]).origin).y
	fit.transform = Transform3D(fit.basis * _scale, fit.position * _scale)
	_to_model = _chain(skeleton, self)
	_from_model = _to_model.affine_inverse()
	_turn = _to_model.basis.orthonormalized()
	_turn_inv = _turn.transposed()
	_read_rest()

	for node in pivot.find_children("*", "MeshInstance3D", true, false):
		var part := node as MeshInstance3D
		part.layers = layers
		part.extra_cull_margin = 0.25
		_parts.append(part)
		if _body == null or part.mesh.get_aabb().get_volume() > _body.mesh.get_aabb().get_volume():
			_body = part
	if _body == null or _body.skin == null:
		return false
	var baked := _bake(id, _body, skeleton, _arms_only)
	_body.mesh = baked["mesh"]
	_base_skin = baked["skin"]
	material = ShaderMaterial.new()
	material.shader = load(BODY_SHADER)
	material.set_shader_parameter("albedo_tex", baked["texture"])
	material.set_shader_parameter("skin_height", Stylized.height_map(Stylized.Surface.SKIN))
	material.set_shader_parameter("fabric_height", Stylized.height_map(Stylized.Surface.FABRIC))
	material.set_shader_parameter("leather_height", Stylized.height_map(Stylized.Surface.LEATHER))
	material.set_shader_parameter("soft_height", Stylized.height_map(Stylized.Surface.PLAIN))
	_set_landmarks(baked["reach"])
	_body.material_override = material
	for part in _parts:
		if part == _body:
			continue
		# Eyebrows share the hair colour; the eyes keep their own texture.
		var source := part.get_active_material(0)
		if String(part.name).to_lower().contains("brow"):
			part.set_meta("hair", true)
			part.material_override = Stylized.standard(Color(0.2, 0.14, 0.1), 0.72, 0.0, Stylized.Surface.FABRIC)
		elif source != null:
			part.material_override = Stylized.convert(source)
	return true


func _map_bones() -> bool:
	var pelvis := _find("pelvis", 0)
	for key: String in ["spine1", "spine2", "spine3"]:
		var bone := _find(key, 0)
		if bone >= 0:
			_spine.append(bone)
	_neck = _find("neck", 0)
	_head = _find("head", 0)
	for i in 2:
		_clav[i] = _find("clav", i)
		_upper[i] = _find("upper", i)
		_lower[i] = _find("lower", i)
		_hand[i] = _find("hand", i)
		_thigh[i] = _find("thigh", i)
		_calf[i] = _find("calf", i)
		_foot[i] = _find("foot", i)
		if _upper[i] < 0 or _lower[i] < 0 or _hand[i] < 0 or _thigh[i] < 0 or _calf[i] < 0 or _foot[i] < 0:
			return false
	return pelvis >= 0 and _spine.size() > 0


# Bone for a BONES key on side 0 (left) or 1 (right), or -1.
func _find(key: String, side: int) -> int:
	for candidate: String in BONES[key]:
		var name := candidate
		if side == 1:
			name = name.replace("_l", "_r").replace("Left", "Right").replace(".l", ".r")
		var bone := skeleton.find_bone(name)
		if bone >= 0:
			return bone
	return -1


func _read_rest() -> void:
	var count := skeleton.get_bone_count()
	_parent.resize(count)
	_rest_local.resize(count)
	_rest_basis.resize(count)
	_gb.resize(count)
	_go.resize(count)
	for bone in count:
		var rest := skeleton.get_bone_global_rest(bone)
		_parent[bone] = maxi(skeleton.get_bone_parent(bone), 0)
		_rest_local[bone] = skeleton.get_bone_rest(bone)
		_rest_basis[bone] = rest.basis.orthonormalized()
		_gb[bone] = _rest_basis[bone]
		_go[bone] = rest.origin
	var down := _turn_inv * Vector3.DOWN
	var front := _turn_inv * Vector3.FORWARD
	for i in 2:
		# Arms hang straight down in CharacterModel's zero pose; the rig rests in a T-pose.
		var arm := (_go[_hand[i]] - _go[_upper[i]]).normalized()
		var hang := Basis(Quaternion(arm, down))
		_arm_ref[i] = [hang * _rest_basis[_upper[i]], hang * _rest_basis[_lower[i]], hang * _rest_basis[_hand[i]]]
		_leg_rest_inv[i] = [_frame(_go[_calf[i]] - _go[_thigh[i]], front).transposed(), _frame(_go[_foot[i]] - _go[_calf[i]], front).transposed()]
		_leg_length[i] = Vector2((_go[_calf[i]] - _go[_thigh[i]]).length(), (_go[_foot[i]] - _go[_calf[i]]).length())
		_hip_x[i] = (_to_model * _go[_thigh[i]]).x
		_read_fingers(i)
	_ankle_height = (_to_model * _go[_foot[0]]).y


func _read_fingers(i: int) -> void:
	var suffix := "_l" if i == 0 else "_r"
	var hand := _hand[i]
	var index := skeleton.find_bone("index_01" + suffix)
	var pinky := skeleton.find_bone("pinky_01" + suffix)
	var middle := skeleton.find_bone("middle_01" + suffix)
	# The middle of the fist, in the hand bone's own frame.
	_palm[i] = Vector3(0.0, 0.085, 0.0) / _scale * 1.0
	if index < 0 or pinky < 0 or middle < 0:
		return
	var knuckles := _go[middle] - _go[hand]
	_palm[i] = _rest_basis[hand].transposed() * (knuckles * 0.72)
	var across := (_go[pinky] - _go[index]).normalized()
	var palm := -(_go[index] - _go[hand]).cross(_go[pinky] - _go[hand]).normalized() * signf(_go[hand].x - _go[_upper[i]].x)
	var joints: Array = []
	for finger in FINGERS:
		for joint in 3:
			var bone := skeleton.find_bone("%s_0%d%s" % [finger, joint + 1, suffix])
			if bone < 0:
				continue
			var along := _rest_basis[bone].y
			var axis := _rest_basis[bone].transposed() * along.cross(palm).normalized()
			joints.append([bone, skeleton.get_bone_rest(bone).basis.get_rotation_quaternion(), axis, FINGER_CURL[joint]])
	for joint in 3:
		var bone := skeleton.find_bone("thumb_0%d%s" % [joint + 1, suffix])
		if bone < 0:
			continue
		# The thumb folds across the fingers rather than into the palm.
		var along := _rest_basis[bone].y
		var towards := (palm * 0.45 + across * 0.9).normalized()
		var axis := _rest_basis[bone].transposed() * along.cross(towards).normalized()
		joints.append([bone, skeleton.get_bone_rest(bone).basis.get_rotation_quaternion(), axis, THUMB_CURL[joint]])
	_fingers[i] = joints


func _set_landmarks(reach: float) -> void:
	var rest := func(bone: int) -> Vector3: return skeleton.get_bone_global_rest(bone).origin
	var hand: Vector3 = rest.call(_hand[0])
	var pelvis: Vector3 = rest.call(_parent[_spine[0]])
	material.set_shader_parameter("hip_y", (rest.call(_thigh[0]) as Vector3).y)
	material.set_shader_parameter("waist_y", pelvis.y + 0.075)
	material.set_shader_parameter("ankle_y", (rest.call(_foot[0]) as Vector3).y)
	material.set_shader_parameter("neck_y", (rest.call(_neck) as Vector3).y if _neck >= 0 else pelvis.y + 0.57)
	material.set_shader_parameter("arm_y", hand.y)
	material.set_shader_parameter("arm_z", hand.z)
	material.set_shader_parameter("shoulder_x", absf((rest.call(_upper[0]) as Vector3).x))
	material.set_shader_parameter("elbow_x", absf((rest.call(_lower[0]) as Vector3).x))
	material.set_shader_parameter("wrist_x", absf(hand.x))
	material.set_shader_parameter("hand_len", maxf(reach - absf(hand.x), 0.05))


func _set_color(look: Dictionary, key: String, parameter: String) -> void:
	if look.has(key):
		var color: Color = look[key]
		material.set_shader_parameter(parameter, Color(color.r, color.g, color.b))


func _set_hair(pieces: Variant, color: Color) -> void:
	for part in _parts.duplicate():
		if part.has_meta("hairpiece"):
			_parts.erase(part)
			part.queue_free()
	for id: String in (pieces as Array if pieces is Array else [pieces]):
		_add_hair(id, color)


func _add_hair(id: String, color: Color) -> void:
	if id == "" or not ModelLoader.has_model(id):
		return
	var scene := ModelLoader.raw(id)
	for node in scene.find_children("*", "MeshInstance3D", true, false):
		var piece := node as MeshInstance3D
		piece.get_parent().remove_child(piece)
		piece.owner = null
		skeleton.add_child(piece)
		piece.skeleton = NodePath("..")
		piece.set_meta("hair", true)
		piece.set_meta("hairpiece", true)
		piece.layers = _body.layers
		piece.extra_cull_margin = 0.25
		piece.material_override = Stylized.standard(color, 0.72, 0.0, Stylized.Surface.FABRIC)
		_parts.append(piece)
	scene.free()


# Transform taking `node`'s space to `ancestor`'s.
static func _chain(node: Node3D, ancestor: Node3D) -> Transform3D:
	var result := Transform3D.IDENTITY
	var walker: Node = node
	while walker != ancestor and walker != null:
		if walker is Node3D:
			result = (walker as Node3D).transform * result
		walker = walker.get_parent()
	return result


# The body mesh with its rest pose stored per vertex (CUSTOM0), shared by every instance.
## With `arms_only` every vertex an arm bone moves is skinned to the arm bones alone, so a
## first-person arm posed far from the (unposed) chest does not drag its shoulder behind it.
static func _bake(id: String, body: MeshInstance3D, bones_of: Skeleton3D, arms_only: bool = false) -> Dictionary:
	var key := id + (":arms" if arms_only else "")
	if _baked.has(key):
		return _baked[key]
	var source := body.mesh
	var skin := body.skin
	var thumb := PackedByteArray()
	var arm := PackedByteArray()
	thumb.resize(skin.get_bind_count())
	arm.resize(skin.get_bind_count())
	for bind in skin.get_bind_count():
		var bound := String(skin.get_bind_name(bind))
		if bound == "" and skin.get_bind_bone(bind) >= 0:
			bound = bones_of.get_bone_name(skin.get_bind_bone(bind))
		thumb[bind] = 1 if bound.to_lower().contains("thumb") else 0
		for part in ARM_BONES:
			if bound.contains(part):
				arm[bind] = 1
	var mesh := ArrayMesh.new()
	var reach := 0.0
	var texture: Texture2D = null
	for surface in source.get_surface_count():
		var arrays := source.surface_get_arrays(surface)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var bones: PackedInt32Array = arrays[Mesh.ARRAY_BONES]
		var weights: PackedFloat32Array = (arrays[Mesh.ARRAY_WEIGHTS] as PackedFloat32Array).duplicate()
		@warning_ignore("integer_division")
		var per := bones.size() / maxi(vertices.size(), 1)
		var custom := PackedFloat32Array()
		custom.resize(vertices.size() * 4)
		for v in vertices.size():
			var point := vertices[v]
			var share := 0.0
			for k in per:
				var slot := v * per + k
				if bones[slot] < thumb.size() and thumb[bones[slot]] == 1:
					share += weights[slot]
			custom[v * 4] = point.x
			custom[v * 4 + 1] = point.y
			custom[v * 4 + 2] = point.z
			custom[v * 4 + 3] = share
			reach = maxf(reach, absf(point.x))
			if arms_only:
				var kept := 0.0
				for k in per:
					if bones[v * per + k] < arm.size() and arm[bones[v * per + k]] == 1:
						kept += weights[v * per + k]
				if kept > 0.001:
					for k in per:
						var slot := v * per + k
						weights[slot] = weights[slot] / kept if bones[slot] < arm.size() and arm[bones[slot]] == 1 else 0.0
		var out := []
		out.resize(Mesh.ARRAY_MAX)
		out[Mesh.ARRAY_VERTEX] = vertices
		out[Mesh.ARRAY_NORMAL] = arrays[Mesh.ARRAY_NORMAL]
		out[Mesh.ARRAY_TEX_UV] = arrays[Mesh.ARRAY_TEX_UV]
		out[Mesh.ARRAY_BONES] = bones
		out[Mesh.ARRAY_WEIGHTS] = weights
		out[Mesh.ARRAY_INDEX] = arrays[Mesh.ARRAY_INDEX]
		out[Mesh.ARRAY_CUSTOM0] = custom
		var flags := Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT
		if per == 8:
			flags |= Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, out, [], {}, flags)
		var surface_material := source.surface_get_material(surface) as BaseMaterial3D
		if surface_material != null and texture == null:
			texture = surface_material.albedo_texture
	var result := {"mesh": mesh, "reach": reach, "texture": texture, "skin": _average_skin(texture)}
	_baked[key] = result
	return result


# Mean colour of the atlas's skin texels (saturated ones), the tone `dress` re-tints from.
static func _average_skin(texture: Texture2D) -> Color:
	var fallback := Color(0.8, 0.56, 0.44)
	if texture == null:
		return fallback
	var image := texture.get_image()
	if image == null or image.is_empty():
		return fallback
	if image.is_compressed() and image.decompress() != OK:
		return fallback
	var total := Vector3.ZERO
	var count := 0
	for y in 24:
		for x in 24:
			var texel := image.get_pixel(int((x + 0.5) / 24.0 * image.get_width()), int((y + 0.5) / 24.0 * image.get_height()))
			if texel.s > 0.3 and texel.v > 0.35:
				total += Vector3(texel.r, texel.g, texel.b)
				count += 1
	if count == 0:
		return fallback
	# Tint ratios are applied in linear light, like the shader's sampled texel.
	var mean := Color(total.x / count, total.y / count, total.z / count)
	return mean.srgb_to_linear()
