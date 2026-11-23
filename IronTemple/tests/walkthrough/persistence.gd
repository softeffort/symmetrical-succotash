extends "res://tests/walkthrough/walk.gd"
## Step 4 saving. Several phases, each a separate process of the real game (run them in order with
## the same XDG_DATA_HOME, see run_all.sh):
##   phase1        play, change settings, save, remember the numbers
##   phase2        a fresh process loads the save: everything identical, starts at the gym door
##   phase3        the save written on window close is there; Reset Career keeps the settings
##   legacy_write  hand-written Step 4 save file (no game code involved)
##   legacy_check  the current build loads it with the right values and no errors
##   league_write  / league_check   a Step 4 save with the Endless League open
##   damaged_write / damaged_check  missing and out-of-range fields
##   corrupt_write / corrupt_check  a save file that is not JSON
## Expected numbers travel between phases in user://walk_expected.json.

const EXPECTED := "user://walk_expected.json"
const SAVE_KEYS := ["level", "xp", "cash", "strength", "max_stamina", "muscle_arms", "muscle_torso", "muscle_legs", "gym_tenure", "ladder_progress", "league_wins"]

var phase := ""


func _init() -> void:
	area = "persistence"


func run() -> void:
	var args := OS.get_cmdline_user_args()
	phase = args[0] if args.size() > 0 else "phase1"
	area = "persistence:" + phase
	print("== PHASE %s ==" % phase)
	seed(5)
	match phase:
		"phase1":
			await _phase1()
		"phase2":
			await _phase2()
		"phase3":
			await _phase3()
		"legacy_write":
			_write_legacy()
		"legacy_check":
			await _check_legacy()
		"league_write":
			_write_league()
		"league_check":
			await _check_league()
		"damaged_write":
			_write_damaged()
		"damaged_check":
			await _check_damaged()
		"corrupt_write":
			_write_corrupt()
		"corrupt_check":
			await _check_corrupt()
		_:
			check("known phase '%s'" % phase, false, "unknown phase")


func _write_text(path: String, text: String) -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(text)
	file.close()
	return true


func _stats_snapshot() -> Dictionary:
	var record := PlayerStats.fight_record
	return {
		"level": PlayerStats.level, "xp": PlayerStats.xp, "cash": PlayerStats.cash, "strength": PlayerStats.strength,
		"max_stamina": PlayerStats.max_stamina, "muscle_arms": PlayerStats.muscle_arms, "muscle_torso": PlayerStats.muscle_torso,
		"muscle_legs": PlayerStats.muscle_legs, "gym_tenure": PlayerStats.gym_tenure, "ladder_progress": PlayerStats.ladder_progress,
		"league_wins": PlayerStats.league_wins, "wins": record.wins, "losses": record.losses, "win_streak": record.win_streak,
		"best_streak": record.best_streak, "rank": PlayerStats.rank_title,
		"sens": SaveManager.get_mouse_sensitivity(), "music": SaveManager.get_setting("MusicOn"), "sfx": SaveManager.get_setting("SfxOn"),
		"reached_gym": SaveManager.reached_gym,
	}


func _store_expected() -> void:
	_write_text(EXPECTED, JSON.stringify(_stats_snapshot(), "\t", true, true))


func _load_expected() -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(EXPECTED))
	return parsed if parsed is Dictionary else {}


func _compare(label: String, want: Dictionary) -> void:
	var have := _stats_snapshot()
	var bad: Array[String] = []
	for key: String in want:
		var a: Variant = have[key]
		var b: Variant = want[key]
		var same: bool = absf(float(a) - float(b)) < 1e-9 if (a is float or a is int) and (b is float or b is int) else a == b
		if not same:
			bad.append("%s: have %s want %s" % [key, a, b])
	check("%s: all %d saved numbers come back identical (level, XP, cash, strength, stamina, muscles, tenure, record, ladder, league, settings)" % [label, want.size()], bad.is_empty(), "; ".join(bad))


