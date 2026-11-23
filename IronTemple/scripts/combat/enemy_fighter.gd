class_name EnemyFighter
extends CharacterBody3D
## An opponent in the cage: a CharacterModel body shaped by its FighterProfile, a hurtbox the
## player strikes, an overhead tag, and the action state machine that carries out what its
## EnemyAI brain decides. The body owns the rules: wind-ups and tells, the two guards, slips,
## the clinch, the chin gauge, knockdowns and knockouts.
##
## Every dangerous move is readable before it lands. A cue pops over the head and the glove
## glows for the whole wind-up, and no wind-up is shorter than MIN_WINDUP:
##
##   "!" / "!!"   head strike, light or heavy; an overhand or hook also swooshes as it loads
##   "LOW"        body shot: the fighter dips a level first
##   "GRAB"       clinch attempt: a step in with both arms reaching wide
##   "!!!"        explosive burst: a tense crouch and a sharp exhale before the combination
##
## A feint shows the cue and the twitch of the shoulder but the glove never lights up.

signal health_changed(current: float, maximum: float)
signal guard_changed(current: float, maximum: float)
signal stamina_changed(current: float, maximum: float)
## The chin gauge moved; `fill` is 0 to 1 (see ChinGauge.get_fill).
signal chin_changed(fill: float, rocked: bool)
signal guard_mode_changed(mode: Guard)
## The tell over the head changed: its text and colour, "" when it is gone. The HUD repeats it,
## because up close the fighter's head is out of the top of the view.
signal cue_changed(text: String, color: Color)
## Put on the canvas for the `count`-th time this bout.
signal knocked_down(count: int)
signal defeated

enum State { IDLE, FOOTWORK, WINDUP, STRIKE, RECOVER, FEINT, SLIP, CROUCH, REACH, CLINCH, STAGGER, ROCKED, DOWN, OUT, VICTORY }
enum Guard { NONE, HIGH, LOW }

## `power` multiplies the profile's damage. `windup` (before the style's telegraph factor),
## `strike` and `recover` are seconds; `reach` is centre to centre. `stagger` is the composure
## a clean hit takes and `drain` the stamina a body shot saps.
const MOVES := {
	Strike.JAB: {"power": 1.0, "windup": 0.42, "strike": 0.09, "recover": 0.34, "reach": 1.8, "cost": 5.0, "knockback": 0.6, "heavy": false, "stagger": 6.0, "drain": 0.0},
	Strike.CROSS: {"power": 1.6, "windup": 0.55, "strike": 0.1, "recover": 0.45, "reach": 1.85, "cost": 8.0, "knockback": 1.4, "heavy": true, "stagger": 14.0, "drain": 0.0},
	Strike.HOOK: {"power": 2.0, "windup": 0.66, "strike": 0.11, "recover": 0.55, "reach": 1.65, "cost": 10.0, "knockback": 1.8, "heavy": true, "stagger": 16.0, "drain": 0.0},
	Strike.UPPERCUT: {"power": 1.8, "windup": 0.6, "strike": 0.1, "recover": 0.5, "reach": 1.5, "cost": 9.0, "knockback": 1.0, "heavy": true, "stagger": 18.0, "drain": 0.0},
	Strike.OVERHAND: {"power": 2.4, "windup": 0.8, "strike": 0.12, "recover": 0.7, "reach": 1.8, "cost": 12.0, "knockback": 2.2, "heavy": true, "stagger": 24.0, "drain": 0.0},
	Strike.BODY_HOOK: {"power": 1.3, "windup": 0.6, "strike": 0.1, "recover": 0.5, "reach": 1.6, "cost": 8.0, "knockback": 0.8, "heavy": true, "stagger": 8.0, "drain": 14.0},
	Strike.BODY_CROSS: {"power": 1.4, "windup": 0.58, "strike": 0.1, "recover": 0.48, "reach": 1.8, "cost": 8.0, "knockback": 1.0, "heavy": true, "stagger": 8.0, "drain": 12.0},
	Strike.KICK: {"power": 1.5, "windup": 0.7, "strike": 0.12, "recover": 0.6, "reach": 2.15, "cost": 11.0, "knockback": 5.0, "heavy": true, "stagger": 6.0, "drain": 8.0},
	Strike.KNEE: {"power": 1.2, "windup": 0.45, "strike": 0.1, "recover": 0.3, "reach": 1.2, "cost": 7.0, "knockback": 0.0, "heavy": true, "stagger": 6.0, "drain": 14.0},
}
## No wind-up is ever shorter than this, whatever the style says.
const MIN_WINDUP := 0.28
## Half-angle in front of the fighter that a strike covers.
const STRIKE_CONE := 0.7
const TURN_SPEED := 7.0
## Gassed below this share of stamina, until it climbs back over FRESH: slower, weaker, guard
## down, and one clean intercept away from being put out.
const TIRED := 0.2
const FRESH := 0.4
const TIRED_POWER := 0.75
## Seconds a clean body shot stops the stamina coming back.
const WINDED_TIME := 2.5
const GUARD_BREAK_STAGGER := 0.8
## Seconds a rebuilt guard cannot be broken again.
const GUARD_REBUILD := 2.0
const INTERCEPT_STAGGER := 0.25
## Seconds between the strikes of a combination.
const FOLLOW_GAP := 0.14
const FEINT_TIME := 0.26
const SLIP_TIME := 0.36
## Seconds from the start of a slip during which strikes pass through. A slip that carries a
## counter stays off the line for COUNTER_EVADE longer, until the counter is on its way: the rest
## of the combination it slipped sails past instead of catching the wind-up.
const SLIP_IFRAMES := 0.3
const COUNTER_EVADE := 0.2
const SLIP_SPEED := 2.8
const CROUCH_TIME := 0.45
const REACH_TIME := 0.5
const CLINCH_RANGE := 1.25
## Distance the fighter holds the player at in the clinch.
const CLINCH_HOLD := 0.72
const CLINCH_KNEES := 3
const KNEE_PERIOD := 0.9
const KNEE_WINDUP := 0.45
const FALL_TIME := 0.55
## A knockdown, from the blow to back on the feet, and how much of it is the get-up.
const KNOCKDOWN_TIME := 2.4
const RISE_TIME := 0.7
const MAX_KNOCKDOWNS := 2
const LIGHT_CUE := Color(1.0, 0.86, 0.3)
const HEAVY_CUE := Color(1.0, 0.32, 0.25)
const BODY_CUE := Color(0.4, 0.85, 1.0)
const GRAB_CUE := Color(0.76, 0.58, 1.0)
const BURST_CUE := Color(1.0, 0.45, 0.85)
## Size of the cue (it keeps the same size on screen at any distance).
const CUE_SIZE := 0.0011

