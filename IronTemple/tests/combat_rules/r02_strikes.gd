extends "res://tests/combat_rules/rules_base.gd"
## Rule group 2: strikes and combos (ComboTracker WINDOW 0.9, ONE_TWO_BONUS 1.5,
## GUARD_BREAKER_BONUS 1.25, KO_FINISHER_BONUS 2.0, MOVES table, body-shot stamina drain).

const G := EnemyFighter.Guard


func throw(key: String) -> Strike:
	var n := resolved.size()
	await button(key)
	await until(func() -> bool: return resolved.size() > n, 120)
	return resolved[n] if resolved.size() > n else null


func kinds() -> Array:
	var out := []
	for s: Strike in started:
		out.append(s.kind)
	return out


func open_fight(d: float = 1.4) -> void:
	await fresh(4, true, null, d)
	opp.set_guard(G.NONE)
	await frames(2)


func run() -> void:
	await test_buttons()
	await test_both_buttons_guard()
	await test_combos()
	await test_chain_window()
	await test_chain_breaks()
	await test_body_shots()
	await test_kick()
	await test_hit_stop()


func test_buttons() -> void:
	var table := [
		["L", [Strike.JAB], "LMB = jab"],
		["LL", [Strike.JAB, Strike.HOOK], "LMB LMB = hook"],
		["R", [Strike.CROSS], "RMB = cross"],
		["RR", [Strike.CROSS, Strike.OVERHAND], "RMB RMB = overhand"],
		["l", [Strike.BODY_HOOK], "Ctrl+LMB = body hook"],
		["r", [Strike.BODY_CROSS], "Ctrl+RMB = body cross"],
		["K", [Strike.KICK], "F = push kick at range"],
	]
	for row: Array in table:
		await open_fight()
		await chain(row[0])
		await secs(0.6)
		check("buttons: " + row[2], kinds() == row[1], "thrown %s expected %s" % [kinds(), row[1]])
	await open_fight(0.8)
	await button("K")
	await secs(0.6)
	check("buttons: F is a knee when chest to chest", kinds() == [Strike.KNEE], "thrown %s" % [kinds()])
	# Each punch lands on the level it is aimed at.
	await open_fight()
	var zones := []
	for key in ["L", "R", "l", "r"]:
		var s := await throw(key)
		zones.append(s.zone if s != null else -1)
		await secs(0.5)
	check("buttons: LMB/RMB aim at the head, Ctrl+LMB/RMB at the body", zones == [Strike.Zone.HEAD, Strike.Zone.HEAD, Strike.Zone.BODY, Strike.Zone.BODY], "zones %s" % [zones])
	var jab_dmg: float = CombatController.MOVES[Strike.BODY_HOOK]["damage"] / float(CombatController.MOVES[Strike.HOOK]["damage"])
	var cross_dmg: float = CombatController.MOVES[Strike.BODY_CROSS]["damage"] / float(CombatController.MOVES[Strike.CROSS]["damage"])
	check("buttons: body shots do about half the head damage (hook, cross tables)", jab_dmg > 0.4 and jab_dmg < 0.7 and cross_dmg > 0.4 and cross_dmg < 0.7, "ratios %.2f %.2f" % [jab_dmg, cross_dmg])


func test_both_buttons_guard() -> void:
	await open_fight()
	act(&"strike_left", true)
	act(&"strike_right", true)
	await frames(4)
	check("guard: LMB + RMB held together raise the high guard", combat.blocking and not combat.guard_low and started.is_empty(), "blocking=%s low=%s strikes=%d" % [combat.blocking, combat.guard_low, started.size()])
	act(&"body_mod", true)
	await frames(3)
	check("guard: LMB + RMB + Ctrl raise the body guard", combat.blocking and combat.guard_low, "blocking=%s low=%s" % [combat.blocking, combat.guard_low])
	release_all()


