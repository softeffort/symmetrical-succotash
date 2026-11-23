extends "res://tests/combat_rules/rules_base.gd"
## Rule group 11: bout flow and robustness (RingManager countdown, FINISH/RESULT, _pay_out,
## rematch / next_fight / exit_ring, back-to-back bouts, simultaneous finishing blows).

const G := EnemyFighter.Guard
const S := EnemyFighter.State
const RS := RingManager.State


func _init() -> void:
	keep_career = true


func open_fight(index: int = 0, d: float = 1.4) -> void:
	await fresh(index, true, null, d)
	opp.set_guard(G.NONE)
	await frames(2)


func throw(key: String) -> Strike:
	var n := resolved.size()
	await button(key)
	await until(func() -> bool: return resolved.size() > n, 120)
	return resolved[n] if resolved.size() > n else null


func to_result(max_frames: int = 900) -> bool:
	return await until(func() -> bool: return ring.state == RS.RESULT, max_frames)


## Wins the current bout by health: the opponent has 1 health left and a jab lands.
func win_by_health() -> void:
	opp.health = 1.0
	await throw("L")
	await to_result()


func lose_by_health() -> void:
	combat.health = 1.0
	opp.start_attack([Strike.JAB])
	await to_result()


func result_rows() -> Dictionary:
	var out := {}
	for row in hud._result_rows.get_children():
		if row.is_queued_for_deletion():
			continue
		var kids := row.get_children()
		out[(kids[0] as Label).text] = (kids[2] as Label).text
	return out


func run() -> void:
	await test_countdown()
	await test_win_by_health_and_result()
	await test_loss_by_health()
	await test_entry_points_guarded()
	await test_payout_formula()
	await test_payout_in_a_bout()
	await test_next_rematch_exit()
	await test_exit_cleanliness()
	await test_back_to_back()
	await test_simultaneous_blows()
	await test_time_scale_restored()
	await test_league_progression()


func test_countdown() -> void:
	PlayerStats.reset_career()
	clear_logs()
	var t0 := game_time
	var texts: Array = []
	ring.start_bout(FighterRoster.ladder()[0])
	opp = ring.opponent
	var last_text := ""
	check("flow: start_bout enters COUNTDOWN", ring.state == RS.COUNTDOWN)
	check("flow: during the countdown the player is locked and cannot move or punch", combat.locked and not player.controls_enabled and combat.in_bout, "locked=%s controls=%s" % [combat.locked, player.controls_enabled])
	check("flow: the opponent waits (IDLE) during the countdown", opp.state == S.IDLE)
	var n := started.size()
	var t_fight := -1.0
	var pressed := false
	for i in 400:
		await frames(1)
		if hud._count.text != last_text and hud._count.modulate.a > 0.0:
			last_text = hud._count.text
			texts.append(last_text)
		if not pressed and i == 30:
			await button("L")
			pressed = true
		if ring.state == RS.FIGHT:
			t_fight = game_time - t0
			break
	check("flow: the countdown reads 3, 2, 1, FIGHT!", texts == ["3", "2", "1", "FIGHT!"], "texts %s" % [texts])
	check_near("flow: FIGHT starts about 2.6 s after the bell for the countdown", t_fight, 2.6, 0.12)
	check("flow: a punch pressed during the countdown does nothing", started.size() == n, "%d punches" % (started.size() - n))
	await frames(2)
	check("flow: at FIGHT the player is free and the opponent is fighting", player.controls_enabled and not combat.locked and opp.state == S.FOOTWORK, "controls=%s locked=%s state=%s" % [player.controls_enabled, combat.locked, opp.state])
	var bt := ring.bout_time
	await secs(1.0)
	check_near("flow: the bout clock runs from FIGHT", ring.bout_time - bt, 1.0, 0.05)


