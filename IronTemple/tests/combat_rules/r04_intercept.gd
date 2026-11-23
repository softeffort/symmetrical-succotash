extends "res://tests/combat_rules/rules_base.gd"
## Rule group 4: intercept counters (Strike.COUNTER_HIT_DAMAGE 2.5, EnemyFighter
## INTERCEPT_STAGGER) and the reverse: the player beaten to the punch (COUNTERED_DAMAGE 1.6,
## LOW_STAMINA 0.2) and the gassed opponent caught on a counter (finish == &"counter").

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


func run() -> void:
	await test_intercept_windup()
	await test_intercept_other_states()
	await test_not_in_recovery()
	await test_sloppy_never_intercepts()
	await test_beaten_to_the_punch()
	await test_low_stamina_floors()
	await test_gassed_opponent()


func test_intercept_windup() -> void:
	await open_fight()
	var hp := opp.health
	opp.start_attack([Strike.CROSS])
	await secs(0.2)
	var s := await throw("L")
	check("intercept: a clean jab into a wind-up is flagged counter_hit", s != null and s.outcome == Strike.Outcome.HIT and s.counter_hit, "outcome=%s counter_hit=%s" % [s.outcome if s != null else -1, s.counter_hit if s != null else "?"])
	if s != null:
		check_range("intercept: damage is x2.5", mult(s), 2.5 * 0.94 - 0.01, 2.5 * 1.06 + 0.01)
		check_near("intercept: opponent loses exactly the intercepted damage", hp - opp.health, s.dealt, 0.01)
		check_near("intercept: a heavy jolt to his chin (jab stagger x2 + 14)", opp.chin.stagger, float(CombatController.MOVES[Strike.JAB]["stagger"]) * 2.0 + 14.0, 0.01)
	check("intercept: his attack is cancelled (stagger, no punch thrown)", opp.state == S.STAGGER, "state=%s" % opp.state)
	await secs(1.5)
	check("intercept: ... and the punch never lands on the player", brain.landings.is_empty() and combat.health >= combat.max_health - 0.01, "landings=%d health=%.1f" % [brain.landings.size(), combat.health])
	check("intercept: it is counted and announced", combat.bout_intercepts == 1 and count_ev("combo_landed") > 0 and str(last_ev("combo_landed")).begins_with("INTERCEPT"), "intercepts=%d label=%s" % [combat.bout_intercepts, last_ev("combo_landed")])
	# Same blow with nothing coming: plain x1.
	await open_fight()
	s = await throw("L")
	check_range("intercept: control, the same jab at rest does x1", mult(s), 0.93, 1.07)
	check("intercept: control, not flagged", not s.counter_hit)


func test_intercept_other_states() -> void:
	# CROUCH (a burst coils first) and REACH (the grab) are intercepted too.
	await open_fight()
	opp.start_burst([Strike.CROSS, Strike.HOOK])
	await secs(0.2)
	var s := await throw("L")
	check("intercept: a jab into the burst's crouch is an intercept (x2.5)", s != null and s.counter_hit and opp.state == S.STAGGER, "counter_hit=%s state=%s" % [s.counter_hit if s != null else "?", opp.state])
	await open_fight(1.1)
	free_opponent()
	opp.start_clinch()
	await secs(0.2)
	s = await throw("L")
	check("intercept: a jab into the clinch reach is an intercept", s != null and s.counter_hit and combat.clinch == null, "counter_hit=%s clinch=%s" % [s.counter_hit if s != null else "?", combat.clinch])
	await secs(1.0)
	check("intercept: ... and the grab never lands", combat.clinch == null)
	# STRIKE: sweep the press so some jabs resolve while his punch is already on its way.
	var strike_state_hits := 0
	var strike_state_flagged := 0
	for lead in range(2, 12):
		await open_fight()
		opp.start_attack([Strike.OVERHAND])
		await until(func() -> bool: return opp.state == S.WINDUP and opp._state_time + float(lead) * DT >= opp._windup_time, 200)
		act(&"strike_left", true)
		await frames(3)
		act(&"strike_left", false)
		await secs(0.4)
		if not resolved.is_empty() and resolved_ostate[0] == S.STRIKE and resolved[0].outcome == Strike.Outcome.HIT:
			strike_state_hits += 1
			if resolved[0].counter_hit:
				strike_state_flagged += 1
	check("intercept: (setup) at least one jab resolved while his punch was in the STRIKE state", strike_state_hits >= 1, "no sweep position produced a STRIKE-state hit")
	check("intercept: every jab that landed during his STRIKE state is an intercept", strike_state_hits >= 1 and strike_state_flagged == strike_state_hits, "%d of %d flagged" % [strike_state_flagged, strike_state_hits])


