extends "res://tests/combat_rules/rules_base.gd"
## Rule group 12: the fight HUD. Chin gauges, knockdown dots, the opponent's guard label,
## bout clock, callouts, clinch bar, status line and result lines exist, show when they should
## and carry the values of the model.

const G := EnemyFighter.Guard
const S := EnemyFighter.State


func open_fight(index: int = 4, d: float = 1.4) -> void:
	await fresh(index, true, null, d)
	opp.set_guard(G.NONE)
	await frames(2)


func throw(key: String) -> Strike:
	var n := resolved.size()
	await button(key)
	await until(func() -> bool: return resolved.size() > n, 120)
	return resolved[n] if resolved.size() > n else null


func dot_colors(dots: Array) -> Array:
	var out := []
	for d: Panel in dots:
		out.append((d.get_theme_stylebox(&"panel") as StyleBoxFlat).bg_color)
	return out


func lit(dots: Array) -> int:
	var n := 0
	for c: Color in dot_colors(dots):
		if c == UiKit.BAD:
			n += 1
	return n


func run() -> void:
	test_hidden_before_bout()
	await test_layout_at_start()
	await test_guard_label()
	await test_bars_follow_model()
	await test_clock()
	await test_counter_banner_fades()
	await test_player_side()
	await test_dots_and_chin()
	await test_clinch_bar()
	await test_status_line()
	await test_result_lines()


func test_hidden_before_bout() -> void:
	check("hud: before any bout the fight panels, clock, clinch bar and result are hidden", not hud._opponent_panel.visible and not hud._player_panel.visible and not hud._clock.visible and not hud._clinch_box.visible and not hud._result.visible)
	check("hud: the chin gauges, knockdown dots, guard label, clock, callout, clinch bar and result nodes exist", hud._opponent_chin != null and hud._player_chin != null and hud._opponent_dots.size() == 2 and hud._player_dots.size() == 2 and hud._opponent_guard_caption != null and hud._clock != null and hud._callout != null and hud._clinch_bar != null and hud._result_rows != null)


func test_layout_at_start() -> void:
	await open_fight(4)
	var p: FighterProfile = ring.profile
	check("hud: both panels and the clock are visible in a bout", hud._opponent_panel.visible and hud._player_panel.visible and hud._clock.visible)
	check("hud: the clinch bar and result screen are hidden at the start of a bout", not hud._clinch_box.visible and not hud._result.visible)
	check("hud: the opponent panel names him, his style and his tag", hud._opponent_name.text == p.fighter_name.to_upper() and hud._opponent_style.text == "THE PRO" and hud._opponent_tag.text == p.get_tag(), "'%s' '%s' '%s'" % [hud._opponent_name.text, hud._opponent_style.text, hud._opponent_tag.text])
	check_near("hud: opponent health bar maximum is his health", hud._opponent_health.max_value, p.max_health, 0.01)
	check_near("hud: opponent health bar is full", hud._opponent_health.value, opp.health, 0.01)
	check_near("hud: opponent guard meter bar matches the meter", hud._opponent_guard.value, opp.guard, 0.01)
	check_near("hud: player health bar is full and matches", hud._player_health.value, combat.health, 0.01)
	check("hud: player health text reads 'current / maximum'", hud._player_health_text.text == "%d / %d" % [ceili(combat.health), roundi(combat.max_health)], "'%s'" % hud._player_health_text.text)
	check("hud: both chin gauges start empty and both knockdown rows start unlit", hud._opponent_chin.value == 0.0 and hud._player_chin.value == 0.0 and lit(hud._opponent_dots) == 0 and lit(hud._player_dots) == 0)
	check("hud: the controls hint is up with the stance", hud._hint.visible == combat.stance and combat.stance)
	check("hud: no status warning at full stamina", hud._status.text == "", "'%s'" % hud._status.text)