func _curl_reps(count: int) -> int:
	var st := stations_of(&"dumbbell_curl")[1] as CurlStation
	if not await use_station(st):
		return -1
	var done := 0
	var button := MOUSE_BUTTON_LEFT
	for i in count:
		var arm := 0 if button == MOUSE_BUTTON_LEFT else 1
		var reps0 := st.reps
		mouse_button(button, true)
		await until(func() -> bool: return st.reps > reps0 or st.curl[arm] >= 0.99, 1.5)
		mouse_button(button, false)
		if st.reps > reps0:
			done += 1
		button = MOUSE_BUTTON_RIGHT if button == MOUSE_BUTTON_LEFT else MOUSE_BUTTON_LEFT
	await secs(0.5)
	await tap_key(KEY_E)
	await frames(4)
	return done


# --- phase 1: build a career and save it -----------------------------------------------------

func _phase1() -> void:
	wipe_career()
	await boot()
	check("phase 1 starts from a brand-new career", PlayerStats.level == 1 and PlayerStats.cash == 0 and not SaveManager.reached_gym, "level=%d cash=%d reached=%s file=%s" % [PlayerStats.level, PlayerStats.cash, SaveManager.reached_gym, FileAccess.file_exists(SAVE_PATH)])
	await place_player(gym_point(0.0, 3.0), 0.0)
	# A veteran career, loaded through the same loader the game uses at start-up.
	PlayerStats.apply_save({"Level": 8, "XP": 41.5, "Cash": 640, "Strength": 52.5, "MaxStamina": 123.25, "MuscleArms": 61.5, "MuscleTorso": 48.25, "MuscleLegs": 35.75,
		"GymTenure": 14.5, "FightRecord": {"Wins": 6, "Losses": 3, "WinStreak": 2, "BestStreak": 4}, "LadderProgress": 5, "LeagueWins": 2, "EndlessLeagueUnlocked": true})
	_compare("the veteran career is in place after apply_save", {"level": 8, "xp": 41.5, "cash": 640, "strength": 52.5, "max_stamina": 123.25, "muscle_arms": 61.5, "muscle_torso": 48.25, "muscle_legs": 35.75, "gym_tenure": 14.5, "ladder_progress": 5, "league_wins": 2, "wins": 6, "losses": 3, "win_streak": 2, "best_streak": 4, "rank": "Lean Grinder"})
	SaveManager.mark_gym_reached()
	check("arriving at the gym wrote a save file with ReachedGym true", read_save().get("ReachedGym") == true)
	var xp_before := PlayerStats.xp
	var arms_before := PlayerStats.muscle_arms
	var done := await _curl_reps(6)
	check("six real dumbbell curls were completed at the station (%d)" % done, done >= 5, "done=%d" % done)
	check("the session was banked in the save file the moment it ended", absf(float(read_save().get("Career", {}).get("XP", -1)) - PlayerStats.xp) < 1e-9 and read_save().get("Career", {}).get("MuscleArms", -1) > arms_before - 0.0001, "file xp=%s stats xp=%.3f" % [read_save().get("Career", {}).get("XP"), PlayerStats.xp])
	check("the reps changed XP and arm muscle (so the numbers being saved are not defaults)", PlayerStats.xp != xp_before or PlayerStats.level > 8, "xp %.2f -> %.2f" % [xp_before, PlayerStats.xp])
	# Settings through the pause menu.
	var pause := hud.pause_menu
	await press_escape()
	await frames(3)
	await click_control(pause._sensitivity, Vector2(0.3, 0.5))
	await click_control(pause._music)
	var sens := SaveManager.get_mouse_sensitivity()
	check("settings changed through the pause menu (sensitivity %.2fx, music off)" % sens, sens < 1.5 and sens > 0.3 and not SaveManager.get_setting("MusicOn") and SaveManager.get_setting("SfxOn"), "sens=%.3f" % sens)
	PlayerStats.add_pump(80.0)
	PlayerStats.protein_timer = 100.0
	PlayerStats.warmup_timer = 200.0
	PlayerStats.injury_timer = 30.0
	await click_control(pause._status.get_parent().get_child(3) if false else _save_button(pause))
	check("SAVE GAME in the pause menu writes the save", pause._status.text.begins_with("Saved"), "status='%s'" % pause._status.text)
	var data := read_save()
	var career: Dictionary = data.get("Career", {})
	var keys: Array = career.keys()
	keys.sort()
	check("the save file has the Step 4 layout (Version, SavedAt, ReachedGym, Career, Settings)", data.get("Version") == 1 and data.has("SavedAt") and data.get("ReachedGym") == true and data.has("Career") and data.has("Settings"), "keys=%s" % [data.keys()])
	check("the Career block holds level, XP, cash, strength, stamina, muscles, tenure, record, ladder and league", keys == ["Cash", "EndlessLeagueUnlocked", "FightRecord", "GymTenure", "Level", "LadderProgress", "LeagueWins", "MaxStamina", "MuscleArms", "MuscleLegs", "MuscleTorso", "Strength", "XP"] or keys == ["Cash", "EndlessLeagueUnlocked", "FightRecord", "GymTenure", "LadderProgress", "LeagueWins", "Level", "MaxStamina", "MuscleArms", "MuscleLegs", "MuscleTorso", "Strength", "XP"], "keys=%s" % [keys])
	check("buffs, pump and injuries are not part of the save", not career.has("Pump") and not career.has("Injury") and not career.has("Protein"), "keys=%s" % [keys])
	check("the save holds the live numbers", int(career.get("Level", -1)) == PlayerStats.level and int(career.get("Cash", -1)) == 640 and absf(float(career.get("Strength", -1)) - PlayerStats.strength) < 1e-9, "career=%s" % [career])
	_store_expected()
	await press_escape()
	note("phase 1 saved: %s" % [_stats_snapshot()])


