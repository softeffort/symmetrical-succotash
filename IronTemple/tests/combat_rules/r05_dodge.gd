extends "res://tests/combat_rules/rules_base.gd"
## Rule group 5: slips and the perfect counter (CombatController PERFECT_WINDOW 0.22,
## IFRAME_TIME 0.32, COUNTER_MULTIPLIER 2.0, COUNTER_SLOWMO 0.25 at scale 0.3, COUNTER_GRACE 0.4)
## and the rule that bonuses never stack (the biggest one applies).

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


func slip_right() -> void:
	act(&"move_right", true)
	act(&"dodge", true)
	await frames(3)
	act(&"dodge", false)
	act(&"move_right", false)


## His jab is started now and lands 32 ticks later; the slip is pressed `j` ticks after that,
## so the slip is `(31 - j)` ticks old when the punch arrives. Returns the landing record.
func slip_trial(j: int) -> Dictionary:
	await open_fight()
	var stamina := PlayerStats.stamina
	opp.start_attack([Strike.JAB])
	await frames(j)
	await slip_right()
	await until(func() -> bool: return brain.landings.size() > 0, 120)
	var land := last_landing()
	land["stamina_spent"] = stamina - PlayerStats.stamina
	return land


func run() -> void:
	await test_slip_timing_sweep()
	await test_perfect_counter()
	await test_counter_expiry()
	await test_no_stacking()
	await test_punish_and_level_change()
	await test_slip_before_a_whiff()
	await test_directions_and_slow_motion()


func test_slip_timing_sweep() -> void:
	# [ticks before landing the slip is pressed], classified by the slip's real age on arrival.
	for j in [29, 26, 22, 19, 18, 17, 16, 14, 13, 12, 10, 6]:
		var land := await slip_trial(j)
		if land.is_empty():
			check("dodge: slip trial j=%d lands" % j, false, "his punch never landed")
			continue
		var s: Strike = land["strike"]
		var age: float = land["dodge_age"]
		var label := "slip %.3f s old when his jab lands" % age
		if age <= CombatController.PERFECT_WINDOW:
			check("dodge: %s is a PERFECT dodge (within 0.22 s)" % label, s.outcome == Strike.Outcome.DODGED and s.perfect, "outcome=%s perfect=%s" % [s.outcome, s.perfect])
			check("dodge: %s opens the counter window" % label, count_ev("counter_opened") == 1 and combat.is_counter_ready(), "counter_opened=%d ready=%s" % [count_ev("counter_opened"), combat.is_counter_ready()])
		elif age < CombatController.IFRAME_TIME:
			check("dodge: %s dodges without the counter (0.22 to 0.32 s)" % label, s.outcome == Strike.Outcome.DODGED and not s.perfect and count_ev("counter_opened") == 0 and not combat.is_counter_ready(), "outcome=%s perfect=%s counter_opened=%d" % [s.outcome, s.perfect, count_ev("counter_opened")])
		else:
			check("dodge: %s is too late and gets hit (after 0.32 s)" % label, s.outcome == Strike.Outcome.HIT and not s.perfect, "outcome=%s perfect=%s" % [s.outcome, s.perfect])
	var land := await slip_trial(22)
	check_near("dodge: a slip costs 9 stamina", land["stamina_spent"], CombatController.DODGE_COST, 1.0)


func test_perfect_counter() -> void:
	var land := await slip_trial(22)
	var s: Strike = land["strike"]
	check("perfect: (setup) the slip was perfect", s.perfect and land["dodge_age"] <= CombatController.PERFECT_WINDOW, "age %.3f" % land["dodge_age"])
	var opened: Variant = last_ev("counter_opened")
	check_near("perfect: the window stays open 0.65 s (0.25 slow motion + 0.4 grace)", float(opened), CombatController.COUNTER_SLOWMO + CombatController.COUNTER_GRACE, 0.001)
	await frames(2)
	check_near("perfect: time slows to 0.3", Engine.time_scale, CombatController.COUNTER_SLOWMO_SCALE, 0.02)
	await frames(24)
	check_near("perfect: ... and is back to normal after the quarter second", Engine.time_scale, 1.0, 0.001)
	check("perfect: the counter is still ready after the slow motion (grace)", combat.is_counter_ready())
	# The counter: x2 and a stagger.
	await secs(0.1)
	var c := await throw("L")
	check("perfect: the next strike is flagged counter", c != null and c.counter and c.outcome == Strike.Outcome.HIT, "counter=%s outcome=%s" % [c.counter if c != null else "?", c.outcome if c != null else -1])
	if c != null:
		check_range("perfect: the counter does x2 damage", mult(c), 2.0 * 0.94 - 0.01, 2.0 * 1.06 + 0.01)
	check("perfect: the counter staggers him", opp.state == S.STAGGER, "state=%s" % opp.state)
	check("perfect: the window is used up by that strike", not combat.is_counter_ready())
	check("perfect: it counts as a perfect counter for the payout", combat.bout_counters == 1, "counters=%d" % combat.bout_counters)