func test_win_by_health_and_result() -> void:
	await open_fight(0)
	PlayerStats.reset_career()
	opp.health = 1.0
	var s := await throw("L")
	check("win: a clean hit on a one-health opponent is a knockout", s != null and s.outcome == Strike.Outcome.KNOCKOUT and opp.state == S.OUT and opp.finish == &"ko" and opp.health <= 0.0, "outcome=%s state=%s finish=%s" % [s.outcome if s != null else -1, opp.state, opp.finish])
	check("win: the ring moves to FINISH and locks the player's strikes", ring.state == RS.FINISH and combat.locked, "ring=%s locked=%s" % [ring.state, combat.locked])
	await frames(3)
	check("win: slow motion finish", Engine.time_scale < 0.9, "time_scale %.2f" % Engine.time_scale)
	await to_result()
	check("win: RESULT is reached and reported as a win", ring.state == RS.RESULT and last_ev("bout_finished") == true and count_ev("bout_finished") == 1, "state=%s finished=%s" % [ring.state, last_ev("bout_finished")])
	check("win: time scale is back to 1.0 on the result screen", Engine.time_scale == 1.0, "%.2f" % Engine.time_scale)
	check("win: result screen is up with VICTORY and the next opponent unlocked", hud._result.visible and hud._result_title.text == "VICTORY" and hud._result_footer.text.contains("Cardio Carl") and hud._next_button.visible, "title '%s' footer '%s' next=%s" % [hud._result_title.text, hud._result_footer.text, hud._next_button.visible])
	check("win: the subtitle names the fighter and the finish", hud._result_subtitle.text == "Knockout over Skinny Sam", "subtitle '%s'" % hud._result_subtitle.text)
	check("win: player controls are off on the result screen", not player.controls_enabled)
	var rows := result_rows()
	check("win: the result rows show the purse and the XP", rows.has("Fight purse") and rows["Fight purse"] == "+$60" and rows.has("Experience") and rows.has("Gym tenure") and rows["Gym tenure"] == "+3 Days" and rows.has("Fight time") and rows.has("Record"), "rows %s" % [rows])
	check("win: the record shows 1 W - 0 L and the ladder advanced", PlayerStats.fight_record.wins == 1 and PlayerStats.ladder_progress == 1, "record %s progress %d" % [PlayerStats.fight_record.to_text(), PlayerStats.ladder_progress])
	check("win: knocking him out by health is not a knockdown (no knockdown bonus)", not rows.has("Knockdowns x1"), "rows %s" % [rows])


func test_loss_by_health() -> void:
	await open_fight(0)
	combat.health = 1.0
	opp.start_attack([Strike.JAB])
	await until(func() -> bool: return count_ev("p_knocked_out") > 0, 200)
	await frames(2)
	check("loss: a clean jab on a one-health player is a knockout", combat.health <= 0.0 and ring.state == RS.FINISH and not player.controls_enabled, "health=%.1f ring=%s controls=%s" % [combat.health, ring.state, player.controls_enabled])
	await secs(0.3)
	check("loss: the opponent celebrates", opp.state == S.VICTORY, "state=%s" % opp.state)
	var cash := PlayerStats.cash
	var days := PlayerStats.gym_tenure
	await to_result()
	check("loss: RESULT is reached as a loss with DEFEAT on screen", ring.state == RS.RESULT and last_ev("bout_finished") == false and hud._result_title.text == "DEFEAT" and hud._result_subtitle.text == "Knocked out by Skinny Sam", "title '%s' subtitle '%s'" % [hud._result_title.text, hud._result_subtitle.text])
	var rows := result_rows()
	var xp_row: String = rows.get("Consolation experience", "")
	check("loss: pays 15%% of the XP (Sam 110 -> +17 XP, at least 10)", xp_row == "+%d XP" % roundi(110.0 * RingManager.CONSOLATION), "rows %s" % [rows])
	check("loss: no purse and one day of tenure", PlayerStats.cash == cash and rows.get("Gym tenure", "") == "+1 Days" and not rows.has("Fight purse"), "cash %d->%d rows %s" % [cash, PlayerStats.cash, rows])
	check("loss: the record shows the loss and the streak is broken", PlayerStats.fight_record.losses == 1 and PlayerStats.fight_record.win_streak == 0)
	check("loss: no Next Fight button after a loss", not hud._next_button.visible)


func test_entry_points_guarded() -> void:
	await open_fight(0)
	var before_opp := opp
	ring.rematch()
	ring.next_fight()
	ring.exit_ring()
	await frames(3)
	check("flow: rematch / next_fight / exit_ring do nothing in the middle of a bout", ring.state == RS.FIGHT and ring.opponent == before_opp and combat.in_bout, "ring=%s" % ring.state)