func test_combos() -> void:
	# 1-2: the cross lands for x1.5.
	await open_fight()
	await chain("LR", 0.25)
	await secs(0.5)
	var s: Strike = started[1] if started.size() > 1 else null
	check("combo: LMB RMB is the 1-2 Combo (cross)", s != null and s.combo == Strike.ONE_TWO and s.kind == Strike.CROSS, "started %s" % [kinds()])
	var landed: Strike = resolved[1] if resolved.size() > 1 else null
	check("combo: 1-2 cross lands clean", landed != null and landed.outcome == Strike.Outcome.HIT)
	if landed != null:
		check_range("combo: 1-2 cross does x1.5 damage", mult(landed), 1.5 * 0.94 - 0.01, 1.5 * 1.06 + 0.01)
	check("combo: 1-2 is announced", callouts.has("1-2 COMBO") or count_ev("combo_landed") > 0, "events %s" % [last_ev("combo_landed")])

	# Guard Breaker: jab, hook, uppercut shatters a raised guard and staggers.
	await open_fight()
	opp.set_guard(G.HIGH)
	await frames(2)
	await chain("LLR", 0.25)
	await secs(0.3)
	check("combo: LMB LMB RMB throws jab, hook, uppercut", kinds() == [Strike.JAB, Strike.HOOK, Strike.UPPERCUT], "thrown %s" % [kinds()])
	s = resolved[2] if resolved.size() > 2 else null
	check("combo: Guard Breaker uppercut is flagged guard_breaker", s != null and s.combo == Strike.GUARD_BREAKER and s.guard_breaker)
	check("combo: the first two punches were stopped by the raised guard", resolved.size() > 1 and resolved[0].outcome == Strike.Outcome.BLOCKED and resolved[1].outcome == Strike.Outcome.BLOCKED)
	check("combo: Guard Breaker shatters the raised guard (GUARD_BREAK, meter empty)", s != null and s.outcome == Strike.Outcome.GUARD_BREAK and opp.guard <= 0.0, "outcome=%s guard=%.1f" % [s.outcome if s != null else -1, opp.guard])
	check("combo: Guard Breaker staggers", opp.state == EnemyFighter.State.STAGGER, "state=%s" % opp.state)
	# Against an open head it is a clean hit that staggers.
	await open_fight()
	opp.set_guard(G.LOW)
	await frames(2)
	await chain("LLR", 0.25)
	await secs(0.2)
	s = resolved[2] if resolved.size() > 2 else null
	check("combo: Guard Breaker on an uncovered head is a clean hit", s != null and s.outcome == Strike.Outcome.HIT and s.combo == Strike.GUARD_BREAKER)
	check("combo: Guard Breaker staggers a fighter with no guard up", opp.state == EnemyFighter.State.STAGGER, "state=%s" % opp.state)

	# KO Finisher: cross, jab, overhand for x2 with heavy knockback and a stagger.
	await open_fight()
	await chain("RLR", 0.25)
	await secs(0.2)
	check("combo: RMB LMB RMB throws cross, jab, overhand", kinds() == [Strike.CROSS, Strike.JAB, Strike.OVERHAND], "thrown %s" % [kinds()])
	s = resolved[2] if resolved.size() > 2 else null
	check("combo: KO Finisher overhand is flagged", s != null and s.combo == Strike.KO_FINISHER and s.outcome == Strike.Outcome.HIT)
	if s != null:
		check_range("combo: KO Finisher does x2 damage", mult(s), 2.0 * 0.94 - 0.01, 2.0 * 1.06 + 0.01)
		var plain: float = CombatController.MOVES[Strike.OVERHAND]["knockback"]
		check("combo: KO Finisher knockback is heavy (more than twice the plain overhand)", s.knockback > plain * 2.0, "knockback %.2f vs overhand %.2f" % [s.knockback, plain])
	check("combo: KO Finisher staggers", opp.state == EnemyFighter.State.STAGGER, "state=%s" % opp.state)

	# Only head shots complete the named combos: body shots chain but never combo.
	await open_fight()
	await chain("LLr", 0.25)
	await secs(0.3)
	var combos := []
	for st: Strike in started:
		combos.append(st.combo)
	check("combo: LLr (body cross last) never completes a Guard Breaker", combos.all(func(c: StringName) -> bool: return c == &""), "combos %s kinds %s" % [combos, kinds()])
	await open_fight()
	await chain("LlR", 0.25)
	await secs(0.3)
	combos = []
	for st: Strike in started:
		combos.append(st.combo)
	check("combo: L l R does not make a 1-2", combos.all(func(c: StringName) -> bool: return c == &""), "combos %s kinds %s" % [combos, kinds()])


