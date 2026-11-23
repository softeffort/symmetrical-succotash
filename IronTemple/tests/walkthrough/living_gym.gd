extends "res://tests/walkthrough/walk.gd"
## Step 4, the living gym: thirteen regulars and a bartender with name tags, walkers that use the
## stairs, reputation comments by level tier, the high-tier step-aside and the crowd at the cage.

const REGULARS := ["Mike", "Dana", "Rocco", "Lena", "Tasha", "Ivan", "Priya", "Omar", "Chloe", "Deshawn", "Kat", "Felix", "Nora"]

var crowd: GymCrowd


func _init() -> void:
	area = "living_gym"


func run() -> void:
	seed(7)
	wipe_career()
	await boot()
	crowd = main.get_node("Gym/GymCrowd") as GymCrowd
	await place_player(gym_point(-8.0, -8.0), 0.0)
	await _roster()
	await _walkers()
	await _tiers_and_comments()
	await _step_aside()
	await _crowd_at_the_cage()


func _career(level: int, wins: int = 0, streak: int = 0) -> void:
	PlayerStats.apply_save({"Level": level, "FightRecord": {"Wins": wins, "Losses": 0, "WinStreak": streak, "BestStreak": streak}})


func _roster() -> void:
	var names: Array[String] = []
	for npc in crowd.npcs:
		names.append(npc.npc_name)
	names.sort()
	var want: Array = REGULARS.duplicate()
	want.sort()
	check("thirteen regulars live in the gym", crowd.npcs.size() == 13 and names == want, "count=%d names=%s" % [crowd.npcs.size(), names])
	var tags_ok := true
	var tag_detail := ""
	for npc in crowd.npcs:
		var expected := "%s | LVL %d | %s" % [npc.npc_name, npc.level, npc.tenure]
		if npc.name_tag.text != expected or not npc.name_tag.visible or npc.name_tag.text.count("|") != 2:
			tags_ok = false
			tag_detail += "'%s' vs '%s'; " % [npc.name_tag.text, expected]
	check("every regular floats a 'Name | LVL n | tenure' tag", tags_ok, tag_detail)
	var mike: GymNpc = null
	for npc in crowd.npcs:
		if npc.npc_name == "Mike":
			mike = npc
	check("Mike's tag reads 'Mike | LVL 4 | 3 Months'", mike != null and mike.name_tag.text == "Mike | LVL 4 | 3 Months", "tag='%s'" % (mike.name_tag.text if mike != null else "none"))
	var floors := {0: 0, 1: 0, 2: 0}
	for npc in crowd.npcs:
		floors[clampi(roundi(npc.home.y / 5.0), 0, 2)] += 1
	check("regulars are spread over all three storeys", floors[0] >= 3 and floors[1] >= 3 and floors[2] >= 3, "per floor=%s" % [floors])
	var bars := main.get_node("Gym/Floor3_Lounge").find_children("*", "SupplementBar", true, false)
	check("the third floor has a supplement bar", bars.size() == 1, "found %d" % bars.size())
	if bars.size() == 1:
		var bartender: GymNpc = (bars[0] as SupplementBar).bartender
		check("the bartender 'Joe | LVL 12 | 6 Years' stands behind the counter with a name tag", bartender != null and bartender.name_tag.text == "Joe | LVL 12 | 6 Years" and bartender.activity == GymNpc.Activity.SERVE and bartender.name == "Bartender", "tag='%s'" % (bartender.name_tag.text if bartender != null else "none"))
		check("the bartender is on the third floor", absf(bartender.global_position.y - 10.0) < 0.5, "y=%.2f" % bartender.global_position.y)
	await secs(1.0)
	var visible_count := 0
	for npc in crowd.npcs:
		if npc.is_visible_in_tree() and npc.model.visible:
			visible_count += 1
	check("all regulars are shown (the interior is within draw distance)", visible_count == 13, "visible=%d" % visible_count)


