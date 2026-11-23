extends "res://tests/combat_rules/rules_base.gd"
## Rule group 1: targeting and guards (CombatController BLOCK_REDUCTION, GUARD_BREAK_STUN,
## BLOCK_COST_PER_DAMAGE; EnemyFighter GUARD_BREAK_STAGGER, GUARD_REBUILD).

const G := EnemyFighter.Guard


## Presses `key`, waits for the strike to resolve and returns it.
func throw(key: String) -> Strike:
	var n := resolved.size()
	await button(key)
	await until(func() -> bool: return resolved.size() > n, 120)
	return resolved[n] if resolved.size() > n else null


func run() -> void:
	await test_harness_input()
	await test_opponent_guards()
	await test_player_guard_reduction()
	await test_block_costs_stamina()
	await test_guard_break_by_empty_tank()
	await test_exhausted_guard_stays_down()
	await test_opponent_guard_meter()


func test_harness_input() -> void:
	await fresh(4)
	act(&"block", true)
	await frames(3)
	check("input: parse_input_event(block) raises the player's guard", combat.blocking, "blocking=%s pressed=%s" % [combat.blocking, Input.is_action_pressed(&"block")])
	act(&"block", false)
	await frames(3)
	check("input: releasing block lowers the guard", not combat.blocking)
	check("bout: countdown handed control over (FIGHT, controls enabled, not locked)", ring.state == RingManager.State.FIGHT and player.controls_enabled and not combat.locked)


func test_opponent_guards() -> void:
	# [button, opponent guard, expected outcome, label]
	var table := [
		["L", G.HIGH, Strike.Outcome.BLOCKED, "head jab into HIGH guard is BLOCKED"],
		["L", G.LOW, Strike.Outcome.HIT, "head jab into LOW (body) guard is a clean HIT"],
		["L", G.NONE, Strike.Outcome.HIT, "head jab into NO guard is a clean HIT"],
		["R", G.HIGH, Strike.Outcome.BLOCKED, "head cross into HIGH guard is BLOCKED"],
		["l", G.LOW, Strike.Outcome.BLOCKED, "body hook into LOW (body) guard is BLOCKED"],
		["l", G.HIGH, Strike.Outcome.HIT, "body hook into HIGH guard is a clean HIT"],
		["l", G.NONE, Strike.Outcome.HIT, "body hook into NO guard is a clean HIT"],
		["r", G.LOW, Strike.Outcome.BLOCKED, "body cross into LOW (body) guard is BLOCKED"],
		["r", G.HIGH, Strike.Outcome.HIT, "body cross into HIGH guard is a clean HIT"],
		["K", G.LOW, Strike.Outcome.BLOCKED, "kick (body level) into LOW guard is BLOCKED"],
		["K", G.HIGH, Strike.Outcome.HIT, "kick (body level) into HIGH guard is a clean HIT"],
	]
	for row: Array in table:
		await fresh(4)
		opp.set_guard(row[1])
		await frames(2)
		var s := await throw(row[0])
		check("targeting: " + row[3], s != null and s.outcome == row[2], "outcome=%s" % [s.outcome if s != null else "no strike"])
		if s != null and row[2] == Strike.Outcome.BLOCKED:
			var passed_through: float = s.dealt / s.damage
			check_near("targeting: blocked %s lets (1 - block_power) through" % row[0], passed_through, 1.0 - brain.style.block_power, 0.001)


