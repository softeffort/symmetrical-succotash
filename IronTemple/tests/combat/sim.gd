extends Node
## Bout simulator: a scripted player (see fight_bot.gd) fights one opponent again and again in
## the real main scene and the lengths and results are printed.
##
##   godot --headless --path . --fixed-fps 60 res://tests/combat/sim.tscn -- \
##       --opp=viktor --skill=average --bouts=20 --seed=1 --edge=0
##
## `opp` is sam, carl, viktor, boris, champ or league<level>; `skill` is masher, novice,
## average or skilled; `edge` trains the player that many tiers past the opponent's.

const MAIN := preload("res://scenes/main.tscn")
const FightBot := preload("res://tests/combat/fight_bot.gd")
const Builds := preload("res://tests/combat/builds.gd")

const LADDER_IDS := ["sam", "carl", "viktor", "boris", "champ"]
## A bout still running after this long counts as stuck.
const BOUT_LIMIT := 240.0

## `tune` names a JSON file of trial numbers, to try a tuning before it goes into the roster:
## {"viktor": {"damage": 5.5, "style.feint_chance": 0.5}, "league": {"x:max_health": 1.2}}.
## A key is a FighterProfile property, or a FightStyle one after "style."; "x:" multiplies
## instead of replacing; "league" applies to every league challenger. `hp` scales the
## player's health and `hp_add` adds to it.
var _args := {"opp": "sam", "skill": "average", "bouts": "20", "seed": "1", "edge": "0", "verbose": "0", "tune": "", "hp": "1", "hp_add": "0"}


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		var pair := arg.trim_prefix("--").split("=")
		if pair.size() == 2:
			_args[pair[0]] = pair[1]
	seed(int(_args["seed"]))
	add_child(MAIN.instantiate())
	_run.call_deferred()


func _run() -> void:
	for i in 40:
		await get_tree().physics_frame
	var ring := get_tree().get_first_node_in_group(&"ring") as RingManager
	var player := get_tree().get_first_node_in_group(&"player") as Player
	var profile := _profile(String(_args["opp"]))
	_tune(profile)
	var wins := FighterRoster.LADDER_SIZE + profile.level - FighterRoster.LEAGUE_START_LEVEL if profile.is_league() else profile.ladder_index
	var build := Builds.train_to(_level_for(profile, int(_args["edge"])), wins)
	var bot := FightBot.new()
	add_child(bot)
	bot.setup(player, ring, String(_args["skill"]), int(_args["seed"]))
	var rows: Array[Dictionary] = []
	for bout in int(_args["bouts"]):
		Builds.apply(build, wins)
		if ring.state == RingManager.State.RESULT and bout % 2 == 1:
			ring.rematch()
		else:
			if ring.state == RingManager.State.RESULT:
				ring.exit_ring()
			ring.start_bout(profile)
		player.combat.max_health = player.combat.max_health * float(_args["hp"]) + float(_args["hp_add"])
		player.combat.health = player.combat.max_health
		var stuck := false
		while ring.state != RingManager.State.RESULT:
			await get_tree().physics_frame
			if ring.state == RingManager.State.FIGHT and ring.bout_time > BOUT_LIMIT and not stuck:
				stuck = true
				player.combat._go_out(false)
		rows.append(_record(ring, player, stuck))
		if _args["verbose"] != "0":
			print("BOUT ", JSON.stringify(rows[-1]))
	_summarise(profile, build, rows)
	get_tree().quit(0)


func _profile(id: String) -> FighterProfile:
	if id.begins_with("league"):
		return FighterRoster.league_challenger(int(id.trim_prefix("league")))
	return FighterRoster.ladder()[LADDER_IDS.find(id)]


func _tune(profile: FighterProfile) -> void:
	if String(_args["tune"]).is_empty():
		return
	var table: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(String(_args["tune"])))
	var entry: Dictionary = table.get("league" if profile.is_league() else String(_args["opp"]), {})
	for key: String in entry:
		var scale := key.begins_with("x:")
		var path := key.trim_prefix("x:")
		var targets: Array[Object] = [profile]
		if path.begins_with("style."):
			path = path.trim_prefix("style.")
			targets = [profile.style]
			if profile.alt_style != null:
				targets.append(profile.alt_style)
		for target in targets:
			target.set(path, target.get(path) * float(entry[key]) if scale else entry[key])


## The level the player has trained to: the opponent's, or that of the fighter `edge` tiers up.
func _level_for(profile: FighterProfile, edge: int) -> int:
	if profile.is_league():
		# The league is reached with the body that beat the boss; the fights pay for the levels.
		return FighterRoster.BOSS_LEVEL + 4 * edge
	var ladder := FighterRoster.ladder()
	var index := profile.ladder_index + edge
	if index < ladder.size():
		return ladder[index].level
	return FighterRoster.BOSS_LEVEL + 4 * (index - ladder.size() + 1)


func _record(ring: RingManager, player: Player, stuck: bool) -> Dictionary:
	var combat := player.combat
	var foe := ring.opponent
	var won := foe.state == EnemyFighter.State.OUT
	var finish := String(foe.finish)
	if stuck:
		finish = "stuck"
	elif not won:
		finish = "knockdowns" if combat.knockdowns >= CombatController.MAX_KNOCKDOWNS else ("ko" if combat.bout_damage_taken >= combat.max_health - 0.5 else "counter")
	return {
		"won": won, "time": snappedf(ring.bout_time, 0.1), "finish": finish,
		"kd_for": foe.knockdowns, "kd_against": combat.knockdowns,
		"intercepts": combat.bout_intercepts, "counters": combat.bout_counters, "baits": combat.bout_baits,
		"hp": snappedf(combat.health / combat.max_health, 0.01), "foe_hp": snappedf(foe.health / foe.profile.max_health, 0.01),
		"dealt": roundi(combat.bout_damage_dealt), "taken": roundi(combat.bout_damage_taken),
	}


func _summarise(profile: FighterProfile, build: Dictionary, rows: Array[Dictionary]) -> void:
	var times: Array[float] = []
	var wins := 0
	var finishes := {}
	var totals := {"kd_for": 0.0, "kd_against": 0.0, "intercepts": 0.0, "counters": 0.0, "baits": 0.0, "foe_hp": 0.0, "hp": 0.0}
	for row in rows:
		times.append(row["time"])
		wins += 1 if row["won"] else 0
		var key := ("W:" if row["won"] else "L:") + String(row["finish"])
		finishes[key] = int(finishes.get(key, 0)) + 1
		for stat: String in totals:
			totals[stat] += float(row[stat]) / rows.size()
	times.sort()
	var count := times.size()
	for stat: String in totals:
		totals[stat] = snappedf(totals[stat], 0.01)
	print("SUMMARY ", JSON.stringify({
		"opp": _args["opp"], "skill": _args["skill"], "edge": int(_args["edge"]), "bouts": count, "wins": wins,
		"median": times[count / 2], "p10": times[count / 10], "p90": times[mini(count * 9 / 10, count - 1)],
		"min": times[0], "max": times[count - 1], "finishes": finishes, "avg": totals,
		"build": {"level": build["level"], "reps": build["reps"], "str": roundi(build["strength"]), "arms": roundi(build["arms"]), "torso": roundi(build["torso"]), "legs": roundi(build["legs"]), "hp": roundi(PlayerStats.get_max_health()), "foe_hp": roundi(profile.max_health)},
	}))
