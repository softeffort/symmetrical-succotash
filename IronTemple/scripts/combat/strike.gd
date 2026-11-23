class_name Strike
extends RefCounted
## One punch or kick in flight. The attacker fills in what was thrown and how hard; whoever it
## reaches writes back what happened (`outcome`, `dealt` and the flags under them). Used in both
## directions: the player's strikes on bags and opponents, and an opponent's strikes on the player.

enum Outcome { MISS, DODGED, BLOCKED, HIT, GUARD_BREAK, KNOCKOUT }
## The level a strike is aimed at. A high guard stops HEAD, a body guard stops BODY.
enum Zone { HEAD, BODY }

const JAB := &"jab"
const HOOK := &"hook"
const CROSS := &"cross"
const OVERHAND := &"overhand"
const UPPERCUT := &"uppercut"
## Lead-hand hook to the liver and a straight right to the gut.
const BODY_HOOK := &"body_hook"
const BODY_CROSS := &"body_cross"
const KICK := &"kick"
const KNEE := &"knee"

# Combos, detected by ComboTracker.
const ONE_TWO := &"one_two"
const GUARD_BREAKER := &"guard_breaker"
const KO_FINISHER := &"ko_finisher"

## Damage multiplier for a true intercept: landing while the target is still winding up.
const COUNTER_HIT_DAMAGE := 2.5
## Damage multiplier on a fighter who is staggered or rocked.
const OPEN_DAMAGE := 1.25
## Damage multiplier on a head shot that follows a clean body shot.
const SETUP_DAMAGE := 1.2

var kind: StringName = JAB
## The limb used: 0 left, 1 right.
var side := 0
var zone := Zone.HEAD
var damage := 0.0
## Multiplier the attacker has already folded into `damage` (a combo, a perfect-dodge counter).
## Bonuses never stack: the target applies only what its own state adds on top of this.
var bonus := 1.0
## Taken off a blocking opponent's guard meter; on the player, extra stamina a block costs.
var guard_damage := 0.0
## How far the blow carries from the attacker, centre to centre; 0 when it does not matter.
var reach := 0.0
## Composure a clean hit takes off the target's chin gauge.
var stagger := 0.0
## Speed, in m/s, the target is shoved along `direction`.
var knockback := 0.0
var stamina_drain := 0.0
var heavy := false
## Shatters a raised guard outright.
var guard_breaker := false
## Thrown inside a perfect-dodge counter window.
var counter := false
## Thrown past the anti-spam limit: slow, weak, and never an intercept.
var sloppy := false
## A clinch knee: the target is held and can neither block nor slip it.
var held := false
## Thrown off a read of the target's habits: floors them if it lands clean.
var finisher := false
var combo: StringName = &""
var attacker: Node3D = null
## Horizontal unit vector from the attacker to the target.
var direction := Vector3.FORWARD

var outcome := Outcome.MISS
## Damage that got through.
var dealt := 0.0
## The defender slipped it at the last moment, which opens their counter window.
var perfect := false
## It beat the target to the punch.
var counter_hit := false
## A head shot landed straight after a clean body shot.
var setup := false
## What a clean hit did to the target's composure.
var rocked := false
var knockdown := false


## The level `strike_kind` is thrown at.
static func zone_of(strike_kind: StringName) -> Zone:
	if strike_kind == BODY_HOOK or strike_kind == BODY_CROSS or strike_kind == KICK or strike_kind == KNEE:
		return Zone.BODY
	return Zone.HEAD


func is_kick() -> bool:
	return kind == KICK or kind == KNEE


func is_body() -> bool:
	return zone == Zone.BODY


## True when the blow touched the target, blocked or not.
func connected() -> bool:
	return outcome >= Outcome.BLOCKED


## True when it landed with nothing in the way.
func clean() -> bool:
	return outcome == Outcome.HIT or outcome == Outcome.KNOCKOUT
