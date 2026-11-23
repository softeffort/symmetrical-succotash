class_name EnemyAI
extends RefCounted
## The fight brain of an EnemyFighter: a small tactical state machine that, whenever the fighter
## is on its feet and free, decides where to stand, when to lead and with what, when to feint,
## burst or grab, and how to answer what the player throws. The fighter's body carries the
## decisions out, so every strike keeps its wind-up and its tell.
##
## Tempo and fight IQ come from the active FightStyle. A hybrid swaps between two styles
## mid-bout; an adaptive fighter also keeps a PatternMemory of the player and punishes the
## third repeat of a combination or a slip.

## Where the fighter wants to be and how it carries itself there.
enum Tactic { WAIT, SHUFFLE, PRESS, STALK, PROBE, FINISH }
enum Reaction { NONE, GUARD, SLIP }

## The player's strikes are only answered from inside this distance.
const REACT_RANGE := 2.6
## Strikes further apart than this are separate attacks: each one can be slipped afresh.
const SEQUENCE_GAP := 0.6
## A strike to the other level this soon after the last is a level change, which is this much
## harder to read.
const LEVEL_CHANGE_WINDOW := 0.55
const LEVEL_CHANGE_READ := 0.45
## Seconds a fighter who bit on a feint stays stuck with what it did.
const COMMIT_TIME := 0.55
## Share of its reads and reflexes a gassed fighter keeps.
const TIRED_IQ := 0.4
## Seconds a hybrid spends in one style before switching (min, max).
const SWAP_TIME := Vector2(5.0, 8.0)
const CLINCH_COOLDOWN := Vector2(6.0, 9.0)
const CLINCH_REACH := 1.75
## Distance kept from a player who is down.
const NEUTRAL_DISTANCE := 2.9
const BURST_RANGE := 3.2
## How far past its reach a fighter steps to punish a whiff.
const WHIFF_RANGE := 0.55
## Inside this distance the player can hit, so the guard matters; outside it the hands relax.
const THREAT_RANGE := 2.5
## A fighter with any sense does not start a lead this soon after the player threw something.
const UNDER_FIRE := 0.5
## Seconds after the last blocked punch before the answer comes back, and after one that fell
## short. A beat, so the answer is never thrown into the rest of a combination.
const RIPOSTE_DELAY := 0.3
const WHIFF_DELAY := 0.15

var fighter: EnemyFighter
var profile: FighterProfile
## The style in use right now.
var style: FightStyle
var tactic := Tactic.SHUFFLE
var memory := PatternMemory.new()

var _lead_timer := 1.0
var _burst_timer := 0.0
var _guard_timer := 0.0
var _swap_timer := 0.0
var _retreat_time := 0.0
var _gawk_time := 0.0
var _strafe_time := 0.0
var _strafe_direction := 1.0
var _slip_wait := 0.0
var _clinch_wait := 0.0
var _committed := 0.0
var _riposte := -1.0
# How far past its reach the fighter steps to deliver that answer.
var _riposte_reach := 0.3
var _since_player_strike := 9.0
var _last_zone := Strike.Zone.HEAD
var _zone_age := 9.0
# The player strike last answered, and how, so a feint can be seen through or bitten on.
var _reacted: Strike = null
var _reaction := Reaction.NONE
var _guard_before := EnemyFighter.Guard.NONE
# Running reads of the player: share of strikes aimed low, of attacks blocked and slipped.
var _body_seen := 0.0
var _block_habit := 0.0
var _dodge_habit := 0.0


func _init(owner: EnemyFighter) -> void:
	fighter = owner
	profile = owner.profile
	style = profile.style
	_lead_timer = _next_lead() * 0.5
	_burst_timer = randf_range(style.probe_time.x, style.probe_time.y)
	_swap_timer = randf_range(SWAP_TIME.x, SWAP_TIME.y)
	_clinch_wait = randf_range(1.5, 3.0)


## Runs every physics tick of the bout, whatever the fighter is doing.
func tick(delta: float) -> void:
	memory.tick(delta)
	_since_player_strike += delta
	_zone_age += delta
	_slip_wait = maxf(_slip_wait - delta, 0.0)
	_clinch_wait = maxf(_clinch_wait - delta, 0.0)
	_committed = maxf(_committed - delta, 0.0)
	_retreat_time = maxf(_retreat_time - delta, 0.0)
	_gawk_time = maxf(_gawk_time - delta, 0.0)
	if _riposte >= 0.0:
		_riposte -= delta
		if _riposte < 0.0:
			_answer_back()
	if profile.alt_style != null:
		_swap_timer -= delta
		if _swap_timer <= 0.0 and fighter.is_free():
			_swap_style()


