extends "res://tests/combat_rules/rules_base.gd"
## Rule group 9: tells. Every strike is announced by a cue and a glowing glove, and the time from
## the cue appearing to the strike landing is never under EnemyFighter.MIN_WINDUP (0.28 s),
## whatever the style, move, or haste path (lead, follow-up, burst, slip counter, riposte, tired).
## Measured in the running game: cue label first visible -> the fighter's strike resolved.

const G := EnemyFighter.Guard
const S := EnemyFighter.State
const MOVES := [Strike.JAB, Strike.CROSS, Strike.HOOK, Strike.UPPERCUT, Strike.OVERHAND, Strike.BODY_HOOK, Strike.BODY_CROSS, Strike.KICK, Strike.KNEE]
const CUE_OF := {
	Strike.JAB: "!", Strike.CROSS: "!!", Strike.HOOK: "!!", Strike.UPPERCUT: "!!", Strike.OVERHAND: "!!",
	Strike.BODY_HOOK: "LOW", Strike.BODY_CROSS: "LOW", Strike.KICK: "LOW", Strike.KNEE: "LOW",
}

var min_slip_post := 99.0
var min_slip_post_where := ""
var min_overall := 99.0
var measurements := 0
var path_min := {}


func open_fight() -> void:
	await fresh(4, true, null, 1.0)
	opp.set_guard(G.NONE)
	opp.profile.stamina_regen = 0.0
	combat.max_health = 1.0e9
	combat.health = 1.0e9
	combat.chin.reset(1.0e9)
	track_tells = true
	await frames(2)


func reset_opponent(tired: bool) -> void:
	opp._end_attack()
	opp._enter(S.FOOTWORK)
	opp._set_stamina(0.0 if tired else opp.profile.max_stamina)
	reset_player_light()
	brain.landings.clear()
	clear_cues()
	ftime.clear()


func reset_player_light() -> void:
	combat.health = combat.max_health
	PlayerStats.stamina = PlayerStats.max_stamina
	PlayerStats.is_exhausted = false


## Starts `path` for `kind` and waits for the strikes to land. Returns the measured tell times:
## "dts" (cue -> landing for each strike of the path), "post_slip" for the slip path.
func trial(style: FightStyle, kind: StringName, path: String, tired: bool) -> Dictionary:
	opp.profile.style = style
	opp.brain.style = style
	reset_opponent(tired)
	await frames(1)
	var expected := 1
	match path:
		"lead":
			opp.start_attack([kind], 1.0)
		"follow":
			opp.start_attack([Strike.JAB, kind])
			expected = 2
		"burst":
			opp.start_burst([kind, kind])
			expected = 2
		"slip":
			opp.start_slip(Vector3.RIGHT, kind, style.counter_haste)
		"riposte":
			opp.start_attack([kind], style.counter_haste)
		"finish":
			opp.start_attack([kind], 0.85)
	await until(func() -> bool: return brain.landings.size() >= expected, 500)
	await frames(1)
	var out := {"ok": brain.landings.size() >= expected, "dts": [], "cues": cues.duplicate(true)}
	if not out["ok"]:
		return out
	match path:
		"follow":
			if cues.size() >= 2:
				out["dts"].append(land_time(1) - cues[1]["t"])
		"burst":
			if cues.size() >= 3:
				out["dts"].append(land_time(0) - cues[0]["t"])
				out["dts"].append(land_time(0) - cues[1]["t"])
				out["dts"].append(land_time(1) - cues[2]["t"])
		"slip":
			if not cues.is_empty():
				var total: float = land_time(0) - cues[0]["t"]
				out["dts"].append(total)
				out["post_slip"] = total - EnemyFighter.SLIP_TIME
		_:
			if not cues.is_empty():
				out["dts"].append(land_time(0) - cues[0]["t"])
	return out


func run() -> void:
	await test_cues_and_glove()
	await test_feint_cue()
	await test_matrix()


func test_cues_and_glove() -> void:
	await open_fight()
	var style := FightStyle.new()
	for kind: StringName in MOVES:
		var r := await trial(style, kind, "lead", false)
		var c: Dictionary = r["cues"][0] if not r["cues"].is_empty() else {}
		check("cue: %s shows '%s'" % [kind, CUE_OF[kind]], not c.is_empty() and c["text"] == CUE_OF[kind], "cues %s" % [r["cues"].map(func(x: Dictionary) -> String: return x["text"])])
		check("glove: %s lights the glove through the wind-up" % kind, not c.is_empty() and c["peak"] > 1.5 and c["last"] > 1.5 and c["dark_frames"] == 0, "peak %.2f last %.2f dark frames %d" % [c.get("peak", -1.0), c.get("last", -1.0), c.get("dark_frames", -1)])
		check("cue: %s cue is hidden once the punch has landed" % kind, not opp.telegraph.visible and opp._glove_materials[0].emission_energy_multiplier == 0.0 and opp._glove_materials[1].emission_energy_multiplier == 0.0, "visible=%s" % opp.telegraph.visible)
	var r := await trial(style, Strike.CROSS, "burst", false)
	var texts: Array = r["cues"].map(func(x: Dictionary) -> String: return x["text"])
	check("cue: a burst shows !!! first, then each strike's own cue", texts.size() >= 3 and texts[0] == "!!!" and texts[1] == "!!", "cues %s" % [texts])
	reset_opponent(false)
	await frames(1)
	opp.start_clinch()
	await frames(2)
	check("cue: a clinch attempt shows GRAB", opp.telegraph.visible and opp.telegraph.text == "GRAB", "cue '%s' visible=%s" % [opp.telegraph.text, opp.telegraph.visible])
	var counter := await trial(style, Strike.CROSS, "slip", false)
	var ct: Array = counter["cues"].map(func(x: Dictionary) -> String: return x["text"])
	check("cue: a counter thrown out of a slip shows its cue from the first frame of the slip", not ct.is_empty() and ct[0] == "!!", "cues %s" % [ct])


