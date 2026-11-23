extends "res://tests/combat_rules/rules_base.gd"
## Rule group 3: feints (CombatController FEINT_WINDOW 0.15, FEINT_TIME 0.16; EnemyAI
## COMMIT_TIME 0.55). The window is measured from the moment the punch starts.

const G := EnemyFighter.Guard


func open_fight(d: float = 1.4) -> void:
	await fresh(4, true, null, d)
	opp.set_guard(G.NONE)
	await frames(2)


## Throws a cross then an overhand (RMB RMB: 0.19 s of start-up, long enough to probe the 0.15 s
## window), taps the guard `k` frames after the overhand starts and reports what happened.
func overhand_feint(k: int) -> Dictionary:
	await open_fight()
	await button("R")
	await secs(0.3)
	var hp := opp.health
	var res_before := resolved.size()
	var stamina_before := PlayerStats.stamina
	var n := started.size()
	await button("R")
	await until(func() -> bool: return started.size() > n, 30)
	stamina_before = PlayerStats.stamina
	var spent_check: Strike = started[n] if started.size() > n else null
	await frames(k)
	await tap(&"block", 2)
	await secs(0.6)
	return {
		"feinted": count_ev("feinted"),
		"resolved": resolved.size() - res_before,
		"hp_lost": hp - opp.health,
		"stamina_before": stamina_before,
		"stamina_after": PlayerStats.stamina,
		"kind": spent_check.kind if spent_check != null else &"",
	}


func run() -> void:
	await test_window()
	await test_kick_cannot_feint()
	await test_refund_and_spam()
	await test_refund_is_what_was_paid()
	await test_opponent_bites()


func test_window() -> void:
	for k in [3, 6]:
		var r := await overhand_feint(k)
		check("feint: tapping Shift %.2f s into an overhand pulls it" % ((k + 1) * DT), r["kind"] == Strike.OVERHAND and r["feinted"] == 1, "result %s" % [r])
		check("feint: a feinted punch does no damage and never resolves (k=%d)" % k, r["resolved"] == 0 and r["hp_lost"] < 0.001, "result %s" % [r])
		check_near("feint: the 13 stamina the overhand cost is refunded (k=%d)" % k, r["stamina_after"] - r["stamina_before"], float(CombatController.MOVES[Strike.OVERHAND]["cost"]), 0.3, "result %s" % [r])
	var late := await overhand_feint(10)
	check("feint: tapping Shift %.2f s into the punch (after 0.15 s) is not a feint" % (11 * DT), late["kind"] == Strike.OVERHAND and late["feinted"] == 0, "result %s" % [late])
	check("feint: ... the punch lands as normal", late["resolved"] == 1 and late["hp_lost"] > 1.0, "result %s" % [late])


func test_kick_cannot_feint() -> void:
	await open_fight()
	var hp := opp.health
	await button("K")
	await frames(2)
	await tap(&"block", 2)
	await secs(0.8)
	check("feint: a kick cannot be feinted", count_ev("feinted") == 0 and resolved.size() == 1 and resolved[0].kind == Strike.KICK and opp.health < hp, "feinted=%d resolved=%d" % [count_ev("feinted"), resolved.size()])


func test_refund_and_spam() -> void:
	# Three punches use up the free count; a sloppy fourth costs double and is pulled back for
	# a full refund, which also wipes the count.
	await open_fight()
	await chain("LLL", 0.2)
	await secs(0.32)
	check("feint: after three punches the next one would be sloppy", combat.is_sloppy())
	var before := PlayerStats.stamina
	var n := started.size()
	await button("L")
	await until(func() -> bool: return started.size() > n, 30)
	var after_press := PlayerStats.stamina
	var cost := before - after_press
	check("feint: (setup) the fourth punch (a hook) is sloppy and costs double (16)", started[n].sloppy and started[n].kind == Strike.HOOK and absf(cost - 16.0) < 0.5, "sloppy=%s cost=%.2f" % [started[n].sloppy, cost])
	await frames(2)
	await tap(&"block", 2)
	await frames(2)
	check("feint: the sloppy punch was feinted", count_ev("feinted") == 1)
	check_near("feint: the whole (double) cost comes back", PlayerStats.stamina, before, 0.3)
	check("feint: a feint resets the anti-spam count", not combat.is_sloppy())
	await secs(0.3)
	n = started.size()
	await button("L")
	await secs(0.3)
	check("feint: the punch after a feint is not sloppy", started.size() > n and not started[n].sloppy, "sloppy=%s" % [started[n].sloppy if started.size() > n else "?"])


## A fighter with these numbers reacts to every punch (guard or slip) and either never or
## always sees through the feint.
func reactive_style(guard_read: float, slip_skill: float, feint_read: float) -> FightStyle:
	var style := FightStyle.new()
	style.block_reaction = 0.0
	style.attack_delay = Vector2(9999.0, 9999.0)
	style.move_speed = 1.0
	style.preferred_range = 1.6
	style.guard_read = guard_read
	style.slip_skill = slip_skill
	style.feint_read = feint_read
	style.guard_uptime = 0.0
	style.counter_rate = 0.0
	style.counter_chance = 0.0
	return style