var profile: FighterProfile
var brain: EnemyAI
var state := State.IDLE
var health := 1.0
var guard := 1.0
var stamina := 1.0
var chin := ChinGauge.new()
var knockdowns := 0
var guard_mode := Guard.NONE
var target: Player = null
## Punches the guard has stopped in a row.
var blocked_recently := 0
## How the fighter was stopped: &"ko" (health), &"knockdowns" or &"counter" (caught gassed).
var finish: StringName = &""
var arena_centre := Vector3.ZERO
var arena_radius := 0.0

var _animator := FightAnimator.new()
var _glove_materials: Array[StandardMaterial3D] = []
var _state_time := 0.0
var _knock := Vector3.ZERO
var _stride := 0.0
var _move_amount := 0.0
# The attack in progress: the strike being thrown and the rest of the combination.
var _queue: Array = []
var _move: Dictionary = {}
var _move_kind: StringName = Strike.JAB
var _move_side := 0
var _windup_time := 0.5
# How far the arm is already drawn back when a wind-up starts (a counter loaded in a slip).
var _wound := 0.0
var _recover_time := 0.4
var _burst := false
var _lunge := false
var _finisher := false
var _tracking := false
var _stagger_time := 0.0
var _guard_broken := false
var _composure_left := 0.0
var _untouchable := 0.0
var _since_hit := 10.0
var _blocked_timer := 0.0
var _gassed := false
var _winded := 0.0
var _hands_down := 0.0
var _slip_velocity := Vector3.ZERO
var _slip_time := SLIP_TIME
var _evade_left := 0.0
var _slip_lean := 0.0
var _slip_counter: StringName = &""
var _slip_haste := 1.0
var _knees_left := 0
var _knee_time := 0.0
var _knee_thrown := 0.0
var _cue_tween: Tween

@onready var model: CharacterModel = $Model
@onready var hurtbox: CombatTarget = $Hurtbox
@onready var collision_shape: CollisionShape3D = $CollisionShape3D
@onready var name_tag: Label3D = $NameTag
@onready var telegraph: Label3D = $Telegraph


## Call before adding the fighter to the tree: the body takes its colours when it is built.
func setup(fighter: FighterProfile) -> void:
	profile = fighter
	health = fighter.max_health
	guard = fighter.guard_max
	stamina = fighter.max_stamina
	chin.reset(fighter.chin)
	var body: CharacterModel = $Model
	body.render_layers = 1
	body.skin_color = fighter.skin
	body.shirt_color = fighter.skin if fighter.bare_chest else fighter.shirt
	body.shorts_color = fighter.shorts
	# Barefoot, like everyone in the cage.
	body.shoe_color = fighter.skin
	body.hair_color = fighter.hair
	body.look = FighterLook.of(fighter)
	body.scale = Vector3(1.0, fighter.height, 1.0)
	body.set_physique(fighter.build.x, fighter.build.y, fighter.build.z)


func _ready() -> void:
	if profile == null:
		setup(FighterProfile.new())
	motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	brain = EnemyAI.new(self)
	model.fight_pose = _animator.pose
	model.fight_blend = 1.0
	on_style_changed()
	for i in 2:
		# Each glove has its own material so it can glow through a wind-up.
		var material := StandardMaterial3D.new()
		material.albedo_color = profile.gloves
		material.roughness = 0.5
		material.emission_enabled = true
		material.emission = HEAVY_CUE
		material.emission_energy_multiplier = 0.0
		FightGear.glove(model.get_hand(i), material, Color(0.95, 0.95, 0.97))
		_glove_materials.append(material)
	if model.look.has("aura"):
		FighterLook.add_aura(self, model.look["aura"], 1.9 * profile.height)
	name_tag.text = "%s\n%s" % [profile.fighter_name.to_upper(), profile.get_tag()]
	name_tag.position.y = 1.95 * profile.height + 0.42
	telegraph.position.y = 1.95 * profile.height + 0.16
	telegraph.visible = false
	hurtbox.struck.connect(_on_struck)
	chin.changed.connect(func() -> void: chin_changed.emit(chin.get_fill(), chin.rocked))


func _exit_tree() -> void:
	_release_clinch()