func test_guard_label() -> void:
	await open_fight(4)
	var names := {G.HIGH: "HIGH GUARD", G.LOW: "BODY GUARD", G.NONE: "NO GUARD"}
	for mode: int in [G.HIGH, G.LOW, G.NONE, G.HIGH]:
		opp.set_guard(mode)
		await frames(2)
		check("hud: guard label reads %s when he covers it" % names[mode], hud._opponent_guard_caption.text == names[mode], "'%s'" % hud._opponent_guard_caption.text)
	# Hands low after a punch: the label must not claim a guard he cannot use.
	await open_fight(4)
	opp.brain.style.hands_down = 1.5
	opp.start_attack([Strike.JAB])
	await until(func() -> bool: return brain.landings.size() > 0 and opp.state == S.FOOTWORK, 200)
	opp.set_guard(G.HIGH)
	await frames(2)
	var guarding := opp.is_guarding()
	check("hud: (setup) with his hands still down a raised guard does not cover anything", not guarding)
	check("hud: guard label says NO GUARD while his hands are down (a punch would land clean)", hud._opponent_guard_caption.text == "NO GUARD", "label '%s' while is_guarding()=%s guard_mode=%s" % [hud._opponent_guard_caption.text, guarding, opp.guard_mode])
	var s := await throw("L")
	check("hud: ... and the head shot indeed lands clean", s != null and s.outcome == Strike.Outcome.HIT, "outcome=%s" % [s.outcome if s != null else -1])
	await secs(1.8)
	opp.set_guard(G.HIGH)
	await frames(2)
	check("hud: guard label reads HIGH GUARD once his hands are back", opp.is_guarding() and hud._opponent_guard_caption.text == "HIGH GUARD", "label '%s' guarding=%s" % [hud._opponent_guard_caption.text, opp.is_guarding()])
	# A staggered fighter has no guard whatever he last chose.
	await open_fight(4)
	opp.set_guard(G.HIGH)
	opp.guard = 0.5
	await throw("L")
	await frames(2)
	check("hud: guard label reads NO GUARD while he is staggered", opp.state == S.STAGGER and hud._opponent_guard_caption.text == "NO GUARD", "state=%s label '%s'" % [opp.state, hud._opponent_guard_caption.text])


func test_bars_follow_model() -> void:
	await open_fight(4)
	var s := await throw("L")
	check_near("hud: opponent health bar follows his health after a hit", hud._opponent_health.value, opp.health, 0.01)
	check_near("hud: opponent chin gauge shows the fill (jab 5 of 95)", hud._opponent_chin.value, opp.chin.get_fill(), 0.006, "(ProgressBar steps are 0.01)")
	check("hud: ... and it is not zero", hud._opponent_chin.value > 0.04)
	s = await throw("L")
	await frames(2)
	check("hud: the hit counter shows x2 after two clean hits", hud._streak_box.visible and hud._streak_count.text == "x2", "visible=%s '%s'" % [hud._streak_box.visible, hud._streak_count.text])
	await open_fight(4)
	await chain("LR", 0.25)
	await secs(0.3)
	check("hud: the combo name shows 1-2 COMBO", hud._combo_name.text == "1-2 COMBO" and hud._combo_name.modulate.a > 0.5, "'%s' alpha %.2f" % [hud._combo_name.text, hud._combo_name.modulate.a])
	# Blocked hit: guard meter bar.
	await open_fight(4)
	opp.set_guard(G.HIGH)
	await frames(2)
	await throw("L")
	check_near("hud: opponent guard meter bar drops with a blocked hit", hud._opponent_guard.value, opp.guard, 0.01)
	# Body shot: opponent stamina bar.
	await open_fight(4)
	await throw("l")
	check_near("hud: opponent stamina bar follows a body shot's drain", hud._opponent_stamina.value, opp.stamina, 0.01)
	check_near("hud: ... against the profile's maximum", hud._opponent_stamina.max_value, opp.profile.max_stamina, 0.01)
	# Intercept.
	await open_fight(4)
	opp.start_attack([Strike.CROSS])
	await secs(0.2)
	await throw("L")
	await frames(2)
	check("hud: an intercept flashes INTERCEPT COUNTER in the combo line", hud._combo_name.text.begins_with("INTERCEPT COUNTER"), "'%s'" % hud._combo_name.text)