func test_payout_formula() -> void:
	await open_fight(0)
	await win_by_health()
	var profile: FighterProfile = ring.profile
	var purse := profile.cash
	# [streak before, flawless, counters, intercepts, rematch, label]
	var cases := [
		[0, false, 0, 0, false, "plain first win"],
		[0, true, 0, 0, false, "flawless"],
		[1, false, 0, 0, false, "second win in a row (+10%)"],
		[3, false, 0, 0, false, "fourth win in a row (+30%)"],
		[9, false, 0, 0, false, "tenth win in a row (capped at +50%)"],
		[0, false, 2, 0, false, "two perfect counters (+5% each)"],
		[0, false, 0, 3, false, "three intercept counters (+5% each)"],
		[2, true, 1, 2, false, "everything at once"],
		[0, false, 0, 0, true, "rematch pays half"],
		[2, true, 1, 1, true, "rematch with bonuses (half purse, bonuses on the halved purse)"],
	]
	for c: Array in cases:
		PlayerStats.fight_record = FightRecord.new()
		PlayerStats.fight_record.win_streak = c[0]
		PlayerStats.ladder_progress = 1 if c[4] else 0
		combat.bout_damage_taken = 0.0 if c[1] else 25.0
		combat.bout_counters = c[2]
		combat.bout_intercepts = c[3]
		var cash := PlayerStats.cash
		var summary: Dictionary = ring._pay_out(true)
		var share := 0.5 if c[4] else 1.0
		var base := roundi(purse * share)
		var expected := base
		if c[0] > 0:
			expected += roundi(base * minf(0.1 * c[0], 0.5))
		if c[1]:
			expected += roundi(base * 0.25)
		expected += roundi(base * 0.05) * c[2]
		expected += roundi(base * 0.05) * c[3]
		var got := PlayerStats.cash - cash
		var has_knockdown_row := false
		for r: Array in summary["rows"]:
			if str(r[0]).begins_with("Knockdowns"):
				has_knockdown_row = true
		# This synthetic bout has the one real knockdown-free KO behind it: the knockdown row is a bug if it appears.
		check("payout: %s pays $%d" % [c[5], expected], got == expected and not has_knockdown_row, "paid $%d, expected $%d, knockdown row=%s" % [got, expected, has_knockdown_row])
	# XP: full, half on a rematch, 15% on a loss.
	PlayerStats.fight_record = FightRecord.new()
	PlayerStats.ladder_progress = 0
	var rows: Array = ring._pay_out(true)["rows"]
	var xp_win := ""
	for r: Array in rows:
		if r[0] == "Experience":
			xp_win = r[1]
	check("payout: a first win pays the full XP (Sam 110)", xp_win == "+110 XP", "row '%s'" % xp_win)
	PlayerStats.ladder_progress = 1
	rows = ring._pay_out(true)["rows"]
	xp_win = ""
	var purse_row := ""
	for r: Array in rows:
		if r[0] == "Experience":
			xp_win = r[1]
		if str(r[0]).begins_with("Fight purse"):
			purse_row = str(r[0])
	check("payout: a rematch pays half the XP and is labelled (rematch)", xp_win == "+55 XP" and purse_row.contains("rematch"), "xp '%s' purse '%s'" % [xp_win, purse_row])
	var loss: Dictionary = ring._pay_out(false)
	var loss_xp := ""
	for r: Array in loss["rows"]:
		if r[0] == "Consolation experience":
			loss_xp = r[1]
	check("payout: a loss pays 15% of the XP", loss_xp == "+17 XP" and loss["title"] == "DEFEAT", "row '%s' title '%s'" % [loss_xp, loss["title"]])
	check("payout: the win/loss tenure is 3 days for a win and 1 for a loss", PlayerStats.WIN_TENURE_DAYS == 3.0 and PlayerStats.LOSS_TENURE_DAYS == 1.0)


