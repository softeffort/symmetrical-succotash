class_name RingManager
extends Node3D
## Runs the cage: the fight card terminal, the gate, the 3-2-1 countdown, the bout, and the
## payout at the end. Sits at the centre of the octagon at floor level, with the gate on the
## local +Z side; the fight hall sets the dimensions before adding it.
##
## A bout: the gate locks, both fighters are placed face to face, "3, 2, 1, FIGHT!", then the
## opponent's AI and the player's CombatController take over until one of them is stopped: by
## damage, by a second knockdown, or by walking onto a clean counter with an empty tank. Bouts
## are short and sharp, so the clock runs on the HUD and goes on the result screen.
## A win pays cash and XP, advances the ladder and the fight record; a loss pays a little XP.
## Either way the result screen offers a rematch or the way out.

signal bout_started(profile: FighterProfile)
signal bout_finished(profile: FighterProfile, won: bool)

enum State { IDLE, COUNTDOWN, FIGHT, FINISH, RESULT }

const ENEMY_FIGHTER := preload("res://scenes/combat/enemy_fighter.tscn")
const COUNTS: Array[String] = ["3", "2", "1", "FIGHT!"]
const COUNT_STEP := 0.7
## Distance of each corner from the centre.
const CORNER := 2.1
const GATE_OPEN := -1.83
## Seconds between the knockout and the result screen.
const WIN_PAUSE := 2.3
const LOSS_PAUSE := 2.1
## Share of the opponent's XP paid for a loss.
const CONSOLATION := 0.15
const STREAK_BONUS := 0.1
const MAX_STREAK_BONUS := 0.5
const FLAWLESS_BONUS := 0.25
const COUNTER_BONUS := 0.05
## Share of the purse paid per intercept counter landed and per knockdown scored.
const INTERCEPT_BONUS := 0.05
const KNOCKDOWN_BONUS := 0.1

## Radius of the canvas inside the fence.
@export var arena_radius := 3.95
@export var platform_height := 0.72
@export var fence_height := 1.8
## Distance from the centre to the gate, the gate's width and the width of the whole fence side.
@export var gate_distance := 4.1
@export var gate_width := 2.0
@export var side_length := 3.5
@export var pad_color := Color(0.9, 0.16, 0.16)
## Where the terminal stands, relative to the centre, and which way its screen faces.
@export var terminal_position := Vector3(2.5, 0.0, 5.6)
@export var terminal_yaw := 20.0

var state := State.IDLE
var profile: FighterProfile = null
var opponent: EnemyFighter = null
var player: Player = null
## Seconds fought since "FIGHT!".
var bout_time := 0.0

var _gate: Node3D
var _gate_shape: CollisionShape3D
var _gate_tween: Tween
var _timer := 0.0
var _count := 0
var _won := false
var _hud: CombatHUD = null
var _card: FightCard = null


func _ready() -> void:
	add_to_group(&"ring")
	var zone := CombatZone.new()
	zone.name = "Zone"
	zone.position.y = platform_height
	zone.radius = arena_radius + 0.25
	zone.height = fence_height + 0.8
	add_child(zone)
	_build_gate()
	var terminal := FightCardTerminal.new()
	terminal.name = "FightCardTerminal"
	terminal.position = terminal_position
	terminal.rotation_degrees.y = terminal_yaw
	add_child(terminal)
	terminal.used.connect(open_fight_card)


func _physics_process(delta: float) -> void:
	match state:
		State.COUNTDOWN:
			_timer -= delta
			if _timer <= 0.0:
				_advance_count()
		State.FIGHT:
			bout_time += delta
			_hud.set_clock(bout_time)
		State.FINISH:
			_timer -= delta
			if _timer <= 0.0:
				_show_result()


# --- Flow ------------------------------------------------------------------------------------

## Opens the fight selection menu for the player at the terminal.
func open_fight_card(user: Node) -> void:
	var fighter := user as Player
	if fighter == null or state != State.IDLE or not _find_ui():
		return
	player = fighter
	_card.open(player)


