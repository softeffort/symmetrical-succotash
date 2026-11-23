extends "res://tests/combat_rules/rules_base.gd"
## Rule group 8: the clinch (EnemyFighter REACH_TIME 0.5, CLINCH_KNEES 3, KNEE_PERIOD 0.9,
## KNEE_WINDUP 0.45; CombatController CLINCH_MASH 0.14, CLINCH_TIMED 0.5, CLINCH_DECAY 0.2).

const G := EnemyFighter.Guard
const S := EnemyFighter.State


func clinch_fight(d: float = 1.1) -> void:
	await fresh(4, true, null, 0.0)
	opp.set_guard(G.NONE)
	var p := player.global_position
	opp.global_position = Vector3(p.x, opp.global_position.y, p.z - d)
	opp.face(p)
	await frames(2)


func grab() -> void:
	opp.start_clinch()
	await until(func() -> bool: return combat.clinch != null, 120)
	await frames(1)


func knees() -> Array:
	var out := []
	for e: Dictionary in events:
		if e["n"] == "damage_taken":
			out.append(e)
	return out


func run() -> void:
	await test_full_clinch()
	await test_mash_and_timed()
	await test_break_out()
	await test_slip_the_grab()
	await test_release_on_knockdown()
	await test_release_on_bout_end()


func test_full_clinch() -> void:
	await clinch_fight()
	opp.start_clinch()
	check("clinch: GRAB cue shows over the head", opp.telegraph.visible and opp.telegraph.text == "GRAB", "cue '%s' visible=%s" % [opp.telegraph.text, opp.telegraph.visible])
	await until(func() -> bool: return combat.clinch != null, 120)
	var t_clinch := game_time
	check("clinch: a grab from close range holds the player", combat.clinch == opp and opp.state == S.CLINCH and count_ev("clinch_changed") == 1 and last_ev("clinch_changed") == true, "clinch=%s state=%s" % [combat.clinch, opp.state])
	check_near("clinch: the reach takes about 0.5 s", t_clinch - opp_entered(S.REACH), EnemyFighter.REACH_TIME, 0.06)
	check("clinch: CLINCHED! is shouted", callouts.has("CLINCHED!"))
	check_near("clinch: the player cannot walk while held", combat.get_move_factor(), 0.0, 0.0001)
	# Everything but the break does nothing while held, even with the guard held down.
	act(&"block", true)
	var n := started.size()
	var pos := player.global_position
	act(&"move_forward", true)
	for key in [&"strike_left", &"strike_right", &"kick", &"dodge"]:
		await tap(key, 2)
		await secs(0.1)
	await frames(2)
	act(&"move_forward", false)
	check("clinch: no punch, kick or slip works while held", started.size() == n and count_ev("dodged") == 0, "strikes +%d dodged %d" % [started.size() - n, count_ev("dodged")])
	check("clinch: the guard cannot be raised while held", not combat.blocking)
	check("clinch: the player does not walk while held", player.global_position.distance_to(pos) < 0.2, "moved %.2f m" % player.global_position.distance_to(pos))
	# Wait it out: three knees, then he lets go. Space/F were not "break" presses except dodge->none.
	await until(func() -> bool: return combat.clinch == null, 400)
	var t_end := game_time
	var hits := knees()
	check("clinch: exactly three knees land", hits.size() == 3, "%d damage events" % hits.size())
	var unblocked := true
	var dmg_ok := true
	var expected: float = opp.profile.damage * float(EnemyFighter.MOVES[Strike.KNEE]["power"])
	for e: Dictionary in hits:
		if e["v"][1]:
			unblocked = false
		if e["v"][0] < expected * 0.93 or e["v"][0] > expected * 1.07:
			dmg_ok = false
	check("clinch: knees cannot be blocked, even with the guard held (full damage %.1f each)" % expected, unblocked and dmg_ok, "events %s" % [hits.map(func(e: Dictionary) -> Array: return e["v"])])
	if hits.size() == 3:
		check_near("clinch: first knee comes 0.9 s after the grab", hits[0]["t"] - t_clinch, EnemyFighter.KNEE_PERIOD, 0.1)
		check_near("clinch: knees are 0.9 s apart", hits[2]["t"] - hits[1]["t"], EnemyFighter.KNEE_PERIOD, 0.1)
		check_near("clinch: he lets go 0.35 s after the third knee", t_end - hits[2]["t"], 0.35, 0.1)
	check("clinch: after the third knee he lets go and is free again", combat.clinch == null and count_ev("clinch_changed") == 2 and last_ev("clinch_changed") == false, "clinch=%s" % combat.clinch)
	await secs(0.3)
	check("clinch: ... the opponent is back in neutral", opp.state == S.FOOTWORK, "state=%s" % opp.state)
	check("clinch: ... and no punch pressed while held fired afterwards", started.size() == n, "strikes +%d" % (started.size() - n))
	release_all()


