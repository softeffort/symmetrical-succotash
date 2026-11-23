extends "res://tests/walkthrough/walk.gd"
## Step 3 (non-combat parts): heavy bags, the stance, the Fight Card terminal and the cage
## flow. A single bout is started only to prove it begins and that control comes back.

var ring: RingManager
var kinds: Array[StringName] = []
var hits_seen := 0


func _init() -> void:
	area = "second_floor"


func run() -> void:
	seed(99)
	wipe_career()
	await boot()
	ring = get_tree().get_first_node_in_group(&"ring") as RingManager
	player.combat.strike_resolved.connect(func(strike: Strike) -> void: kinds.append(strike.kind))
	check("the Fight Hall has a ring manager and a Fight Card terminal", ring != null and ring.get_node_or_null("FightCardTerminal") != null)
	await _bag_stance()
	await _bag_strikes()
	await _bag_combos()
	await _fight_card()
	await _one_bout()


func bags() -> Array[PunchingBag]:
	var found: Array[PunchingBag] = []
	for node in main.get_node("Gym/Floor2_FightHall").find_children("*", "PunchingBag", true, false):
		found.append(node as PunchingBag)
	return found


func _bag_stance() -> void:
	var list := bags()
	check("five heavy bags hang on 2F", list.size() == 5, "found %d" % list.size())
	var bag := list[1]
	# Start well outside the bag's and the cage's combat zones, on 2F.
	var start := bag.global_position + Vector3(6.0, 0.05, 0.0)
	await place_player(start, 90.0)
	await secs(1.0)
	check("2F: standing away from the bags the hands are down", not player.combat.stance and not player.arms.fight_stance, "stance=%s" % player.combat.stance)
	check("2F: the player really is on the second storey", near(player.global_position.y, 5.0, 0.3), "y=%.2f" % player.global_position.y)
	var up_at := -1.0
	key_down(KEY_W)
	for i in 600:
		var offset := bag.global_position - player.global_position
		offset.y = 0.0
		var scale := player.mouse_sensitivity * SaveManager.get_mouse_sensitivity()
		player._look(Vector2(-wrapf(atan2(-offset.x, -offset.z) - player._yaw, -PI, PI) / scale, 0.0))
		await get_tree().physics_frame
		if player.combat.stance and up_at < 0.0:
			up_at = offset.length()
		if offset.length() < 1.3:
			break
	key_up(KEY_W)
	await frames(10)
	check("walking up to a heavy bag raises the hands (stance up at %.2f m, zone radius 2.3 m)" % up_at, up_at > 1.6 and up_at < 2.7, "up_at=%.2f" % up_at)
	check("the glove arms come up with the stance", player.arms.fight_stance)
	check("objective tells the player to mix head and body shots", GameState.objective.begins_with("Hands up:") and hud.objective_label.text == GameState.objective, "objective='%s'" % GameState.objective)
	check("HUD knows the stance is up", hud._in_stance)
	# Walk away: the hands come down after a short linger.
	key_down(KEY_S)
	await secs(1.8)
	key_up(KEY_S)
	await secs(1.0)
	check("walking away from the bag lowers the hands again", not player.combat.stance and not player.arms.fight_stance, "stance=%s dist=%.2f" % [player.combat.stance, (bag.global_position - player.global_position).length()])
	check("objective goes back to the next fight on the card", GameState.objective.begins_with("Next fight: Skinny Sam"), "objective='%s'" % GameState.objective)


## One strike: press, then wait for it to land and recover. Returns whether the bag count rose.
func _throw(bag: PunchingBag, action: StringName, wait: float = 0.8) -> bool:
	var before := bag.hits
	if action == &"kick":
		await tap_key(KEY_F)
	else:
		await tap_action(action)
	await secs(wait)
	return bag.hits > before


