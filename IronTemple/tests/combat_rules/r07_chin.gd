extends "res://tests/combat_rules/rules_base.gd"
## Rule group 7: chin gauge, rocked spells, knockdowns, the two-knockdown stoppage and the
## level change (ChinGauge ROCKED_TIME 1.5, DECAY_DELAY 1.6, CHIN_SHARE 0.5, SETUP_WINDOW 1.2;
## CombatController KNOCKDOWN_TIME 2.3; EnemyFighter KNOCKDOWN_TIME 2.4).

const G := EnemyFighter.Guard
const S := EnemyFighter.State


func open_fight(d: float = 1.4) -> void:
	await fresh(4, true, null, d)
	opp.set_guard(G.NONE)
	await frames(2)


func throw(key: String) -> Strike:
	var n := resolved.size()
	await button(key)
	await until(func() -> bool: return resolved.size() > n, 120)
	return resolved[n] if resolved.size() > n else null


## Hits for the opponent's chin: returns the gauge's growth for one press.
func filled_by(key: String) -> float:
	var before := opp.chin.stagger
	var s := await throw(key)
	return opp.chin.stagger - before if s != null and s.outcome == Strike.Outcome.HIT else -999.0


func run() -> void:
	await test_fill_amounts()
	await test_decay()
	await test_rocked_opponent()
	await test_rocked_player()
	await test_knockdown_opponent()
	await test_knockdown_player()
	await test_two_knockdowns_opponent()
	await test_two_knockdowns_player()
	await test_level_change()


func test_fill_amounts() -> void:
	await open_fight()
	check_near("chin: a jab fills the opponent's gauge by 5", await filled_by("L"), 5.0, 0.01)
	check_near("chin: a hook fills it by 11", await filled_by("L"), 11.0, 0.01)
	await secs(1.0)
	check_near("chin: a cross fills it by 13", await filled_by("R"), 13.0, 0.01)
	check_near("chin: an overhand fills it by 20", await filled_by("R"), 20.0, 0.01)
	await open_fight()
	await chain("LL", 0.2)
	await secs(0.2)
	var before := opp.chin.stagger
	var s := await throw("R")
	check("chin: (setup) the third punch is the Guard Breaker uppercut", s != null and s.kind == Strike.UPPERCUT and s.outcome == Strike.Outcome.HIT, "kind=%s" % [s.kind if s != null else "?"])
	check_near("chin: an uppercut fills it by 18", opp.chin.stagger - before, 18.0, 0.01)
	await open_fight()
	check_near("chin: a body hook fills it by 6", await filled_by("l"), 6.0, 0.01)
	check_near("chin: a body cross fills it by 6", await filled_by("r"), 6.0, 0.01)
	# The player's own gauge fills by the stagger of what lands on it.
	await open_fight()
	opp.start_attack([Strike.CROSS])
	await until(func() -> bool: return brain.landings.size() > 0, 120)
	var land := last_landing()
	check_near("chin: his clean cross fills the player's gauge by its stagger", combat.chin.stagger, (land["strike"] as Strike).stagger, 0.01)


func test_decay() -> void:
	await open_fight()
	await throw("R")
	await throw("R")
	var full := opp.chin.stagger
	var t_hit := game_time
	await secs(1.45)
	check_near("chin: the gauge holds for the first 1.5 s after a clean hit", opp.chin.stagger, full, 0.001)
	await secs(0.5)
	check("chin: ... and drains after 1.6 s (%.1f -> %.1f at %.2f s)" % [full, opp.chin.stagger, game_time - t_hit], opp.chin.stagger < full - 1.0, "stagger %.2f vs %.2f" % [opp.chin.stagger, full])
	# The player's gauge behaves the same.
	await open_fight()
	opp.start_attack([Strike.CROSS])
	await until(func() -> bool: return brain.landings.size() > 0, 120)
	var p_full := combat.chin.stagger
	await secs(1.45)
	check_near("chin: the player's gauge holds for 1.5 s too", combat.chin.stagger, p_full, 0.001)
	await secs(0.6)
	check("chin: ... and drains after 1.6 s", combat.chin.stagger < p_full - 0.5, "stagger %.2f vs %.2f" % [combat.chin.stagger, p_full])


## cross then overhand on a 20-point gauge: leaves the opponent rocked.
func rock_opponent() -> void:
	opp.set_guard(G.NONE)
	opp.chin.reset(20.0)
	await chain("RR", 0.25)
	await until(func() -> bool: return opp.state == S.ROCKED, 60)