## Runs while the fighter is free: turns to the player, picks the tactic and the guard, may
## start a move, and returns the velocity to walk at.
func think(delta: float) -> Vector3:
	var combat := fighter.target.combat
	var offset := fighter.to_target()
	var distance := offset.length()
	var toward := offset / maxf(distance, 0.001)
	fighter.turn(toward, delta)
	tactic = _pick_tactic(combat)
	if _committed > 0.0:
		# Sold on a feint: stuck with it for a moment.
		return Vector3.ZERO
	_think_guard(delta, distance)
	var move := _footwork(delta, distance, toward)
	if tactic != Tactic.WAIT and _gawk_time <= 0.0:
		_decide(delta, distance, combat)
	return move


# --- Tactics ---------------------------------------------------------------------------------

func _pick_tactic(combat: CombatController) -> Tactic:
	if combat.is_down():
		return Tactic.WAIT
	if combat.is_rocked() and not fighter.is_tired():
		return Tactic.FINISH
	match style.archetype:
		FightStyle.Archetype.PRESSURE, FightStyle.Archetype.DIRTY:
			return Tactic.PRESS
		FightStyle.Archetype.SNIPER:
			return Tactic.STALK
		FightStyle.Archetype.PRO:
			return Tactic.PROBE
	return Tactic.SHUFFLE


func _footwork(delta: float, distance: float, toward: Vector3) -> Vector3:
	var speed := style.move_speed * (0.6 if fighter.is_tired() else 1.0)
	var hold := style.preferred_range
	_strafe_time -= delta
	if _strafe_time <= 0.0:
		_strafe_time = randf_range(0.9, 2.2)
		if randf() < 0.6:
			_strafe_direction = -_strafe_direction
	if _gawk_time > 0.0:
		return Vector3.ZERO
	var move := Vector3.ZERO
	match tactic:
		Tactic.WAIT:
			# The player is down: back to a neutral spot and let them get up.
			if distance < NEUTRAL_DISTANCE:
				move = _mind_the_fence(-toward * speed)
		Tactic.FINISH:
			if distance > 1.45:
				move = toward * speed * 1.2
		Tactic.PRESS:
			move = _cut_off(distance, toward, speed, hold)
		_:
			if _retreat_time > 0.0:
				move = -toward * speed
			elif distance > hold + 0.15:
				move = toward * speed * (0.8 if tactic == Tactic.STALK else 1.0)
			elif distance < hold - 0.3:
				# A sniper gives ground to keep the range; the others only drift back.
				move = -toward * speed * (1.0 if tactic == Tactic.STALK else 0.7)
			if style.circling > 0.0 and distance < hold + 1.0:
				move += toward.cross(Vector3.UP) * _strafe_direction * speed * 0.6 * style.circling
			move = _mind_the_fence(move)
	if fighter.is_guarding():
		move *= 0.8 if style.pressure else 0.6
	return move


## Walks the player down. With `cut_off` the fighter keeps itself between the player and the
## middle of the cage and mirrors their sidesteps, so circling out ends on the fence.
func _cut_off(distance: float, toward: Vector3, speed: float, hold: float) -> Vector3:
	var move := Vector3.ZERO
	if _retreat_time > 0.0:
		move = -toward * speed
	elif distance > hold + 0.1:
		move = toward * speed
	elif distance < hold - 0.35 and not style.pressure:
		move = -toward * speed * 0.7
	if style.cut_off <= 0.0:
		return move
	var spot := fighter.target.global_position
	var inward := fighter.arena_centre - spot
	inward.y = 0.0
	if inward.length() > 0.9:
		var goal := spot + inward.normalized() * hold - fighter.global_position
		goal.y = 0.0
		var across := goal - toward * goal.dot(toward)
		move += across.limit_length(1.0) * speed * style.cut_off
	var drift := fighter.target.velocity
	drift.y = 0.0
	move += (drift - toward * drift.dot(toward)) * 0.5 * style.cut_off
	return move.limit_length(speed * 1.15)


