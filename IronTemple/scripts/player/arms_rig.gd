class_name ArmsRig
extends CharacterRig
## First-person arms: the arm bones of a rigged body, posed from PlayerArms' two-bone solve.
## The wrist is pinned exactly where the solve puts it (grips and punch targets depend on it);
## the elbow and shoulder follow at the mesh's own bone lengths, so nothing is stretched and
## the shoulder end stays out of view. Hand wraps and MMA gloves come from the body shader.

## Tried in order: the arms-only model, then a whole body drawn arms-only.
const SOURCES: Array[String] = ["hands/fps_arms", "characters/superhero_male"]
## Size of the arms in view space relative to the model.
const VIEW_SCALE := 1.1

var _conv_inv: Array = [[], []]
var _upper_len: Array[float] = [0.25, 0.25]
var _fore_len: Array[float] = [0.24, 0.24]
var _twist: Array[float] = [0.0, 0.0]


## Builds the view-model arms on render `layers`, or returns null if no source model loads.
static func create_arms(layers: int) -> ArmsRig:
	for id in SOURCES:
		if not ModelLoader.has_model(id):
			continue
		var arms := ArmsRig.new()
		arms.name = "ArmsRig"
		arms._arms_only = true
		if arms._load(id, layers):
			arms._prepare(id != SOURCES[0])
			return arms
		arms.free()
	return null


## Poses arm `i` (0 left, 1 right) from the solve, all in this node's space: `shoulder`, `elbow`
## and `wrist` positions, the `bend` direction the elbow is pushed out along and the hand's
## basis (+Y to the fingers, +Z out of the back of the hand).
func pose_arm(i: int, shoulder: Vector3, elbow: Vector3, wrist: Vector3, bend: Vector3, hand: Basis) -> void:
	var side := -1.0 if i == 0 else 1.0
	var upper_dir := (_turn_inv * (elbow - shoulder)).normalized()
	var fore_dir := (_turn_inv * (wrist - elbow)).normalized()
	var reach := (_turn_inv * (wrist - shoulder)).normalized()
	var wrist_at := _from_model * wrist
	var elbow_at := wrist_at - fore_dir * _fore_len[i]
	var shoulder_at := elbow_at - upper_dir * _upper_len[i]
	# The elbow's hinge axis: square to the plane the arm bends in.
	var hinge := reach.cross(_turn_inv * bend) * -side
	hinge = hinge.normalized() if hinge.length_squared() > 0.000001 else Vector3.UP
	var inverse: Array = _conv_inv[i]
	_write(_upper[i], _conv(upper_dir, hinge) * (inverse[0] as Basis) * _rest_basis[_upper[i]], shoulder_at)
	# The forearm carries half of the hand's roll, so the wrist never wrings.
	var palm := _turn_inv * hand
	var flat := (hinge - fore_dir * hinge.dot(fore_dir)).normalized()
	var back := (palm.z - fore_dir * palm.z.dot(fore_dir)).normalized()
	_twist[i] = flat.signed_angle_to(back, fore_dir)
	_write(_lower[i], _conv(fore_dir, flat.rotated(fore_dir, _twist[i] * 0.5)) * (inverse[1] as Basis) * _rest_basis[_lower[i]], elbow_at)
	_write(_hand[i], palm.orthonormalized() * (inverse[2] as Basis) * _rest_basis[_hand[i]], wrist_at)
	if not is_equal_approx(fist[i], _shown_fist[i]):
		_curl(i, fist[i])


## Where arm `i`'s shoulder joint ended up, in this node's space.
func shoulder_of(i: int) -> Vector3:
	return _to_model * _go[_upper[i]]


## Skin, sleeve and the muscle the player has built: `arms` 0 to 1, `pump` 0 to 1.
func set_arm_physique(arms: float, pump: float) -> void:
	set_physique(arms, 0.5, 0.5, pump)
	# Up close the veins and the cut of the forearm are the reward for training.
	material.set_shader_parameter("veins", clampf(smoothstep(0.25, 1.0, arms) * 0.85 + 0.4 * pump, 0.0, 1.0))
	material.set_shader_parameter("definition", 0.3 + 0.5 * arms + 0.15 * pump)


func _prepare(whole_body: bool) -> void:
	var pivot := get_child(0) as Node3D
	var fit := pivot.get_node("Fit") as Node3D
	fit.transform = Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * VIEW_SCALE), Vector3.ZERO)
	_scale = VIEW_SCALE
	_to_model = _chain(skeleton, self)
	_from_model = _to_model.affine_inverse()
	_turn = _to_model.basis.orthonormalized()
	_turn_inv = _turn.transposed()
	_read_rest()
	material.set_shader_parameter("arms_only", whole_body)
	for part in _parts:
		part.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		part.visible = part == _body
	for i in 2:
		var upper := _go[_lower[i]] - _go[_upper[i]]
		var fore := _go[_hand[i]] - _go[_lower[i]]
		_upper_len[i] = upper.length()
		_fore_len[i] = fore.length()
		var fingers := fore
		var middle := skeleton.find_bone("middle_01" + ("_l" if i == 0 else "_r"))
		if middle >= 0:
			fingers = _go[middle] - _go[_hand[i]]
		_conv_inv[i] = [_conv(upper, Vector3.UP).transposed(), _conv(fore, Vector3.UP).transposed(), _conv(fingers, Vector3.UP).transposed()]


# Frame with +Y along `along` and +Z as close to `back` as that allows.
static func _conv(along: Vector3, back: Vector3) -> Basis:
	var y := along.normalized()
	var z := back - y * back.dot(y)
	z = z.normalized() if z.length_squared() > 0.000001 else y.cross(Vector3.RIGHT).normalized()
	return Basis(y.cross(z), y, z)