func _bag_strikes() -> void:
	var bag := bags()[1]
	# Stand a metre and a bit from the bag, aimed at its middle.
	var spot := bag.global_position + Vector3(1.25, 0.05, 0.0)
	await place_player(spot, 90.0)
	await look_at_point(bag.global_position + Vector3(0.0, 1.35, 0.0))
	await secs(0.8)
	check("by the bag the stance is up", player.combat.stance)
	check("the stance is not held for the bout (bag work only)", not player.combat.in_bout)
	kinds.clear()
	var before := {"arms": PlayerStats.muscle_arms, "legs": PlayerStats.muscle_legs, "xp": PlayerStats.xp, "stamina": PlayerStats.max_stamina, "hits": bag.hits}
	var jabs := 0
	for i in 4:
		if await _throw(bag, &"strike_left", 0.9):
			jabs += 1
	check("strike_left (LMB) jabs register on the bag (%d of 4)" % jabs, jabs == 4, "hits %d -> %d kinds=%s" % [before["hits"], bag.hits, kinds])
	check("a single LMB is a left jab", kinds.size() >= 4 and kinds.slice(0, 4).all(func(k: StringName) -> bool: return k == Strike.JAB), "kinds=%s" % [kinds])
	var xp_after_jabs := PlayerStats.xp
	var crosses := 0
	for i in 3:
		if await _throw(bag, &"strike_right", 0.9):
			crosses += 1
	check("strike_right (RMB) crosses register on the bag (%d of 3)" % crosses, crosses == 3, "hits=%d kinds=%s" % [bag.hits, kinds])
	check("a single RMB is a right cross", kinds.slice(4, 7).all(func(k: StringName) -> bool: return k == Strike.CROSS), "kinds=%s" % [kinds])
	var arms_mid := PlayerStats.muscle_arms
	var legs_mid := PlayerStats.muscle_legs
	# A second LMB straight after a jab is a left hook.
	var hits_before := bag.hits
	await tap_action(&"strike_left")
	await secs(0.12)
	await tap_action(&"strike_left")
	await secs(0.9)
	check("two quick LMB presses throw a jab then a left hook", bag.hits == hits_before + 2 and kinds.slice(-2) == [Strike.JAB, Strike.HOOK], "hits +%d kinds=%s" % [bag.hits - hits_before, kinds.slice(-2)])
	# Kick from a little further back.
	await place_player(bag.global_position + Vector3(1.6, 0.05, 0.0), 90.0)
	await look_at_point(bag.global_position + Vector3(0.0, 1.35, 0.0))
	await secs(0.8)
	var kicks := 0
	for i in 3:
		if await _throw(bag, &"kick", 1.1):
			kicks += 1
	check("kick (F) lands on the bag (%d of 3)" % kicks, kicks == 3 and kinds.slice(-3).all(func(k: StringName) -> bool: return k == Strike.KICK), "kicks=%d kinds=%s" % [kicks, kinds.slice(-3)])
	check("bag work pays XP", PlayerStats.xp > before["xp"] or PlayerStats.level > 1, "xp %.1f -> %.1f level %d" % [before["xp"], PlayerStats.xp, PlayerStats.level])
	check("punching the bag raises arm muscle", arms_mid > before["arms"], "%.4f -> %.4f" % [before["arms"], arms_mid])
	check("kicking the bag raises leg muscle", PlayerStats.muscle_legs > legs_mid and near(legs_mid, before["legs"], 0.0001), "legs %.4f -> %.4f (before kicks %.4f)" % [before["legs"], PlayerStats.muscle_legs, legs_mid])
	check("bag work raises max stamina", PlayerStats.max_stamina > before["stamina"] or PlayerStats.level > 1, "%.3f -> %.3f" % [before["stamina"], PlayerStats.max_stamina])
	check("the bag swings from the blows and counts them (%d hits)" % bag.hits, bag.hits >= 12 and bag._swing.length() + bag._shudder > 0.0, "hits=%d swing=%s" % [bag.hits, bag._swing])
	var sample_hits := bag.hits
	# Out of reach: a jab at a bag 3 m away does nothing.
	await place_player(bag.global_position + Vector3(2.2, 0.05, 0.0), 90.0)
	await look_at_point(bag.global_position + Vector3(0.0, 1.35, 0.0))
	await secs(0.8)
	var far_hit := await _throw(bag, &"strike_left", 0.9)
	check("a jab thrown from 2.2 m misses the bag", not far_hit and bag.hits == sample_hits, "hits %d -> %d" % [sample_hits, bag.hits])
	_hud_after_bag()