## Turns a step that would back the fighter onto the fence into a step along it.
func _mind_the_fence(move: Vector3) -> Vector3:
	var out := fighter.global_position - fighter.arena_centre
	out.y = 0.0
	if fighter.arena_radius <= 0.0 or out.length() < fighter.arena_radius - 1.1:
		return move
	var normal := out.normalized()
	var outward := move.dot(normal)
	if outward <= 0.0:
		return move
	return move - normal * outward + normal.cross(Vector3.UP) * _strafe_direction * outward


func _think_guard(delta: float, distance: float) -> void:
	_guard_timer -= delta
	if _guard_timer > 0.0:
		return
	_guard_timer = randf_range(0.6, 1.2)
	# Hands up when the player is close enough to hit, relaxed when they are not.
	var uptime := style.guard_uptime * _iq() * (1.0 if distance <= THREAT_RANGE else 0.5)
	# A broken guard has to rebuild before it goes back up.
	if _gawk_time > 0.0 or fighter.guard <= profile.guard_max * 0.25 or randf() >= uptime:
		fighter.set_guard(EnemyFighter.Guard.NONE)
		return
	var low := style.body_guard
	if profile.adaptive:
		# Covers the level the player has been going to.
		low = clampf(lerpf(low, _body_seen, 0.6), 0.05, 0.85)
	fighter.set_guard(EnemyFighter.Guard.LOW if randf() < low else EnemyFighter.Guard.HIGH)


# --- Offence ---------------------------------------------------------------------------------

func _decide(delta: float, distance: float, combat: CombatController) -> void:
	if tactic == Tactic.FINISH:
		_lead_timer = minf(_lead_timer, 0.15)
	elif tactic == Tactic.PROBE and style.probe_time.y > 0.0:
		# Broken rhythm: the calm runs out and the combination comes all at once.
		_burst_timer -= delta
		if _burst_timer <= 0.0 and distance <= BURST_RANGE and not fighter.is_tired():
			_burst_timer = randf_range(style.probe_time.x, style.probe_time.y)
			_lead_timer = _next_lead()
			fighter.start_burst(style.burst_combos.pick_random())
			return
	if distance > style.preferred_range + 0.45:
		return
	# Only a novice swings while punches are still coming at them; a pressure fighter just
	# keeps walking through them.
	if _since_player_strike < UNDER_FIRE and not style.pressure and style.archetype != FightStyle.Archetype.NOOB and tactic != Tactic.FINISH:
		return
	_lead_timer -= delta
	if _lead_timer > 0.0:
		return
	_lead_timer = _next_lead()
	if tactic == Tactic.FINISH:
		fighter.start_attack([[Strike.OVERHAND], [Strike.CROSS, Strike.HOOK], [Strike.HOOK]].pick_random(), 0.85)
		return
	if randf() < style.hesitation * (1.6 if fighter.is_tired() else 1.0):
		# Stops and stares, hands low.
		_gawk_time = randf_range(0.6, 1.2)
		fighter.set_guard(EnemyFighter.Guard.NONE)
		return
	if style.clinch_rate > 0.0 and _clinch_wait <= 0.0 and distance <= CLINCH_REACH and randf() < style.clinch_rate:
		_clinch_wait = randf_range(CLINCH_COOLDOWN.x, CLINCH_COOLDOWN.y)
		fighter.start_clinch()
		return
	var combo := _pick_combo(combat)
	if randf() < _feint_rate():
		fighter.start_feint(combo[0])
		return
	fighter.start_attack(combo)


func _next_lead() -> float:
	return randf_range(style.attack_delay.x, style.attack_delay.y) * (1.4 if fighter.is_tired() else 1.0)


func _feint_rate() -> float:
	# A player who slips everything gets shown more fakes.
	return style.feint_chance + (0.2 * _dodge_habit if profile.adaptive else 0.0)


## A lead combination, aimed where the player's guard is not when the fighter can read it.
func _pick_combo(combat: CombatController) -> Array:
	var pool := style.combos
	var want := -1
	if combat.blocking and (profile.adaptive or style.guard_read >= 0.3):
		want = Strike.Zone.HEAD if combat.guard_low else Strike.Zone.BODY
	elif profile.adaptive and randf() < _block_habit:
		want = Strike.Zone.BODY
	if want >= 0 and randf() < 0.75:
		var open: Array[Array] = []
		for combo: Array in pool:
			if Strike.zone_of(combo[0]) == want:
				open.append(combo)
		if not open.is_empty():
			pool = open
	return pool.pick_random()