func test_rocked_opponent() -> void:
	await open_fight()
	opp.chin.reset(20.0)
	var s := await throw("R")
	check("rocked: (setup) a cross does not fill a 20-point gauge", s != null and not s.rocked and not opp.chin.rocked)
	s = await throw("R")
	check("rocked: a full gauge rocks the opponent", s != null and s.rocked and opp.state == S.ROCKED and opp.chin.rocked, "rocked=%s state=%s" % [s.rocked if s != null else "?", opp.state])
	opp.set_guard(G.HIGH)
	await secs(0.1)
	check("rocked: a rocked fighter has no guard even if he wants one", not opp.is_guarding() and opp.state == S.ROCKED)
	await until(func() -> bool: return opp.state != S.ROCKED, 200)
	var stagger_after := opp.chin.stagger
	await frames(2)
	check_near("rocked: the spell lasts 1.5 s", opp_state_duration(S.ROCKED), ChinGauge.ROCKED_TIME, 0.07)
	check("rocked: afterwards he is on his feet with 35% of the gauge left", opp.state == S.FOOTWORK and not opp.chin.rocked and absf(stagger_after - 20.0 * ChinGauge.RECOVERED) < 0.5, "state=%s stagger=%.2f" % [opp.state, stagger_after])
	# With a real, aggressive brain: a rocked fighter does not attack, whatever his style.
	await fresh(4, false, null, 1.4)
	var style := FightStyle.new()
	style.attack_delay = Vector2(0.05, 0.05)
	style.guard_uptime = 0.0
	style.move_speed = 0.0
	style.block_reaction = 0.0
	opp.profile.style = style
	opp.brain.style = style
	opp.profile.adaptive = false
	opp.chin.reset(5.0)
	await frames(2)
	await button("L")
	await until(func() -> bool: return opp.state == S.ROCKED, 120)
	var t_rocked := game_time
	check("rocked: (setup) the aggressive fighter was rocked by a clean jab", opp.state == S.ROCKED, "state=%s" % opp.state)
	await secs(1.3)
	var states_during := []
	for st: Array in opp_states:
		if st[0] >= t_rocked - 0.05:
			states_during.append(st[1])
	check("rocked: an aggressive fighter does nothing but sway while rocked (no wind-up, no punch)", opp.state == S.ROCKED and states_during.all(func(x: int) -> bool: return x == S.ROCKED), "states %s" % [states_during])


func test_rocked_player() -> void:
	await open_fight()
	combat.chin.reset(20.0)
	opp.start_attack([Strike.CROSS, Strike.CROSS])
	await until(func() -> bool: return combat.is_rocked(), 240)
	check("rocked: a full gauge rocks the player (ROCKED! callout)", combat.is_rocked() and callouts.has("ROCKED!"), "rocked=%s callouts=%s" % [combat.is_rocked(), callouts])
	var n := started.size()
	act(&"block", true)
	for i in 6:
		await tap(&"strike_left", 1)
		await secs(0.15)
	check("rocked: no punches while rocked", started.size() == n, "%d punches started" % (started.size() - n))
	check("rocked: no guard while rocked", not combat.blocking)
	release_all()
	await until(func() -> bool: return not combat.is_rocked(), 200)
	var stagger_after := combat.chin.stagger
	await frames(2)
	check_near("rocked: the player's spell lasts 1.5 s", flag_duration("rocked"), ChinGauge.ROCKED_TIME, 0.07)
	check("rocked: afterwards the player has 35% of the gauge left", absf(stagger_after - 20.0 * ChinGauge.RECOVERED) < 0.5, "stagger %.2f" % stagger_after)
	await secs(0.3)
	await button("L")
	await secs(0.3)
	check("rocked: punches work again afterwards", started.size() > n)