## Keeps the fighter inside a circular arena: `centre` is in world space, on the canvas.
func set_arena(centre: Vector3, radius: float) -> void:
	arena_centre = centre
	arena_radius = radius


## Starts fighting `opponent`. Until then the fighter stands in its guard.
func begin(opponent: Player) -> void:
	target = opponent
	var combat := opponent.combat
	combat.strike_started.connect(_on_player_strike_started)
	combat.feinted.connect(_on_player_feinted)
	combat.dodged.connect(_on_player_dodged)
	combat.strike_resolved.connect(_on_player_strike_resolved)
	# The HUD carries the name from here on; over the head it would sit on top of the tells.
	name_tag.visible = false
	_enter(State.FOOTWORK)


## The opponent is down for good: stop fighting and raise the arms.
func celebrate() -> void:
	if state == State.DOWN or state == State.OUT:
		return
	_end_attack()
	_release_clinch()
	set_guard(Guard.NONE)
	_enter(State.VICTORY)


## Turns to face a world position at once.
func face(point: Vector3) -> void:
	var toward := point - global_position
	if Vector2(toward.x, toward.z).length() > 0.01:
		rotation.y = atan2(-toward.x, -toward.z)


func _physics_process(delta: float) -> void:
	_state_time += delta
	_tick_meters(delta)
	var move := Vector3.ZERO
	match state:
		State.FOOTWORK:
			move = brain.think(delta)
		State.WINDUP:
			move = _wind_up(delta)
		State.STRIKE:
			move = _throw()
		State.RECOVER:
			_recover()
		State.FEINT:
			_feint()
		State.SLIP:
			move = _slip()
		State.CROUCH:
			_crouch(delta)
		State.REACH:
			move = _reach(delta)
		State.CLINCH:
			move = _hold(delta)
		State.STAGGER:
			if _state_time >= _stagger_time:
				_shake_it_off()
		State.ROCKED:
			# Legs gone: drifts back, going nowhere in particular.
			move = global_transform.basis.z * 0.45
		State.DOWN:
			if _state_time >= KNOCKDOWN_TIME:
				_get_up()
	if _winded > 0.0 and state == State.FOOTWORK:
		move *= 0.6
	_knock = _knock.lerp(Vector3.ZERO, 1.0 - exp(-6.0 * delta))
	velocity = move + _knock
	move_and_slide()
	_confine()
	_animate(delta)


# --- What the brain can ask for ---------------------------------------------------------------

## On its feet in neutral, free to choose the next move.
func is_free() -> bool:
	return state == State.FOOTWORK


## Able to slip a strike right now.
func can_slip() -> bool:
	return state == State.FOOTWORK or state == State.FEINT


func is_tired() -> bool:
	return _gassed


func is_guarding() -> bool:
	return guard_mode != Guard.NONE and state == State.FOOTWORK and guard > 0.0 and _hands_down <= 0.0


## The level the fighter is covering right now, for the HUD: NONE whenever the hands are away
## from the guard, whatever the fighter means to do with them next.
func get_shown_guard() -> Guard:
	return guard_mode if is_guarding() else Guard.NONE


func set_guard(mode: Guard) -> void:
	if mode == guard_mode:
		return
	guard_mode = mode
	guard_mode_changed.emit(mode)


## Horizontal offset to the opponent.
func to_target() -> Vector3:
	if target == null:
		return -global_transform.basis.z
	var offset := target.global_position - global_position
	offset.y = 0.0
	return offset


func turn(toward: Vector3, delta: float) -> void:
	rotation.y = lerp_angle(rotation.y, atan2(-toward.x, -toward.z), 1.0 - exp(-TURN_SPEED * delta))


## Centre-to-centre reach of `kind` in the current style.
func reach_of(kind: StringName) -> float:
	var move: Dictionary = MOVES[kind]
	var reach: float = move["reach"]
	return reach + brain.style.reach


## Throws `combo`, a list of strike kinds, one after another. `haste` below 1 shortens the
## first wind-up; `hold` keeps it at least that long. A `finisher` floors the player if it
## lands clean.
func start_attack(combo: Array, haste: float = 1.0, finisher: bool = false, hold: float = 0.0) -> void:
	_queue = combo.duplicate()
	_burst = false
	_finisher = finisher
	# Counters close the distance with the punch.
	_lunge = haste < 1.0
	_begin_windup(_queue.pop_front(), haste, hold)


## Broken rhythm: coils into a tense crouch with a sharp exhale, then explodes through `combo`.
func start_burst(combo: Array) -> void:
	_queue = combo.duplicate()
	_burst = true
	_finisher = false
	_lunge = true
	set_guard(Guard.NONE)
	_spend(6.0)
	_show_cue("!!!", BURST_CUE)
	AudioManager.play(&"exhale")
	_enter(State.CROUCH)


## Sells the start of `kind` and pulls it: the cue and the twitch, but no glow on the glove.
func start_feint(kind: StringName) -> void:
	_move_kind = kind
	_move_side = _side_of(kind)
	set_guard(Guard.NONE)
	_show_tell(kind, false)
	AudioManager.play(&"feint", 0.6)
	_enter(State.FEINT)