func test_clock() -> void:
	await open_fight(4)
	await secs(3.2)
	check("hud: bout clock reads 0:03 after three seconds", hud._clock.text == "0:%02d" % floori(ring.bout_time), "'%s' at %.2f s" % [hud._clock.text, ring.bout_time])
	await secs(10.0)
	check("hud: bout clock keeps counting (0:13)", hud._clock.text == "0:%02d" % floori(ring.bout_time) and ring.bout_time > 13.0, "'%s' at %.2f s" % [hud._clock.text, ring.bout_time])
	combat.max_health = 1.0e9
	combat.health = 1.0e9
	await secs(50.0)
	var t := ring.bout_time
	check("hud: bout clock rolls over to minutes (1:%02d)" % (floori(t) - 60), hud._clock.text == "%d:%02d" % [floori(floori(t) / 60.0), floori(t) % 60], "'%s' at %.2f s" % [hud._clock.text, t])


func test_player_side() -> void:
	await open_fight(4)
	opp.start_attack([Strike.CROSS])
	await until(func() -> bool: return brain.landings.size() > 0, 120)
	await frames(2)
	check_near("hud: player health bar follows the damage taken", hud._player_health.value, combat.health, 0.01)
	check("hud: player health text follows", hud._player_health_text.text == "%d / %d" % [ceili(combat.health), roundi(combat.max_health)], "'%s' vs health %.2f" % [hud._player_health_text.text, combat.health])
	check_near("hud: player chin gauge shows the fill", hud._player_chin.value, combat.chin.get_fill(), 0.006, "(ProgressBar steps are 0.01)")
	check("hud: ... and it moved", hud._player_chin.value > 0.1)
	await secs(0.2)
	await tap(&"dodge", 2)
	await frames(2)
	check_near("hud: player stamina bar follows a slip's cost", hud._player_stamina.value, PlayerStats.stamina, 0.01)
	# Callouts.
	await open_fight(4)
	opp.start_attack([Strike.BODY_HOOK])
	await until(func() -> bool: return brain.landings.size() > 0, 120)
	await frames(2)
	check("hud: a body shot taken shows the BODY SHOT! callout", hud._callout.text == "BODY SHOT!" and hud._callout.modulate.a > 0.5, "'%s' alpha %.2f" % [hud._callout.text, hud._callout.modulate.a])
	await secs(1.5)
	opp.start_attack([Strike.JAB])
	await until(func() -> bool: return opp.state == EnemyFighter.State.STRIKE, 200)
	await button("R")
	await secs(0.3)
	check("hud: being beaten to the punch shows COUNTERED!", hud._callout.text == "COUNTERED!" and hud._callout.modulate.a > 0.5, "'%s' alpha %.2f" % [hud._callout.text, hud._callout.modulate.a])