func test_not_in_recovery() -> void:
	await open_fight()
	opp.start_attack([Strike.JAB])
	await until(func() -> bool: return brain.landings.size() >= 1, 120)
	await button("L")
	await secs(0.6)
	var s: Strike = resolved[0] if not resolved.is_empty() else null
	check("intercept: a jab that lands while he recovers from a punch is not an intercept (x1)", s != null and s.outcome == Strike.Outcome.HIT and not s.counter_hit and resolved_ostate[0] == S.RECOVER, "ostate=%s counter_hit=%s" % [resolved_ostate[0] if not resolved_ostate.is_empty() else -1, s.counter_hit if s != null else "?"])
	if s != null:
		check_range("intercept: ... it does x1.0", mult(s), 0.93, 1.07)


func test_sloppy_never_intercepts() -> void:
	await open_fight()
	await chain("LLL", 0.2)
	await until(func() -> bool: return resolved.size() >= 3, 60)
	opp.start_attack([Strike.OVERHAND])
	await button("L")
	await secs(1.8)
	var sloppy: Strike = resolved[3] if resolved.size() > 3 else null
	check("sloppy: (setup) the fourth punch is sloppy and resolved while he was winding up", sloppy != null and sloppy.sloppy and resolved_ostate[3] == S.WINDUP, "sloppy=%s ostate=%s" % [sloppy.sloppy if sloppy != null else "?", resolved_ostate[3] if resolved_ostate.size() > 3 else -1])
	check("sloppy: a sloppy punch never intercepts (no counter_hit)", sloppy != null and sloppy.outcome == Strike.Outcome.HIT and not sloppy.counter_hit)
	if sloppy != null:
		check_range("sloppy: it does 65% damage, not x2.5", mult(sloppy), 0.65 * 0.94 - 0.02, 0.65 * 1.06 + 0.02)
	check("sloppy: his wind-up carries on and lands", brain.landings.size() == 1, "landings=%d" % brain.landings.size())
	# control: the same moment with a fresh count is an intercept
	await open_fight()
	opp.start_attack([Strike.OVERHAND])
	await secs(0.3)
	var ctl := await throw("L")
	check("sloppy: control, a normal punch at the same moment does intercept", ctl != null and ctl.counter_hit)


func test_beaten_to_the_punch() -> void:
	# His jab lands while the player's cross is still in start-up.
	await open_fight()
	combat.health = 100.0
	var before_resolved := resolved.size()
	var hp := opp.health
	opp.start_attack([Strike.JAB])
	await until(func() -> bool: return opp.state == S.STRIKE, 240)
	await button("R")
	await secs(0.8)
	var land := last_landing()
	var s: Strike = land["strike"] if not land.is_empty() else null
	check("beaten: his clean jab on a punch in start-up is flagged counter_hit", s != null and s.outcome == Strike.Outcome.HIT and s.counter_hit, "outcome=%s counter_hit=%s" % [s.outcome if s != null else -1, s.counter_hit if s != null else "?"])
	if s != null:
		check_near("beaten: ... the player takes x1.6", s.dealt / s.damage, CombatController.COUNTERED_DAMAGE, 0.001)
		check_near("beaten: health drops by that amount", 100.0 - combat.health, s.dealt, 0.01)
	check("beaten: the player's punch is lost (never resolves, no damage to him)", resolved.size() == before_resolved and opp.health >= hp - 0.01 and not combat.is_striking(), "resolved +%d opp lost %.2f" % [resolved.size() - before_resolved, hp - opp.health])
	# Control: same jab with no punch of the player's in flight is x1.
	await open_fight()
	opp.start_attack([Strike.JAB])
	await secs(0.8)
	land = last_landing()
	s = land["strike"]
	check_near("beaten: control, the same jab on an idle player is x1", s.dealt / s.damage, 1.0, 0.001)
	check("beaten: control, not flagged counter_hit", not s.counter_hit)