func _walkers() -> void:
	var walkers: Array[GymNpc] = []
	for npc in crowd.npcs:
		if npc.activity == GymNpc.Activity.WALK:
			walkers.append(npc)
	check("two regulars are walkers (Felix and Nora)", walkers.size() == 2 and walkers.map(func(n: GymNpc) -> String: return n.npc_name).has("Felix") and walkers.map(func(n: GymNpc) -> String: return n.npc_name).has("Nora"), "walkers=%s" % [walkers.map(func(n: GymNpc) -> String: return n.npc_name)])
	var low := {}
	var high := {}
	var travelled := {}
	var last := {}
	for w in walkers:
		low[w.npc_name] = w.position.y
		high[w.npc_name] = w.position.y
		travelled[w.npc_name] = 0.0
		last[w.npc_name] = w.position
	var start_index := {}
	for w in walkers:
		start_index[w.npc_name] = w.route_index
	for i in 240:
		await secs(0.5)
		for w in walkers:
			low[w.npc_name] = minf(low[w.npc_name], w.position.y)
			high[w.npc_name] = maxf(high[w.npc_name], w.position.y)
			travelled[w.npc_name] += w.position.distance_to(last[w.npc_name])
			last[w.npc_name] = w.position
	for w in walkers:
		var n := w.npc_name
		check("walker %s moved between floors in 120 s (y %.1f..%.1f, %.0f m walked)" % [n, low[n], high[n], travelled[n]], high[n] - low[n] > 9.0 and travelled[n] > 60.0, "low=%.2f high=%.2f walked=%.1f route_index %d->%d" % [low[n], high[n], travelled[n], start_index[n], w.route_index])
		check("walker %s keeps to the stairs (never leaves the building footprint)" % n, w.position.x > -15.0 and w.position.x < 15.0 and w.position.z < 0.5 and w.position.z > -26.0, "pos=%s" % w.position)
	var stationary := crowd.npcs.filter(func(n: GymNpc) -> bool: return n.activity != GymNpc.Activity.WALK and n.mode == GymNpc.Mode.ROUTINE)
	var stayed := stationary.all(func(n: GymNpc) -> bool: return n.position.distance_to(n.home) < 0.2)
	check("everyone else stays at their station in the meantime", stayed, "moved=%s" % [stationary.filter(func(n: GymNpc) -> bool: return n.position.distance_to(n.home) >= 0.2).map(func(n: GymNpc) -> String: return n.npc_name)])


func _pool(tier: Reputation.Tier) -> Array[String]:
	var pools: Array[Array] = [Reputation.LOW_LINES, Reputation.MID_LINES, Reputation.HIGH_LINES]
	var lines: Array[String] = []
	for entry: Array in pools[tier]:
		lines.append(entry[0])
	return lines


func _tiers_and_comments() -> void:
	var boundaries := {1: Reputation.Tier.LOW, 3: Reputation.Tier.LOW, 4: Reputation.Tier.MID, 9: Reputation.Tier.MID, 10: Reputation.Tier.HIGH, 25: Reputation.Tier.HIGH}
	var ok := true
	var detail := ""
	for level: int in boundaries:
		PlayerStats.level = level
		if Reputation.tier() != boundaries[level]:
			ok = false
			detail += "level %d -> %d; " % [level, Reputation.tier()]
	check("reputation tiers: levels 1-3 rookie, 4-9 respected, 10+ legend", ok, detail)
	var titles: Array[String] = []
	for level in [2, 6, 12]:
		PlayerStats.level = level
		titles.append(Reputation.tier_title())
	check("tier titles are Rookie, Respected, Legend", titles == ["Rookie", "Respected", "Legend"], "%s" % [titles])
	var pool_low := _pool(Reputation.Tier.LOW)
	var pool_mid := _pool(Reputation.Tier.MID)
	var pool_high := _pool(Reputation.Tier.HIGH)
	var overlap := pool_low.filter(func(t: String) -> bool: return pool_mid.has(t) or pool_high.has(t)) + pool_mid.filter(func(t: String) -> bool: return pool_high.has(t))
	check("the three tiers have different comment lines (no shared lines)", overlap.is_empty(), "shared=%s" % [overlap])
	var seen_by_tier := {}
	for level in [2, 6, 12]:
		_career(level)
		await place_player(gym_point(-8.0, -8.0), 0.0)
		await secs(1.0)
		for npc in crowd.npcs:
			npc.cooldown = 0.0
		crowd._remark_timer = 0.5
		await place_player(gym_point(-11.1, -11.9), 270.0)
		var seen: Array[String] = []
		for i in 160:
			await secs(0.5)
			for npc in crowd.npcs:
				if npc.bubble.visible and npc.bubble.text != "" and not seen.has(npc.bubble.text) and npc.is_speaking():
					seen.append(npc.bubble.text)
		seen_by_tier[level] = seen
		var tier := Reputation.tier()
		var pool := _pool(tier)
		var stray := seen.filter(func(t: String) -> bool: return not pool.has(t))
		check("level %d (%s) regulars comment %d times, all from the %s pool" % [level, Reputation.tier_title(), seen.size(), Reputation.tier_title()], seen.size() >= 2 and stray.is_empty(), "seen=%s stray=%s" % [seen, stray])
	var low_seen: Array = seen_by_tier[2]
	var mid_seen: Array = seen_by_tier[6]
	var high_seen: Array = seen_by_tier[12]
	check("comments really differ by tier (no line heard in two tiers)", low_seen.all(func(t: String) -> bool: return not mid_seen.has(t) and not high_seen.has(t)) and mid_seen.all(func(t: String) -> bool: return not high_seen.has(t)), "low=%s mid=%s high=%s" % [low_seen, mid_seen, high_seen])
	check("level 12 hears champion talk ('Make way', 'champ', 'Legend', ...)", high_seen.any(func(t: String) -> bool: return t in pool_high), "high=%s" % [high_seen])
	_career(1)


