extends "res://tests/combat_rules/rules_base.gd"
## Rule group 6: anti-spam (CombatController SPAM_FREE 3, SPAM_PAUSE 0.4, SPAM_STEP 0.5,
## SPAM_SLOW 1.45, SPAM_COST 2.0, SPAM_POWER 0.65, SPAM_STAGGER 0.3).

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


## Three punches thrown and finished; the count is now at the limit.
func three_punches() -> void:
	await open_fight()
	await chain("LLL", 0.2)
	await until(func() -> bool: return started.size() >= 3 and combat._strike == null, 120)
	await frames(1)


func sloppy_next() -> bool:
	var n := started.size()
	await button("L")
	await until(func() -> bool: return started.size() > n, 60)
	return started.size() > n and started[n].sloppy


func run() -> void:
	await test_limit()
	await test_sloppy_numbers()
	await test_resets()
	await test_opponent_slips()
	await test_hud_warning()


func test_limit() -> void:
	await open_fight()
	await chain("LLLL", 0.2)
	await secs(0.6)
	var flags := []
	for s: Strike in started:
		flags.append(s.sloppy)
	check("spam: three strikes in a row are normal, the fourth is sloppy", flags == [false, false, false, true], "sloppy flags %s" % [flags])
	check("spam: is_sloppy() is true after the limit", combat.is_sloppy())
	await open_fight()
	await chain("LL", 0.2)
	await secs(0.1)
	check("spam: is_sloppy() is still false after two strikes", not combat.is_sloppy())


func test_sloppy_numbers() -> void:
	# The fourth press is RMB after jab, hook, jab: an uppercut that would complete the Guard
	# Breaker, but a sloppy punch cannot combo.
	await open_fight()
	await chain("LLL", 0.2)
	await until(func() -> bool: return started.size() >= 3 and combat._strike == null, 120)
	var stamina_before := PlayerStats.stamina
	await button("R")
	await until(func() -> bool: return started.size() > 3, 60)
	var paid := stamina_before - PlayerStats.stamina
	var s: Strike = started[3]
	check("spam: sloppy fourth press is an uppercut with no combo", s.sloppy and s.kind == Strike.UPPERCUT and s.combo == &"", "sloppy=%s kind=%s combo=%s" % [s.sloppy, s.kind, s.combo])
	var cost: float = CombatController.MOVES[Strike.UPPERCUT]["cost"]
	check_near("spam: sloppy strikes cost double stamina (uppercut 12 -> 24)", paid, cost * CombatController.SPAM_COST, 1.0)
	check_near("spam: sloppy strike stagger is 30%", s.stagger, float(CombatController.MOVES[Strike.UPPERCUT]["stagger"]) * CombatController.SPAM_STAGGER, 0.001)
	await until(func() -> bool: return resolved.size() > 3, 60)
	var sloppy_time: float = resolved_t[3] - started_t[3]
	var startup: float = CombatController.MOVES[Strike.UPPERCUT]["startup"]
	check("spam: sloppy strike is 1.45x slower to land (start-up %.3f s -> %.3f s)" % [startup, startup * CombatController.SPAM_SLOW], absf(sloppy_time - startup * CombatController.SPAM_SLOW) <= 1.5 * DT, "measured %.3f s" % sloppy_time)
	# Same punch with a fresh count for the speed comparison.
	await open_fight()
	await chain("LLR", 0.2)
	await secs(0.5)
	var normal_time: float = resolved_t[2] - started_t[2]
	check("spam: control, the same uppercut with a fresh count lands in %.2f s" % startup, absf(normal_time - startup) <= 1.5 * DT, "measured %.3f s" % normal_time)
	# 65% damage: fourth punch lands while he winds up, so he cannot slip it.
	await open_fight()
	await chain("LLL", 0.2)
	await until(func() -> bool: return resolved.size() >= 3, 60)
	opp.start_attack([Strike.OVERHAND])
	await button("L")
	await secs(1.0)
	s = resolved[3] if resolved.size() > 3 else null
	check("spam: (setup) the sloppy hook hit", s != null and s.sloppy and s.outcome == Strike.Outcome.HIT, "outcome=%s" % [s.outcome if s != null else -1])
	if s != null:
		check_range("spam: sloppy strikes do 65% damage", mult(s), 0.65 * 0.94 - 0.02, 0.65 * 1.06 + 0.02)
	# Slow-motion tired: gassed punches are 60% speed / 55% power (README stamina rules).
	await open_fight()
	PlayerStats.stamina = 0.0
	PlayerStats.is_exhausted = true
	await frames(2)
	var jab := await throw("L")
	check("stamina: at zero stamina punches come out at 55% power", jab != null and absf(jab.damage / (float(CombatController.MOVES[Strike.JAB]["damage"]) * PlayerStats.get_punch_power()) - CombatController.GASSED_POWER) < 0.07, "damage %.2f" % [jab.damage if jab != null else -1.0])
	check("stamina: at zero stamina punches are slow (60% speed: start-up 0.09 -> 0.15 s)", jab != null and absf((resolved_t[0] - started_t[0]) - 0.09 / 0.6) <= 1.5 * DT, "measured %.3f s" % (resolved_t[0] - started_t[0]))