# --- Answering the player --------------------------------------------------------------------

## The player has just started a strike: slip it, cover the right level, or get caught.
func on_player_strike(strike: Strike) -> void:
	memory.note_strike(_key_of(strike))
	var opener := _since_player_strike > SEQUENCE_GAP
	_since_player_strike = 0.0
	if _riposte >= 0.0:
		# More is coming: hold the answer until it stops.
		_riposte = RIPOSTE_DELAY
	_body_seen = lerpf(_body_seen, 1.0 if strike.is_body() else 0.0, 0.35)
	var level_change := strike.zone != _last_zone and _zone_age < LEVEL_CHANGE_WINDOW
	_last_zone = strike.zone
	_zone_age = 0.0
	_reacted = null
	_reaction = Reaction.NONE
	if not fighter.can_slip() or _committed > 0.0 or fighter.to_target().length() > REACT_RANGE:
		return
	_reacted = strike
	# Mashing is read by everyone, every time.
	if strike.sloppy:
		_slip(strike, true, false)
		return
	# The third helping of the same combination.
	if profile.adaptive and memory.is_repeating():
		memory.forget_attacks()
		fighter.say("READ!", CombatPopup.HOT)
		_slip(strike, true, true)
		return
	var iq := _iq()
	if fighter.blocked_recently >= 2 and randf() < style.counter_chance * iq:
		# Another punch into the guard: not this time.
		_slip(strike, true, false)
		return
	if opener and _slip_wait <= 0.0:
		var baiting := fighter.state == EnemyFighter.State.FEINT
		if randf() < style.slip_skill * iq * (1.5 if baiting else 1.0):
			_slip(strike, randf() < style.counter_rate, false)
			return
	if randf() < style.guard_read * iq * (LEVEL_CHANGE_READ if level_change else 1.0):
		_guard_before = fighter.guard_mode
		_reaction = Reaction.GUARD
		fighter.set_guard(EnemyFighter.Guard.LOW if strike.is_body() else EnemyFighter.Guard.HIGH)
		_guard_timer = maxf(_guard_timer, 0.7)


## The strike just answered was a feint: see through it, or stay stuck with the answer.
func on_player_feint(strike: Strike) -> void:
	memory.note_feint()
	if _reacted != strike or _reaction == Reaction.NONE:
		return
	_reacted = null
	if randf() < style.feint_read * _iq():
		if _reaction == Reaction.GUARD:
			fighter.set_guard(_guard_before)
		else:
			fighter.cancel_slip()
			_slip_wait = 0.3
		return
	_committed = COMMIT_TIME
	if _reaction == Reaction.SLIP:
		fighter.spoil_slip(COMMIT_TIME)
	fighter.say("FEINTED!", CombatPopup.ACCENT)
	fighter.target.combat.note_bait()


func on_player_dodge(direction: int) -> void:
	memory.note_dodge(direction)
	_dodge_habit = lerpf(_dodge_habit, 1.0, 0.3)


## A player strike that hit nothing but air in front of the fighter gets punished, a beat later
## so the answer is not thrown into whatever follows it.
func on_player_strike_resolved(strike: Strike) -> void:
	if strike.outcome != Strike.Outcome.MISS or strike.sloppy:
		return
	if not fighter.is_free() or _committed > 0.0 or tactic == Tactic.WAIT:
		return
	if fighter.to_target().length() > fighter.reach_of(style.counter_move) + WHIFF_RANGE:
		return
	_riposte = WHIFF_DELAY
	_riposte_reach = WHIFF_RANGE


func _slip(strike: Strike, counter: bool, finisher: bool) -> void:
	var toward := fighter.to_target().normalized()
	var direction := -toward
	# Round punches are pulled away from; straight ones are slipped to the side.
	var looping := strike.kind == Strike.HOOK or strike.kind == Strike.OVERHAND or strike.kind == Strike.BODY_HOOK
	if not looping and randf() < 0.65:
		direction = toward.cross(Vector3.UP) * _strafe_direction
	_reaction = Reaction.SLIP
	_slip_wait = style.slip_cooldown
	fighter.start_slip(_mind_the_fence(direction), style.counter_move if counter else &"", style.counter_haste, finisher)


# --- Feedback from the fighter ---------------------------------------------------------------