func _step_aside() -> void:
	var mike: GymNpc = null
	for npc in crowd.npcs:
		if npc.npc_name == "Mike":
			mike = npc
	var spot := gym_point(-11.9, -11.9)
	# Respected (level 5): Mike stays where he is.
	_career(5)
	await place_player(gym_point(-8.0, -8.0), 0.0)
	await secs(1.0)
	await place_player(spot, 270.0)
	await secs(2.0)
	var mid_shift := mike.position.distance_to(mike.home)
	check("a respected (level 5) player does not make regulars move (Mike shifted %.2f m)" % mid_shift, mid_shift < 0.05, "shift=%.3f" % mid_shift)
	# Legend (level 10): he steps aside.
	_career(10)
	await secs(2.0)
	var high_shift := mike.position.distance_to(mike.home)
	check("a level-10 player: Mike steps aside (shifted %.2f m)" % high_shift, high_shift > 0.4 and high_shift < 1.5, "shift=%.3f" % high_shift)
	await place_player(gym_point(-6.0, -8.0), 0.0)
	await secs(2.5)
	var back := mike.position.distance_to(mike.home)
	check("when the player walks off, Mike goes back to his spot (%.2f m off)" % back, back < 0.08, "off=%.3f" % back)
	_career(1)


func _crowd_at_the_cage() -> void:
	var cases := [[9, 0, 0], [10, 0, 0], [12, 0, 0], [10, 2, 2], [13, 1, 1], [16, 3, 3], [30, 9, 9]]
	for entry: Array in cases:
		var level: int = entry[0]
		var wins: int = entry[1]
		var streak: int = entry[2]
		var expected := 0 if level < 10 else clampi(3 + (level - 10) / 2 + streak, 3, 9)
		wipe_career()
		_career(level, wins, streak)
		await boot()
		crowd = main.get_node("Gym/GymCrowd") as GymCrowd
		await place_player(gym_point(-8.0, -8.0), 0.0)
		await secs(1.0)
		var started := await start_bout_from_card()
		var ring := get_ring()
		var wanted := Reputation.crowd_size()
		await frames(5)
		var sent := crowd.spectators.size()
		var label := "level %d, win streak %d" % [level, streak]
		check("%s: a bout sends %d extra regulars to the cage (formula 3 + (level-10)/2 + streak, max 9; none below level 10)" % [label, expected], started and wanted == expected and sent == expected, "started=%s crowd_size=%d sent=%d" % [started, wanted, sent])
		var arrived := await until(func() -> bool: return crowd.get_audience().size() == expected + 2 and crowd.spectators.all(func(n: GymNpc) -> bool: return n.is_watching()), 45.0)
		var audience := crowd.get_audience()
		var near_cage := audience.all(func(n: GymNpc) -> bool: return Vector2(n.global_position.x - ring.global_position.x, n.global_position.z - ring.global_position.z).length() < 8.0 and absf(n.global_position.y - 5.0) < 0.6)
		check("%s: the crowd (%d + the ringside pair) gathers round the cage on 2F" % [label, expected], arrived and near_cage, "audience=%d wanted=%d near=%s" % [audience.size(), expected + 2, near_cage])
		if level == 30:
			await _disperse(ring)
	wipe_career()


func _disperse(ring: RingManager) -> void:
	var over := await until(func() -> bool: return ring.state == RingManager.State.RESULT, 400.0)
	if not check("the bout with the big crowd ends (idle player stopped)", over, "state=%d" % ring.state):
		return
	var exit_button: Button = null
	for button in hud.combat_hud.find_children("*", "Button", true, false):
		if (button as Button).text == "EXIT RING" and (button as Button).is_visible_in_tree():
			exit_button = button
	if exit_button == null:
		check("result screen offers EXIT RING", false, "no button")
		return
	await click_control(exit_button)
	await frames(5)
	check("leaving the cage sends the spectators back to what they were doing", crowd.spectators.is_empty(), "spectators=%d" % crowd.spectators.size())
	var left := await until(func() -> bool: return crowd.get_audience().size() == 2, 60.0)
	check("a while later only the ringside pair is left at the cage", left, "audience=%d" % crowd.get_audience().size())