## Slips along `direction`. With a `counter` the slip is its wind-up: the cue shows from the
## first frame and the punch follows straight out of the lean.
func start_slip(direction: Vector3, counter: StringName = &"", haste: float = 1.0, finisher: bool = false) -> void:
	var toward := to_target().normalized()
	_slip_velocity = direction.normalized() * SLIP_SPEED
	_slip_lean = signf(direction.dot(toward.cross(Vector3.UP))) if absf(direction.dot(toward)) < 0.7 else 0.0
	_slip_time = SLIP_TIME
	_evade_left = SLIP_IFRAMES if counter == &"" else SLIP_TIME + COUNTER_EVADE
	_slip_counter = counter
	_slip_haste = haste
	_finisher = finisher
	set_guard(Guard.NONE)
	_spend(4.0)
	if counter != &"":
		_show_tell(counter, true)
	AudioManager.play_varied(&"whoosh", 0.45)
	_enter(State.SLIP)


## The slip was drawn by a feint: no counter, and the fighter is left open for `seconds`.
func spoil_slip(seconds: float) -> void:
	if state != State.SLIP:
		return
	_evade_left = minf(_evade_left, 0.04)
	_slip_time = maxf(_slip_time, _state_time + seconds)
	_slip_counter = &""
	_finisher = false
	_hide_cue()


## Saw through the feint in time: straight back to the guard.
func cancel_slip() -> void:
	if state != State.SLIP:
		return
	_slip_counter = &""
	_evade_left = 0.0
	_finisher = false
	_hide_cue()
	_enter(State.FOOTWORK)


## Steps in with both arms reaching wide for a clinch.
func start_clinch() -> void:
	set_guard(Guard.NONE)
	_spend(8.0)
	_show_cue("GRAB", GRAB_CUE)
	AudioManager.play(&"lunge", 0.8)
	_enter(State.REACH)


## The player tore out of the clinch and shoved the fighter off.
func on_clinch_broken() -> void:
	if state != State.CLINCH:
		return
	_animator.clear_strike()
	_knock -= to_target().normalized() * 4.5
	_stagger(0.8)


## The brain changed style (hybrids): carry the body the new way.
func on_style_changed() -> void:
	_animator.nerves = brain.style.nerves
	_animator.bounce = brain.style.bounce


## Floating word over the fighter's head.
func say(text: String, color: Color) -> void:
	var at := global_position + Vector3.UP * (1.95 * profile.height + 0.55)
	CombatPopup.spawn(get_tree().current_scene, text, at, color, 0.28, 1.1)


# --- Attacking -------------------------------------------------------------------------------

## Starts the telegraphed wind-up of `kind`. `haste` below 1 shortens it (follow-ups, counters);
## `shown` is how much of the tell has already played (a slip), `hold` a minimum length.
func _begin_windup(kind: StringName, haste: float, hold: float = 0.0, shown: float = 0.0) -> void:
	_move_kind = kind
	_move = MOVES[kind]
	_move_side = _side_of(kind)
	var windup: float = _move["windup"]
	windup *= brain.style.telegraph * haste
	if is_tired():
		windup *= 1.3
	_windup_time = maxf(maxf(maxf(windup, MIN_WINDUP) - shown, 0.08), hold)
	_wound = 1.0 if shown > 0.0 else 0.0
	_tracking = false
	set_guard(Guard.NONE)
	var cost: float = _move["cost"]
	_spend(cost * brain.style.effort)
	if shown <= 0.0:
		_show_tell(kind, true)
	_enter(State.WINDUP)


func _wind_up(delta: float) -> Vector3:
	var offset := to_target()
	var distance := offset.length()
	var toward := offset / maxf(distance, 0.001)
	_wait_out_slip()
	var progress := _state_time / _windup_time
	# Tracks the target until the blow is committed; a late sidestep makes it miss.
	if progress < 0.7 or _tracking:
		turn(toward, delta)
	_animator.set_strike(_move_kind, _move_side, maxf(progress / 0.6, _wound), 0.0)
	_glow(_move_side, maxf(clampf(progress * 1.5, 0.0, 1.0), _wound))
	if progress >= 1.0:
		_enter(State.STRIKE)
	if distance <= reach_of(_move_kind) - 0.25:
		return Vector3.ZERO
	return toward * brain.style.move_speed * (1.5 if _lunge else 0.5)


## An adaptive fighter who has seen the same slip twice holds the punch when the third one
## comes, and lets it go as the slip runs out of room. The wind-up stays on show throughout.
func _wait_out_slip() -> void:
	if not profile.adaptive or _tracking:
		return
	var combat := target.combat
	var since := combat.get_dodge_age()
	# The slip in progress is already in the memory: it has to be the third of its kind.
	if since > _state_time or not brain.memory.is_dodge_repeating():
		return
	_windup_time = maxf(_windup_time, _state_time + CombatController.IFRAME_TIME - since + 0.06)
	_tracking = true
	_lunge = true
	_finisher = true
	brain.memory.forget_dodges()
	say("READ!", CombatPopup.HOT)


func _throw() -> Vector3:
	var duration: float = _move["strike"]
	var progress := _state_time / duration
	_animator.set_strike(_move_kind, _move_side, 1.0, progress)
	if progress >= 1.0:
		_land()
	# Steps into the blow.
	return -global_transform.basis.z * 1.6