func test_feint_cue() -> void:
	await open_fight()
	for kind: StringName in [Strike.JAB, Strike.CROSS, Strike.BODY_HOOK]:
		reset_opponent(false)
		await frames(1)
		var hp := combat.health
		opp.start_feint(kind)
		await secs(0.6)
		var c: Dictionary = cues[0] if not cues.is_empty() else {}
		check("feint: %s feint shows the cue '%s'" % [kind, CUE_OF[kind]], not c.is_empty() and c["text"] == CUE_OF[kind], "cues %s" % [cues.map(func(x: Dictionary) -> String: return x["text"])])
		check("feint: %s feint never lights the glove" % kind, not c.is_empty() and c["peak"] == 0.0, "peak glow %.2f" % c.get("peak", -1.0))
		check("feint: %s feint throws nothing (no strike, no damage)" % kind, brain.landings.is_empty() and combat.health >= hp, "landings %d" % brain.landings.size())
		check("feint: %s feint ends back in neutral" % kind, opp.state == S.FOOTWORK and not opp.telegraph.visible, "state=%s" % opp.state)
	check_near("feint: a feint lasts 0.26 s", opp_state_duration(S.FEINT), EnemyFighter.FEINT_TIME, 0.08)


func style_list() -> Array:
	var out := []
	for a: int in FightStyle.Archetype.values():
		out.append(["make(%s)" % FightStyle.SHORT_TITLES[a], FightStyle.make(a)])
	for a: int in FightStyle.Archetype.values():
		out.append(["make(%s).sharpen(1.0)" % FightStyle.SHORT_TITLES[a], FightStyle.make(a).sharpen(1.0)])
	for p: FighterProfile in FighterRoster.ladder():
		out.append(["ladder %s" % p.fighter_name, p.style])
	for level in [16, 31, 60]:
		var c := FighterRoster.league_challenger(level)
		out.append(["league L%d %s" % [level, FightStyle.SHORT_TITLES[c.style.archetype]], c.style])
		out.append(["league L%d %s (alt)" % [level, FightStyle.SHORT_TITLES[c.alt_style.archetype]], c.alt_style])
	return out


func test_matrix() -> void:
	await open_fight()
	var paths := [["lead", false], ["follow", false], ["burst", false], ["slip", false], ["riposte", false], ["finish", false], ["lead", true], ["follow", true], ["burst", true], ["slip", true]]
	var worst := 99.0
	var worst_where := ""
	for entry: Array in style_list():
		var label: String = entry[0]
		var style: FightStyle = entry[1]
		var style_min := 99.0
		var style_where := ""
		var failures := []
		var missing := 0
		var count := 0
		for kind: StringName in MOVES:
			for p: Array in paths:
				var r := await trial(style, kind, p[0], p[1])
				var where := "%s %s%s" % [p[0], kind, " tired" if p[1] else ""]
				if not r["ok"] or r["dts"].is_empty():
					missing += 1
					failures.append("%s: never landed" % where)
					continue
				for dt: float in r["dts"]:
					count += 1
					measurements += 1
					var pkey: String = "%s%s" % [p[0], " (tired)" if p[1] else ""]
					if not path_min.has(pkey) or dt < path_min[pkey][0]:
						path_min[pkey] = [dt, "%s %s" % [label, kind]]
					if dt < style_min:
						style_min = dt
						style_where = where
					if dt < EnemyFighter.MIN_WINDUP - 0.0001:
						failures.append("%s: %.3f s" % [where, dt])
				if p[0] == "slip" and r.has("post_slip") and r["post_slip"] < min_slip_post:
					min_slip_post = r["post_slip"]
					min_slip_post_where = "%s %s%s" % [label, kind, " tired" if p[1] else ""]
		if style_min < worst:
			worst = style_min
			worst_where = "%s / %s" % [label, style_where]
		check("tells[%s]: cue -> landing never under 0.28 s over %d measurements (min %.3f s via %s)" % [label, count, style_min, style_where], failures.is_empty(), "%s" % [failures.slice(0, 6)])
	min_overall = worst
	print("INFO tells: %d measurements, smallest cue->landing %.3f s (%s)" % [measurements, worst, worst_where])
	for key: String in path_min:
		print("INFO tells: path %s: smallest cue -> landing %.3f s (%s)" % [key, path_min[key][0], path_min[key][1]])
	print("INFO tells: slip-counter path, the part of the tell after the slip ends (slip itself counts as tell): smallest %.3f s (%s); the cue is visible for slip (0.36 s) + that" % [min_slip_post, min_slip_post_where])