func _save_button(pause: PauseMenu) -> Button:
	for button in pause.find_children("*", "Button", true, false):
		if (button as Button).text == "SAVE GAME":
			return button
	return null


# --- phase 2: a new process loads it ---------------------------------------------------------

func _phase2() -> void:
	var want := _load_expected()
	check("phase 2 found the numbers phase 1 saved", want.size() > 10, "expected=%s" % [want])
	_compare("fresh process, before the scene is even built", want)
	await boot()
	_compare("after the main scene started", want)
	check("a loaded career is announced rank-consistently (rank '%s')" % PlayerStats.rank_title, PlayerStats.rank_title == PlayerStats.get_rank_for(PlayerStats.level) and PlayerStats.rank_title == want["rank"])
	check("pump, warm-up, injury and buffs are not restored", PlayerStats.pump_level == 0.0 and PlayerStats.warmup_timer == 0.0 and PlayerStats.injury_timer == 0.0 and PlayerStats.protein_timer == 0.0 and PlayerStats.preworkout_timer == 0.0, "pump=%.1f warm=%.1f injury=%.1f protein=%.1f" % [PlayerStats.pump_level, PlayerStats.warmup_timer, PlayerStats.injury_timer, PlayerStats.protein_timer])
	check("stamina starts full after loading", near(PlayerStats.stamina, PlayerStats.max_stamina, 0.001))
	check("settings are applied: music off, sound on, loaded sensitivity", AudioManager.music_enabled == want["music"] and AudioManager.sfx_enabled == want["sfx"] and near(SaveManager.get_mouse_sensitivity(), want["sens"], 1e-9), "music=%s sfx=%s sens=%.3f" % [AudioManager.music_enabled, AudioManager.sfx_enabled, SaveManager.get_mouse_sensitivity()])
	var beacon := main.get_node("GymBeacon") as Beacon
	var door := beacon.global_position + Vector3(0.0, 0.05, 1.5)
	check("a returning player starts at the gym door, not at the house", player.global_position.distance_to(door) < 0.6, "pos=%s door=%s" % [player.global_position, door])
	check("the beacon is already switched off for a returning player", not beacon.active and not beacon.visible)
	check("the bike is still parked at the house and nobody rides", (main.get_node("Bicycle") as Bicycle).rider == null and player.vehicle == null)
	var next_text := "Endless League: challenger Lvl %d is waiting at the cage" % FighterRoster.next_league_level()
	check("objective welcomes the player back with the next fight", GameState.objective == "Welcome back. " + next_text and hud.objective_label.text == GameState.objective, "objective='%s'" % GameState.objective)
	check("HUD shows the loaded profile", hud.level_label.text == "Lvl %d" % PlayerStats.level and hud.rank_label.text == PlayerStats.get_profile_title() and hud.cash_label.text == "$640" and hud.record_label.text == "6 W - 3 L", "level='%s' rank='%s' cash='%s' record='%s'" % [hud.level_label.text, hud.rank_label.text, hud.cash_label.text, hud.record_label.text])
	check("HUD XP bar shows the loaded XP", hud.xp_label.text == "%d / %d XP" % [floori(PlayerStats.xp), roundi(PlayerStats.xp_to_next())], "xp label='%s'" % hud.xp_label.text)
	check("ladder and league progress came back: ladder cleared, League open at challenger level 18", FighterRoster.is_league_open() and FighterRoster.next_league_level() == 18 and FighterRoster.is_beaten(FighterRoster.ladder()[4]), "progress=%d league=%d" % [PlayerStats.ladder_progress, PlayerStats.league_wins])
	var spot := player.global_position
	key_down(KEY_W)
	await secs(0.8)
	key_up(KEY_W)
	check("the loaded player can walk", player.global_position.distance_to(spot) > 2.0)
	# Window close writes the save: change something now and close the window.
	PlayerStats.add_cash(7)
	var expected := _load_expected()
	expected["cash"] = PlayerStats.cash
	_write_text(EXPECTED, JSON.stringify(expected, "\t", true, true))
	check("(before closing) cash is now %d" % PlayerStats.cash, PlayerStats.cash == 647)
	release_all()
	# The window-close request is what the OS sends; the game saves and quits by itself. The
	# result line and exit code follow from finish() in this same frame.
	get_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)