## The moment of impact: hands the strike to the player and reads back what happened.
func _land() -> void:
	var offset := to_target()
	var distance := offset.length()
	var toward := offset / maxf(distance, 0.001)
	var style := brain.style
	var power: float = _move["power"]
	var stagger: float = _move["stagger"]
	var drain: float = _move["drain"]
	var strike := Strike.new()
	strike.kind = _move_kind
	strike.side = _move_side
	strike.zone = Strike.zone_of(_move_kind)
	strike.attacker = self
	strike.damage = profile.damage * power * randf_range(0.94, 1.06) * (TIRED_POWER if is_tired() else 1.0)
	strike.guard_damage = style.guard_shred * power
	strike.stagger = stagger * style.stagger_power
	strike.stamina_drain = drain * style.drain_power
	strike.heavy = _move["heavy"]
	strike.knockback = _move["knockback"]
	strike.finisher = _finisher
	strike.direction = toward
	strike.reach = reach_of(_move_kind)
	var in_reach := distance <= reach_of(_move_kind) and (-global_transform.basis.z).angle_to(toward) <= STRIKE_CONE
	target.combat.receive_strike(strike, in_reach)
	brain.on_strike_landed(strike)
	if state != State.STRIKE:
		# That was the knockout: the fighter is already celebrating.
		return
	var recover: float = _move["recover"]
	recover *= style.recovery
	match strike.outcome:
		Strike.Outcome.MISS, Strike.Outcome.DODGED:
			# A whiff hangs the arm out and ends the combination: the counter opening.
			recover = recover * 1.35 + (0.3 if strike.perfect else 0.0)
			_queue.clear()
		Strike.Outcome.BLOCKED:
			pass
		_:
			recover *= 0.85
	if not _queue.is_empty():
		recover = FOLLOW_GAP
	_recover_time = recover
	_hide_cue()
	_enter(State.RECOVER)


func _recover() -> void:
	_animator.set_strike(_move_kind, _move_side, 0.0, 1.0 - _state_time / _recover_time)
	if _state_time < _recover_time:
		return
	_animator.clear_strike()
	if not _queue.is_empty():
		_begin_windup(_queue.pop_front(), brain.style.burst_haste if _burst else brain.style.follow_haste)
		return
	_end_attack()
	_hands_down = brain.style.hands_down
	_enter(State.FOOTWORK)
	brain.on_attack_done()


func _feint() -> void:
	var progress := _state_time / FEINT_TIME
	_animator.set_strike(_move_kind, _move_side, sin(minf(progress, 1.0) * PI) * 0.75, 0.0)
	if progress < 1.0:
		return
	_end_attack()
	_enter(State.FOOTWORK)
	brain.on_feint_done()


func _slip() -> Vector3:
	var progress := _state_time / _slip_time
	if _slip_counter != &"":
		# The lean is the wind-up: the fist is already loaded as the fighter comes back.
		_animator.set_strike(_slip_counter, _side_of(_slip_counter), progress, 0.0)
		_glow(_side_of(_slip_counter), clampf(progress * 1.5, 0.0, 1.0))
	if progress < 1.0:
		return _slip_velocity * maxf(1.0 - _state_time / SLIP_TIME, 0.0)
	if _slip_counter == &"":
		_enter(State.FOOTWORK)
		brain.on_attack_done()
		return Vector3.ZERO
	var counter := _slip_counter
	_slip_counter = &""
	_queue.clear()
	_burst = false
	_lunge = true
	_begin_windup(counter, _slip_haste, 0.0, _slip_time)
	return Vector3.ZERO


func _crouch(delta: float) -> void:
	turn(to_target().normalized(), delta)
	if _state_time >= CROUCH_TIME:
		_begin_windup(_queue.pop_front(), brain.style.burst_haste)


func _end_attack() -> void:
	_animator.clear_strike()
	_queue.clear()
	_burst = false
	_lunge = false
	_finisher = false
	_tracking = false
	_slip_counter = &""
	_evade_left = 0.0
	_hide_cue()


# --- Clinch ----------------------------------------------------------------------------------

func _reach(delta: float) -> Vector3:
	var offset := to_target()
	var distance := offset.length()
	var toward := offset / maxf(distance, 0.001)
	turn(toward, delta)
	if _state_time < REACH_TIME:
		return toward * 3.2 if distance > CLINCH_HOLD + 0.1 else Vector3.ZERO
	_hide_cue()
	var facing := (-global_transform.basis.z).angle_to(toward) <= STRIKE_CONE
	if distance <= CLINCH_RANGE and facing and target.combat.enter_clinch(self):
		_knees_left = CLINCH_KNEES
		_knee_time = KNEE_PERIOD
		_knee_thrown = 0.0
		AudioManager.play(&"grab")
		_enter(State.CLINCH)
	else:
		# Grabbed at air and stumbles through.
		_stagger(0.7)
	return Vector3.ZERO


## Holds the player chest to chest and drives knees into the body until they break out or the
## last knee has landed.
func _hold(delta: float) -> Vector3:
	var offset := to_target()
	var distance := offset.length()
	var toward := offset / maxf(distance, 0.001)
	turn(toward, delta)
	var combat := target.combat
	if combat.clinch != self:
		# The player went down or the bout ended: nothing left to hold.
		_animator.clear_strike()
		_enter(State.FOOTWORK)
		brain.on_attack_done()
		return Vector3.ZERO
	_knee_time -= delta
	_knee_thrown = maxf(_knee_thrown - delta, 0.0)
	# The knee coming up is the moment a timed push tears the grip open.
	combat.set_clinch_window(_knees_left > 0 and _knee_time <= KNEE_WINDUP)
	if _knee_thrown > 0.0:
		_animator.set_strike(Strike.KNEE, 1, 0.0, _knee_thrown / 0.25)
	elif _knees_left > 0 and _knee_time <= KNEE_WINDUP:
		_animator.set_strike(Strike.KNEE, 1, 1.0 - _knee_time / KNEE_WINDUP, 0.0)
	else:
		_animator.clear_strike()
	if _knee_time <= 0.0:
		if _knees_left <= 0:
			_let_go(toward)
			return Vector3.ZERO
		_knee(toward)
	return (offset - toward * CLINCH_HOLD) * 10.0