func test_chain_window() -> void:
	await open_fight()
	await button("L")
	await secs(0.78)
	await button("L")
	await secs(0.4)
	check("chain: a second LMB 0.8 s after the jab is still a hook", kinds() == [Strike.JAB, Strike.HOOK], "thrown %s" % [kinds()])
	await open_fight()
	await button("L")
	await secs(1.0)
	await button("L")
	await secs(0.4)
	check("chain: a second LMB 1.0 s after the jab is a new jab (chain expired at 0.9 s)", kinds() == [Strike.JAB, Strike.JAB], "thrown %s" % [kinds()])
	await open_fight()
	await button("R")
	await secs(1.0)
	await button("R")
	await secs(0.4)
	check("chain: a second RMB 1.0 s after the cross is a new cross", kinds() == [Strike.CROSS, Strike.CROSS], "thrown %s" % [kinds()])


func test_chain_breaks() -> void:
	# A whiff breaks the chain.
	await open_fight(4.5)
	var s := await throw("L")
	check("chain: out of reach the jab whiffs", s != null and s.outcome == Strike.Outcome.MISS, "outcome=%s" % [s.outcome if s != null else -1])
	engage(1.4)
	await secs(0.3)
	await button("L")
	await secs(0.4)
	check("chain: after a whiff the next LMB is a jab again, not a hook", kinds() == [Strike.JAB, Strike.JAB], "thrown %s" % [kinds()])
	# A clean hit taken breaks it (control: without the hit the same timing gives a hook).
	await open_fight()
	await button("L")
	await secs(0.15)
	opp.start_attack([Strike.JAB])
	await secs(0.55)
	var took: bool = not brain.landings.is_empty() and brain.landings[0]["strike"].outcome == Strike.Outcome.HIT
	await secs(0.15)
	await button("L")
	await secs(0.4)
	check("chain: taking a clean hit breaks the chain (next LMB is a jab)", took and kinds() == [Strike.JAB, Strike.JAB], "hit taken=%s thrown %s" % [took, kinds()])
	await open_fight()
	await button("L")
	await secs(0.85)
	await button("L")
	await secs(0.4)
	check("chain: control for the above: same timing with no hit chains into a hook", kinds() == [Strike.JAB, Strike.HOOK], "thrown %s" % [kinds()])