func _bag_combos() -> void:
	var bag := bags()[1]
	var labels: Array[String] = []
	player.combat.combo_landed.connect(func(label: String) -> void: labels.append(label))
	await place_player(bag.global_position + Vector3(1.25, 0.05, 0.0), 90.0)
	await look_at_point(bag.global_position + Vector3(0.0, 1.35, 0.0))
	await secs(1.5)
	var cases := [
		["1-2 COMBO", [&"strike_left", &"strike_right"], [Strike.JAB, Strike.CROSS]],
		["GUARD BREAKER", [&"strike_left", &"strike_left", &"strike_right"], [Strike.JAB, Strike.HOOK, Strike.UPPERCUT]],
		["KO FINISHER", [&"strike_right", &"strike_left", &"strike_right"], [Strike.CROSS, Strike.JAB, Strike.OVERHAND]],
	]
	for entry: Array in cases:
		var label: String = entry[0]
		var presses: Array = entry[1]
		var want: Array = entry[2]
		kinds.clear()
		labels.clear()
		var hits_before := bag.hits
		for action: StringName in presses:
			await tap_action(action)
			await secs(0.4)
		await secs(1.0)
		check("%s on the heavy bag: LMB/RMB chain throws %s and the combo is called out" % [label, want], kinds == want and labels.has(label) and bag.hits == hits_before + presses.size(), "kinds=%s labels=%s hits +%d" % [kinds, labels, bag.hits - hits_before])
		await secs(1.0)
	# Four strikes without a pause turn into sloppy arm punches (Step 5 anti-spam) but still hit the bag.
	kinds.clear()
	var sloppy := {"seen": 0}
	var spam_hits := bag.hits
	player.combat.strike_resolved.connect(func(strike: Strike) -> void: sloppy["seen"] += 1 if strike.sloppy else 0)
	for i in 5:
		await tap_action(&"strike_left")
		await secs(0.3)
	await secs(1.5)
	check("five jabs without a breath: the bag still registers them and the fourth and fifth are sloppy", bag.hits >= spam_hits + 4 and sloppy["seen"] >= 1, "hits +%d sloppy strikes=%d" % [bag.hits - spam_hits, sloppy["seen"]])


func _hud_after_bag() -> void:
	check("HUD level/XP labels follow the bag work", hud.level_label.text == "Lvl %d" % PlayerStats.level and hud.xp_label.text == "%d / %d XP" % [floori(PlayerStats.xp), roundi(PlayerStats.xp_to_next())], "level='%s' xp='%s'" % [hud.level_label.text, hud.xp_label.text])


# --- Fight Card ------------------------------------------------------------------------------

func _terminal() -> Node3D:
	return ring.get_node("FightCardTerminal") as Node3D


func _open_card() -> bool:
	return await open_fight_card()