func _knee(toward: Vector3) -> void:
	var move: Dictionary = MOVES[Strike.KNEE]
	var power: float = move["power"]
	var stagger: float = move["stagger"]
	var drain: float = move["drain"]
	var cost: float = move["cost"]
	var strike := Strike.new()
	strike.kind = Strike.KNEE
	strike.side = 1
	strike.zone = Strike.Zone.BODY
	strike.attacker = self
	strike.held = true
	strike.heavy = true
	strike.damage = profile.damage * power * randf_range(0.94, 1.06) * (TIRED_POWER if is_tired() else 1.0)
	strike.stagger = stagger * brain.style.stagger_power
	strike.stamina_drain = drain * brain.style.drain_power
	strike.direction = toward
	_spend(cost)
	_knees_left -= 1
	_knee_time = KNEE_PERIOD if _knees_left > 0 else 0.35
	_knee_thrown = 0.25
	target.combat.receive_strike(strike, true)


## Out of knees: pushes the player off and resets.
func _let_go(toward: Vector3) -> void:
	_release_clinch()
	target.apply_impulse(toward * 3.0)
	_animator.clear_strike()
	_enter(State.FOOTWORK)
	brain.on_attack_done()


func _release_clinch() -> void:
	if target != null and is_instance_valid(target) and target.combat.clinch == self:
		target.combat.release_clinch()


# --- Getting hit -----------------------------------------------------------------------------

func _on_struck(strike: Strike) -> void:
	if state == State.IDLE or state == State.DOWN or state == State.OUT or state == State.VICTORY or _untouchable > 0.0:
		return
	# Slipping. An arm punch thrown past the anti-spam limit never catches a fighter who is
	# already moving out of its way.
	if _evade_left > 0.0 or (state == State.SLIP and strike.sloppy):
		strike.outcome = Strike.Outcome.DODGED
		return
	_since_hit = 0.0
	var body := strike.is_body()
	var open := state == State.STAGGER or state == State.ROCKED
	# Beaten to the punch: caught loading up, with the hands away from the guard.
	var intercepted := not strike.sloppy and (state == State.WINDUP or state == State.STRIKE or state == State.CROUCH or state == State.REACH)
	# Just out of a stagger: takes the damage but will not be staggered again yet.
	var steady := _composure_left > 0.0
	var broke := false
	if _covers(strike.zone):
		blocked_recently += 1
		_blocked_timer = 1.2
		# Fresh out of a stagger the guard holds whatever is thrown at it.
		if not steady:
			guard = 0.0 if strike.guard_breaker else maxf(guard - strike.guard_damage, 0.0)
			guard_changed.emit(guard, profile.guard_max)
		if guard <= 0.0:
			broke = true
			strike.outcome = Strike.Outcome.GUARD_BREAK
			strike.dealt = strike.damage * 0.6
		else:
			strike.outcome = Strike.Outcome.BLOCKED
			strike.dealt = strike.damage * (1.0 - brain.style.block_power)
	else:
		strike.outcome = Strike.Outcome.HIT
		# Bonuses do not stack: the best of the combo's own, the intercept, the opening and the
		# set-up is the one that counts.
		var best := strike.bonus
		if intercepted:
			strike.counter_hit = true
			best = maxf(best, Strike.COUNTER_HIT_DAMAGE)
		elif open:
			best = maxf(best, Strike.OPEN_DAMAGE)
		if not body and chin.is_set_up():
			strike.setup = true
			best = maxf(best, Strike.SETUP_DAMAGE)
		strike.dealt = strike.damage * best / strike.bonus

	var blocked := strike.outcome == Strike.Outcome.BLOCKED
	health = maxf(health - strike.dealt, 0.0)
	health_changed.emit(health, profile.max_health)
	if strike.stamina_drain > 0.0:
		_set_stamina(stamina - strike.stamina_drain * (0.4 if blocked else 1.0))
		if not blocked:
			_winded = WINDED_TIME
	_knock += strike.direction * strike.knockback * (0.35 if blocked else 1.0)

	var result := ChinGauge.Result.NONE
	if strike.outcome == Strike.Outcome.HIT:
		if body:
			chin.note_body_hit()
		result = chin.take(_jolt(strike), strike.heavy)
	# Caught clean on the way in with nothing left in the tank: floored on the spot.
	var spent := strike.counter_hit and stamina < profile.max_stamina * TIRED
	if spent:
		result = ChinGauge.Result.KNOCKDOWN
	if result == ChinGauge.Result.KNOCKDOWN:
		knockdowns += 1
	if health <= 0.0 or knockdowns >= MAX_KNOCKDOWNS:
		finish = &"ko" if health <= 0.0 else (&"counter" if spent else &"knockdowns")
		strike.outcome = Strike.Outcome.KNOCKOUT
		strike.knockdown = true
		_go_out(strike, result == ChinGauge.Result.KNOCKDOWN)
		return
	if result == ChinGauge.Result.KNOCKDOWN:
		strike.knockdown = true
		_go_down(strike)
		return

	# The player's left hand lands on this fighter's right side.
	var across := 1.0 if strike.side == 0 else -1.0
	if result == ChinGauge.Result.ROCKED:
		strike.rocked = true
		_rock()
	elif broke:
		_stagger(GUARD_BREAK_STAGGER)
		_guard_broken = true
	elif blocked:
		_animator.flinch(0.25)
		brain.on_blocked(strike)
	else:
		_animator.flinch(clampf(0.4 + strike.dealt / 25.0, 0.0, 1.0), across)
		if state == State.ROCKED:
			pass
		elif strike.counter_hit:
			_stagger(INTERCEPT_STAGGER)
		elif steady:
			pass
		elif strike.counter or strike.combo == Strike.KO_FINISHER:
			_stagger(0.7)
		elif strike.guard_breaker:
			_stagger(0.6)
		else:
			if body:
				# A body shot knocks the wind out of whatever was coming next.
				_queue.clear()
				_burst = false
				brain.on_rhythm_broken()
			brain.on_hit(strike)