# --- phase 3: the close-request save, then Reset Career --------------------------------------

func _phase3() -> void:
	var want := _load_expected()
	_compare("the save written when the window closed (cash 647)", want)
	await boot()
	await place_player(gym_point(0.0, 3.0), 0.0)
	var pause := hud.pause_menu
	await press_escape()
	await frames(3)
	var reset_button := _pause_button("RESET CAREER")
	await click_control(reset_button)
	check("RESET CAREER asks for confirmation first", pause._confirm.visible and not pause._reset.visible, "confirm=%s" % pause._confirm.visible)
	var before_cancel := _stats_snapshot()
	await click_control(_pause_button("CANCEL"))
	check("CANCEL keeps the career untouched", not pause._confirm.visible and _stats_snapshot() == before_cancel and pause.is_open(), "snapshot changed")
	await click_control(_pause_button("RESET CAREER"))
	var old_main := main
	await click_control(_pause_button("YES, RESET"))
	await rebind_after_reload()
	await frames(10)
	check("Reset Career reloads the scene (a brand-new Main node)", main != old_main and is_instance_valid(main) and not get_tree().paused, "same=%s paused=%s" % [main == old_main, get_tree().paused])
	var snap := _stats_snapshot()
	var zero_keys := ["xp", "cash", "muscle_arms", "muscle_torso", "muscle_legs", "gym_tenure", "ladder_progress", "league_wins", "wins", "losses", "win_streak", "best_streak"]
	var zeros := zero_keys.all(func(k: String) -> bool: return absf(float(snap[k])) < 1e-9)
	check("Reset Career restores a fresh career (level 1, 0 XP, $0, strength 20, stamina 100, muscles 0, record 0-0, ladder 0)", zeros and snap["level"] == 1 and near(snap["strength"], 20.0, 1e-9) and near(snap["max_stamina"], 100.0, 1e-9) and snap["rank"] == "Skinny Rookie", "snapshot=%s" % [snap])
	check("Reset Career keeps the settings (sensitivity, music off, sound on)", near(snap["sens"], want["sens"], 1e-9) and snap["music"] == want["music"] and snap["sfx"] == want["sfx"], "sens=%.3f music=%s sfx=%s want=%.3f/%s/%s" % [snap["sens"], snap["music"], snap["sfx"], want["sens"], want["music"], want["sfx"]])
	check("after a reset the gym counts as not reached", not SaveManager.reached_gym)
	check("the player wakes up at home again (the ride restarts)", player.global_position.distance_to(Vector3(9.0, 0.0, 7.0)) < 1.0, "pos=%s" % player.global_position)
	var beacon := main.get_node("GymBeacon") as Beacon
	check("the beacon is back and the objective is the ride", beacon.active and GameState.objective == "Grab your bike and ride to the gym", "active=%s objective='%s'" % [beacon.active, GameState.objective])
	var data := read_save()
	var career: Dictionary = data.get("Career", {})
	var settings: Dictionary = data.get("Settings", {})
	check("the save file was rewritten: fresh career, ReachedGym false, settings kept", int(career.get("Level", -1)) == 1 and int(career.get("Cash", -1)) == 0 and data.get("ReachedGym") == false and near(float(settings.get("MouseSensitivity", -1)), want["sens"], 1e-9) and settings.get("MusicOn") == want["music"], "data=%s" % [data])
	check("HUD shows the fresh profile", hud.level_label.text == "Lvl 1" and hud.cash_label.text == "$0" and hud.record_label.text == "0 W - 0 L" and hud.rank_label.text.begins_with("Skinny Rookie | 0 Days"), "level='%s' cash='%s' record='%s' rank='%s'" % [hud.level_label.text, hud.cash_label.text, hud.record_label.text, hud.rank_label.text])
	check("the pause menu is closed and the game running after the reset", not hud.pause_menu.is_open() and not get_tree().paused)