func test_player_guard_reduction() -> void:
	# [guard, attack kind, expected outcome, expected share through, label]
	var table := [
		["high", Strike.JAB, Strike.Outcome.BLOCKED, 0.2, "high guard stops 80% of a head strike (jab)"],
		["high", Strike.HOOK, Strike.Outcome.BLOCKED, 0.2, "high guard stops 80% of a head strike (hook)"],
		["high", Strike.BODY_HOOK, Strike.Outcome.HIT, 1.0, "high guard stops nothing of a body strike"],
		["high", Strike.KICK, Strike.Outcome.HIT, 1.0, "high guard stops nothing of a kick (body level)"],
		["body", Strike.BODY_HOOK, Strike.Outcome.BLOCKED, 0.2, "Ctrl+Shift body guard stops 80% of a body strike"],
		["body", Strike.BODY_CROSS, Strike.Outcome.BLOCKED, 0.2, "Ctrl+Shift body guard stops 80% of a body cross"],
		["body", Strike.JAB, Strike.Outcome.HIT, 1.0, "body guard stops nothing of a head strike"],
		["body", Strike.OVERHAND, Strike.Outcome.HIT, 1.0, "body guard stops nothing of an overhand"],
	]
	for row: Array in table:
		await fresh(4)
		combat.max_health = 100000.0
		combat.health = 100000.0
		combat.chin.reset(100000.0)
		if row[0] == "body":
			act(&"body_mod", true)
		act(&"block", true)
		await frames(3)
		check("guard: %s guard is up (guard_low=%s)" % [row[0], combat.guard_low], combat.blocking and combat.guard_low == (row[0] == "body"))
		opp.start_attack([row[1]])
		await until(func() -> bool: return brain.landings.size() > 0, 240)
		var land := last_landing()
		if land.is_empty():
			check("guard: " + row[4], false, "opponent never landed")
		else:
			var s: Strike = land["strike"]
			var share: float = s.dealt / s.damage
			check("guard: " + row[4], s.outcome == row[2] and absf(share - float(row[3])) < 0.001, "outcome=%s through=%.3f expected %s through=%.2f" % [s.outcome, share, row[2], row[3]])
		release_all()


func test_block_costs_stamina() -> void:
	await fresh(4)
	act(&"block", true)
	await frames(3)
	opp.start_attack([Strike.CROSS])
	await until(func() -> bool: return opp.state == EnemyFighter.State.STRIKE, 240)
	var before := PlayerStats.stamina
	await until(func() -> bool: return brain.landings.size() > 0, 60)
	var land := last_landing()
	var s: Strike = land["strike"]
	var paid := before - PlayerStats.stamina
	var expected: float = s.damage * CombatController.BLOCK_COST_PER_DAMAGE + s.guard_damage
	check("guard: a blocked cross costs 0.45 x damage (+ guard shred) in stamina", s.outcome == Strike.Outcome.BLOCKED and paid >= expected - 0.1 and paid <= expected + 0.8, "paid %.3f expected %.3f outcome %s" % [paid, expected, s.outcome])
	release_all()
	# Holding the guard costs stamina every second even when nothing lands.
	await fresh(4)
	var start := PlayerStats.stamina
	act(&"block", true)
	await secs(1.0)
	var drained := start - PlayerStats.stamina
	check_near("guard: holding the guard drains about 3 stamina per second", drained, CombatController.BLOCK_DRAIN, 0.6)
	release_all()


func test_guard_break_by_empty_tank() -> void:
	# A blow that the last of the stamina cannot pay for breaks the guard: 0.6 s stun.
	await fresh(4)
	combat.max_health = 100000.0
	combat.health = 100000.0
	combat.chin.reset(100000.0)
	PlayerStats.stamina = 3.0
	act(&"block", true)
	await frames(3)
	opp.start_attack([Strike.JAB])
	await until(func() -> bool: return brain.landings.size() > 0, 240)
	var land := last_landing()
	var s: Strike = land["strike"]
	check("guard: a blow the stamina cannot pay for is a GUARD_BREAK", s.outcome == Strike.Outcome.GUARD_BREAK, "outcome=%s stamina=%.2f" % [s.outcome, PlayerStats.stamina])
	check_near("guard: guard break lets 50% of the damage through", s.dealt / s.damage, 0.5, 0.001)
	check("guard: guard_broken signal fired", count_ev("guard_broken") == 1)
	check("guard: guard is down after the break", not combat.blocking)
	await secs(1.0)
	check_near("guard: guard-break stun lasts 0.6 s", flag_duration("stun"), CombatController.GUARD_BREAK_STUN, 0.06)
	release_all()
	# Running dry with the guard up and nothing landing breaks it too.
	await fresh(4)
	PlayerStats.stamina = 0.3
	act(&"block", true)
	await secs(0.5)
	check("guard: draining to zero behind the guard breaks it (guard_broken)", count_ev("guard_broken") >= 1)
	await secs(0.8)
	check_near("guard: that stun also lasts 0.6 s", flag_duration("stun"), CombatController.GUARD_BREAK_STUN, 0.06)
	release_all()
	# Stunned: a punch pressed during the stun does not start before it ends.
	await fresh(4)
	PlayerStats.stamina = 0.3
	act(&"block", true)
	await until(func() -> bool: return count_ev("guard_broken") > 0, 120)
	act(&"block", false)
	var broke_at := game_time
	var n := started.size()
	for i in 60:
		await tap(&"strike_left", 1)
		if started.size() > n:
			break
		await frames(1)
	check("guard: a punch cannot start during the 0.6 s stun", started.size() > n and started_t[n] - broke_at >= CombatController.GUARD_BREAK_STUN - 0.05, "first punch %.3f s after the break" % (started_t[n] - broke_at if started.size() > n else -1.0))
	release_all()