## A bout won with two knockdowns pays 10% of the purse for each; a plain knockout pays none.
func test_payout_in_a_bout() -> void:
	PlayerStats.reset_career()
	await open_fight(1)
	var purse: int = ring.profile.cash
	opp.chin.reset(20.0)
	opp.set_guard(G.NONE)
	await chain("RR", 0.25)
	await until(func() -> bool: return opp.state == S.ROCKED, 60)
	await secs(0.1)
	await throw("R")
	await secs(2.8)
	opp.set_guard(G.NONE)
	await chain("RR", 0.25)
	await until(func() -> bool: return opp.state == S.ROCKED, 60)
	await secs(0.1)
	await throw("R")
	await to_result()
	var rows := result_rows()
	check("payout: a win by two knockdowns shows 'Knockdowns x2' worth 20%% of the purse", rows.get("Knockdowns x2", "") == "+" + PlayerStats.format_cash(roundi(purse * 0.1) * 2), "rows %s" % [rows])
	check("payout: ... and the Intercept/Perfect rows are absent when there were none", not rows.has("Intercept counters x1"))
	# Flawless: nothing landed on the player.
	PlayerStats.reset_career()
	await open_fight(0)
	await win_by_health()
	rows = result_rows()
	check("payout: a win without taking damage is a Flawless victory (+25%)", rows.get("Flawless victory", "") == "+" + PlayerStats.format_cash(roundi(60 * 0.25)), "rows %s" % [rows])
	# Intercept counter shows up on the result.
	PlayerStats.reset_career()
	await open_fight(0)
	opp.start_attack([Strike.CROSS])
	await secs(0.2)
	await throw("L")
	check("payout: (setup) an intercept landed", combat.bout_intercepts == 1)
	opp.health = 1.0
	opp.set_guard(G.NONE)
	await secs(0.5)
	await throw("L")
	await to_result()
	rows = result_rows()
	check("payout: an intercept counter pays 5%% of the purse", rows.get("Intercept counters x1", "") == "+" + PlayerStats.format_cash(roundi(60 * 0.05)), "rows %s" % [rows])


func test_next_rematch_exit() -> void:
	PlayerStats.reset_career()
	await open_fight(0)
	await win_by_health()
	var old := opp
	# Rematch.
	Engine.time_scale = 1.0
	combat.time_fx.slow_motion(5.0, 0.3)
	ring.rematch()
	check("flow: rematch() from RESULT starts a new COUNTDOWN against the same fighter", ring.state == RS.COUNTDOWN and ring.profile.fighter_name == "Skinny Sam" and ring.opponent != old, "state=%s" % ring.state)
	await frames(2)
	check("flow: rematch is a fresh bout: full health, no knockdowns, result screen hidden", combat.health == combat.max_health and combat.knockdowns == 0 and not hud._result.visible and combat.chin.stagger == 0.0 and ring.opponent.health == ring.profile.max_health, "health %.1f/%.1f" % [combat.health, combat.max_health])
	var back := -1
	for i in 120:
		await frames(1)
		if Engine.time_scale == 1.0:
			back = i
			break
	check("flow: rematch clears a lingering slow motion within a second", back >= 0 and back < 60, "time_scale %.2f after %d ticks" % [Engine.time_scale, back])
	check("flow: the old opponent is freed", not is_instance_valid(old))
	await until(func() -> bool: return ring.state == RS.FIGHT, 400)
	opp = ring.opponent
	make_passive()
	opp.set_guard(G.NONE)
	engage(1.4)
	await win_by_health()
	var rows := result_rows()
	check("flow: a rematch win pays half the purse and the label says so", rows.has("Fight purse  (rematch)") and rows["Fight purse  (rematch)"] == "+$30", "rows %s" % [rows])
	# Next fight: Carl is unlocked.
	old = opp
	combat.time_fx.slow_motion(5.0, 0.3)
	ring.next_fight()
	check("flow: next_fight() starts the next ladder fighter", ring.state == RS.COUNTDOWN and ring.profile.fighter_name == "Cardio Carl", "state=%s profile=%s" % [ring.state, ring.profile.fighter_name if ring.profile != null else "?"])
	back = -1
	for i in 120:
		await frames(1)
		if Engine.time_scale == 1.0:
			back = i
			break
	check("flow: next_fight clears a lingering slow motion within a second", back >= 0 and back < 60, "time_scale %.2f after %d ticks" % [Engine.time_scale, back])
	check("flow: the previous opponent is freed", not is_instance_valid(old))
	await until(func() -> bool: return ring.state == RS.FIGHT, 400)
	opp = ring.opponent
	make_passive()
	engage(1.4)
	check("flow: the new fighter has Carl's health and style", opp.health == 350.0 and opp.profile.fighter_name == "Cardio Carl" and hud._opponent_name.text == "CARDIO CARL", "health %.0f" % opp.health)