## Composure a clean hit takes: an intercept and a set-up both shake the chin far more.
func _jolt(strike: Strike) -> float:
	var jolt := strike.stagger
	if strike.counter_hit:
		jolt = jolt * 2.0 + 14.0
	elif strike.counter or strike.combo == Strike.KO_FINISHER:
		jolt *= 1.5
	if strike.setup:
		jolt *= ChinGauge.SETUP_JOLT
	return jolt


func _covers(zone: Strike.Zone) -> bool:
	return is_guarding() and (guard_mode == Guard.HIGH) == (zone == Strike.Zone.HEAD)


## Back in the fight after a stagger: steady for a moment, guard rebuilt, and looking to hit back.
## A guard that was broken comes back whole and cannot be broken again for a while.
func _shake_it_off() -> void:
	_composure_left = maxf(profile.composure, GUARD_REBUILD) if _guard_broken else profile.composure
	var floor_share := 1.0 if _guard_broken else 0.6
	_guard_broken = false
	if guard < profile.guard_max * floor_share:
		guard = profile.guard_max * floor_share
		guard_changed.emit(guard, profile.guard_max)
	_enter(State.FOOTWORK)
	brain.on_recovered()


func _stagger(seconds: float) -> void:
	var left := _stagger_time - _state_time if state == State.STAGGER else 0.0
	_end_attack()
	_release_clinch()
	set_guard(Guard.NONE)
	_stagger_time = maxf(seconds, left)
	_enter(State.STAGGER)


## The chin gauge filled: out on the feet with the guard down until it wears off.
func _rock() -> void:
	_end_attack()
	_release_clinch()
	set_guard(Guard.NONE)
	AudioManager.play(&"rocked", 0.7)
	_enter(State.ROCKED)


## A knockdown: falls away from the blow and gets back up.
func _go_down(strike: Strike) -> void:
	_fall(strike)
	_enter(State.DOWN)
	knocked_down.emit(knockdowns)


## Stopped for good.
func _go_out(strike: Strike, floored: bool) -> void:
	_fall(strike)
	collision_shape.set_deferred(&"disabled", true)
	_enter(State.OUT)
	if floored:
		knocked_down.emit(knockdowns)
	defeated.emit()


func _fall(strike: Strike) -> void:
	_end_attack()
	_release_clinch()
	set_guard(Guard.NONE)
	face(global_position - strike.direction)
	_knock += strike.direction * 2.5
	hurtbox.enabled = false
	AudioManager.play(&"knockdown", 0.9, 1.0, 0.3)


func _get_up() -> void:
	hurtbox.enabled = true
	chin.reset()
	_set_stamina(maxf(stamina, profile.max_stamina * FRESH))
	_untouchable = 0.3
	_composure_left = maxf(profile.composure, 1.0)
	guard = profile.guard_max
	guard_changed.emit(guard, profile.guard_max)
	if target != null:
		face(target.global_position)
	_enter(State.FOOTWORK)
	brain.on_recovered()


# --- Player events ---------------------------------------------------------------------------

func _on_player_strike_started(strike: Strike) -> void:
	if _is_fighting():
		brain.on_player_strike(strike)


func _on_player_feinted(strike: Strike) -> void:
	if _is_fighting():
		brain.on_player_feint(strike)


func _on_player_dodged(direction: int) -> void:
	if _is_fighting():
		brain.on_player_dodge(direction)


func _on_player_strike_resolved(strike: Strike) -> void:
	if _is_fighting():
		brain.on_player_strike_resolved(strike)


func _is_fighting() -> bool:
	return state != State.IDLE and state != State.OUT and state != State.VICTORY


# --- Helpers ---------------------------------------------------------------------------------

func _enter(next: State) -> void:
	state = next
	_state_time = 0.0


## Jabs and both hooks come off the lead hand.
static func _side_of(kind: StringName) -> int:
	return 0 if kind == Strike.JAB or kind == Strike.HOOK or kind == Strike.BODY_HOOK else 1


func _spend(cost: float) -> void:
	_set_stamina(stamina - cost)


func _set_stamina(value: float) -> void:
	value = clampf(value, 0.0, profile.max_stamina)
	if not is_equal_approx(value, stamina):
		stamina = value
		stamina_changed.emit(stamina, profile.max_stamina)
	var share := stamina / profile.max_stamina
	if share < TIRED:
		_gassed = true
	elif share >= FRESH:
		_gassed = false