func test_mash_and_timed() -> void:
	await clinch_fight()
	await grab()
	await secs(0.1)
	check_near("clinch: the break bar starts empty", combat.clinch_progress, 0.0, 0.001)
	check("clinch: (setup) the window is closed early in the hold", not combat.is_clinch_window())
	await tap(&"clinch_break", 2)
	check_near("clinch: one mashed press adds 14% to the break bar", combat.clinch_progress, CombatController.CLINCH_MASH, 0.015)
	var after_press := combat.clinch_progress
	await secs(0.3)
	check_near("clinch: the bar decays by 20% a second", combat.clinch_progress, after_press - CombatController.CLINCH_DECAY * 0.3, 0.02)
	# Timed press: while the knee comes up.
	await until(func() -> bool: return combat.is_clinch_window(), 120)
	var before := combat.clinch_progress
	await tap(&"clinch_break", 2)
	check_near("clinch: a press as the knee comes up adds half the bar", combat.clinch_progress - before, CombatController.CLINCH_TIMED, 0.02)
	check("clinch: ... and TIMED! is shouted", callouts.has("TIMED!"))
	before = combat.clinch_progress
	await tap(&"clinch_break", 2)
	check_near("clinch: a second press in the same window is only a mash (14%)", combat.clinch_progress - before, CombatController.CLINCH_MASH, 0.02)
	# The window closes when the knee lands and opens again for the next one.
	await until(func() -> bool: return knees().size() >= 1, 120)
	await secs(0.1)
	check("clinch: the window is shut right after a knee", not combat.is_clinch_window())
	await until(func() -> bool: return combat.is_clinch_window(), 120)
	before = combat.clinch_progress
	await tap(&"clinch_break", 2)
	if before + CombatController.CLINCH_TIMED >= 1.0:
		check("clinch: the next window gives another timed press (+50%% breaks it from %.2f)" % before, combat.clinch == null and callouts.has("CLINCH BROKEN!"), "clinch=%s progress=%.2f" % [combat.clinch, combat.clinch_progress])
	else:
		check_near("clinch: the next window gives another timed press (+50%)", combat.clinch_progress - before, CombatController.CLINCH_TIMED, 0.03)


func test_break_out() -> void:
	# Mashing alone tears the grip open before the first knee.
	await clinch_fight()
	await grab()
	var start := opp.global_position
	for i in 12:
		await tap(&"clinch_break", 1)
		await frames(1)
		if combat.clinch == null:
			break
	check("clinch: mashing Space/F breaks the grip", combat.clinch == null and callouts.has("CLINCH BROKEN!") and knees().is_empty(), "clinch=%s knees=%d" % [combat.clinch, knees().size()])
	await frames(2)
	check("clinch: breaking out staggers the opponent", opp.state == S.STAGGER, "state=%s" % opp.state)
	await secs(1.0)
	check_near("clinch: ... for about 0.8 s", opp_state_duration(S.STAGGER), 0.8, 0.08)
	check("clinch: ... and shoves him back", opp.global_position.distance_to(start) > 0.3 or (opp.global_position - player.global_position).length() > 1.4, "moved %.2f m, now %.2f m away" % [opp.global_position.distance_to(start), (opp.global_position - player.global_position).length()])
	# One timed press plus a few mashes also does it.
	await clinch_fight()
	await grab()
	await until(func() -> bool: return combat.is_clinch_window(), 120)
	await tap(&"clinch_break", 1)
	for i in 6:
		await frames(1)
		await tap(&"clinch_break", 1)
		if combat.clinch == null:
			break
	check("clinch: one timed press and a few mashes break the grip", combat.clinch == null and knees().size() <= 1, "clinch=%s" % combat.clinch)
	release_all()


