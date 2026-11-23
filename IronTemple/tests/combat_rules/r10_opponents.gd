extends "res://tests/combat_rules/rules_base.gd"
## Rule group 10: the opponents. Ladder archetypes and health, adaptive reads (third repeat of a
## combination, the third slip the same way), Endless League challengers (deterministic, health
## 14 a level from 714, two styles swapped every 5 to 8 s, sharpest from level 31).

const G := EnemyFighter.Guard
const S := EnemyFighter.State
const A := FightStyle.Archetype


func open_fight(adaptive: bool = false) -> void:
	await fresh(4, true, null, 1.4)
	opp.set_guard(G.NONE)
	opp.profile.adaptive = adaptive
	combat.max_health = 1.0e6
	combat.health = 1.0e6
	await frames(2)


func throw(key: String) -> Strike:
	var n := resolved.size()
	await button(key)
	await until(func() -> bool: return resolved.size() > n, 120)
	return resolved[n] if resolved.size() > n else null


func slip(direction: StringName) -> void:
	act(direction, true)
	act(&"dodge", true)
	await frames(3)
	act(&"dodge", false)
	act(direction, false)


func run() -> void:
	test_ladder()
	test_league_profiles()
	await test_ladder_in_bout()
	await test_read_third_repeat()
	await test_slip_habit()
	await test_league_swaps()


func test_ladder() -> void:
	var ladder := FighterRoster.ladder()
	var spec := [
		["Skinny Sam", 1, A.NOOB, "The Noob", 310.0, false],
		["Cardio Carl", 3, A.PRESSURE, "Pressure Fighter", 350.0, false],
		["Counter-King Viktor", 6, A.SNIPER, "Sniper", 300.0, false],
		["Brawler Boris", 10, A.DIRTY, "Dirty Boxer", 520.0, false],
		["The Iron Champ", 15, A.PRO, "The Pro", 630.0, true],
	]
	check_eq("ladder: five fighters", ladder.size(), 5)
	for i in 5:
		var p: FighterProfile = ladder[i]
		var row: Array = spec[i]
		check("ladder: tier %d is %s (Lvl %d), %s, %d health" % [i + 1, row[0], row[1], row[3], int(row[4])], p.fighter_name == row[0] and p.level == row[1] and p.style.archetype == row[2] and p.get_style_title() == row[3] and p.max_health == row[4], "got %s Lvl %d %s %s %.0f" % [p.fighter_name, p.level, p.style.archetype, p.get_style_title(), p.max_health])
		check("ladder: %s adaptive = %s (only the Champ adapts)" % [row[0], row[5]], p.adaptive == row[5], "adaptive=%s" % p.adaptive)
		check("ladder: %s has no second style" % row[0], p.alt_style == null)
	# Style character from the README table.
	var noob: FightStyle = ladder[0].style
	var longest := true
	for k in 5:
		if ladder[k].style.telegraph > noob.telegraph:
			longest = false
	check("style: the Noob has the longest wind-ups and the slowest recovery", longest and noob.recovery >= 1.4 and noob.hands_down > 0.5, "telegraph %.2f recovery %.2f hands_down %.2f" % [noob.telegraph, noob.recovery, noob.hands_down])
	var pressure: FightStyle = ladder[1].style
	var lens := pressure.combos.map(func(c: Array) -> int: return c.size())
	check("style: Cardio Carl throws three and four punch flurries and keeps walking", pressure.pressure and lens.all(func(n: int) -> bool: return n == 3 or n == 4) and lens.has(4), "lengths %s pressure=%s" % [lens, pressure.pressure])
	check_near("style: Viktor feints six leads in ten", ladder[2].style.feint_chance, 0.6, 0.001)
	check("style: Viktor holds the end of a long reach", ladder[2].style.preferred_range > ladder[1].style.preferred_range and ladder[2].style.reach > 0.0)
	var boris: FightStyle = ladder[3].style
	var body_first := 0
	for c: Array in boris.combos:
		if Strike.zone_of(c[0]) == Strike.Zone.BODY:
			body_first += 1
	check("style: Boris rips the body and grabs the clinch", boris.clinch_rate > 0.0 and body_first * 2 >= boris.combos.size() and boris.drain_power > 1.0, "body-first combos %d of %d clinch_rate %.2f" % [body_first, boris.combos.size(), boris.clinch_rate])
	var pro: FightStyle = ladder[4].style
	check("style: the Champ is calm for 4 to 8 s, then bursts head-body-head", pro.probe_time == Vector2(4.0, 8.0) and pro.burst_combos.size() > 0 and pro.burst_combos.any(func(c: Array) -> bool: return c.size() == 3 and Strike.zone_of(c[0]) == Strike.Zone.HEAD and Strike.zone_of(c[1]) == Strike.Zone.BODY and Strike.zone_of(c[2]) == Strike.Zone.HEAD), "probe %s bursts %s" % [pro.probe_time, pro.burst_combos.size()])