## Locks the gate, puts both fighters in their corners and starts the countdown.
func start_bout(fighter: FighterProfile) -> void:
	if player == null:
		player = get_tree().get_first_node_in_group(&"player") as Player
	if player == null or fighter == null or not _find_ui():
		return
	_clear_opponent()
	profile = fighter
	_set_gate(true)

	var canvas := platform_height + 0.02
	opponent = ENEMY_FIGHTER.instantiate()
	opponent.setup(fighter)
	opponent.position = Vector3(0.0, canvas, -CORNER)
	add_child(opponent)
	opponent.set_arena(global_transform * Vector3(0.0, canvas, 0.0), arena_radius)
	opponent.defeated.connect(_on_opponent_defeated)
	# Corners face each other across the centre: the player looks down local -Z.
	player.place_at(global_transform * Transform3D(Basis.IDENTITY, Vector3(0.0, platform_height, CORNER)))
	opponent.face(player.global_position)
	opponent.reset_physics_interpolation()

	player.controls_enabled = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	player.combat.begin_bout()
	_hud.open_bout(fighter, opponent)
	state = State.COUNTDOWN
	bout_time = 0.0
	_count = 0
	_timer = 0.5
	bout_started.emit(fighter)


func rematch() -> void:
	if state == State.RESULT:
		start_bout(profile)


func next_fight() -> void:
	if state != State.RESULT:
		return
	var next := FighterRoster.next_after(profile)
	if next != null:
		start_bout(next)


## Leaves the cage: the gate unlocks and the player stands outside it, rested.
func exit_ring() -> void:
	if state != State.RESULT:
		return
	_clear_opponent()
	_set_gate(false)
	_hud.close_bout()
	player.combat.end_bout()
	player.place_at(global_transform * Transform3D(Basis.IDENTITY, Vector3(0.0, 0.05, gate_distance + 2.6)))
	player.controls_enabled = true
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	PlayerStats.restore_stamina(PlayerStats.max_stamina)
	state = State.IDLE


func _advance_count() -> void:
	_hud.show_count(COUNTS[_count])
	_count += 1
	_timer = COUNT_STEP
	if _count < COUNTS.size():
		AudioManager.play(&"count")
		return
	AudioManager.play(&"bell")
	# "FIGHT!" is on screen: hand over control.
	state = State.FIGHT
	player.controls_enabled = true
	player.combat.set_locked(false)
	opponent.begin(player)


func _on_opponent_defeated() -> void:
	if state != State.FIGHT:
		return
	_won = true
	state = State.FINISH
	_timer = WIN_PAUSE
	player.combat.set_locked(true)
	player.combat.time_fx.slow_motion(0.7, 0.25)
	_ring_bell()
	# Confetti over the cage; a title fight fills the air.
	var title_fight := profile.is_league() or profile.ladder_index == FighterRoster.LADDER_SIZE - 1
	var above := global_transform * Vector3(0.0, platform_height + 3.3, 0.0)
	CombatFx.burst(get_tree().current_scene, CombatFx.CONFETTI, above, Vector3.UP, 2.0 if title_fight else 1.0)
	CombatFx.flash(get_tree().current_scene, above, Color(1.0, 0.95, 0.85), 6.0, 12.0, 0.5)


func _on_player_down() -> void:
	if state != State.FIGHT:
		return
	_won = false
	state = State.FINISH
	_timer = LOSS_PAUSE
	player.controls_enabled = false
	opponent.celebrate()
	_ring_bell()


func _show_result() -> void:
	state = State.RESULT
	player.controls_enabled = false
	player.combat.set_locked(true)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var summary := _pay_out(_won)
	SaveManager.save_game()
	if _won:
		AudioManager.play(&"level_up", 0.8)
	_hud.show_result(summary)
	bout_finished.emit(profile, _won)


