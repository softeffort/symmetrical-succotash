class_name FightAnimator
extends RefCounted
## Fight choreography for a CharacterModel: the guard stance, wind-ups, strikes, the high and
## body guards, slips, the clinch, staggers, the rocked sway and the knockdown, written as joint
## targets into `pose`. The owner sets the inputs every physics tick, calls `update` and lets
## the model blend `pose` in through its fight layer. The stance is orthodox: left side leads.

## Arm strikes. `wind` and `hit` are (arm_x, arm_z, elbow) at the top of the wind-up and at full
## extension; `twist`, `lean` and `dip` are the torso twist, torso lean and hip height at those
## two moments (x for the wind-up, y for the hit). `crouch` bends the knees to drop the level by
## that many metres: the tell of a body shot.
const ARM_MOVES := {
	Strike.JAB: {"wind": Vector3(0.72, -0.05, 2.45), "hit": Vector3(1.5, -0.08, 0.06), "twist": Vector2(0.12, 0.32), "lean": Vector2(0.03, -0.1), "dip": Vector2.ZERO},
	Strike.CROSS: {"wind": Vector3(0.3, 0.32, 2.35), "hit": Vector3(1.52, -0.1, 0.05), "twist": Vector2(0.5, 0.62), "lean": Vector2(0.05, -0.2), "dip": Vector2(0.0, -0.02)},
	# The arm is carried out to the side, so the bent elbow swings the fist across.
	Strike.HOOK: {"wind": Vector3(-0.15, 1.2, 1.25), "hit": Vector3(0.1, 1.25, 1.8), "twist": Vector2(0.6, 0.85), "lean": Vector2(0.04, -0.12), "dip": Vector2(-0.02, -0.03)},
	Strike.OVERHAND: {"wind": Vector3(-0.45, 0.85, 1.9), "hit": Vector3(1.8, 0.1, 0.5), "twist": Vector2(0.62, 0.62), "lean": Vector2(0.14, -0.4), "dip": Vector2(0.0, -0.05)},
	Strike.UPPERCUT: {"wind": Vector3(0.1, 0.12, 1.35), "hit": Vector3(1.25, -0.12, 2.0), "twist": Vector2(0.32, 0.45), "lean": Vector2(-0.3, 0.12), "dip": Vector2(-0.11, 0.03)},
	# Body shots: the whole fighter drops a level first, then the fist comes round or through low.
	Strike.BODY_HOOK: {"wind": Vector3(0.05, 0.65, 1.3), "hit": Vector3(0.72, 0.45, 1.75), "twist": Vector2(0.55, 0.8), "lean": Vector2(-0.26, -0.32), "dip": Vector2.ZERO, "crouch": Vector2(0.17, 0.13)},
	Strike.BODY_CROSS: {"wind": Vector3(0.2, 0.25, 2.2), "hit": Vector3(1.08, -0.06, 0.1), "twist": Vector2(0.45, 0.6), "lean": Vector2(-0.24, -0.4), "dip": Vector2.ZERO, "crouch": Vector2(0.18, 0.15)},
}
const BLOCK_ARM := Vector3(1.3, -0.22, 2.5)
## Elbows on the ribs, forearms across the belly.
const BLOCK_LOW_ARM := Vector3(0.38, -0.16, 1.8)
const DROPPED_ARM := Vector3(0.22, 0.12, 0.4)
const REACH_ARM := Vector3(1.28, 0.95, 0.3)
const CLINCH_ARM := Vector3(1.42, 0.08, 0.95)
const TENSE_ARM := Vector3(1.15, -0.2, 2.4)
## Thigh plus shin, for turning a drop in hip height into knee bend.
const LEG_LENGTH := 0.94

var pose := FightPose.new()
## Walk cycle of the fighter, so the feet shuffle while the hands stay up.
var stride_phase := 0.0
var move_amount := 0.0
## Inputs, 0 to 1 unless noted.
var block := 0.0
## The body guard.
var block_low := 0.0
var stagger := 0.0
## Out on their feet: a slow, wide sway with the hands down.
var rocked := 0.0
var knockdown := 0.0
var victory := 0.0
## Side slip, -1 (left) to 1 (right).
var lean := 0.0
## Pulling the head straight back out of range.
var pull := 0.0
## Hands hanging at the waist.
var drop := 0.0
## Coiled low before an explosion.
var crouch := 0.0
## Both arms reaching wide for a clinch, and the clinch itself.
var reach := 0.0
var clinch := 0.0
## Shaky hands and a low guard.
var nerves := 0.0
## Bounce in the footwork.
var bounce := 0.0
## The strike in progress, or &"". `windup` pulls the limb back, `extend` throws it.
var strike_kind: StringName = &""
var strike_side := 0
var windup := 0.0
var extend := 0.0

var _time := 0.0
var _flinch := 0.0
var _flinch_side := 0.0


func set_strike(kind: StringName, side: int, windup_amount: float, extend_amount: float) -> void:
	strike_kind = kind
	strike_side = side
	windup = clampf(windup_amount, 0.0, 1.0)
	extend = clampf(extend_amount, 0.0, 1.0)