func test_league_profiles() -> void:
	var pairs := [[A.SNIPER, A.PRESSURE], [A.DIRTY, A.PRO], [A.PRESSURE, A.DIRTY], [A.PRO, A.SNIPER]]
	var health_ok := true
	var pair_ok := true
	var health_bad := ""
	var seen_pairs := {}
	for level in range(16, 61):
		var c := FighterRoster.league_challenger(level)
		var expected_health := 714.0 + 14.0 * float(level - 16)
		if c.max_health != expected_health:
			health_ok = false
			health_bad += " L%d=%.0f(expected %.0f)" % [level, c.max_health, expected_health]
		var pair := [c.style.archetype, c.alt_style.archetype]
		if not pairs.has(pair):
			pair_ok = false
		seen_pairs[str(pair)] = true
		if not c.adaptive or c.alt_style == null or not c.is_league() or c.level != level:
			pair_ok = false
	check("league: health is 714 at level 16 and rises 14 a level (levels 16-60)", health_ok, health_bad)
	check("league: every challenger is adaptive with one of the four documented hybrids", pair_ok, "")
	check("league: all four hybrids occur across levels 16-60", seen_pairs.size() == 4, "%d distinct" % seen_pairs.size())
	# Deterministic per level.
	var same := true
	var diff := ""
	for level in [16, 17, 25, 31, 45, 60]:
		var a := FighterRoster.league_challenger(level)
		var b := FighterRoster.league_challenger(level)
		var fields := ["fighter_name", "max_health", "max_stamina", "stamina_regen", "damage", "chin", "guard_max", "guard_regen", "composure", "height", "build", "skin", "hair", "shorts", "gloves", "cash", "xp", "blurb", "rank", "tenure"]
		for f: String in fields:
			if a.get(f) != b.get(f):
				same = false
				diff += " L%d.%s" % [level, f]
		for f: String in ["telegraph", "recovery", "follow_haste", "counter_haste", "attack_delay", "guard_read", "slip_skill", "feint_read", "counter_rate", "slip_cooldown", "probe_time", "archetype"]:
			if a.style.get(f) != b.style.get(f) or a.alt_style.get(f) != b.alt_style.get(f):
				same = false
				diff += " L%d.style.%s" % [level, f]
	check("league: league_challenger(level) is deterministic per level", same, "differs in:" + diff)
	var names := {}
	for level in range(16, 40):
		names[FighterRoster.league_challenger(level).fighter_name] = true
	check("league: different levels give different challengers", names.size() > 10, "%d distinct names in 24 levels" % names.size())
	# Fight IQ: windows tighten up to level 31 and stay put after it.
	var ratios := {}
	for level in [16, 20, 25, 31, 45, 60]:
		var c := FighterRoster.league_challenger(level)
		var base := FightStyle.make(c.style.archetype)
		ratios[level] = c.style.telegraph / base.telegraph
	check("league: wind-ups tighten as levels climb and are sharpest from level 31", ratios[16] > ratios[20] and ratios[20] > ratios[25] and ratios[25] > ratios[31] and absf(ratios[31] - ratios[45]) < 0.0001 and absf(ratios[45] - ratios[60]) < 0.0001, "telegraph ratios %s" % [ratios])
	var iq := {}
	for level in [16, 31, 60]:
		var c := FighterRoster.league_challenger(level)
		var base := FightStyle.make(c.style.archetype)
		iq[level] = [c.style.guard_read - base.guard_read, c.style.feint_read - base.feint_read, c.style.counter_rate - base.counter_rate]
	check("league: reads, feint reading and counters improve from level 16 to 31", iq[31][0] >= iq[16][0] and iq[31][1] >= iq[16][1] and iq[31][2] >= iq[16][2] and iq[31][0] > 0.0, "gains %s" % [iq])