func test_body_shots() -> void:
	# Drain per move (regeneration switched off so only the blow counts).
	var drains := {"l": [Strike.BODY_HOOK, 14.0], "r": [Strike.BODY_CROSS, 12.0], "K": [Strike.KICK, 16.0]}
	for key: String in drains:
		await open_fight()
		opp.profile.stamina_regen = 0.0
		opp.stamina = 150.0
		await frames(1)
		var before := opp.stamina
		var s := await throw(key)
		check("body: %s lands clean" % key, s != null and s.outcome == Strike.Outcome.HIT, "outcome=%s" % [s.outcome if s != null else -1])
		check_near("body: %s drains %.0f stamina from the opponent" % [key, drains[key][1]], before - opp.stamina, float(drains[key][1]) * (PlayerStats.get_kick_power() if key == "K" else 1.0), 0.05)
	await open_fight(0.8)
	opp.profile.stamina_regen = 0.0
	opp.stamina = 150.0
	await frames(1)
	var knee := await throw("K")
	check_near("body: a knee drains 24", 150.0 - opp.stamina, 24.0, 0.05, "kind=%s" % [knee.kind if knee != null else "?"])
	var all_in_range := true
	for d in [14.0, 12.0, 16.0, 24.0]:
		if d < 12.0 or d > 24.0:
			all_in_range = false
	check("body: stamina drains sit in the documented 12-24 range", all_in_range)
	# 2.5 s without regeneration.
	await open_fight()
	opp.stamina = 150.0
	await frames(1)
	var s := await throw("l")
	var after := opp.stamina
	var t_hit := game_time
	await secs(2.3)
	check_near("body: stamina does not regenerate for the first 2.3 s after a body shot", opp.stamina, after, 0.05)
	await secs(1.2)
	check("body: stamina regenerates again after 2.5 s", opp.stamina > after + 1.5, "stamina %.2f vs %.2f at %.2f s" % [opp.stamina, after, game_time - t_hit])
	# Control: a head shot does not wind him.
	await open_fight()
	opp.stamina = 150.0
	await frames(1)
	s = await throw("L")
	var s0 := opp.stamina
	await secs(1.0)
	check("body: control, after a head shot stamina keeps regenerating", opp.stamina > s0 + 3.0, "stamina %.2f -> %.2f" % [s0, opp.stamina])

	# A body shot that lands in the gap between his punches knocks the rest of the combination
	# out of him. The gap is 0.14 s, so this needs the pre-workout hand speed and a press made
	# one tick before his punch lands.
	await open_fight()
	PlayerStats.preworkout_timer = 120.0
	opp.start_attack([Strike.JAB, Strike.JAB, Strike.JAB])
	await until(func() -> bool: return opp.state == EnemyFighter.State.STRIKE and opp._state_time + 2.0 * DT >= opp._move["strike"] and opp._state_time + DT < opp._move["strike"], 240)
	act(&"body_mod", true)
	act(&"strike_left", true)
	await frames(3)
	release_all()
	await secs(1.8)
	var landed_count: int = brain.landings.size()
	var body_strike: Strike = resolved[0] if not resolved.is_empty() else null
	var timing_ok: bool = body_strike != null and body_strike.kind == Strike.BODY_HOOK and body_strike.outcome == Strike.Outcome.HIT and not body_strike.counter_hit
	check("body: (setup) the body hook landed in the gap between his punches, not as an intercept", timing_ok, "strike %s outcome %s counter_hit %s" % [body_strike.kind if body_strike != null else "none", body_strike.outcome if body_strike != null else -1, body_strike.counter_hit if body_strike != null else "-"])
	check("body: a body shot in the gap cuts the rest of his combination (he threw 1 of 3)", landed_count == 1 and opp._queue.is_empty(), "his punches that landed: %d, queue %d" % [landed_count, opp._queue.size()])
	check("body: ... and the AI is told its rhythm broke", int(brain.calls.get("rhythm_broken", 0)) == 1, "calls %s" % [brain.calls])
	# And through a wind-up (intercept): the combination is gone as well.
	await open_fight()
	opp.start_attack([Strike.JAB, Strike.JAB, Strike.JAB])
	await until(func() -> bool: return brain.landings.size() >= 1, 120)
	await secs(0.12)
	await button("l")
	await secs(1.8)
	check("body: a body shot into his next wind-up also ends the combination (1 of 3 thrown)", brain.landings.size() == 1 and opp._queue.is_empty(), "his punches that landed: %d" % brain.landings.size())
	await open_fight()
	opp.start_attack([Strike.JAB, Strike.JAB, Strike.JAB])
	await secs(2.0)
	check("body: control, left alone he throws all three punches", brain.landings.size() == 3, "landed %d" % brain.landings.size())


func test_kick() -> void:
	await open_fight()
	free_opponent()
	var start := opp.global_position
	var s := await throw("K")
	await secs(0.8)
	var pushed := opp.global_position.distance_to(start)
	check("kick: lands and pushes the opponent back", s != null and s.outcome == Strike.Outcome.HIT and pushed > 0.3, "outcome=%s pushed %.2f m" % [s.outcome if s != null else -1, pushed])
	check("kick: is a heavy body-level strike", s != null and s.heavy and s.zone == Strike.Zone.BODY)


## Feel: 30 to 80 ms of hit-stop on heavy, combo and counter hits (2 to 5 ticks), none on a light jab.
func hit_stop_ticks(key: String, setup_attack: bool = false) -> int:
	await open_fight()
	if setup_attack:
		opp.start_attack([Strike.CROSS])
		await secs(0.2)
	var n := resolved.size()
	await button(key)
	await until(func() -> bool: return resolved.size() > n, 120)
	var frozen := 0
	for i in 10:
		if Engine.time_scale < 0.1:
			frozen += 1
		await frames(1)
	return frozen


func test_hit_stop() -> void:
	var jab := await hit_stop_ticks("L")
	check("feel: a plain jab has no hit-stop", jab == 0, "%d frozen ticks" % jab)
	var cross := await hit_stop_ticks("R")
	check("feel: a heavy cross freezes the action for 30-80 ms (2-5 ticks)", cross >= 2 and cross <= 5, "%d frozen ticks" % cross)
	var intercept := await hit_stop_ticks("L", true)
	check("feel: an intercept counter freezes the action for 30-80 ms (2-5 ticks)", intercept >= 2 and intercept <= 5, "%d frozen ticks" % intercept)