func test_dots_and_chin() -> void:
	# Opponent: rocked gauge, then two knockdowns light the dots.
	await open_fight(4)
	opp.chin.reset(20.0)
	await chain("RR", 0.25)
	await until(func() -> bool: return opp.state == S.ROCKED, 60)
	await frames(2)
	check("hud: a rocked opponent's gauge shows his chin (full) and pulses", hud._opponent_chin.value == opp.chin.get_fill() and hud._opponent_rocked and absf(hud._opponent_chin.value - 1.0) < 0.001, "value %.2f rocked=%s" % [hud._opponent_chin.value, hud._opponent_rocked])
	await secs(0.1)
	await throw("R")
	await frames(2)
	check("hud: his first knockdown lights one dot", lit(hud._opponent_dots) == 1 and dot_colors(hud._opponent_dots)[1] == UiKit.TRACK, "lit %d colours %s" % [lit(hud._opponent_dots), dot_colors(hud._opponent_dots)])
	check("hud: after the knockdown his gauge is reset on screen", hud._opponent_chin.value == 0.0 or opp.state == S.DOWN, "value %.2f" % hud._opponent_chin.value)
	await secs(2.8)
	opp.set_guard(G.NONE)
	opp.chin.reset(20.0)
	await chain("RR", 0.25)
	await until(func() -> bool: return opp.state == S.ROCKED, 60)
	await secs(0.1)
	await throw("R")
	await frames(2)
	check("hud: his second knockdown lights both dots", lit(hud._opponent_dots) == 2, "lit %d" % lit(hud._opponent_dots))
	# Player: rocked gauge, callouts, dots.
	await open_fight(4)
	combat.health = combat.max_health
	combat.chin.reset(20.0)
	opp.start_attack([Strike.CROSS, Strike.CROSS])
	await until(func() -> bool: return combat.is_rocked(), 300)
	await frames(2)
	check("hud: a rocked player sees ROCKED! and his full chin gauge", hud._callout.text == "ROCKED!" and hud._player_rocked and absf(hud._player_chin.value - 1.0) < 0.001, "callout '%s' value %.2f rocked=%s" % [hud._callout.text, hud._player_chin.value, hud._player_rocked])
	check("hud: ... and the status line says ROCKED", hud._status.text.begins_with("ROCKED"), "'%s'" % hud._status.text)
	await open_fight(4)
	combat.chin.reset(20.0)
	opp.start_attack([Strike.CROSS, Strike.OVERHAND, Strike.CROSS])
	await until(func() -> bool: return combat.is_down(), 400)
	await frames(2)
	check("hud: the player's first knockdown shows KNOCKDOWN! and lights one dot", hud._callout.text == "KNOCKDOWN!" and lit(hud._player_dots) == 1, "callout '%s' lit %d" % [hud._callout.text, lit(hud._player_dots)])
	await secs(2.5)
	check("hud: getting up shows BACK UP!", hud._callout.text == "BACK UP!" or callouts.has("BACK UP!"), "'%s'" % hud._callout.text)
	combat.health = combat.max_health
	await secs(1.0)
	combat.chin.reset(20.0)
	opp.start_attack([Strike.CROSS, Strike.OVERHAND, Strike.CROSS])
	await until(func() -> bool: return combat.knockdowns >= 2, 400)
	await frames(2)
	check("hud: the second knockdown lights both of the player's dots", lit(hud._player_dots) == 2, "lit %d" % lit(hud._player_dots))


func test_clinch_bar() -> void:
	await fresh(4, true, null, 0.0)
	opp.set_guard(G.NONE)
	var p := player.global_position
	opp.global_position = Vector3(p.x, opp.global_position.y, p.z - 1.1)
	opp.face(p)
	await frames(2)
	opp.start_clinch()
	await until(func() -> bool: return combat.clinch != null, 120)
	await frames(2)
	check("hud: the clinch bar and its prompt show while held", hud._clinch_box.visible and hud._clinch_prompt.text.contains("BREAK CLINCH!") and callouts.has("CLINCHED!"), "visible=%s prompt '%s'" % [hud._clinch_box.visible, hud._clinch_prompt.text])
	await tap(&"clinch_break", 2)
	await frames(2)
	check_near("hud: the clinch bar shows the break progress", hud._clinch_bar.value, combat.clinch_progress, 0.001)
	check("hud: ... which is above zero after a press", hud._clinch_bar.value > 0.05)
	await until(func() -> bool: return combat.is_clinch_window(), 120)
	await frames(2)
	check("hud: the bar lights up (hot colour) while the knee is coming up", UiKit.fill_of(hud._clinch_bar).bg_color == UiKit.ACCENT_HOT, "colour %s" % [UiKit.fill_of(hud._clinch_bar).bg_color])
	await until(func() -> bool: return not combat.is_clinch_window(), 120)
	await frames(2)
	check("hud: ... and goes back to the normal colour after it", UiKit.fill_of(hud._clinch_bar).bg_color == UiKit.ACCENT, "colour %s" % [UiKit.fill_of(hud._clinch_bar).bg_color])
	for i in 14:
		await tap(&"clinch_break", 1)
		await frames(1)
		if combat.clinch == null:
			break
	await frames(2)
	check("hud: the clinch bar is hidden once the grip is broken", combat.clinch == null and not hud._clinch_box.visible and callouts.has("CLINCH BROKEN!"), "visible=%s" % hud._clinch_box.visible)