func test_ladder_in_bout() -> void:
	for i in 5:
		await fresh(i, false, null, 0.0)
		var p: FighterProfile = ring.profile
		check("bout: %s starts with full health %d, style %s" % [p.fighter_name, int(p.max_health), p.get_style_title()], opp.health == p.max_health and opp.brain.style.archetype == p.style.archetype and hud._opponent_style.text == p.get_style_title().to_upper() and hud._opponent_name.text == p.fighter_name.to_upper(), "health=%.0f style=%s hud style '%s'" % [opp.health, opp.brain.style.archetype, hud._opponent_style.text])


func test_read_third_repeat() -> void:
	# Cross, cross, cross: the third is read, slipped and answered with a finisher counter.
	await open_fight(true)
	var s1 := await throw("R")
	await secs(0.85)
	var s2 := await throw("R")
	check("adaptive: the second identical cross is not read", s1.outcome == Strike.Outcome.HIT and s2.outcome == Strike.Outcome.HIT and opp_entered(S.SLIP) < 0.0, "outcomes %s %s slip=%.2f" % [s1.outcome, s2.outcome, opp_entered(S.SLIP)])
	await secs(0.85)
	var s3 := await throw("R")
	check("adaptive: the third identical cross is read and slipped", s3.outcome == Strike.Outcome.DODGED and opp_entered(S.SLIP) > 0.0, "outcome=%s slip=%.2f" % [s3.outcome, opp_entered(S.SLIP)])
	await secs(1.6)
	var land := last_landing()
	var counter: Strike = land["strike"] if not land.is_empty() else null
	check("adaptive: ... and answered with a counter flagged as a finisher", counter != null and counter.finisher and land["kind"] == opp.brain.style.counter_move, "landings %d finisher=%s" % [brain.landings.size(), counter.finisher if counter != null else "?"])
	check("adaptive: ... which floors the player when it lands clean", counter != null and counter.outcome != Strike.Outcome.MISS and combat.knockdowns == 1 and count_ev("p_knocked_down") == 1, "outcome=%s knockdowns=%d" % [counter.outcome if counter != null else -1, combat.knockdowns])
	# A combination: jab-cross three times, the cross of the third is read.
	await open_fight(true)
	await chain("LR", 0.25)
	await secs(1.3)
	await chain("LR", 0.25)
	await secs(1.3)
	check("adaptive: (setup) two jab-cross combinations landed, no slip yet", resolved.size() == 4 and opp_entered(S.SLIP) < 0.0, "resolved %s slip %.2f" % [resolved.map(func(r: Strike) -> int: return r.outcome), opp_entered(S.SLIP)])
	await chain("LR", 0.25)
	await secs(0.6)
	check("adaptive: the cross of the third jab-cross is read and slipped", resolved.size() == 6 and resolved[4].outcome == Strike.Outcome.HIT and resolved[5].outcome == Strike.Outcome.DODGED and opp_entered(S.SLIP) > 0.0, "outcomes %s" % [resolved.map(func(r: Strike) -> int: return r.outcome)])
	# Controls: a fighter that does not adapt never reads it; strikes closer than 0.75 s are one sequence.
	await open_fight(false)
	await throw("R")
	await secs(0.85)
	await throw("R")
	await secs(0.85)
	var c3 := await throw("R")
	await secs(1.0)
	check("adaptive: control, a non-adaptive fighter never reads the third repeat", c3.outcome == Strike.Outcome.HIT and opp_entered(S.SLIP) < 0.0 and brain.landings.is_empty())
	await open_fight(true)
	await throw("R")
	await secs(0.3)
	await throw("R")
	await secs(0.3)
	var q3 := await throw("R")
	check("adaptive: control, crosses 0.3 s apart are one sequence, not a habit", q3.outcome == Strike.Outcome.HIT and opp_entered(S.SLIP) < 0.0, "outcome=%s" % q3.outcome)
	# A lone jab is a probe, not a habit.
	await open_fight(true)
	await throw("L")
	await secs(0.85)
	await throw("L")
	await secs(0.85)
	var j3 := await throw("L")
	check("adaptive: control, a repeated lone jab is a probe and is never read", j3.outcome == Strike.Outcome.HIT and opp_entered(S.SLIP) < 0.0, "outcome=%s" % j3.outcome)