func test_low_stamina_floors() -> void:
	# Under 20% stamina (after paying for the punch) a counter-hit is a knockdown, not the end.
	for case: Array in [[15.0, true, "15%"], [0.0, true, "empty tank"], [40.0, false, "40%"]]:
		await open_fight()
		PlayerStats.stamina = case[0]
		PlayerStats.is_exhausted = case[0] <= 0.0
		await frames(2)
		opp.start_attack([Strike.JAB])
		await until(func() -> bool: return opp.state == S.STRIKE, 240)
		await button("R")
		await secs(0.5)
		var land := last_landing()
		var s: Strike = land["strike"] if not land.is_empty() else null
		var floored: bool = combat.is_down() and combat.knockdowns == 1
		check("beaten: counter-hit with %s stamina %s the player" % [case[2], "floors" if case[1] else "does not floor"], s != null and s.counter_hit and floored == case[1], "counter_hit=%s down=%s knockdowns=%d" % [s != null and s.counter_hit, combat.is_down(), combat.knockdowns])
		check("beaten: (%s) the bout goes on" % case[2], count_ev("p_knocked_out") == 0 and combat.health > 0.0 and ring.state == RingManager.State.FIGHT, "knocked_out=%d health=%.1f ring=%s" % [count_ev("p_knocked_out"), combat.health, ring.state])
	# Back on the feet with some stamina; caught the same way again, it is two knockdowns.
	await open_fight()
	for turn in 2:
		PlayerStats.stamina = 15.0
		PlayerStats.is_exhausted = false
		await frames(2)
		opp.start_attack([Strike.JAB])
		await until(func() -> bool: return opp.state == S.STRIKE, 240)
		await button("R")
		await secs(0.5)
		if turn == 0:
			await until(func() -> bool: return not combat.is_down(), 400)
			check("beaten: back up with at least 35% stamina", PlayerStats.get_stamina_ratio() >= CombatController.GET_UP_STAMINA - 0.01, "ratio %.2f" % PlayerStats.get_stamina_ratio())
			await secs(CombatController.GET_UP_GRACE + 0.3)
			await wait_free()
	check("beaten: the second such knockdown ends the bout", count_ev("p_knocked_out") == 1 and combat.knockdowns == 2, "knocked_out=%d knockdowns=%d" % [count_ev("p_knocked_out"), combat.knockdowns])
	await until(func() -> bool: return ring.state == RingManager.State.RESULT, 400)
	check("beaten: ... as a loss by two knockdowns", ring.state == RingManager.State.RESULT and last_ev("bout_finished") == false and hud._result_subtitle.text.contains("two knockdowns"), "state %s subtitle '%s'" % [ring.state, hud._result_subtitle.text])
	# The same clean jab, no punch of the player in flight, never ends it at low stamina.
	await open_fight()
	PlayerStats.stamina = 15.0
	opp.start_attack([Strike.JAB])
	await secs(0.8)
	check("beaten: control, a low-stamina player who is not punching survives the same jab", count_ev("p_knocked_out") == 0 and combat.health > 0.0)


func test_gassed_opponent() -> void:
	await open_fight()
	opp._set_stamina(0.0)
	check("gassed: (setup) the opponent is tired", opp.is_tired())
	opp.start_attack([Strike.CROSS])
	await secs(0.3)
	var s := await throw("L")
	check("gassed: an intercept on a gassed opponent floors him", s != null and s.counter_hit and s.knockdown and s.outcome == Strike.Outcome.HIT and opp.state == S.DOWN and opp.knockdowns == 1 and opp.finish == &"", "outcome=%s finish=%s state=%s" % [s.outcome if s != null else -1, opp.finish, opp.state])
	check("gassed: the bout goes on and the dot is lit", ring.state == RingManager.State.FIGHT and count_ev("o_defeated") == 0 and last_ev("o_knocked_down") == 1, "ring %s" % ring.state)
	await until(func() -> bool: return opp.state != S.DOWN, 400)
	await secs(0.6)
	await wait_free()
	opp._set_stamina(0.0)
	opp.start_attack([Strike.CROSS])
	await secs(0.3)
	s = await throw("L")
	check("gassed: the second one stops him (finish == counter)", s != null and s.counter_hit and s.outcome == Strike.Outcome.KNOCKOUT and opp.finish == &"counter" and opp.knockdowns == 2, "outcome=%s finish=%s state=%s" % [s.outcome if s != null else -1, opp.finish, opp.state])
	check("gassed: the ring finishes as a win", ring.state == RingManager.State.FINISH and count_ev("o_defeated") == 1, "ring %s" % ring.state)
	await until(func() -> bool: return ring.state == RingManager.State.RESULT, 600)
	check("gassed: RESULT is a win by counter", ring.state == RingManager.State.RESULT and last_ev("bout_finished") == true and hud._result_subtitle.text.contains("counter"), "state %s subtitle '%s'" % [ring.state, hud._result_subtitle.text])
	# Controls: a clean hit that is not an intercept does not end it; a fighter at 30% is not gassed.
	await open_fight()
	opp._set_stamina(0.0)
	s = await throw("L")
	check("gassed: control, a plain clean hit on a gassed fighter does not end it", s.outcome == Strike.Outcome.HIT and opp.state != S.OUT and opp.finish == &"")
	await open_fight()
	opp._set_stamina(opp.profile.max_stamina * 0.3)
	opp.start_attack([Strike.CROSS])
	await secs(0.2)
	s = await throw("L")
	check("gassed: control, an intercept on a fighter at 30% stamina does not floor him", s.counter_hit and s.outcome == Strike.Outcome.HIT and not s.knockdown and opp.finish == &"" and not opp.is_tired())
	# Tired stays tired until 40% is back.
	await open_fight()
	opp.profile.stamina_regen = 0.0
	opp._set_stamina(opp.profile.max_stamina * 0.1)
	opp._set_stamina(opp.profile.max_stamina * 0.3)
	check("gassed: a fighter who dropped under 20% stays gassed at 30% (until 40%)", opp.is_tired())
	opp._set_stamina(opp.profile.max_stamina * 0.45)
	check("gassed: ... and is fresh again at 45%", not opp.is_tired())