## Books the result in PlayerStats and returns the breakdown for the result screen.
func _pay_out(won: bool) -> Dictionary:
	var combat := player.combat
	var rematch_fight := FighterRoster.is_beaten(profile)
	var share := FighterRoster.REMATCH_SHARE if rematch_fight else 1.0
	var level_before := PlayerStats.level
	var rank_before := PlayerStats.rank_title
	var rows: Array[Array] = []
	var cash := 0
	var xp := 0.0
	var footer := ""
	if won:
		var purse := roundi(profile.cash * share)
		rows.append(["Fight purse" + ("  (rematch)" if rematch_fight else ""), "+" + PlayerStats.format_cash(purse), UiKit.GOLD])
		cash = purse
		var streak := PlayerStats.fight_record.win_streak
		if streak > 0:
			var bonus := roundi(purse * minf(STREAK_BONUS * streak, MAX_STREAK_BONUS))
			rows.append(["Win streak x%d" % (streak + 1), "+" + PlayerStats.format_cash(bonus), UiKit.GOLD])
			cash += bonus
		if combat.bout_damage_taken <= 0.0:
			var bonus := roundi(purse * FLAWLESS_BONUS)
			rows.append(["Flawless victory", "+" + PlayerStats.format_cash(bonus), UiKit.GOLD])
			cash += bonus
		if combat.bout_counters > 0:
			var bonus := roundi(purse * COUNTER_BONUS) * combat.bout_counters
			rows.append(["Perfect counters x%d" % combat.bout_counters, "+" + PlayerStats.format_cash(bonus), UiKit.GOLD])
			cash += bonus
		if combat.bout_intercepts > 0:
			var bonus := roundi(purse * INTERCEPT_BONUS) * combat.bout_intercepts
			rows.append(["Intercept counters x%d" % combat.bout_intercepts, "+" + PlayerStats.format_cash(bonus), UiKit.GOLD])
			cash += bonus
		if opponent.knockdowns > 0:
			var bonus := roundi(purse * KNOCKDOWN_BONUS) * opponent.knockdowns
			rows.append(["Knockdowns x%d" % opponent.knockdowns, "+" + PlayerStats.format_cash(bonus), UiKit.GOLD])
			cash += bonus
		xp = profile.xp * share
		if not rematch_fight:
			footer = _advance_ladder()
	else:
		xp = maxf(profile.xp * CONSOLATION, 10.0)
		footer = "Train downstairs, come back stronger."

	PlayerStats.record_fight(won)
	PlayerStats.add_cash(cash)
	PlayerStats.add_xp(xp)
	var days := roundi(PlayerStats.WIN_TENURE_DAYS if won else PlayerStats.LOSS_TENURE_DAYS)
	rows.append(["Experience" if won else "Consolation experience", "+%d XP" % roundi(xp), UiKit.ACCENT])
	if PlayerStats.level > level_before:
		rows.append(["Level up", "Lvl %d  >  Lvl %d" % [level_before, PlayerStats.level], UiKit.WHITE])
	if PlayerStats.rank_title != rank_before:
		rows.append(["New rank", PlayerStats.rank_title, UiKit.WHITE])
	rows.append(["Gym tenure", "+%d Days" % days, UiKit.WHITE])
	var seconds := floori(bout_time)
	rows.append(["Fight time", "%d:%02d" % [floori(seconds / 60.0), seconds % 60], UiKit.WHITE])
	rows.append(["Best combo", "x%d" % combat.bout_best_streak, UiKit.WHITE])
	rows.append(["Record", PlayerStats.fight_record.to_text(), UiKit.WHITE])
	rows.append(["Cash", PlayerStats.get_cash_text(), UiKit.GOLD])
	return {
		"won": won,
		"title": "VICTORY" if won else "DEFEAT",
		"subtitle": _method(won),
		"rows": rows,
		"footer": footer,
		"has_next": won and FighterRoster.next_after(profile) != null,
	}


## How the bout ended, for the line under the result title.
func _method(won: bool) -> String:
	if won:
		match opponent.finish:
			&"knockdowns":
				return "%s stopped: two knockdowns" % profile.fighter_name
			&"counter":
				return "Clean KO: %s walked onto a counter with nothing left" % profile.fighter_name
		return "Knockout over %s" % profile.fighter_name
	if player.combat.knockdowns >= CombatController.MAX_KNOCKDOWNS:
		return "Stopped by %s: two knockdowns" % profile.fighter_name
	return "Knocked out by %s" % profile.fighter_name