func test_exit_cleanliness() -> void:
	PlayerStats.reset_career()
	await open_fight(0)
	await win_by_health()
	PlayerStats.stamina = 5.0
	combat.chin.take(9999.0, false)
	check("exit: (setup) the player is rocked on the result screen", combat.is_rocked())
	var old := opp
	combat.time_fx.slow_motion(5.0, 0.3)
	ring.exit_ring()
	await frames(2)
	check("exit: exit_ring() returns the ring to IDLE and frees the opponent", ring.state == RS.IDLE and ring.opponent == null, "state=%s" % ring.state)
	var back := -1
	for i in 120:
		await frames(1)
		if Engine.time_scale == 1.0:
			back = i
			break
	check("exit: time scale is back to 1.0 within a second", back >= 0 and back < 60, "time_scale %.2f after %d ticks" % [Engine.time_scale, back])
	check("exit: the old opponent is freed", not is_instance_valid(old))
	check("exit: player controls are enabled again", player.controls_enabled)
	check("exit: the player is rested", PlayerStats.stamina == PlayerStats.max_stamina)
	check("exit: no leftover clinch, rocked, knockdown or stun", combat.clinch == null and not combat.is_rocked() and not combat.is_down() and combat._stun <= 0.0 and not combat.blocking and not combat.in_bout and not combat.locked, "clinch=%s rocked=%s down=%s stun=%.2f blocking=%s in_bout=%s locked=%s" % [combat.clinch, combat.is_rocked(), combat.is_down(), combat._stun, combat.blocking, combat.in_bout, combat.locked])
	check("exit: the knockdown count and bout totals are cleared", combat.knockdowns == 0, "knockdowns=%d" % combat.knockdowns)
	check("exit: the result screen and both panels are closed", not hud._result.visible and not hud._opponent_panel.visible and not hud._player_panel.visible and not hud._clock.visible and not hud._clinch_box.visible)
	check("exit: the view is back on its feet (no wobble or drop)", combat.view_wobble < 0.05 and combat.view_drop < 0.05, "wobble %.2f drop %.2f" % [combat.view_wobble, combat.view_drop])
	# Leaving after a two-knockdown loss (the player is down for good).
	await open_fight(0)
	combat.chin.reset(20.0)
	for rnd in 2:
		combat.health = combat.max_health
		combat.chin.reset(20.0)
		opp.start_attack([Strike.CROSS, Strike.OVERHAND, Strike.CROSS])
		await until(func() -> bool: return combat.is_down() or combat.knockdowns >= 2, 400)
		if rnd == 0:
			await secs(3.5)
	await to_result()
	check("exit: (setup) lost on two knockdowns, the player is down on the result screen", ring.state == RS.RESULT and combat.is_down() and combat.knockdowns == 2, "state=%s down=%s kd=%d" % [ring.state, combat.is_down(), combat.knockdowns])
	ring.exit_ring()
	await secs(1.6)
	check("exit: leaving while down: standing, no drop, free controls", not combat.is_down() and combat.view_drop < 0.05 and player.controls_enabled, "down=%s drop=%.2f controls=%s" % [combat.is_down(), combat.view_drop, player.controls_enabled])
	check("exit: leaving after a two-knockdown stoppage clears the knockdown count", combat.knockdowns == 0, "knockdowns=%d is still set after exit_ring (only the next begin_bout resets it)" % combat.knockdowns)


func snapshot() -> Dictionary:
	return {
		"conn_started": combat.strike_started.get_connections().size(),
		"conn_feinted": combat.feinted.get_connections().size(),
		"conn_dodged": combat.dodged.get_connections().size(),
		"conn_resolved": combat.strike_resolved.get_connections().size(),
		"nodes": int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		"orphans": int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)),
		"time_scale": Engine.time_scale,
	}