func _pause_button(text: String) -> Button:
	for button in hud.pause_menu.find_children("*", "Button", true, false):
		if (button as Button).text == text and (button as Button).is_visible_in_tree():
			return button
	return null


# --- hand-written Step 4 saves ---------------------------------------------------------------

func _write_legacy() -> void:
	var text := """{
	"Career": {
		"Cash": 1234,
		"EndlessLeagueUnlocked": false,
		"FightRecord": {
			"BestStreak": 4,
			"Losses": 2,
			"WinStreak": 3,
			"Wins": 5
		},
		"GymTenure": 12.375,
		"LadderProgress": 3,
		"LeagueWins": 0,
		"Level": 7,
		"MaxStamina": 118.0,
		"MuscleArms": 41.5,
		"MuscleLegs": 27.75,
		"MuscleTorso": 33.25,
		"Strength": 47.25,
		"XP": 33.5
	},
	"ReachedGym": true,
	"SavedAt": "2025-11-02T18:04:11",
	"Settings": {
		"MouseSensitivity": 1.5,
		"MusicOn": false,
		"SfxOn": true
	},
	"Version": 1
}
"""
	check("hand-written Step 4 save file written to user://", _write_text(SAVE_PATH, text) and FileAccess.file_exists(SAVE_PATH))