func _tick_meters(delta: float) -> void:
	if state == State.IDLE or state == State.OUT:
		return
	brain.tick(delta)
	_since_hit += delta
	_composure_left = maxf(_composure_left - delta, 0.0)
	_untouchable = maxf(_untouchable - delta, 0.0)
	_evade_left = maxf(_evade_left - delta, 0.0)
	_winded = maxf(_winded - delta, 0.0)
	if state == State.FOOTWORK:
		_hands_down = maxf(_hands_down - delta, 0.0)
	if state != State.DOWN and chin.tick(delta) and state == State.ROCKED:
		_shake_it_off()
	if _winded <= 0.0:
		_set_stamina(stamina + profile.stamina_regen * delta)
	if _since_hit > 1.0 and state != State.STAGGER and state != State.ROCKED and guard < profile.guard_max:
		guard = minf(guard + profile.guard_regen * (0.5 if is_tired() else 1.0) * delta, profile.guard_max)
		guard_changed.emit(guard, profile.guard_max)
	if _blocked_timer > 0.0:
		_blocked_timer -= delta
		if _blocked_timer <= 0.0:
			blocked_recently = 0


## Keeps the fighter on the canvas, inside the fence.
func _confine() -> void:
	if arena_radius <= 0.0:
		return
	var offset := global_position - arena_centre
	offset.y = 0.0
	var limit := maxf(arena_radius - 0.4, 0.1)
	if offset.length() > limit:
		offset = offset.normalized() * limit
	global_position = Vector3(arena_centre.x + offset.x, arena_centre.y, arena_centre.z + offset.z)


func _animate(delta: float) -> void:
	var speed := Vector2(velocity.x, velocity.z).length()
	_move_amount = lerpf(_move_amount, clampf(speed / 2.0, 0.0, 1.0), 1.0 - exp(-10.0 * delta))
	_stride = fmod(_stride + delta * TAU * 1.3 * _move_amount, TAU)
	var slipping := state == State.SLIP and _state_time < SLIP_TIME
	var guarding := is_guarding()
	var hands_low := _hands_down > 0.0 and state == State.FOOTWORK
	_animator.stride_phase = _stride
	_animator.move_amount = _move_amount
	_animator.block = move_toward(_animator.block, 1.0 if guarding and guard_mode == Guard.HIGH else 0.0, delta * 9.0)
	_animator.block_low = move_toward(_animator.block_low, 1.0 if guarding and guard_mode == Guard.LOW else 0.0, delta * 9.0)
	_animator.drop = move_toward(_animator.drop, 1.0 if hands_low else (0.45 if is_tired() else 0.0), delta * 5.0)
	_animator.crouch = move_toward(_animator.crouch, 1.0 if state == State.CROUCH else 0.0, delta * 6.0)
	_animator.reach = move_toward(_animator.reach, 1.0 if state == State.REACH else 0.0, delta * 8.0)
	_animator.clinch = move_toward(_animator.clinch, 1.0 if state == State.CLINCH else 0.0, delta * 8.0)
	_animator.lean = move_toward(_animator.lean, _slip_lean if slipping else 0.0, delta * 12.0)
	_animator.pull = move_toward(_animator.pull, 1.0 if slipping and _slip_lean == 0.0 else 0.0, delta * 10.0)
	_animator.stagger = move_toward(_animator.stagger, 1.0 if state == State.STAGGER else 0.0, delta * 7.0)
	_animator.rocked = move_toward(_animator.rocked, 1.0 if state == State.ROCKED else 0.0, delta * 6.0)
	_animator.victory = move_toward(_animator.victory, 1.0 if state == State.VICTORY else 0.0, delta * 3.0)
	if state == State.OUT:
		_animator.knockdown = minf(_state_time / FALL_TIME, 1.0)
	elif state == State.DOWN:
		# Down, a moment on the canvas, then the fall played backwards as the get-up.
		_animator.knockdown = minf(minf(_state_time / FALL_TIME, (KNOCKDOWN_TIME - _state_time) / RISE_TIME), 1.0)
	else:
		_animator.knockdown = 0.0
	_animator.update(delta)
	model.animate(delta, _stride, 0.0, 0.0, false)


## The tell of `kind`: the overhead cue and, for a real strike, its sound.
func _show_tell(kind: StringName, real: bool) -> void:
	var move: Dictionary = MOVES[kind]
	if Strike.zone_of(kind) == Strike.Zone.BODY:
		_show_cue("LOW", BODY_CUE)
		if real:
			AudioManager.play(&"dip", 0.7)
	elif move["heavy"]:
		_show_cue("!!", HEAVY_CUE)
		if real and (kind == Strike.OVERHAND or kind == Strike.HOOK):
			AudioManager.play(&"swoosh", 0.6)
	else:
		_show_cue("!", LIGHT_CUE)


func _show_cue(text: String, color: Color) -> void:
	telegraph.text = text
	telegraph.modulate = color
	telegraph.visible = true
	telegraph.pixel_size = CUE_SIZE * 0.4
	cue_changed.emit(text, color)
	if _cue_tween != null:
		_cue_tween.kill()
	_cue_tween = create_tween()
	_cue_tween.tween_property(telegraph, "pixel_size", CUE_SIZE, 0.12).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _hide_cue() -> void:
	if telegraph.visible:
		cue_changed.emit("", Color.WHITE)
	telegraph.visible = false
	for i in 2:
		_glow(i, 0.0)


func _glow(side: int, amount: float) -> void:
	_glove_materials[side].emission_energy_multiplier = 2.5 * amount
	model.set_glove_glow(side, 2.5 * amount, _glove_materials[side].emission)