func test_counter_expiry() -> void:
	await slip_trial(22)
	await secs(0.8)
	check("perfect: the counter window is gone after 0.65 s", not combat.is_counter_ready())
	var c := await throw("L")
	check("perfect: a strike after the window is a plain x1 strike", c != null and not c.counter and mult(c) < 1.1, "counter=%s mult=%.2f" % [c.counter if c != null else "?", mult(c) if c != null else 0.0])


func test_no_stacking() -> void:
	# --- counter + 1-2 combo: the counter's x2 stands, the 1.5 is not multiplied on top.
	await open_fight()
	await button("L")
	await until(func() -> bool: return resolved.size() >= 1, 60)
	opp.start_attack([Strike.JAB])
	await frames(22)
	await slip_right()
	await until(func() -> bool: return brain.landings.size() > 0, 120)
	await frames(2)
	var s := await throw("R")
	check("stacking: (setup) the cross is both a counter and the 1-2 combo", s != null and s.counter and s.combo == Strike.ONE_TWO and s.outcome == Strike.Outcome.HIT, "counter=%s combo=%s outcome=%s" % [s.counter if s != null else "?", s.combo if s != null else "?", s.outcome if s != null else -1])
	if s != null:
		check_range("stacking: counter + 1-2 does x2.0, not x3.0", mult(s), 2.0 * 0.94 - 0.01, 2.0 * 1.06 + 0.01)
	# --- counter + KO finisher.
	await open_fight()
	await chain("RL", 0.2)
	await until(func() -> bool: return resolved.size() >= 2, 60)
	opp.start_attack([Strike.JAB])
	await frames(22)
	await slip_right()
	await until(func() -> bool: return brain.landings.size() > 0, 120)
	await frames(2)
	s = await throw("R")
	check("stacking: (setup) the overhand is both a counter and the KO Finisher", s != null and s.counter and s.combo == Strike.KO_FINISHER, "counter=%s combo=%s" % [s.counter if s != null else "?", s.combo if s != null else "?"])
	if s != null:
		check_range("stacking: counter + KO Finisher does x2.0, not x4.0", mult(s), 2.0 * 0.94 - 0.01, 2.0 * 1.06 + 0.01)
	# --- 1-2 combo + intercept: the 2.5 wins over the 1.5.
	await open_fight()
	await button("L")
	await until(func() -> bool: return resolved.size() >= 1, 60)
	opp.start_attack([Strike.OVERHAND])
	await secs(0.1)
	s = await throw("R")
	check("stacking: (setup) the cross is both an intercept and the 1-2 combo", s != null and s.counter_hit and s.combo == Strike.ONE_TWO, "counter_hit=%s combo=%s" % [s.counter_hit if s != null else "?", s.combo if s != null else "?"])
	if s != null:
		check_range("stacking: intercept + 1-2 does x2.5, not x3.75", mult(s), 2.5 * 0.94 - 0.01, 2.5 * 1.06 + 0.01)
	# --- KO finisher + intercept.
	await open_fight()
	await chain("RL", 0.2)
	await until(func() -> bool: return resolved.size() >= 2, 60)
	opp.start_attack([Strike.OVERHAND])
	await secs(0.1)
	s = await throw("R")
	check("stacking: (setup) the overhand is both an intercept and the KO Finisher", s != null and s.counter_hit and s.combo == Strike.KO_FINISHER, "counter_hit=%s combo=%s" % [s.counter_hit if s != null else "?", s.combo if s != null else "?"])
	if s != null:
		check_range("stacking: intercept + KO Finisher does x2.5, not x5", mult(s), 2.5 * 0.94 - 0.01, 2.5 * 1.06 + 0.01)
	# --- counter + intercept: a counter punch thrown into his next wind-up.
	await open_fight()
	opp.start_attack([Strike.JAB])
	await frames(22)
	await slip_right()
	await until(func() -> bool: return brain.landings.size() > 0, 120)
	opp.start_attack([Strike.OVERHAND])
	await frames(14)
	s = await throw("L")
	check("stacking: (setup) the jab is both a counter and an intercept", s != null and s.counter and s.counter_hit, "counter=%s counter_hit=%s" % [s.counter if s != null else "?", s.counter_hit if s != null else "?"])
	if s != null:
		check_range("stacking: counter + intercept does x2.5, not x5", mult(s), 2.5 * 0.94 - 0.01, 2.5 * 1.06 + 0.01)