func _check_legacy() -> void:
	check("the hand-written file survived start-up untouched by the loader", FileAccess.file_exists(SAVE_PATH) and read_save().get("SavedAt") == "2025-11-02T18:04:11")
	_compare("Step 4 save loaded by the current build", {"level": 7, "xp": 33.5, "cash": 1234, "strength": 47.25, "max_stamina": 118.0, "muscle_arms": 41.5, "muscle_torso": 33.25, "muscle_legs": 27.75, "gym_tenure": 12.375, "ladder_progress": 3, "league_wins": 0, "wins": 5, "losses": 2, "win_streak": 3, "best_streak": 4, "sens": 1.5, "music": false, "sfx": true, "reached_gym": true, "rank": "Lean Grinder"})
	await boot()
	var beacon := main.get_node("GymBeacon") as Beacon
	check("the Step 4 save starts at the gym door", player.global_position.distance_to(beacon.global_position + Vector3(0.0, 0.05, 1.5)) < 0.6, "pos=%s" % player.global_position)
	check("objective: 'Welcome back. Next fight: Brawler Boris'", GameState.objective == "Welcome back. Next fight: Brawler Boris (Lvl 10). Fight Card terminal by the 2F cage", "objective='%s'" % GameState.objective)
	check("HUD shows Lvl 7, $1,234 and 5 W - 2 L", hud.level_label.text == "Lvl 7" and hud.cash_label.text == "$1,234" and hud.record_label.text == "5 W - 2 L" and hud.rank_label.text == "Lean Grinder | 12 Days", "level='%s' cash='%s' record='%s' rank='%s'" % [hud.level_label.text, hud.cash_label.text, hud.record_label.text, hud.rank_label.text])
	check("the music setting from the file is applied (speakers off)", not AudioManager.music_enabled and AudioManager.sfx_enabled)
	var ladder := FighterRoster.ladder()
	var unlocked: Array[bool] = []
	for profile in ladder:
		unlocked.append(FighterRoster.is_unlocked(profile))
	check("ladder progress 3: Sam, Carl, Viktor beaten and Boris unlocked, the Champ and the League still locked", unlocked == [true, true, true, true, false] and FighterRoster.is_beaten(ladder[2]) and not FighterRoster.is_beaten(ladder[3]) and not FighterRoster.is_league_open(), "unlocked=%s" % [unlocked])
	check("Level 7 is a 'Respected' reputation", Reputation.tier() == Reputation.Tier.MID)
	# The fight card shows it (real UI).
	await place_player(gym_point(0.0, 3.0), 0.0)
	var opened := await open_fight_card()
	var card: FightCard = hud.fight_card
	check("the Fight Card opens with Boris selected as the next fight", opened and card._entries[card._selected].fighter_name == "Brawler Boris" and not card._enter.disabled, "selected=%s" % (card._entries[card._selected].fighter_name if opened else "n/a"))
	await press_escape()
	# Saving again writes the same career back.
	check("saving a loaded Step 4 career writes the same numbers back", SaveManager.save_game() and int(read_save().get("Career", {}).get("Level", -1)) == 7 and read_save().get("Career", {}).get("XP") == 33.5 and read_save().get("Career", {}).get("FightRecord", {}).get("BestStreak") == 4 and read_save().get("ReachedGym") == true and read_save().get("Settings", {}).get("MouseSensitivity") == 1.5)


func _write_league() -> void:
	var text := """{
	"Career": {
		"Cash": 98765,
		"EndlessLeagueUnlocked": true,
		"FightRecord": {"BestStreak": 9, "Losses": 4, "WinStreak": 6, "Wins": 14},
		"GymTenure": 61.0,
		"LadderProgress": 5,
		"LeagueWins": 4,
		"Level": 19,
		"MaxStamina": 140.5,
		"MuscleArms": 78.0,
		"MuscleLegs": 66.5,
		"MuscleTorso": 71.25,
		"Strength": 88.5,
		"XP": 120.25
	},
	"ReachedGym": true,
	"SavedAt": "2025-11-02T19:30:00",
	"Settings": {"MouseSensitivity": 0.8, "MusicOn": true, "SfxOn": false},
	"Version": 1
}
"""
	check("hand-written Step 4 save with the Endless League open", _write_text(SAVE_PATH, text) and FileAccess.file_exists(SAVE_PATH))