func test_resets() -> void:
	# A pause: measured from the end of the last strike's recovery.
	await three_punches()
	await secs(0.3)
	check("spam: a 0.3 s breath is not enough (still sloppy)", await sloppy_next())
	await three_punches()
	await secs(0.55)
	check("spam: a 0.55 s breath resets the count", not await sloppy_next())
	# Half a metre of walking between punches.
	await three_punches()
	var start := player.global_position
	var t0 := game_time
	act(&"move_left", true)
	await until(func() -> bool: return player.global_position.distance_to(start) >= 0.62, 60)
	act(&"move_left", false)
	var walked := player.global_position.distance_to(start)
	var took := game_time - t0
	var sloppy: bool = await sloppy_next()
	check("spam: stepping half a metre resets the count (walked %.2f m in %.2f s)" % [walked, took], took < 0.38 and not sloppy, "sloppy=%s took=%.2f" % [sloppy, took])
	await three_punches()
	start = player.global_position
	t0 = game_time
	act(&"move_left", true)
	await until(func() -> bool: return player.global_position.distance_to(start) >= 0.2, 60)
	act(&"move_left", false)
	walked = player.global_position.distance_to(start)
	sloppy = await sloppy_next()
	check("spam: control, a 0.2 m step does not reset it (walked %.2f m)" % walked, sloppy, "sloppy=%s" % sloppy)
	# A slip.
	await three_punches()
	act(&"move_right", true)
	act(&"dodge", true)
	await frames(3)
	act(&"dodge", false)
	act(&"move_right", false)
	await secs(0.22)
	check("spam: a slip resets the count", not await sloppy_next())
	await three_punches()
	await secs(0.3)
	check("spam: control, 0.3 s of nothing at all leaves it sloppy (so the slip did the reset)", await sloppy_next())
	# The guard.
	await three_punches()
	await tap(&"block", 8)
	await secs(0.12)
	check("spam: raising the guard resets the count", not await sloppy_next())
	# A feint.
	await three_punches()
	var n := started.size()
	await button("L")
	await until(func() -> bool: return started.size() > n, 60)
	await frames(2)
	await tap(&"block", 2)
	await secs(0.25)
	check("spam: a feint resets the count", count_ev("feinted") == 1 and not await sloppy_next(), "feinted=%d" % count_ev("feinted"))


func test_opponent_slips() -> void:
	await open_fight()
	await chain("LLLL", 0.2)
	await secs(2.0)
	check("spam: a sloppy punch is slipped (DODGED)", resolved.size() == 4 and resolved[3].sloppy and resolved[3].outcome == Strike.Outcome.DODGED, "outcomes %s" % [resolved.map(func(r: Strike) -> int: return r.outcome)])
	check("spam: the first three normal punches landed", resolved.size() >= 3 and resolved[0].outcome == Strike.Outcome.HIT and resolved[1].outcome == Strike.Outcome.HIT and resolved[2].outcome == Strike.Outcome.HIT)
	check("spam: he slipped (SLIP state) and counters the sloppy punch", opp_entered(S.SLIP) > 0.0 and brain.landings.size() >= 1 and brain.landings[0]["kind"] == opp.brain.style.counter_move, "slip at %.2f landings %d kinds %s" % [opp_entered(S.SLIP), brain.landings.size(), brain.landings.map(func(l: Dictionary) -> StringName: return l["kind"])])


func test_hud_warning() -> void:
	await open_fight()
	await chain("LL", 0.2)
	await secs(0.1)
	check("hud: no SLOPPY warning while the count is under the limit", not hud._status.text.begins_with("SLOPPY"), "status '%s'" % hud._status.text)
	await button("L")
	await secs(0.25)
	check("hud: SLOPPY shows when the next punch would be sloppy (is_sloppy)", combat.is_sloppy() and hud._status.text.begins_with("SLOPPY"), "is_sloppy=%s status '%s'" % [combat.is_sloppy(), hud._status.text])
	await secs(0.9)
	check("hud: ... and clears once the count resets", not combat.is_sloppy() and hud._status.text == "", "is_sloppy=%s status '%s'" % [combat.is_sloppy(), hud._status.text])