func clear_strike() -> void:
	strike_kind = &""
	windup = 0.0
	extend = 0.0


## Snaps the head and shoulders back from a hit. `side` -1 or 1 turns them away from it.
func flinch(strength: float = 1.0, side: float = 0.0) -> void:
	_flinch = clampf(maxf(_flinch, strength), 0.0, 1.0)
	_flinch_side = side


func update(delta: float) -> void:
	_time += delta
	_flinch = move_toward(_flinch, 0.0, delta * 3.5)
	var p := pose
	var lowered := 0.3 * nerves
	for i in 2:
		var lead := i == 0
		var step := sin(stride_phase + (PI if i == 1 else 0.0)) * 0.24 * move_amount
		p.leg[i] = (0.35 if lead else -0.3) + step
		p.knee[i] = (-0.55 if lead else -0.1) - maxf(-step, 0.0) * 0.7
		p.arm_x[i] = (1.05 if lead else 0.92) - lowered + sin(_time * 29.0 + i * 2.1) * 0.035 * nerves
		p.arm_z[i] = -0.1
		p.elbow[i] = (1.95 if lead else 2.2) - lowered * 0.6
	p.torso = Vector3(-0.1, -0.22, 0.0)
	p.head = 0.05
	p.root_pos = Vector3(0.0, -0.045 + absf(sin(_time * 6.5)) * 0.028 * bounce, 0.0)
	p.root_rot = Vector3.ZERO

	if drop > 0.0:
		var hang := smoothstep(0.0, 1.0, drop)
		for i in 2:
			_blend_arm(p, i, DROPPED_ARM, hang)
		p.torso.x = lerpf(p.torso.x, 0.06, hang)
	if strike_kind != &"":
		_layer_strike(p)
	if block > 0.0:
		var guard := smoothstep(0.0, 1.0, block)
		for i in 2:
			_blend_arm(p, i, BLOCK_ARM, guard)
		p.head = lerpf(p.head, -0.2, guard)
		p.torso.x = lerpf(p.torso.x, -0.2, guard)
		p.torso.y = lerpf(p.torso.y, -0.08, guard)
	if block_low > 0.0:
		var guard := smoothstep(0.0, 1.0, block_low)
		for i in 2:
			_blend_arm(p, i, BLOCK_LOW_ARM, guard)
		p.torso.x = lerpf(p.torso.x, -0.3, guard)
		p.torso.y = lerpf(p.torso.y, -0.08, guard)
		_sink(p, 0.07 * guard)
	if crouch > 0.0:
		var coil := smoothstep(0.0, 1.0, crouch)
		for i in 2:
			_blend_arm(p, i, TENSE_ARM, coil * 0.8)
		p.torso.x -= 0.24 * coil
		p.head -= 0.12 * coil
		_sink(p, 0.2 * coil)
	if reach > 0.0:
		var grab := smoothstep(0.0, 1.0, reach)
		for i in 2:
			_blend_arm(p, i, REACH_ARM, grab)
		p.torso.x -= 0.22 * grab
		_sink(p, 0.06 * grab)
	if clinch > 0.0:
		var hold := smoothstep(0.0, 1.0, clinch)
		for i in 2:
			_blend_arm(p, i, CLINCH_ARM, hold)
		p.torso.x = lerpf(p.torso.x, -0.34, hold)
		p.head = lerpf(p.head, 0.18, hold)
	if _flinch > 0.0:
		p.torso.x += 0.25 * _flinch
		p.torso.y += 0.35 * _flinch * _flinch_side
		p.head += 0.4 * _flinch
	if lean != 0.0:
		p.root_rot.z -= lean * 0.22
		p.torso.z -= lean * 0.2
	if pull > 0.0:
		p.torso.x += 0.34 * pull
		p.head += 0.12 * pull
		p.root_rot.x += 0.08 * pull
	if stagger > 0.0:
		_layer_stagger(p, smoothstep(0.0, 1.0, stagger))
	if rocked > 0.0:
		_layer_rocked(p, smoothstep(0.0, 1.0, rocked))
	if victory > 0.0:
		_layer_victory(p, smoothstep(0.0, 1.0, victory))
	if knockdown > 0.0:
		_layer_knockdown(p, clampf(knockdown, 0.0, 1.0))