## The fighter's own strike resolved: remember how the player dealt with it.
func on_strike_landed(strike: Strike) -> void:
	match strike.outcome:
		Strike.Outcome.BLOCKED:
			_block_habit = lerpf(_block_habit, 1.0, 0.3)
		Strike.Outcome.DODGED:
			_dodge_habit = lerpf(_dodge_habit, 1.0, 0.3)
		Strike.Outcome.HIT, Strike.Outcome.KNOCKOUT:
			_block_habit = lerpf(_block_habit, 0.0, 0.2)
			_dodge_habit = lerpf(_dodge_habit, 0.0, 0.2)


func on_attack_done() -> void:
	# Hands straight back to the guard once the punch is home.
	_guard_timer = 0.0
	if randf() < style.retreat:
		_retreat_time = 0.7


## A feint has run its course: punish whatever the player did about it.
func on_feint_done() -> void:
	_guard_timer = 0.0
	var combat := fighter.target.combat
	var distance := fighter.to_target().length()
	if combat.get_dodge_age() < EnemyFighter.FEINT_TIME + 0.08:
		combat.note_fooled()
		# The straight arrives as the slip runs out of room.
		var wait := CombatController.IFRAME_TIME - combat.get_dodge_age() + 0.05
		fighter.start_attack([style.counter_move], style.counter_haste, false, wait)
	elif combat.blocking and distance <= style.preferred_range + 0.6 and randf() < 0.75:
		if combat.get_block_age() < EnemyFighter.FEINT_TIME + 0.1:
			combat.note_fooled()
		# The guard went to one level: the punch goes to the other.
		fighter.start_attack([Strike.CROSS if combat.guard_low else Strike.BODY_CROSS], style.counter_haste)
	elif distance <= style.preferred_range + 0.45 and randf() < 0.4:
		fighter.start_attack(_pick_combo(combat))
	else:
		_lead_timer = randf_range(0.4, 0.9)


## Took a clean hit and stayed in the fight.
func on_hit(strike: Strike) -> void:
	# Nobody leads with their head still ringing.
	_lead_timer = maxf(_lead_timer, 0.35)
	if fighter.is_free() and fighter.guard > 0.0 and not fighter.is_tired() and randf() < style.block_reaction:
		fighter.set_guard(EnemyFighter.Guard.LOW if strike.is_body() else EnemyFighter.Guard.HIGH)
		_guard_timer = 1.2
	if randf() < style.retreat * 0.5:
		_retreat_time = 0.5


## Caught a punch on the guard: once the combination stops coming, send something back.
func on_blocked(_strike: Strike) -> void:
	_riposte = RIPOSTE_DELAY
	_riposte_reach = 0.3


## The player's attack is over (nothing new started while the answer was held back).
func _answer_back() -> void:
	if not fighter.is_free() or _committed > 0.0 or tactic == Tactic.WAIT:
		return
	if fighter.to_target().length() > fighter.reach_of(style.counter_move) + _riposte_reach:
		return
	if randf() < style.counter_rate * _iq():
		_lead_timer = _next_lead()
		fighter.start_attack([style.counter_move], style.counter_haste)


## A body shot knocked the wind out of a combination.
func on_rhythm_broken() -> void:
	_lead_timer += 0.5
	_burst_timer += 0.5


## Back in the fight after a stagger, a rocked spell or a knockdown.
func on_recovered() -> void:
	_lead_timer = randf_range(0.5, 1.0)
	_guard_timer = 1.0
	if fighter.guard > 0.0:
		fighter.set_guard(EnemyFighter.Guard.HIGH)
	if not style.pressure:
		_retreat_time = 0.4


# --- Helpers ---------------------------------------------------------------------------------

func _iq() -> float:
	return TIRED_IQ if fighter.is_tired() else 1.0


## A hybrid changes gear: the other style takes over from here.
func _swap_style() -> void:
	style = profile.alt_style if style == profile.style else profile.style
	_swap_timer = randf_range(SWAP_TIME.x, SWAP_TIME.y)
	_lead_timer = minf(_lead_timer, 0.6)
	_burst_timer = randf_range(style.probe_time.x, style.probe_time.y) * 0.5
	fighter.on_style_changed()


## The button a strike came off, in PatternMemory's notation.
static func _key_of(strike: Strike) -> String:
	match strike.kind:
		Strike.JAB, Strike.HOOK:
			return "L"
		Strike.BODY_HOOK:
			return "l"
		Strike.BODY_CROSS:
			return "r"
		Strike.KICK, Strike.KNEE:
			return "K"
	return "R"