func test_status_line() -> void:
	await open_fight(4)
	PlayerStats.stamina = 15.0
	await frames(3)
	check("hud: under 20% stamina the status line warns LOW STAMINA", hud._status.text.begins_with("LOW STAMINA"), "'%s'" % hud._status.text)
	PlayerStats.stamina = 0.0
	PlayerStats.is_exhausted = true
	await frames(3)
	check("hud: at zero stamina it says GASSED", hud._status.text.begins_with("GASSED"), "'%s'" % hud._status.text)
	PlayerStats.stamina = PlayerStats.max_stamina
	PlayerStats.is_exhausted = false
	await frames(3)
	check("hud: ... and the line clears when stamina is back", hud._status.text == "", "'%s'" % hud._status.text)


func test_result_lines() -> void:
	PlayerStats.reset_career()
	await open_fight(0)
	opp.health = 1.0
	await throw("L")
	await until(func() -> bool: return ring.state == RingManager.State.RESULT, 700)
	check("hud: the result screen shows VICTORY, the finish, the unlock line and Next Fight", hud._result.visible and hud._result_title.text == "VICTORY" and hud._result_subtitle.text == "Knockout over Skinny Sam" and hud._result_footer.text == "Unlocked: Cardio Carl  (Lvl 3)" and hud._next_button.visible, "title '%s' subtitle '%s' footer '%s' next=%s" % [hud._result_title.text, hud._result_subtitle.text, hud._result_footer.text, hud._next_button.visible])
	var captions := []
	for row in hud._result_rows.get_children():
		if not row.is_queued_for_deletion():
			captions.append((row.get_children()[0] as Label).text)
	check("hud: the result rows list purse, experience, tenure, fight time, best combo, record and cash", captions.has("Fight purse") and captions.has("Experience") and captions.has("Gym tenure") and captions.has("Fight time") and captions.has("Best combo") and captions.has("Record") and captions.has("Cash"), "rows %s" % [captions])
	check("hud: the clinch bar is hidden on the result screen", not hud._clinch_box.visible)
	ring.rematch()
	await frames(2)
	check("hud: a rematch hides the result screen and shows the fight panels again", not hud._result.visible and hud._opponent_panel.visible and hud._player_panel.visible)
	await until(func() -> bool: return ring.state == RingManager.State.FIGHT, 400)
	opp = ring.opponent
	make_passive()
	opp.set_guard(G.NONE)
	engage(1.4)
	combat.health = 1.0
	opp.start_attack([Strike.JAB])
	await until(func() -> bool: return ring.state == RingManager.State.RESULT, 900)
	check("hud: a loss shows DEFEAT, the finish and no Next Fight", hud._result.visible and hud._result_title.text == "DEFEAT" and hud._result_subtitle.text == "Knocked out by Skinny Sam" and not hud._next_button.visible and hud._result_footer.text == "Train downstairs, come back stronger.", "title '%s' subtitle '%s' footer '%s' next=%s" % [hud._result_title.text, hud._result_subtitle.text, hud._result_footer.text, hud._next_button.visible])
	ring.exit_ring()
	await frames(2)
	check("hud: leaving the cage closes every fight view", not hud._result.visible and not hud._opponent_panel.visible and not hud._player_panel.visible and not hud._clock.visible and not hud._clinch_box.visible)


## The PERFECT DODGE banner fades out on its own, even when the counter lands while it is up.
func test_counter_banner_fades() -> void:
	await open_fight(4)
	opp.start_attack([Strike.JAB])
	await frames(22)
	act(&"move_right", true)
	act(&"dodge", true)
	await frames(3)
	act(&"dodge", false)
	act(&"move_right", false)
	await until(func() -> bool: return combat.is_counter_ready(), 120)
	await frames(2)
	check("hud: the COUNTER! banner is up after a perfect dodge", hud._counter.modulate.a > 0.9, "alpha %.2f" % hud._counter.modulate.a)
	await secs(0.15)
	await throw("L")
	await secs(2.5)
	check("hud: the COUNTER! banner has faded out 2.5 s later (even though the counter landed during it)", hud._counter.modulate.a < 0.05, "alpha %.2f" % hud._counter.modulate.a)