func test_slip_habit() -> void:
	# Two slips to the right, then a punch: the third slip right is held out by him.
	await open_fight(true)
	await slip(&"move_right")
	await secs(0.75)
	await slip(&"move_right")
	await secs(0.75)
	check("adaptive: (setup) two right slips are remembered", opp.brain.memory.dodges == [1, 1], "dodges %s" % [opp.brain.memory.dodges])
	opp.start_attack([Strike.JAB])
	await frames(14)
	await slip(&"move_right")
	await until(func() -> bool: return brain.landings.size() > 0, 200)
	var land := last_landing()
	var s: Strike = land["strike"]
	check("adaptive: the third slip the same way is waited out (punch lands after the slip is over)", land["dodge_age"] >= CombatController.IFRAME_TIME and s.outcome == Strike.Outcome.HIT, "slip age %.3f outcome=%s" % [land["dodge_age"], s.outcome])
	check("adaptive: ... and it is a finisher that floors the player", s.finisher and combat.knockdowns == 1, "finisher=%s knockdowns=%d" % [s.finisher, combat.knockdowns])
	# Only one earlier slip: the second slip is dodged as usual.
	await open_fight(true)
	await slip(&"move_right")
	await secs(0.75)
	opp.start_attack([Strike.JAB])
	await frames(14)
	await slip(&"move_right")
	await until(func() -> bool: return brain.landings.size() > 0, 200)
	land = last_landing()
	s = land["strike"]
	check("adaptive: the second slip the same way is not waited out (dodged normally)", s.outcome == Strike.Outcome.DODGED and not s.finisher and land["dodge_age"] < CombatController.IFRAME_TIME, "slip age %.3f outcome=%s finisher=%s" % [land["dodge_age"], s.outcome, s.finisher])
	# Two right slips then a left one: not a habit.
	await open_fight(true)
	await slip(&"move_right")
	await secs(0.75)
	await slip(&"move_right")
	await secs(0.75)
	opp.start_attack([Strike.JAB])
	await frames(14)
	await slip(&"move_left")
	await until(func() -> bool: return brain.landings.size() > 0, 200)
	land = last_landing()
	s = land["strike"]
	check("adaptive: a left slip after two right slips is dodged normally", s.outcome == Strike.Outcome.DODGED and not s.finisher, "slip age %.3f outcome=%s" % [land["dodge_age"], s.outcome])
	# Control: a non-adaptive fighter never holds the punch.
	await open_fight(false)
	await slip(&"move_right")
	await secs(0.75)
	await slip(&"move_right")
	await secs(0.75)
	opp.start_attack([Strike.JAB])
	await frames(14)
	await slip(&"move_right")
	await until(func() -> bool: return brain.landings.size() > 0, 200)
	land = last_landing()
	s = land["strike"]
	check("adaptive: control, a non-adaptive fighter does not wait out the third slip", s.outcome == Strike.Outcome.DODGED and not s.finisher, "slip age %.3f outcome=%s" % [land["dodge_age"], s.outcome])


func test_league_swaps() -> void:
	for level in [16, 31, 60]:
		var profile := FighterRoster.league_challenger(level)
		await fresh(4, false, profile, 0.0)
		combat.max_health = 1.0e9
		combat.health = 1.0e9
		combat.chin.reset(1.0e9)
		var styles: Array = [profile.style, profile.alt_style]
		var current: FightStyle = opp.brain.style
		var swaps: Array = []
		var t_start := game_time
		var seen_order := []
		for i in 3000:
			await frames(1)
			combat.health = 1.0e9
			if opp.brain.style != current:
				swaps.append(game_time - t_start)
				seen_order.append(styles.find(opp.brain.style))
				current = opp.brain.style
				t_start = game_time
				if swaps.size() >= 4:
					break
		check("league L%d: starts in the first style and swaps %d times in the first %.0f s" % [level, swaps.size(), game_time], styles.has(current) and swaps.size() >= 3, "swaps at %s" % [swaps])
		var inside := swaps.size() >= 3
		for dt: float in swaps:
			if dt < 5.0 - 0.05 or dt > 8.0 + 2.5:
				inside = false
		check("league L%d: a swap comes every 5 to 8 s (allowing for a fight in progress): %s" % [level, swaps.map(func(x: float) -> String: return "%.1f" % x)], inside, "intervals %s" % [swaps])
		var alternating := seen_order.size() >= 3
		for k in seen_order.size():
			if seen_order[k] != (1 if k % 2 == 0 else 0):
				alternating = false
		check("league L%d: it alternates between its two styles" % level, alternating, "order %s" % [seen_order])