func test_exhausted_guard_stays_down() -> void:
	await fresh(4)
	PlayerStats.stamina = 0.0
	PlayerStats.is_exhausted = true
	act(&"block", true)
	await secs(1.2)
	check("stamina: at zero stamina the guard cannot be raised (until 25% is back)", not combat.blocking and PlayerStats.is_exhausted, "blocking=%s stamina=%.1f" % [combat.blocking, PlayerStats.stamina])
	await secs(3.5)
	check("stamina: guard comes back once 25% stamina is restored", combat.blocking and not PlayerStats.is_exhausted, "blocking=%s stamina=%.1f exhausted=%s" % [combat.blocking, PlayerStats.stamina, PlayerStats.is_exhausted])
	release_all()


func test_opponent_guard_meter() -> void:
	await fresh(4)
	var max_guard := opp.profile.guard_max
	opp.set_guard(G.HIGH)
	await frames(2)
	var s := await throw("L")
	check("opp guard: a blocked jab chips the guard meter by its guard damage", s != null and s.outcome == Strike.Outcome.BLOCKED and absf(opp.guard - (max_guard - s.guard_damage)) < 0.01, "guard=%.2f max=%.2f guard_damage=%.2f" % [opp.guard, max_guard, s.guard_damage if s != null else -1.0])
	# Run the meter down (a hit holds off its regeneration for a second), then break it.
	opp.guard = 5.0
	var hp := opp.health
	await secs(0.2)
	s = await throw("L")
	check("opp guard: an empty meter breaks (GUARD_BREAK)", s != null and s.outcome == Strike.Outcome.GUARD_BREAK, "outcome=%s guard=%.2f" % [s.outcome if s != null else "none", opp.guard])
	check_near("opp guard: 60% of the blow goes through the broken guard", s.dealt / s.damage, 0.6, 0.001)
	check_near("opp guard: health drops by exactly the damage that got through", hp - opp.health, s.dealt, 0.01)
	check("opp guard: a broken guard staggers him", opp.state == EnemyFighter.State.STAGGER, "state=%s" % opp.state)
	await until(func() -> bool: return opp.state == EnemyFighter.State.FOOTWORK, 120)
	await frames(2)
	var t_free := game_time - 2.0 * DT
	check_near("opp guard: guard-break stagger lasts 0.8 s", opp_state_duration(EnemyFighter.State.STAGGER), EnemyFighter.GUARD_BREAK_STAGGER, 0.07)
	check_near("opp guard: the guard comes back whole", opp.guard, max_guard, 0.01)
	# Unbreakable for 2 s after the rebuild: blows are blocked and the meter does not move.
	opp.set_guard(G.HIGH)
	await secs(0.2)
	var outcomes := []
	var meters := []
	for i in 3:
		s = await throw("L")
		outcomes.append(s.outcome if s != null else -1)
		meters.append(opp.guard)
		await secs(0.3)
	var all_blocked := true
	var all_whole := true
	for o in outcomes:
		if o != Strike.Outcome.BLOCKED:
			all_blocked = false
	for g in meters:
		if absf(g - max_guard) > 0.01:
			all_whole = false
	check("opp guard: right after the rebuild blows are blocked (guard cannot break)", all_blocked, "outcomes %s" % [outcomes])
	check("opp guard: the rebuilt guard is not chipped for 2 s", all_whole, "guard meter %s of %.1f, last blow %.2f s after the stagger" % [meters, max_guard, game_time - t_free])
	await secs(maxf(2.3 - (game_time - t_free), 0.0))
	opp.set_guard(G.HIGH)
	await frames(2)
	s = await throw("L")
	check("opp guard: after 2 s the guard can be chipped again", s != null and s.outcome == Strike.Outcome.BLOCKED and opp.guard < max_guard - 1.0, "guard=%.2f of %.1f outcome=%s (%.2f s after the stagger)" % [opp.guard, max_guard, s.outcome if s != null else -1, game_time - t_free])