func _fight_card() -> void:
	var card: FightCard = hud.fight_card
	var opened := await _open_card()
	check("Fight Card terminal: crosshair prompt reads 'Fight Card / Enter Ring'", last_prompt == "Fight Card / Enter Ring", "prompt='%s'" % last_prompt)
	check("Fight Card terminal: E opens the Fight Card", opened)
	check("Fight Card: the player is frozen with the mouse free", not player.controls_enabled and Input.mouse_mode == Input.MOUSE_MODE_VISIBLE, "controls=%s mouse=%d" % [player.controls_enabled, Input.mouse_mode])
	var names: Array[String] = []
	var levels: Array[int] = []
	var health: Array[int] = []
	for profile in card._entries:
		names.append(profile.fighter_name)
		levels.append(profile.level)
		health.append(roundi(profile.max_health))
	check("Fight Card lists six entries: five ladder fighters and the league", card._entries.size() == 6 and card._buttons.size() == 6, "entries=%d buttons=%d" % [card._entries.size(), card._buttons.size()])
	check("ladder fighters are Skinny Sam, Cardio Carl, Counter-King Viktor, Brawler Boris, The Iron Champ", names.slice(0, 5) == ["Skinny Sam", "Cardio Carl", "Counter-King Viktor", "Brawler Boris", "The Iron Champ"], "names=%s" % [names])
	check("ladder levels are 1, 3, 6, 10, 15 and health 310, 350, 300, 520, 630 (README)", levels.slice(0, 5) == [1, 3, 6, 10, 15] and health.slice(0, 5) == [310, 350, 300, 520, 630], "levels=%s health=%s" % [levels, health])
	var unlocked: Array[bool] = []
	for profile in card._entries:
		unlocked.append(FighterRoster.is_unlocked(profile))
	check("on a fresh career only the first fighter is unlocked", unlocked == [true, false, false, false, false, false], "unlocked=%s" % [unlocked])
	check("the league entry is shown as ENDLESS LEAGUE and locked", card._buttons[5].text.contains("ENDLESS LEAGUE"), "text='%s'" % card._buttons[5].text)
	check("the first fighter is selected and ENTER RING is available", card._selected == 0 and not card._enter.disabled and card._enter.text == "ENTER RING", "selected=%d enter='%s' disabled=%s" % [card._selected, card._enter.text, card._enter.disabled])
	check("card header shows the record and cash", card._record.text.contains("RECORD  0 W - 0 L") and card._record.text.contains("CASH  $0"), "text='%s'" % card._record.text)
	await click_control(card._buttons[2])
	check("clicking a locked fighter shows LOCKED and disables the enter button", card._selected == 2 and card._enter.disabled and card._enter.text == "LOCKED", "selected=%d enter='%s' disabled=%s" % [card._selected, card._enter.text, card._enter.disabled])
	check("a locked fighter explains what unlocks him", card._blurb.text == "Locked. Beat Cardio Carl first.", "blurb='%s'" % card._blurb.text)
	card._confirm()
	await frames(3)
	check("confirming a locked fighter does not start a bout", ring.state == RingManager.State.IDLE and card.is_open(), "state=%d open=%s" % [ring.state, card.is_open()])
	await click_control(card._buttons[5])
	check("the league entry explains it opens when the Champ falls", card._blurb.text.begins_with("Opens when The Iron Champ falls"), "blurb='%s'" % card._blurb.text)
	await press_escape()
	await frames(3)
	check("Esc closes the Fight Card and hands control back", not card.is_open() and player.controls_enabled and ring.state == RingManager.State.IDLE, "open=%s controls=%s" % [card.is_open(), player.controls_enabled])
	check("after closing the player can walk", await walks_away_from(_terminal()))


# --- One bout --------------------------------------------------------------------------------