func real_brain_fight(style: FightStyle, d: float) -> void:
	await fresh(4, false, null, 0.0)
	opp.profile.style = style
	opp.profile.adaptive = false
	opp.brain.style = style
	opp.on_style_changed()
	var p := player.global_position
	opp.global_position = Vector3(p.x, opp.global_position.y, p.z - d)
	opp.face(p)
	await frames(2)


func feint_after_start(k: int) -> void:
	var n := started.size()
	await button("L")
	await until(func() -> bool: return started.size() > n, 30)
	await frames(k)
	await tap(&"block", 2)


func test_opponent_bites() -> void:
	# He covers up against the punch and fails to read the feint: stuck for 0.55 s.
	await real_brain_fight(reactive_style(1.0, 0.0, 0.0), 2.5)
	await frames(3)
	var moving_before := opp.velocity.length() > 0.2
	await feint_after_start(3)
	var t_feint := game_time
	check("feint: (setup) he reacted by covering the head", opp.guard_mode == G.HIGH, "guard=%s" % opp.guard_mode)
	var stuck_until := -1.0
	var resumed := -1.0
	for i in 90:
		await frames(1)
		if opp.velocity.length() > 0.2:
			resumed = game_time - t_feint
			break
	check("feint: a fighter who bit stands stuck, then moves again after about 0.55 s", moving_before and resumed > 0.0 and absf(resumed - 0.55) < 0.12, "was moving=%s resumed after %.3f s" % [moving_before, resumed])
	check("feint: the bite is counted as a bait for the player", combat.bout_baits == 1, "baits=%d" % combat.bout_baits)

	# Control: a fighter who sees through the feint carries on at once and drops the cover.
	await real_brain_fight(reactive_style(1.0, 0.0, 1.0), 2.5)
	await frames(3)
	await feint_after_start(3)
	var t0 := game_time
	var moved := false
	for i in 12:
		await frames(1)
		if opp.velocity.length() > 0.2:
			moved = true
			break
	check("feint: control, a fighter who reads the feint keeps moving (not stuck)", moved and combat.bout_baits == 0, "moved=%s baits=%d after %.3f s" % [moved, combat.bout_baits, game_time - t0])

	# He slips the punch and fails to read the feint: the slip is spoiled and he is stuck in it.
	await real_brain_fight(reactive_style(0.0, 1.0, 0.0), 2.0)
	await frames(3)
	await feint_after_start(3)
	await secs(1.5)
	var slip_time := opp_state_duration(EnemyFighter.State.SLIP)
	check("feint: a fighter who slipped the feint is stuck in the slip for about 0.55 s more", slip_time > 0.5 and slip_time < 0.85 and combat.bout_baits == 1, "slip lasted %.3f s baits=%d" % [slip_time, combat.bout_baits])
	await real_brain_fight(reactive_style(0.0, 1.0, 1.0), 2.0)
	await frames(3)
	await feint_after_start(3)
	await secs(1.0)
	var slip_time2 := opp_state_duration(EnemyFighter.State.SLIP)
	check("feint: control, a fighter who reads the feint leaves the slip at once", slip_time2 >= 0.0 and slip_time2 < 0.3 and combat.bout_baits == 0, "slip lasted %.3f s baits=%d" % [slip_time2, combat.bout_baits])
	await real_brain_fight(reactive_style(0.0, 1.0, 0.0), 2.0)
	await frames(3)
	await button("L")
	await secs(1.5)
	var plain_slip := opp_state_duration(EnemyFighter.State.SLIP)
	check("feint: control, an un-feinted punch makes him slip for the normal 0.36 s", absf(plain_slip - EnemyFighter.SLIP_TIME) < 0.07, "slip lasted %.3f s" % plain_slip)


## The refund is what the punch actually cost: a nearly empty tank cannot be topped up by feinting.
func test_refund_is_what_was_paid() -> void:
	await open_fight()
	PlayerStats.stamina = 3.0
	PlayerStats.is_exhausted = false
	PlayerStats.spend_stamina(0.0)
	await frames(1)
	var before := PlayerStats.stamina
	var n := started.size()
	await button("L")
	await until(func() -> bool: return started.size() > n, 30)
	await frames(1)
	var left := PlayerStats.stamina
	await tap(&"block", 2)
	await frames(2)
	check("feint: (setup) a 5-stamina jab thrown with 3 in the tank was feinted", count_ev("feinted") == 1 and left < before, "feinted=%d stamina %.2f -> %.2f" % [count_ev("feinted"), before, left])
	check_near("feint: a feint refunds what the punch cost (3), never more (the nominal 5)", PlayerStats.stamina, before, 0.15, "stamina before %.2f after the feint %.2f" % [before, PlayerStats.stamina])