func _check_league() -> void:
	_compare("Step 4 league save loaded", {"level": 19, "xp": 120.25, "cash": 98765, "strength": 88.5, "max_stamina": 140.5, "muscle_arms": 78.0, "muscle_torso": 71.25, "muscle_legs": 66.5, "gym_tenure": 61.0, "ladder_progress": 5, "league_wins": 4, "wins": 14, "losses": 4, "win_streak": 6, "best_streak": 9, "sens": 0.8, "music": true, "sfx": false, "reached_gym": true, "rank": "Iron Machine"})
	await boot()
	check("league save: the Endless League is open at challenger level 20", FighterRoster.is_league_open() and FighterRoster.next_league_level() == 20 and Reputation.tier() == Reputation.Tier.HIGH, "league=%s next=%d" % [FighterRoster.is_league_open(), FighterRoster.next_league_level()])
	check("league save: objective points at the League challenger", GameState.objective == "Welcome back. Endless League: challenger Lvl 20 is waiting at the cage", "objective='%s'" % GameState.objective)
	check("league save: the sound-effects setting off is applied", not AudioManager.sfx_enabled and AudioManager.music_enabled)
	check("league save: a level-19 legend with a 6-win streak draws a crowd of 9", Reputation.crowd_size() == 9, "crowd=%d" % Reputation.crowd_size())
	check("league save: HUD cash is $98,765", hud.cash_label.text == "$98,765", "cash='%s'" % hud.cash_label.text)


func _write_damaged() -> void:
	var text := """{
	"Career": {
		"Cash": -5,
		"EndlessLeagueUnlocked": true,
		"FightRecord": {"Losses": 1, "Wins": "many"},
		"Level": 0,
		"MuscleArms": 250.0,
		"MuscleLegs": -3.0,
		"Strength": "lots"
	},
	"Settings": {"MouseSensitivity": 99.0, "MusicOn": "yes"},
	"Version": 1
}
"""
	check("hand-written save with missing and damaged fields", _write_text(SAVE_PATH, text) and FileAccess.file_exists(SAVE_PATH))


func _check_damaged() -> void:
	_compare("damaged save: bad fields fall back to defaults or are clamped", {"level": 1, "xp": 0.0, "cash": 0, "strength": 20.0, "max_stamina": 100.0, "muscle_arms": 100.0, "muscle_torso": 0.0, "muscle_legs": 0.0, "gym_tenure": 0.0, "ladder_progress": 5, "league_wins": 0, "wins": 0, "losses": 1, "win_streak": 0, "best_streak": 0, "sens": 3.0, "music": true, "sfx": true, "reached_gym": false, "rank": "Skinny Rookie"})
	await boot()
	check("damaged save: no ReachedGym means the game starts at the house", player.global_position.distance_to(Vector3(9.0, 0.0, 7.0)) < 1.0 and (main.get_node("GymBeacon") as Beacon).active, "pos=%s" % player.global_position)
	check("damaged save: the game is playable (objective set)", GameState.objective == "Grab your bike and ride to the gym", "objective='%s'" % GameState.objective)


func _write_corrupt() -> void:
	check("a corrupt save file (not JSON) is written", _write_text(SAVE_PATH, "{ this is not json ::: garbage ]]]"))


func _check_corrupt() -> void:
	_compare("corrupt save: the game starts a fresh career with default settings", {"level": 1, "xp": 0.0, "cash": 0, "strength": 20.0, "max_stamina": 100.0, "muscle_arms": 0.0, "ladder_progress": 0, "wins": 0, "losses": 0, "sens": 1.0, "music": true, "sfx": true, "reached_gym": false})
	await boot()
	check("corrupt save: the ride starts as on a first run", player.global_position.distance_to(Vector3(9.0, 0.0, 7.0)) < 1.0 and GameState.objective == "Grab your bike and ride to the gym")
	check("corrupt save: saving afterwards replaces it with a valid file", SaveManager.save_game() and read_save().get("Version") == 1 and int(read_save().get("Career", {}).get("Level", -1)) == 1)