func _layer_strike(p: FightPose) -> void:
	var i := strike_side
	var side := -1.0 if i == 0 else 1.0
	var thrown := extend
	var wound := smoothstep(0.0, 1.0, windup) * (1.0 - thrown)
	if ARM_MOVES.has(strike_kind):
		var move: Dictionary = ARM_MOVES[strike_kind]
		var twist: Vector2 = move["twist"]
		var torso_lean: Vector2 = move["lean"]
		var dip: Vector2 = move["dip"]
		_blend_arm(p, i, move["wind"], wound)
		_blend_arm(p, i, move["hit"], thrown)
		p.torso.y += side * (twist.y * thrown - twist.x * wound)
		p.torso.x += torso_lean.x * wound + torso_lean.y * thrown
		p.root_pos.y += dip.x * wound + dip.y * thrown
		if move.has("crouch"):
			var level: Vector2 = move["crouch"]
			_sink(p, level.x * wound + level.y * thrown)
		return
	# Kicks: chamber the knee, then thrust. x is the thigh, y the knee.
	var knee_strike := strike_kind == Strike.KNEE
	var chamber := Vector2(0.45, -1.3) if knee_strike else Vector2(1.0, -1.75)
	var thrust := Vector2(1.55, -2.0) if knee_strike else Vector2(1.4, -0.12)
	p.leg[i] = lerpf(lerpf(p.leg[i], chamber.x, wound), thrust.x, thrown)
	p.knee[i] = lerpf(lerpf(p.knee[i], chamber.y, wound), thrust.y, thrown)
	# Stand tall on the other leg.
	var planted := maxf(wound, thrown)
	var other := 1 - i
	p.leg[other] = lerpf(p.leg[other], 0.0, planted)
	p.knee[other] = lerpf(p.knee[other], -0.08, planted)
	p.torso.x += (-0.25 if knee_strike else 0.28) * thrown + 0.08 * wound
	p.root_pos.y += 0.03 * planted


func _layer_stagger(p: FightPose, amount: float) -> void:
	var wobble := sin(_time * 11.0)
	for i in 2:
		_blend_arm(p, i, Vector3(0.35 + 0.15 * wobble, 0.45, 0.9), amount)
		p.leg[i] = lerpf(p.leg[i], 0.12 if i == 0 else -0.25, amount)
		p.knee[i] = lerpf(p.knee[i], -0.35, amount)
	p.torso = p.torso.lerp(Vector3(0.36, 0.0, 0.1 * wobble), amount)
	p.head = lerpf(p.head, 0.45, amount)
	p.root_rot.z += 0.07 * wobble * amount
	p.root_pos.y = lerpf(p.root_pos.y, -0.06, amount)


## Legs gone: a slow sway from the ankles, arms hanging, head rolling.
func _layer_rocked(p: FightPose, amount: float) -> void:
	var sway := sin(_time * 5.2)
	var wobble := sin(_time * 8.7 + 1.0)
	for i in 2:
		_blend_arm(p, i, Vector3(0.22 + 0.1 * wobble, 0.3, 0.5), amount)
		p.leg[i] = lerpf(p.leg[i], (0.2 if i == 0 else -0.2) + 0.12 * sway, amount)
		p.knee[i] = lerpf(p.knee[i], -0.5 - 0.15 * wobble, amount)
	p.torso = p.torso.lerp(Vector3(0.22 * sway - 0.08, 0.15 * wobble, 0.2 * sway), amount)
	p.head = lerpf(p.head, 0.35 + 0.2 * wobble, amount)
	p.root_rot.z += 0.14 * sway * amount
	p.root_rot.x += 0.06 * wobble * amount
	p.root_pos.x += 0.08 * sway * amount
	p.root_pos.y = lerpf(p.root_pos.y, -0.1, amount)


func _layer_victory(p: FightPose, amount: float) -> void:
	for i in 2:
		_blend_arm(p, i, Vector3(2.75, 0.35, 0.3 + 0.15 * sin(_time * 6.0 + i)), amount)
		p.leg[i] = lerpf(p.leg[i], 0.0, amount)
		p.knee[i] = lerpf(p.knee[i], -0.05, amount)
	p.torso = p.torso.lerp(Vector3(0.08, 0.0, 0.0), amount)
	p.head = lerpf(p.head, 0.25, amount)
	p.root_pos.y = lerpf(p.root_pos.y, absf(sin(_time * 5.0)) * 0.05, amount)


## Falls straight back, pivoting on the heels, and ends flat on the canvas. Run backwards it
## is the get-up.
func _layer_knockdown(p: FightPose, amount: float) -> void:
	var fall := amount * amount
	for i in 2:
		_blend_arm(p, i, Vector3(0.1, 1.15, 0.35), amount)
		p.leg[i] = lerpf(p.leg[i], 0.12 + 0.1 * i, amount)
		p.knee[i] = lerpf(p.knee[i], -0.3 - 0.25 * i, amount)
	p.torso = p.torso.lerp(Vector3(0.05, 0.0, 0.0), amount)
	p.head = lerpf(p.head, 0.2, amount)
	p.root_rot = Vector3(PI * 0.5 * fall, 0.0, 0.0)
	p.root_pos = Vector3(0.0, 0.13 * fall, 0.0)


## Moves one arm towards `target` (arm_x, arm_z, elbow).
func _blend_arm(p: FightPose, i: int, target: Vector3, weight: float) -> void:
	p.arm_x[i] = lerpf(p.arm_x[i], target.x, weight)
	p.arm_z[i] = lerpf(p.arm_z[i], target.y, weight)
	p.elbow[i] = lerpf(p.elbow[i], target.z, weight)


## Drops the hips by `depth` metres and bends both knees to keep the feet on the canvas.
func _sink(p: FightPose, depth: float) -> void:
	if depth <= 0.0:
		return
	var bend := sqrt(2.0 * depth / LEG_LENGTH)
	for i in 2:
		p.leg[i] += bend
		p.knee[i] -= 2.0 * bend
	p.root_pos.y -= depth