func _one_bout() -> void:
	var started: Array[String] = []
	ring.bout_started.connect(func(profile: FighterProfile) -> void: started.append(profile.fighter_name))
	var finished: Array = []
	ring.bout_finished.connect(func(profile: FighterProfile, won: bool) -> void: finished.append([profile.fighter_name, won]))
	check("the Fight Card opens again for the bout", await _open_card())
	var card: FightCard = hud.fight_card
	await click_control(card._enter)
	await frames(4)
	check("ENTER RING starts the countdown for Skinny Sam", ring.state == RingManager.State.COUNTDOWN and started == ["Skinny Sam"], "state=%d started=%s" % [ring.state, started])
	check("an opponent is spawned in the cage", ring.opponent != null and is_instance_valid(ring.opponent) and ring.opponent.is_inside_tree(), "opponent=%s" % ring.opponent)
	check("the player is placed on the canvas and in a bout", player.combat.in_bout and ring.player.global_position.distance_to(ring.global_position) < ring.arena_radius + 1.0 and ring.player.global_position.y > 5.5, "in_bout=%s pos=%s ring=%s" % [player.combat.in_bout, ring.player.global_position, ring.global_position])
	check("controls are locked during the countdown", not player.controls_enabled)
	check("objective says 'Knock out Skinny Sam'", GameState.objective == "Knock out Skinny Sam", "objective='%s'" % GameState.objective)
	check("the Fight Card is closed once the bout starts", not card.is_open())
	var fight := await until(func() -> bool: return ring.state == RingManager.State.FIGHT, 6.0)
	check("the 3-2-1 countdown ends in FIGHT within about 3.3 s", fight, "state=%d" % ring.state)
	var clock0 := ring.bout_time
	await secs(1.0)
	check("the bout clock runs while fighting", ring.bout_time > clock0 + 0.5, "bout_time %.2f -> %.2f" % [clock0, ring.bout_time])
	await press_escape()
	check("Esc in a bout does not open the pause menu", not hud.pause_menu.is_open() and not get_tree().paused, "pause open=%s paused=%s" % [hud.pause_menu.is_open(), get_tree().paused])
	# Stand still until the bout is over (the player is not defended).
	var over := await until(func() -> bool: return ring.state == RingManager.State.RESULT, 400.0)
	note("bout ended after %.1f s of fight time, state=%d, record=%s" % [ring.bout_time, ring.state, PlayerStats.fight_record.to_text()])
	check("an idle player is stopped within 400 s and the result screen appears", over, "state=%d bout_time=%.1f" % [ring.state, ring.bout_time])
	if not over:
		return
	await frames(10)
	check("bout_finished fired once (loss for the idle player)", finished.size() == 1 and finished[0][1] == false, "finished=%s" % [finished])
	check("the loss is recorded in the fight record", PlayerStats.fight_record.losses == 1 and PlayerStats.fight_record.wins == 0, "record=%s" % PlayerStats.fight_record.to_text())
	check("HUD record label reflects the loss", hud.record_label.text == PlayerStats.fight_record.to_text() and hud.record_label.text.contains("1 L"), "record label='%s'" % hud.record_label.text)
	check("objective after a loss: train, then rematch", GameState.objective == "Train downstairs, then rematch Skinny Sam", "objective='%s'" % GameState.objective)
	var exit_button: Button = null
	for button in hud.combat_hud.find_children("*", "Button", true, false):
		if (button as Button).text == "EXIT RING" and (button as Button).is_visible_in_tree():
			exit_button = button
	check("the result screen offers EXIT RING", exit_button != null)
	if exit_button == null:
		return
	await click_control(exit_button)
	await frames(6)
	check("EXIT RING returns control: state IDLE, controls enabled, not in a bout", ring.state == RingManager.State.IDLE and player.controls_enabled and not player.combat.in_bout, "state=%d controls=%s in_bout=%s" % [ring.state, player.controls_enabled, player.combat.in_bout])
	check("the opponent is removed and the gate unlocks", ring.opponent == null or not is_instance_valid(ring.opponent) or ring.opponent.is_queued_for_deletion(), "opponent=%s" % ring.opponent)
	check("the player stands outside the cage afterwards", player.global_position.distance_to(ring.global_position) > ring.arena_radius + 1.0, "dist=%.2f" % player.global_position.distance_to(ring.global_position))
	check("stamina is restored on leaving the ring", PlayerStats.stamina >= PlayerStats.max_stamina - 0.5, "stamina=%.1f/%.1f" % [PlayerStats.stamina, PlayerStats.max_stamina])
	check("the player can walk again after the bout", await walks_away_from(ring))