func test_punish_and_level_change() -> void:
	# Jab breaks a nearly empty guard: he is staggered for 0.8 s and open (x1.25).
	await open_fight()
	opp.set_guard(G.HIGH)
	opp.guard = 0.5
	var s := await throw("L")
	check("punish: (setup) the jab breaks his guard and staggers him", s != null and s.outcome == Strike.Outcome.GUARD_BREAK and opp.state == S.STAGGER, "outcome=%s state=%s" % [s.outcome if s != null else -1, opp.state])
	await secs(0.2)
	s = await throw("r")
	check("punish: a body cross into the staggered fighter is a clean hit", s != null and s.outcome == Strike.Outcome.HIT and resolved_ostate[1] == S.STAGGER, "outcome=%s ostate=%s" % [s.outcome if s != null else -1, resolved_ostate[1] if resolved_ostate.size() > 1 else -1])
	if s != null:
		check_range("punish: hitting a staggered fighter does x1.25", mult(s), 1.25 * 0.94 - 0.01, 1.25 * 1.06 + 0.01)
	# 1-2 into a stagger: x1.5 (the combo), not 1.5 x 1.25.
	await open_fight()
	opp.set_guard(G.HIGH)
	opp.guard = 0.5
	s = await throw("L")
	await secs(0.12)
	s = await throw("R")
	check("stacking: (setup) the cross is the 1-2 combo into a staggered fighter", s != null and s.combo == Strike.ONE_TWO and s.outcome == Strike.Outcome.HIT and resolved_ostate[1] == S.STAGGER, "combo=%s outcome=%s ostate=%s" % [s.combo if s != null else "?", s.outcome if s != null else -1, resolved_ostate[1] if resolved_ostate.size() > 1 else -1])
	if s != null:
		check_range("stacking: 1-2 + punish does x1.5, not x1.875", mult(s), 1.5 * 0.94 - 0.01, 1.5 * 1.06 + 0.01)
	# Level change into a staggered fighter: x1.25 (punish) beats x1.2 (level change).
	await open_fight()
	opp.set_guard(G.HIGH)
	opp.guard = 0.5
	s = await throw("L")
	await secs(0.1)
	var body := await throw("l")
	var chin_before := opp.chin.stagger
	await secs(0.02)
	s = await throw("L")
	check("stacking: (setup) the jab is a level change on a staggered fighter", s != null and s.setup and s.outcome == Strike.Outcome.HIT and resolved_ostate[2] == S.STAGGER, "setup=%s outcome=%s ostate=%s" % [s.setup if s != null else "?", s.outcome if s != null else -1, resolved_ostate[2] if resolved_ostate.size() > 2 else -1])
	if s != null:
		check_range("stacking: level change + punish does x1.25, not x1.5", mult(s), 1.25 * 0.94 - 0.01, 1.25 * 1.06 + 0.01)


## A slip made before a punch that falls short dodges nothing: no perfect dodge, no counter.
func test_slip_before_a_whiff() -> void:
	await open_fight(2.6)
	opp.start_attack([Strike.JAB])
	await frames(22)
	await slip_right()
	await until(func() -> bool: return brain.landings.size() > 0, 120)
	var land := last_landing()
	var s: Strike = land["strike"]
	check("perfect: (setup) the slip was well inside the 0.22 s window, the punch was out of reach", land["dodge_age"] <= CombatController.PERFECT_WINDOW and opp.to_target().length() > opp.reach_of(Strike.JAB), "age %.3f distance %.2f reach %.2f" % [land["dodge_age"], opp.to_target().length(), opp.reach_of(Strike.JAB)])
	check("perfect: slipping a punch that would not have reached is not a perfect dodge (no counter, no slow motion)", not s.perfect and not combat.is_counter_ready() and count_ev("counter_opened") == 0, "outcome=%s perfect=%s counter_opened=%d" % [s.outcome, s.perfect, count_ev("counter_opened")])


## A/D/S + Space slip left, right and back; Space alone slips back. The slow motion is a quarter second.
func test_directions_and_slow_motion() -> void:
	var cases := [
		["left", [&"move_left"], Vector3(-1, 0, 0)],
		["right", [&"move_right"], Vector3(1, 0, 0)],
		["back (S + Space)", [&"move_back"], Vector3(0, 0, 1)],
		["back (Space alone)", [], Vector3(0, 0, 1)],
	]
	for c: Array in cases:
		await open_fight()
		free_opponent()
		var start := player.global_position
		for a: StringName in c[1]:
			act(a, true)
		act(&"dodge", true)
		await frames(3)
		act(&"dodge", false)
		for a: StringName in c[1]:
			act(a, false)
		await secs(0.4)
		var moved := player.global_position - start
		var dir: Vector3 = c[2]
		check("slip: %s slips %.2f m along %s" % [c[0], moved.dot(dir), dir], moved.dot(dir) > 0.45 and absf(moved.cross(dir).length()) < 0.35, "moved %s" % [moved])
	# The slow motion lasts 0.25 s at scale 0.3.
	var land := await slip_trial(22)
	await frames(1)
	var slow_frames := 0
	for i in 30:
		if Engine.time_scale < 0.5:
			slow_frames += 1
		await frames(1)
	check("perfect: time stays slowed for a quarter second (about 15 ticks)", slow_frames >= 13 and slow_frames <= 18, "%d slow ticks" % slow_frames)