func test_slip_the_grab() -> void:
	await clinch_fight()
	opp.start_clinch()
	await secs(0.3)
	act(&"move_right", true)
	act(&"dodge", true)
	await frames(3)
	act(&"dodge", false)
	act(&"move_right", false)
	await secs(0.6)
	check("clinch: slipping the grab makes it miss", combat.clinch == null and count_ev("clinch_changed") == 0, "clinch=%s changes=%d" % [combat.clinch, count_ev("clinch_changed")])
	check("clinch: ... and he stumbles (STAGGER) after it", opp_entered(S.STAGGER) > 0.0, "states %s" % [opp_states.map(func(x: Array) -> int: return x[1])])
	await secs(1.0)
	check_near("clinch: the stumble lasts 0.7 s", opp_state_duration(S.STAGGER), 0.7, 0.08)
	# Control: a slip long before the grab arrives does not save the player.
	await clinch_fight()
	opp.start_clinch()
	await secs(0.02)
	act(&"move_right", true)
	act(&"dodge", true)
	await frames(3)
	act(&"dodge", false)
	act(&"move_right", false)
	await secs(0.7)
	check("clinch: control, a slip more than 0.32 s before the grab closes does not stop it", combat.clinch != null or count_ev("clinch_changed") > 0, "clinch=%s" % combat.clinch)


func test_release_on_knockdown() -> void:
	await clinch_fight()
	combat.chin.reset(5.0)
	await grab()
	await until(func() -> bool: return combat.is_down(), 400)
	await frames(2)
	check("clinch: a knockdown in the clinch releases it cleanly", combat.is_down() and combat.clinch == null and count_ev("clinch_changed") == 2 and last_ev("clinch_changed") == false, "down=%s clinch=%s changes=%d" % [combat.is_down(), combat.clinch, count_ev("clinch_changed")])
	check("clinch: ... the HUD bar goes away", not hud._clinch_box.visible)
	await secs(0.4)
	check("clinch: ... and the opponent is free (no third knee, not stuck in the hold)", opp.state != S.CLINCH and knees().size() == 2, "state=%s knees=%d" % [opp.state, knees().size()])
	await secs(2.8)
	check("clinch: the player gets up and the bout goes on", not combat.is_down() and ring.state == RingManager.State.FIGHT)


func test_release_on_bout_end() -> void:
	await clinch_fight()
	combat.health = 1.0
	await grab()
	await until(func() -> bool: return count_ev("p_knocked_out") > 0, 400)
	await frames(2)
	check("clinch: a knockout in the clinch releases it cleanly", combat.clinch == null and count_ev("clinch_changed") == 2 and ring.state == RingManager.State.FINISH, "clinch=%s changes=%d ring=%s" % [combat.clinch, count_ev("clinch_changed"), ring.state])
	check("clinch: ... the HUD bar is hidden", not hud._clinch_box.visible)
	await secs(0.5)
	check("clinch: ... the opponent celebrates instead of holding on", opp.state == S.VICTORY, "state=%s" % opp.state)
	await until(func() -> bool: return ring.state == RingManager.State.RESULT, 500)
	check("clinch: ... and the bout reaches RESULT", ring.state == RingManager.State.RESULT and last_ev("bout_finished") == false)
	# The opponent knocked out while holding the player (a blow delivered to his hurtbox).
	await clinch_fight()
	await grab()
	var k := Strike.new()
	k.kind = Strike.CROSS
	k.zone = Strike.Zone.HEAD
	k.damage = 99999.0
	k.attacker = player
	k.direction = Vector3(0, 0, 1)
	opp.hurtbox.receive(k)
	await frames(3)
	check("clinch: if he is knocked out while holding on, the player is released", opp.state == S.OUT and combat.clinch == null and count_ev("clinch_changed") == 2, "state=%s clinch=%s changes=%d" % [opp.state, combat.clinch, count_ev("clinch_changed")])
	await until(func() -> bool: return ring.state == RingManager.State.RESULT, 700)
	check("clinch: ... and that bout reaches RESULT as a win", ring.state == RingManager.State.RESULT and last_ev("bout_finished") == true)