## Moves the player up the ladder (or the league) and returns the headline for the result screen.
func _advance_ladder() -> String:
	if profile.is_league():
		PlayerStats.league_wins += 1
		return "Next challenger: Lvl %d" % FighterRoster.next_league_level()
	PlayerStats.ladder_progress = maxi(PlayerStats.ladder_progress, profile.ladder_index + 1)
	if FighterRoster.is_league_open():
		GameState.notify("Endless Championship League unlocked")
		return "GYM BOSS DEFEATED  |  ENDLESS CHAMPIONSHIP LEAGUE UNLOCKED"
	var next := FighterRoster.ladder()[PlayerStats.ladder_progress]
	return "Unlocked: %s  (Lvl %d)" % [next.fighter_name, next.level]


## Three strokes of the bell: the bout is over.
func _ring_bell() -> void:
	for i in 3:
		AudioManager.play(&"bell", 0.9, 1.0, i * 0.28)


func _clear_opponent() -> void:
	if opponent != null:
		opponent.queue_free()
		opponent = null


## Finds the fight card and the combat HUD and hooks up their buttons, once.
func _find_ui() -> bool:
	if _hud != null and _card != null:
		return true
	_hud = get_tree().get_first_node_in_group(&"combat_hud") as CombatHUD
	_card = get_tree().get_first_node_in_group(&"fight_card") as FightCard
	if _hud == null or _card == null:
		return false
	_card.fight_selected.connect(start_bout)
	_hud.rematch_requested.connect(rematch)
	_hud.next_requested.connect(next_fight)
	_hud.exit_requested.connect(exit_ring)
	var fighter := get_tree().get_first_node_in_group(&"player") as Player
	if fighter != null:
		fighter.combat.knocked_out.connect(_on_player_down)
	return true


# --- Gate ------------------------------------------------------------------------------------

func _set_gate(locked: bool) -> void:
	_gate_shape.set_deferred(&"disabled", not locked)
	if _gate_tween != null:
		_gate_tween.kill()
	_gate_tween = create_tween()
	# Stepped on the physics tick so the swing is interpolated like everything else.
	_gate_tween.set_process_mode(Tween.TWEEN_PROCESS_PHYSICS)
	_gate_tween.tween_property(_gate, "rotation:y", 0.0 if locked else GATE_OPEN, 0.35).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


## Closes the open side of the octagon: fixed fence either side of a swinging door.
func _build_gate() -> void:
	var top := platform_height + fence_height
	var middle := platform_height + fence_height * 0.5
	var mesh := Build.mat(Color(0.05, 0.05, 0.07, 0.3), 0.6)
	var pad := Build.mat(pad_color, 0.6)
	var post := Build.mat(Color(0.1, 0.1, 0.12), 0.6)
	var wing := (side_length - gate_width) * 0.5
	for side: float in [-1.0, 1.0]:
		var x := side * (gate_width + wing) * 0.5
		if wing > 0.2:
			Build.box(self, Vector3(wing - 0.1, fence_height - 0.2, 0.02), Vector3(x, middle, gate_distance), mesh)
			Build.blocker(self, Vector3(wing, fence_height, 0.14), Vector3(x, middle, gate_distance))
			Build.box(self, Vector3(wing - 0.1, 0.14, 0.14), Vector3(x, top, gate_distance), pad)
		Build.cyl(self, 0.07, fence_height, Vector3(side * gate_width * 0.5, middle, gate_distance), post)

	_gate = Build.group(self, "Gate", Vector3(-gate_width * 0.5, platform_height, gate_distance))
	var door := gate_width - 0.16
	var centre := gate_width * 0.5
	Build.box(_gate, Vector3(door, fence_height - 0.3, 0.02), Vector3(centre, fence_height * 0.5, 0.0), mesh)
	for height: float in [0.14, fence_height - 0.12]:
		Build.box(_gate, Vector3(door, 0.08, 0.08), Vector3(centre, height, 0.0), pad)
	Build.box(_gate, Vector3(0.08, fence_height - 0.26, 0.08), Vector3(gate_width - 0.12, fence_height * 0.5, 0.0), pad)
	_gate.rotation.y = GATE_OPEN

	var body := Build.blocker(self, Vector3(gate_width, fence_height, 0.14), Vector3(0.0, middle, gate_distance))
	body.name = "GateBlocker"
	_gate_shape = body.get_child(0) as CollisionShape3D
	_gate_shape.disabled = true