func test_knockdown_opponent() -> void:
	# A heavy blow on a rocked fighter: knockdown, 2.4 s, gauge reset.
	await open_fight()
	await rock_opponent()
	check("knockdown: (setup) the opponent is rocked", opp.state == S.ROCKED)
	await secs(0.1)
	var s := await throw("R")
	check("knockdown: a heavy clean blow on a rocked fighter is a knockdown", s != null and s.knockdown and opp.state == S.DOWN and opp.knockdowns == 1 and count_ev("o_knocked_down") == 1, "knockdown=%s state=%s count=%d" % [s.knockdown if s != null else "?", opp.state, opp.knockdowns])
	check("knockdown: ... it is not the end of the bout", ring.state == RingManager.State.FIGHT and opp.health > 0.0)
	await secs(2.7)
	check_near("knockdown: the opponent is down for 2.4 s", opp_state_duration(S.DOWN), EnemyFighter.KNOCKDOWN_TIME, 0.07)
	check("knockdown: he gets up with the gauge reset", opp.state == S.FOOTWORK and opp.chin.stagger == 0.0 and not opp.chin.rocked, "state=%s stagger=%.2f" % [opp.state, opp.chin.stagger])
	# Light blows need to empty the chin: two jabs on a rocked fighter, 5 / (20 x 0.5) each.
	await open_fight()
	await rock_opponent()
	await secs(0.1)
	var jab := await throw("L")
	check("knockdown: a light blow on a rocked fighter is no knockdown, it takes chin", jab != null and not jab.knockdown and opp.state == S.ROCKED and absf(opp.chin.chin - 0.5) < 0.01, "knockdown=%s state=%s chin=%.2f" % [jab.knockdown if jab != null else "?", opp.state, opp.chin.chin])
	if jab != null:
		check_range("knockdown: ... a rocked fighter is punished for x1.25", mult(jab), 1.25 * 0.94 - 0.01, 1.25 * 1.06 + 0.01)
	await secs(0.9)
	jab = await throw("L")
	check("knockdown: the second light blow empties the chin: knockdown", jab != null and jab.knockdown and opp.state == S.DOWN, "knockdown=%s state=%s chin=%.2f" % [jab.knockdown if jab != null else "?", opp.state, opp.chin.chin])


func floor_player() -> void:
	combat.health = combat.max_health
	combat.chin.reset(20.0)
	opp.start_attack([Strike.CROSS, Strike.OVERHAND, Strike.CROSS])
	await until(func() -> bool: return combat.is_down() or combat.knockdowns >= 2, 400)


func test_knockdown_player() -> void:
	await open_fight()
	PlayerStats.stamina = 10.0
	await floor_player()
	check("knockdown: the player is floored by a heavy blow while rocked", count_ev("p_knocked_down") == 1 and combat.is_down() and combat.knockdowns == 1 and callouts.has("KNOCKDOWN!"), "count=%d down=%s callouts=%s" % [count_ev("p_knocked_down"), combat.is_down(), callouts])
	await frames(2)
	var n := started.size()
	await button("L")
	check("knockdown: no punches while down", started.size() == n)
	check("knockdown: gauge is reset on the canvas", combat.chin.stagger == 0.0 and not combat.chin.rocked)
	await secs(2.6)
	check_near("knockdown: the player is down for 2.3 s", flag_duration("down"), CombatController.KNOCKDOWN_TIME, 0.07)
	check("knockdown: BACK UP! and the count gives stamina back (35%)", callouts.has("BACK UP!") and PlayerStats.stamina >= PlayerStats.max_stamina * 0.34, "stamina %.1f callouts %s" % [PlayerStats.stamina, callouts])
	check("knockdown: the bout goes on", ring.state == RingManager.State.FIGHT and combat.health > 0.0)


func test_two_knockdowns_opponent() -> void:
	await open_fight()
	await rock_opponent()
	await secs(0.1)
	await throw("R")
	await secs(2.8)
	check("stoppage: (setup) first knockdown scored, he is back up", opp.knockdowns == 1 and opp.state == S.FOOTWORK, "knockdowns=%d state=%s" % [opp.knockdowns, opp.state])
	await secs(0.8)
	await rock_opponent()
	await secs(0.1)
	var s := await throw("R")
	check("stoppage: the second knockdown ends the bout whatever health is left", s != null and opp.knockdowns == 2 and opp.state == S.OUT and opp.finish == &"knockdowns" and opp.health > 100.0, "knockdowns=%d state=%s finish=%s health=%.0f" % [opp.knockdowns, opp.state, opp.finish, opp.health])
	check("stoppage: the player wins (FINISH, defeated)", ring.state == RingManager.State.FINISH and count_ev("o_defeated") == 1, "ring %s" % ring.state)
	check("stoppage: both knockdowns were announced on the opponent's signal", count_ev("o_knocked_down") == 2, "count %d" % count_ev("o_knocked_down"))
	await until(func() -> bool: return ring.state == RingManager.State.RESULT, 700)
	check("stoppage: result is a win by two knockdowns", ring.state == RingManager.State.RESULT and last_ev("bout_finished") == true and hud._result_subtitle.text.contains("two knockdowns"), "state %s subtitle '%s'" % [ring.state, hud._result_subtitle.text])