func test_back_to_back() -> void:
	PlayerStats.reset_career()
	var snaps: Array = []
	# Bout 1: win by health.
	await open_fight(0)
	await win_by_health()
	await secs(3.0)
	snaps.append(snapshot())
	# Bout 2: rematch, lose by health.
	ring.rematch()
	await until(func() -> bool: return ring.state == RS.FIGHT, 400)
	opp = ring.opponent
	make_passive()
	engage(1.4)
	var fresh_ok: bool = combat.health == combat.max_health and combat.knockdowns == 0 and combat.hit_streak == 0 and combat.bout_hits == 0 and combat.bout_damage_taken == 0.0 and combat.bout_counters == 0 and combat.bout_intercepts == 0 and combat.clinch == null and not combat.blocking and combat.chin.stagger == 0.0
	check("back-to-back: bout 2 starts clean (health, streak, totals, chin, no clinch)", fresh_ok, "health %.1f/%.1f kd=%d streak=%d hits=%d taken=%.1f" % [combat.health, combat.max_health, combat.knockdowns, combat.hit_streak, combat.bout_hits, combat.bout_damage_taken])
	await lose_by_health()
	await secs(3.0)
	check("back-to-back: bout 2 ended as a loss", last_ev("bout_finished") == false and count_ev("bout_finished") == 2, "events %d last %s" % [count_ev("bout_finished"), last_ev("bout_finished")])
	snaps.append(snapshot())
	# Bout 3: rematch, win with a real combination.
	ring.rematch()
	await until(func() -> bool: return ring.state == RS.FIGHT, 400)
	opp = ring.opponent
	make_passive()
	opp.set_guard(G.NONE)
	engage(1.4)
	await chain("LR", 0.25)
	await secs(0.5)
	opp.health = 1.0
	await throw("L")
	await to_result()
	await secs(3.0)
	snaps.append(snapshot())
	check("back-to-back: bout 3 ended as a win and three results were reported", last_ev("bout_finished") == true and count_ev("bout_finished") == 3, "events %d" % count_ev("bout_finished"))
	var leak := ""
	for key: String in ["conn_started", "conn_feinted", "conn_dodged", "conn_resolved"]:
		if snaps[0][key] != snaps[2][key] or snaps[0][key] != snaps[1][key]:
			leak += " %s %s" % [key, [snaps[0][key], snaps[1][key], snaps[2][key]]]
	check("back-to-back: no signal connections pile up on the player between bouts", leak == "", leak)
	check("back-to-back: node count does not grow bout after bout (%s)" % [snaps.map(func(s: Dictionary) -> int: return s["nodes"])], absi(snaps[2]["nodes"] - snaps[0]["nodes"]) <= 12, "%s" % [snaps])
	check("back-to-back: no orphan nodes accumulate", snaps[2]["orphans"] <= snaps[0]["orphans"] + 2, "orphans %s" % [snaps.map(func(s: Dictionary) -> int: return s["orphans"])])
	check("back-to-back: time scale is 1.0 at every result screen", snaps.all(func(s: Dictionary) -> bool: return s["time_scale"] == 1.0), "%s" % [snaps.map(func(s: Dictionary) -> float: return s["time_scale"])])
	check("back-to-back: the record counts 2 wins and 1 loss", PlayerStats.fight_record.wins == 2 and PlayerStats.fight_record.losses == 1, "record %s" % PlayerStats.fight_record.to_text())
	ring.exit_ring()
	await frames(2)


