extends EnemyAI
## Test brain: the real EnemyAI reactions and bookkeeping, but it never moves or decides on its
## own, so a scenario script can drive the opponent (set_guard, start_attack, start_burst ...)
## deterministically. Records what the fighter's strikes did to the player.

var landings: Array = []
var calls: Dictionary = {}


func _init(owner: EnemyFighter) -> void:
	super(owner)


func think(delta: float) -> Vector3:
	fighter.turn(fighter.to_target().normalized(), delta)
	return Vector3.ZERO


func _note(what: String) -> void:
	calls[what] = int(calls.get(what, 0)) + 1


func on_strike_landed(strike: Strike) -> void:
	var combat: CombatController = fighter.target.combat
	landings.append({
		"strike": strike,
		"frame": Engine.get_physics_frames(),
		"pframe": Engine.get_process_frames(),
		"dodge_age": combat.get_dodge_age(),
		"kind": fighter._move_kind,
		"health": combat.health,
	})
	_note("landed")
	super(strike)


func on_rhythm_broken() -> void:
	_note("rhythm_broken")
	super()


func on_hit(strike: Strike) -> void:
	_note("hit")
	super(strike)


func on_blocked(strike: Strike) -> void:
	_note("blocked")
	super(strike)


func on_recovered() -> void:
	_note("recovered")
	super()


func on_attack_done() -> void:
	_note("attack_done")
	super()


func on_player_feint(strike: Strike) -> void:
	_note("player_feint")
	super(strike)


## When true the fighter's own feint does not lead into the real AI's follow-up attack, so a
## scenario sees the feint on its own.
var quiet_feint := true


func on_feint_done() -> void:
	_note("feint_done")
	if quiet_feint:
		_guard_timer = 0.0
		return
	super()
