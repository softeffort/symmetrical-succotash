class_name PunchingBag
extends Node3D
## A heavy bag the player can work freely: walk up and the hands come up, then jab, cross, kick
## and string combos together. The bag hangs from a ceiling mount and swings as a damped
## pendulum, shudders on impact and pays a little XP and conditioning for every clean strike.

const BAG_RADIUS := 0.2
const BAG_LENGTH := 1.3
## Height of the bag's centre above the floor.
const BAG_CENTRE := 1.55
const GRAVITY := 9.8
const DAMPING := 1.1
const MAX_SWING := 0.32
## Clean strikes between "+Conditioning" popups.
const POPUP_EVERY := 8

@export var color := Color(0.9, 0.16, 0.16)
## Height of the ceiling mount above this node's origin (the floor).
@export var mount_height := 4.35
## The fight stance comes up this close to the bag.
@export var zone_radius := 2.3

## Clean strikes landed on this bag.
var hits := 0

var _pivot: Node3D
var _bag: Node3D
var _length := 2.8
# Swing as rotations about the pivot's x and z axes, and the bag's twist about its chain.
var _swing := Vector2.ZERO
var _swing_velocity := Vector2.ZERO
var _spin := 0.0
var _spin_velocity := 0.0
var _shudder := 0.0
var _time := 0.0


func _ready() -> void:
	_length = mount_height - BAG_CENTRE
	_build()
	Build.drum_blocker(self, BAG_RADIUS + 0.04, BAG_LENGTH, Vector3(0.0, BAG_CENTRE, 0.0)).name = "Body"
	# The hurtbox stays where the bag hangs at rest, so a combo still lands on the backswing.
	var hurtbox := CombatTarget.new()
	hurtbox.name = "Hurtbox"
	hurtbox.radius = BAG_RADIUS + 0.1
	hurtbox.position = Vector3(0.0, BAG_CENTRE - 0.2, 0.0)
	add_child(hurtbox)
	hurtbox.struck.connect(_on_struck)
	var zone := CombatZone.new()
	zone.name = "Zone"
	zone.radius = zone_radius
	add_child(zone)
	set_physics_process(false)


func _physics_process(delta: float) -> void:
	_time += delta
	_swing_velocity += (-_swing * GRAVITY / _length - _swing_velocity * DAMPING) * delta
	_swing = (_swing + _swing_velocity * delta).limit_length(MAX_SWING)
	_spin_velocity += (-_spin * 3.0 - _spin_velocity * 1.4) * delta
	_spin += _spin_velocity * delta
	_shudder = move_toward(_shudder, 0.0, delta * 5.0)
	_pivot.rotation = Vector3(_swing.x + sin(_time * 55.0) * 0.012 * _shudder, 0.0, _swing.y)
	_bag.rotation.y = _spin
	# Settled: sleep until the next strike.
	if _shudder <= 0.0 and _swing.length() + _swing_velocity.length() + absf(_spin) + absf(_spin_velocity) < 0.004:
		set_physics_process(false)


func _build() -> void:
	var chain := GymProps.steel()
	_pivot = Build.group(self, "Pivot", Vector3(0.0, mount_height, 0.0))
	_bag = Build.group(_pivot, "Bag", Vector3(0.0, -_length, 0.0))
	var half := BAG_LENGTH * 0.5
	Build.cyl(_bag, BAG_RADIUS, BAG_LENGTH, Vector3.ZERO, Stylized.leather(color, 0.55))
	Build.cyl(_bag, BAG_RADIUS + 0.005, 0.07, Vector3(0.0, half, 0.0), GymProps.frame())
	Build.cyl(_bag, BAG_RADIUS + 0.005, 0.07, Vector3(0.0, -half, 0.0), GymProps.frame())
	Build.cyl(_bag, BAG_RADIUS + 0.003, 0.14, Vector3(0.0, 0.3, 0.0), Build.mat(Color(0.95, 0.95, 0.97), 0.6))
	var top := half + 0.03
	for i in 4:
		var angle := i * PI * 0.5 + PI * 0.25
		Build.tube(_bag, Vector3(cos(angle) * 0.15, top, sin(angle) * 0.15), Vector3(0.0, top + 0.47, 0.0), 0.008, chain, 4)
	Build.tube(_pivot, Vector3(0.0, -_length + top + 0.47, 0.0), Vector3.ZERO, 0.012, chain, 4)


## Swings the bag without paying anyone out: a regular is working it.
func nudge(direction: Vector3, power: float = 0.5) -> void:
	var along := global_transform.basis.inverse() * direction
	_swing_velocity += Vector2(-along.z, along.x) * 0.3 * power
	_shudder = maxf(_shudder, 0.4 * power)
	set_physics_process(true)


func _on_struck(strike: Strike) -> void:
	strike.outcome = Strike.Outcome.HIT
	strike.dealt = strike.damage
	hits += 1
	# Shove the bag along the blow. Heavier strikes saturate: a heavy bag only swings so far.
	var shove := 0.36 * (1.0 - exp(-strike.damage / 22.0)) + 0.04 * strike.knockback
	var along := global_transform.basis.inverse() * strike.direction
	_swing_velocity += Vector2(-along.z, along.x) * shove
	if strike.kind == Strike.HOOK:
		_spin_velocity += 2.2 if strike.side == 0 else -2.2
	_shudder = clampf(0.4 + strike.damage / 30.0, 0.0, 1.0)
	set_physics_process(true)

	PlayerStats.reward_bag_strike(clampf(strike.damage / 8.0, 0.5, 3.0), strike.is_kick())
	if hits % POPUP_EVERY == 0:
		PlayerStats.popup_requested.emit("+Conditioning  +XP", &"gain")