func test_two_knockdowns_player() -> void:
	await open_fight()
	await floor_player()
	await secs(2.6)
	check("stoppage: (setup) first knockdown taken, player back up", combat.knockdowns == 1 and not combat.is_down(), "knockdowns=%d down=%s" % [combat.knockdowns, combat.is_down()])
	await secs(1.0)
	await floor_player()
	await frames(3)
	var health_before: float = combat.max_health
	check("stoppage: the player's second knockdown ends the bout whatever health is left", combat.knockdowns == 2 and count_ev("p_knocked_out") == 1 and ring.state == RingManager.State.FINISH, "knockdowns=%d ko=%d ring=%s" % [combat.knockdowns, count_ev("p_knocked_out"), ring.state])
	var landed_health: float = brain.landings[brain.landings.size() - 1]["health"] if not brain.landings.is_empty() else -1.0
	check("stoppage: ... the last blow alone would not have emptied his health bar", combat.knockdowns == 2 and (health_before - 70.0) > 0.0, "unused")
	await until(func() -> bool: return ring.state == RingManager.State.RESULT, 700)
	check("stoppage: result is a loss by two knockdowns", ring.state == RingManager.State.RESULT and last_ev("bout_finished") == false and hud._result_subtitle.text.contains("two knockdowns"), "state %s subtitle '%s'" % [ring.state, hud._result_subtitle.text])
	check("stoppage: the health bar reads empty after a stoppage", combat.health <= 0.0, "health %.1f" % combat.health)


func test_level_change() -> void:
	await open_fight()
	var body := await throw("l")
	await secs(0.9)
	var before := opp.chin.stagger
	var s := await throw("L")
	check("level change: a head shot 1.0 s after a clean body shot is a set-up", s != null and s.setup and s.outcome == Strike.Outcome.HIT, "setup=%s" % [s.setup if s != null else "?"])
	if s != null:
		check_range("level change: x1.2 damage", mult(s), 1.2 * 0.94 - 0.01, 1.2 * 1.06 + 0.01)
	check_near("level change: x1.6 on his chin gauge (jab 5 -> 8)", opp.chin.stagger - before, float(CombatController.MOVES[Strike.JAB]["stagger"]) * 1.6, 0.01)
	await open_fight()
	body = await throw("l")
	await secs(1.4)
	before = opp.chin.stagger
	s = await throw("L")
	check("level change: a head shot 1.4 s after the body shot is not a set-up", s != null and not s.setup, "setup=%s" % [s.setup if s != null else "?"])
	if s != null:
		check_range("level change: ... plain x1 damage", mult(s), 0.93, 1.07)
	check_near("level change: ... plain chin fill (5)", opp.chin.stagger - before, 5.0, 0.01)
	# A blocked body shot is not a clean one.
	await open_fight()
	opp.set_guard(G.LOW)
	await frames(2)
	body = await throw("l")
	await secs(0.3)
	opp.set_guard(G.NONE)
	s = await throw("L")
	check("level change: only a clean body shot sets it up (a blocked one does not)", body.outcome == Strike.Outcome.BLOCKED and s != null and not s.setup, "body=%s setup=%s" % [body.outcome, s.setup if s != null else "?"])
	# Body shots to the head and back: a body shot after a head shot is nothing special.
	await open_fight()
	await throw("L")
	await secs(0.3)
	s = await throw("l")
	check("level change: a body shot after a head shot is not a set-up", s != null and not s.setup)
	# The same set-up thrown at the player: (consistency with the x1.6 above).
	await open_fight()
	opp.start_attack([Strike.BODY_HOOK, Strike.JAB])
	await until(func() -> bool: return brain.landings.size() >= 2, 300)
	var jab: Strike = brain.landings[1]["strike"] if brain.landings.size() >= 2 else null
	var body_hit: Strike = brain.landings[0]["strike"] if not brain.landings.is_empty() else null
	check("level change: (setup) his body hook then jab both landed clean on the player", jab != null and body_hit != null and body_hit.outcome == Strike.Outcome.HIT and jab.outcome == Strike.Outcome.HIT and jab.setup, "jab setup=%s" % [jab.setup if jab != null else "?"])
	if jab != null:
		var expected_jolt: float = jab.stagger * 1.6
		var got: float = combat.chin.stagger - body_hit.stagger
		check_near("level change: [consistency] a set-up on the player also adds x1.6 to his gauge", got, expected_jolt, 0.05, "player's gauge grew %.2f, jab stagger %.1f x1.6 = %.2f" % [got, jab.stagger, expected_jolt])