## Both fighters take a fight-ending blow on the same physics tick, in either order.
func test_simultaneous_blows() -> void:
	for first_is_player: bool in [true, false]:
		PlayerStats.reset_career()
		await open_fight(4)
		combat.health = 1.0
		opp.health = 1.0
		var blow_on_opp := Strike.new()
		blow_on_opp.kind = Strike.CROSS
		blow_on_opp.zone = Strike.Zone.HEAD
		blow_on_opp.damage = 999.0
		blow_on_opp.attacker = player
		blow_on_opp.direction = Vector3(0, 0, -1)
		var blow_on_player := Strike.new()
		blow_on_player.kind = Strike.CROSS
		blow_on_player.zone = Strike.Zone.HEAD
		blow_on_player.damage = 999.0
		blow_on_player.attacker = opp
		blow_on_player.direction = Vector3(0, 0, 1)
		if first_is_player:
			opp.hurtbox.receive(blow_on_opp)
			combat.receive_strike(blow_on_player, true)
		else:
			combat.receive_strike(blow_on_player, true)
			opp.hurtbox.receive(blow_on_opp)
		await frames(2)
		var label := "player's blow first" if first_is_player else "opponent's blow first"
		check("simultaneous (%s): the first blow decides: the other fighter ends out or ignored, the ring is finishing" % label, (opp.state == S.OUT if first_is_player else opp.state == S.VICTORY) and combat.is_down() and combat.health <= 0.0 and ring.state == RS.FINISH, "opp=%s player_down=%s health=%.1f ring=%s" % [opp.state, combat.is_down(), combat.health, ring.state])
		var got := await to_result(900)
		check("simultaneous (%s): the ring does not get stuck, it reaches RESULT" % label, got and ring.state == RS.RESULT, "ring state %s" % ring.state)
		check("simultaneous (%s): exactly one result is reported (%s)" % [label, "win" if first_is_player else "loss"], count_ev("bout_finished") == 1 and last_ev("bout_finished") == first_is_player, "events %d last %s" % [count_ev("bout_finished"), last_ev("bout_finished")])
		check("simultaneous (%s): the opponent is not left celebrating over a fallen fighter or stuck mid-hold" % label, opp.state == S.OUT or opp.state == S.VICTORY, "state=%s" % opp.state)
		ring.rematch()
		var ok := await until(func() -> bool: return ring.state == RS.FIGHT, 400)
		check("simultaneous (%s): a rematch afterwards works" % label, ok and combat.health == combat.max_health and not combat.is_down(), "state %s health %.1f down=%s" % [ring.state, combat.health, combat.is_down()])


func test_time_scale_restored() -> void:
	# A perfect-dodge slow motion, then a rematch straight away.
	PlayerStats.reset_career()
	await open_fight(0)
	combat.time_fx.slow_motion(5.0, 0.3)
	await frames(3)
	check("time: (setup) slow motion is running", Engine.time_scale < 0.5, "%.2f" % Engine.time_scale)
	combat.time_fx.hit_stop(0.05)
	await win_by_health()
	check("time: slow motion and hit-stop never outlive the bout (1.0 on RESULT)", Engine.time_scale == 1.0, "%.3f" % Engine.time_scale)
	ring.exit_ring()
	await secs(1.0)
	check("time: and stays 1.0 after leaving", Engine.time_scale == 1.0, "%.3f" % Engine.time_scale)


## Beating the Champ opens the Endless League; its challengers start at level 16.
func test_league_progression() -> void:
	PlayerStats.reset_career()
	PlayerStats.ladder_progress = 4
	await open_fight(4)
	await win_by_health()
	check("league: beating the Champ unlocks the Endless Championship League", PlayerStats.ladder_progress == 5 and FighterRoster.is_league_open() and hud._result_footer.text.contains("ENDLESS CHAMPIONSHIP LEAGUE UNLOCKED") and hud._next_button.visible, "progress %d footer '%s' next=%s" % [PlayerStats.ladder_progress, hud._result_footer.text, hud._next_button.visible])
	ring.next_fight()
	var challenger := FighterRoster.league_challenger(16)
	check("league: Next Fight after the Champ is the level-16 challenger", ring.profile.is_league() and ring.profile.level == 16 and ring.profile.fighter_name == challenger.fighter_name and ring.opponent.health == 714.0, "profile %s Lvl %d health %.0f" % [ring.profile.fighter_name, ring.profile.level, ring.opponent.health])
	await until(func() -> bool: return ring.state == RS.FIGHT, 400)
	opp = ring.opponent
	make_passive()
	opp.set_guard(G.NONE)
	engage(1.4)
	await win_by_health()
	check("league: a league win moves the ladder on to level 17 and counts a league win", PlayerStats.league_wins == 1 and hud._result_footer.text == "Next challenger: Lvl 17", "wins %d footer '%s'" % [PlayerStats.league_wins, hud._result_footer.text])
	ring.next_fight()
	check("league: ... and the next fight is level 17 at 728 health", ring.profile.level == 17 and ring.opponent.health == 728.0, "Lvl %d health %.0f" % [ring.profile.level, ring.opponent.health])
	ring.exit_ring()
