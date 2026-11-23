extends "res://tests/walkthrough/walk.gd"
## Step 4: procedural audio, the pause menu with its settings, and the supplement bar shop.

const SOUNDS: Array[StringName] = [&"clank", &"plate", &"tick", &"tick_perfect", &"crunch", &"buzz", &"gulp", &"cash", &"level_up", &"ui_click",
	&"hit_light", &"hit_heavy", &"block", &"snap", &"whoosh", &"bass_drop", &"bell", &"count", &"crowd",
	&"counter_crunch", &"body_hit", &"knockdown", &"rocked", &"feint", &"swoosh", &"dip", &"lunge", &"grab", &"exhale"]

var popups: Array[String] = []
var bar: SupplementBar
var shop: BarShop
var pause: PauseMenu


func _init() -> void:
	area = "bar_audio_pause"


func run() -> void:
	seed(21)
	wipe_career()
	await boot()
	pause = hud.pause_menu
	shop = hud.bar_shop
	PlayerStats.popup_requested.connect(func(text: String, _kind: StringName) -> void: popups.append(text))
	await place_player(gym_point(0.0, 3.0), 0.0)
	await _audio()
	await _pause_menu()
	await _supplement_bar()


# --- Audio -----------------------------------------------------------------------------------

func _audio() -> void:
	var ready := await until_real(func() -> bool: return AudioManager.is_ready(), 90.0)
	check("AudioManager finished synthesizing every sound on its worker thread", ready)
	var missing: Array[StringName] = []
	for sound in SOUNDS:
		if not AudioManager.has_sound(sound):
			missing.append(sound)
	check("all %d sound effects are registered (19 from Steps 2-4 plus the 10 new ones)" % SOUNDS.size(), missing.is_empty(), "missing=%s" % [missing])
	check("AudioManager registers no unexpected sounds", AudioManager._bank.size() == SOUNDS.size(), "bank has %d" % AudioManager._bank.size())
	var empty_sound := ""
	for sound in SOUNDS:
		if (AudioManager._bank[sound] as PackedVector2Array).size() < 500:
			empty_sound += "%s(%d) " % [sound, (AudioManager._bank[sound] as PackedVector2Array).size()]
	check("every sound has real sample data", empty_sound == "", "short: %s" % empty_sound)
	var silent := ""
	for sound in SOUNDS:
		var peak := 0.0
		for frame: Vector2 in AudioManager._bank[sound]:
			peak = maxf(peak, maxf(absf(frame.x), absf(frame.y)))
		if peak < 0.02:
			silent += "%s(%.3f) " % [sound, peak]
	check("no sound is silent (peak amplitude > 0.02)", silent == "", "silent: %s" % silent)
	check("the music loop was rendered", AudioManager._loop.size() > 22050 * 4, "loop frames=%d" % AudioManager._loop.size())
	check("sound effects are on by default", AudioManager.sfx_enabled and AudioManager.music_enabled)
	AudioManager._voices.clear()
	AudioManager.play(&"clank")
	check("playing a sound starts a voice", AudioManager.get_voice_count() == 1, "voices=%d" % AudioManager.get_voice_count())
	AudioManager.play(&"does_not_exist")
	check("playing an unknown sound is ignored", AudioManager.get_voice_count() == 1)
	for sound in SOUNDS:
		AudioManager.play(sound, 0.5, 1.0, 0.0)
	await frames(2)
	check("many sounds at once are capped at 10 voices", AudioManager.get_voice_count() <= AudioManager.MAX_VOICES and AudioManager.get_voice_count() > 0, "voices=%d" % AudioManager.get_voice_count())
	AudioManager.play_varied(&"hit_light")
	AudioManager.play(&"crowd", 0.5, 0.7, 0.2)
	await frames(2)
	check("play_varied and delayed pitched play run without error", AudioManager.get_voice_count() > 0)
	AudioManager.set_sfx_enabled(false)
	check("turning sound effects off silences everything at once", AudioManager.get_voice_count() == 0 and not AudioManager.sfx_enabled)
	AudioManager.play(&"clank")
	check("with sound effects off nothing is queued", AudioManager.get_voice_count() == 0)
	AudioManager.set_sfx_enabled(true)
	AudioManager._voices.clear()
	PlayerStats.reward_rep({&"arms": 0.1}, 0.1, false)
	await frames(2)
	check("a workout rep triggers its sound through the PlayerStats hook", AudioManager.get_voice_count() >= 1, "voices=%d" % AudioManager.get_voice_count())
	# M mutes the gym speakers: real key, toast and saved setting.
	var toasts: Array[String] = []
	GameState.toast_requested.connect(func(text: String) -> void: toasts.append(text))
	await tap_key(KEY_M)
	check("M mutes the gym speakers (music_enabled false, toast shown)", not AudioManager.music_enabled and toasts.has("Gym speakers muted"), "music=%s toasts=%s" % [AudioManager.music_enabled, toasts])
	check("the mute is saved as the MusicOn setting", SaveManager.get_setting("MusicOn") == false and read_save().get("Settings", {}).get("MusicOn") == false, "setting=%s file=%s" % [SaveManager.get_setting("MusicOn"), read_save().get("Settings")])
	await tap_key(KEY_M)
	check("M again turns the speakers back on", AudioManager.music_enabled and SaveManager.get_setting("MusicOn") == true and toasts.has("Gym speakers on"), "music=%s" % AudioManager.music_enabled)


# --- Pause menu ------------------------------------------------------------------------------

func _pause_menu() -> void:
	var spot := player.global_position
	await press_escape()
	await frames(3)
	check("Esc on foot opens the pause menu and pauses the game", pause.is_open() and get_tree().paused, "open=%s paused=%s" % [pause.is_open(), get_tree().paused])
	check("the pause menu shows the career line", pause._career.text.contains("LVL 1") and pause._career.text.contains("0 W - 0 L") and pause._career.text.contains("$0"), "career='%s'" % pause._career.text)
	key_down(KEY_W)
	await secs(1.0)
	key_up(KEY_W)
	check("the world is frozen while paused (W does not move the player)", player.global_position.distance_to(spot) < 0.05, "moved %.3f" % player.global_position.distance_to(spot))
	await press_escape()
	await frames(3)
	check("Esc again resumes the game", not pause.is_open() and not get_tree().paused, "open=%s paused=%s" % [pause.is_open(), get_tree().paused])
	key_down(KEY_W)
	await secs(0.6)
	key_up(KEY_W)
	check("after resuming the player moves again", player.global_position.distance_to(spot) > 1.0, "moved %.2f" % player.global_position.distance_to(spot))
	# RESUME button.
	await press_escape()
	await frames(3)
	var resume := _button_with_text("RESUME")
	check("pause menu has a RESUME button", resume != null)
	await click_control(resume)
	check("clicking RESUME closes the menu", not pause.is_open() and not get_tree().paused)
	# Sensitivity: slider click.
	await press_escape()
	await frames(3)
	var start_sens := SaveManager.get_mouse_sensitivity()
	check("sensitivity starts at 1.00x", near(start_sens, 1.0, 0.001) and pause._sensitivity_value.text == "1.00x", "sens=%.2f label=%s" % [start_sens, pause._sensitivity_value.text])
	await click_control(pause._sensitivity, Vector2(0.8, 0.5))
	var sens := SaveManager.get_mouse_sensitivity()
	check("clicking the slider changes mouse sensitivity (%.2fx)" % sens, sens > 2.0 and sens <= 3.0 and pause._sensitivity_value.text == "%.2fx" % pause._sensitivity.value and near(sens, pause._sensitivity.value, 0.001), "sens=%.3f slider=%.3f label=%s" % [sens, pause._sensitivity.value, pause._sensitivity_value.text])
	check("the sensitivity is stored in the settings dictionary", near(SaveManager.settings["MouseSensitivity"], sens, 0.001))
	await click_control(pause._sensitivity, Vector2(0.0, 0.5))
	check("the slider bottoms out at 0.3x", near(SaveManager.get_mouse_sensitivity(), SaveManager.SENSITIVITY_RANGE.x, 0.001), "sens=%.3f" % SaveManager.get_mouse_sensitivity())
	await click_control(pause._sensitivity, Vector2(0.8, 0.5))
	sens = SaveManager.get_mouse_sensitivity()
	# Music and sound toggles.
	await click_control(pause._music)
	check("the music toggle turns the gym speakers off (ON -> OFF, setting saved)", not AudioManager.music_enabled and SaveManager.get_setting("MusicOn") == false and pause._music.text == "OFF", "music=%s setting=%s text=%s" % [AudioManager.music_enabled, SaveManager.get_setting("MusicOn"), pause._music.text])
	await click_control(pause._sfx)
	check("the sound toggle turns sound effects off (setting saved)", not AudioManager.sfx_enabled and SaveManager.get_setting("SfxOn") == false and pause._sfx.text == "OFF", "sfx=%s setting=%s text=%s" % [AudioManager.sfx_enabled, SaveManager.get_setting("SfxOn"), pause._sfx.text])
	AudioManager.play(&"clank")
	check("with sound effects off nothing plays", AudioManager.get_voice_count() == 0, "voices=%d" % AudioManager.get_voice_count())
	var saved := read_save().get("Settings", {}) as Dictionary
	check("each change is written to the save file straight away", near(float(saved.get("MouseSensitivity", -1)), sens, 0.001) and saved.get("MusicOn") == false and saved.get("SfxOn") == false, "file settings=%s" % [saved])
	# SAVE GAME.
	PlayerStats.add_cash(77)
	await click_control(_button_with_text("SAVE GAME"))
	check("SAVE GAME writes the career and says so", pause._status.text.begins_with("Saved") and read_save().get("Career", {}).get("Cash") == 77, "status='%s' cash in file=%s" % [pause._status.text, read_save().get("Career", {}).get("Cash")])
	PlayerStats.cash = 0
	# Settings survive reopening the menu.
	await press_escape()
	await frames(3)
	await press_escape()
	await frames(3)
	check("reopening the menu shows the stored settings", pause._music.text == "OFF" and pause._sfx.text == "OFF" and pause._sensitivity_value.text == "%.2fx" % sens, "music=%s sfx=%s sens=%s" % [pause._music.text, pause._sfx.text, pause._sensitivity_value.text])
	await click_control(pause._music)
	await click_control(pause._sfx)
	check("the toggles switch back on", AudioManager.music_enabled and AudioManager.sfx_enabled and pause._music.text == "ON" and pause._sfx.text == "ON")
	# Mouse look scales with the sensitivity setting.
	await press_escape()
	await frames(3)
	var yaw0 := player._yaw
	player._look(Vector2(40.0, 0.0))
	var turned_fast := absf(wrapf(player._yaw - yaw0, -PI, PI))
	SaveManager.set_setting("MouseSensitivity", 1.0)
	yaw0 = player._yaw
	player._look(Vector2(40.0, 0.0))
	var turned_normal := absf(wrapf(player._yaw - yaw0, -PI, PI))
	check("the mouse-look turn scales with the sensitivity setting (%.2fx -> %.3f rad vs 1.00x -> %.3f rad)" % [sens, turned_fast, turned_normal], near(turned_fast / turned_normal, sens, 0.05), "ratio=%.3f sens=%.3f" % [turned_fast / turned_normal, sens])


func _button_with_text(text: String) -> Button:
	for button in pause.find_children("*", "Button", true, false):
		if (button as Button).text == text and (button as Button).is_visible_in_tree():
			return button
	return null


# --- Supplement bar --------------------------------------------------------------------------

func _wait_for_drink() -> void:
	await until(func() -> bool: return not player.arms.is_drinking(), 6.0)
	await frames(2)


func _buy_click(id: StringName) -> void:
	await click_control(shop._rows[id]["button"])
	await frames(2)


func _gain_per_rep() -> Dictionary:
	PlayerStats.add_pump(-PlayerStats.pump_level)
	var muscle := PlayerStats.muscle_arms
	var xp := _xp_total()
	PlayerStats.reward_rep({&"arms": 1.0}, 1.0, false)
	var result := {"muscle": PlayerStats.muscle_arms - muscle, "xp": _xp_total() - xp}
	PlayerStats.add_pump(-PlayerStats.pump_level)
	return result


func _xp_total() -> float:
	var total := PlayerStats.xp
	for level in range(1, PlayerStats.level):
		total += roundf(PlayerStats.XP_BASE * pow(level, PlayerStats.XP_CURVE))
	return total


## Stamina regenerated per second in a 0.4 s window that starts `wait` seconds after spending.
func _regen_rate(wait: float) -> float:
	PlayerStats.stamina = 5.0
	PlayerStats.is_exhausted = false
	PlayerStats.spend_stamina(0.01)
	await secs(wait)
	var s1 := PlayerStats.stamina
	await secs(0.4)
	return (PlayerStats.stamina - s1) / 0.4


## Throws one jab at the second heavy bag and returns the strike timings the combat controller used.
func _jab_timing() -> Dictionary:
	var bag := main.get_node("Gym/Floor2_FightHall").find_children("*", "PunchingBag", true, false)[1] as PunchingBag
	await place_player(bag.global_position + Vector3(1.25, 0.05, 0.0), 90.0)
	await look_at_point(bag.global_position + Vector3(0.0, 1.35, 0.0))
	await secs(1.0)
	PlayerStats.stamina = PlayerStats.max_stamina
	await tap_action(&"strike_left")
	await secs(0.05)
	var timing := {"startup": player.combat._startup, "recovery": player.combat._recovery, "stance": player.combat.stance}
	await secs(1.0)
	return timing


func _supplement_bar() -> void:
	var jab_base := await _jab_timing()
	var found := main.get_node("Gym/Floor3_Lounge").find_children("*", "SupplementBar", true, false)
	bar = found[0] as SupplementBar
	var spots: Array = []
	for offset: Vector3 in [Vector3(0, 0, 1.8), Vector3(0, 0, 2.4), Vector3(1.5, 0, 1.8), Vector3(-1.5, 0, 1.8)]:
		var spot: Vector3 = bar.global_transform * offset
		spot.y = bar.global_position.y + 0.05
		spots.append(spot)
	var focus := await aim_and_find(spots, bar.global_transform * Vector3(0.0, 1.25, 0.46))
	await frames(12)
	check("at the counter the crosshair prompt reads 'Supplement Bar'", focus != null and hud_prompt_text() == "Supplement Bar", "prompt='%s'" % hud_prompt_text())
	check("the bartender greets a customer who walks up", bar.bartender.bubble.visible and SupplementBar.GREETINGS.has(bar.bartender.bubble.text), "bubble='%s'" % bar.bartender.bubble.text)
	await press_e()
	await frames(4)
	check("E at the counter opens the supplement shop and freezes the player", shop.is_open() and not player.controls_enabled, "open=%s controls=%s" % [shop.is_open(), player.controls_enabled])
	check("the shop lists the four items with their README prices ($15, $40, $75, $60)", Supplements.ITEMS.size() == 4 and Supplements.find(Supplements.ISOTONIC)["price"] == 15 and Supplements.find(Supplements.PROTEIN)["price"] == 40 and Supplements.find(Supplements.PREWORKOUT)["price"] == 75 and Supplements.find(Supplements.ELIXIR)["price"] == 60)
	# Broke: nothing can be bought.
	var all_disabled := true
	for item in Supplements.ITEMS:
		all_disabled = all_disabled and (shop._rows[item["id"]]["button"] as Button).disabled
	check("with $0 every item is greyed out", all_disabled)
	check("the notes say how much more cash is needed", shop._rows[Supplements.ISOTONIC]["note"].text == "Need $15 more" and shop._rows[Supplements.PROTEIN]["note"].text == "Need $40 more" and shop._rows[Supplements.PREWORKOUT]["note"].text == "Need $75 more", "notes=%s %s %s" % [shop._rows[Supplements.ISOTONIC]["note"].text, shop._rows[Supplements.PROTEIN]["note"].text, shop._rows[Supplements.PREWORKOUT]["note"].text])
	await _buy_click(Supplements.PROTEIN)
	check("clicking a greyed-out item buys nothing", PlayerStats.cash == 0 and not PlayerStats.has_protein())
	PlayerStats.add_cash(39)
	var refused := not Supplements.buy(Supplements.PROTEIN)
	shop._buy(Supplements.PROTEIN)
	await frames(3)
	check("$39 is refused for the $40 protein shake (cash untouched, no buff)", refused and PlayerStats.cash == 39 and not PlayerStats.has_protein() and shop._rows[Supplements.PROTEIN]["note"].text == "Need $1 more", "cash=%d protein=%s note='%s'" % [PlayerStats.cash, PlayerStats.has_protein(), shop._rows[Supplements.PROTEIN]["note"].text])
	PlayerStats.add_cash(261)
	await frames(3)
	check("with $300 the three drinks can be bought", not (shop._rows[Supplements.ISOTONIC]["button"] as Button).disabled and not (shop._rows[Supplements.PROTEIN]["button"] as Button).disabled and not (shop._rows[Supplements.PREWORKOUT]["button"] as Button).disabled)
	check("the Recovery Elixir is not sold while not strained", (shop._rows[Supplements.ELIXIR]["button"] as Button).disabled and shop._rows[Supplements.ELIXIR]["note"].text == "No injury to heal" and not Supplements.buy(Supplements.ELIXIR) and PlayerStats.cash == 300, "note='%s' cash=%d" % [shop._rows[Supplements.ELIXIR]["note"].text, PlayerStats.cash])
	await _buy_click(Supplements.ELIXIR)
	check("clicking the elixir while healthy changes nothing", PlayerStats.cash == 300)

	# Isotonic water: stamina back to full, active injury healed in half the time left.
	PlayerStats.apply_strain(0.0)
	PlayerStats.stamina = 30.0
	await frames(2)
	var left_before := PlayerStats.injury_timer
	await _buy_click(Supplements.ISOTONIC)
	check("Isotonic Water costs $15", PlayerStats.cash == 285, "cash=%d" % PlayerStats.cash)
	check("Isotonic Water refills the stamina bar to 100%", near(PlayerStats.stamina, PlayerStats.max_stamina, 1.0) and not PlayerStats.is_exhausted, "stamina=%.1f/%.1f" % [PlayerStats.stamina, PlayerStats.max_stamina])
	check("Isotonic Water halves the time left on an injury (%.1f s -> %.1f s)" % [left_before, PlayerStats.injury_timer], near(PlayerStats.injury_timer, left_before * 0.5, 1.5), "before=%.1f after=%.1f" % [left_before, PlayerStats.injury_timer])
	check("a 'STAMINA RESTORED' popup was shown", popups.has("STAMINA RESTORED"))
	check("the bartender says thanks", SupplementBar.THANKS.has(bar.bartender.bubble.text) and bar.bartender.bubble.visible, "bubble='%s'" % bar.bartender.bubble.text)
	check("each purchase is saved right away (Cash in the file)", read_save().get("Career", {}).get("Cash") == 285, "file cash=%s" % read_save().get("Career", {}).get("Cash"))
	await _wait_for_drink()

	# Elixir while strained: heals at once.
	check("the elixir becomes available while strained", not (shop._rows[Supplements.ELIXIR]["button"] as Button).disabled and PlayerStats.is_strained(), "disabled=%s strained=%s" % [(shop._rows[Supplements.ELIXIR]["button"] as Button).disabled, PlayerStats.is_strained()])
	await _buy_click(Supplements.ELIXIR)
	check("Recovery Elixir costs $60 and heals the strain at once", PlayerStats.cash == 225 and not PlayerStats.is_strained() and popups.has("Strain healed"), "cash=%d strained=%s" % [PlayerStats.cash, PlayerStats.is_strained()])
	await _wait_for_drink()

	# Protein and pre-workout.
	var base_gain := await _gain_per_rep()
	PlayerStats.stamina = PlayerStats.max_stamina
	var base_speed := PlayerStats.get_fight_speed()
	var base_strength := PlayerStats.get_effective_strength()
	var base_regen := await _regen_rate(1.2)
	PlayerStats.stamina = PlayerStats.max_stamina
	await _buy_click(Supplements.PROTEIN)
	check("Whey Protein Shake costs $40 and lasts 3 minutes", PlayerStats.cash == 185 and near(PlayerStats.protein_timer, 180.0, 2.0), "cash=%d timer=%.1f" % [PlayerStats.cash, PlayerStats.protein_timer])
	check("HUD shows the PROTEIN x2 badge with a countdown", hud.protein_badge.visible and hud.protein_label.text.begins_with("PROTEIN x2") and ":" in hud.protein_label.text, "label='%s'" % hud.protein_label.text)
	await _wait_for_drink()
	await _buy_click(Supplements.PREWORKOUT)
	check("Hardcore Pre-Workout costs $75 and lasts 2 minutes", PlayerStats.cash == 110 and near(PlayerStats.preworkout_timer, 120.0, 2.0), "cash=%d timer=%.1f" % [PlayerStats.cash, PlayerStats.preworkout_timer])
	await _wait_for_drink()
	await secs(1.5)
	check("HUD shows the PRE-WORKOUT badge and the purple pulse", hud.preworkout_badge.visible and hud.preworkout_label.text.begins_with("PRE-WORKOUT") and hud.pulse_vignette.visible, "label='%s' pulse=%s" % [hud.preworkout_label.text, hud.pulse_vignette.visible])
	check("the shop shows ACTIVE countdowns on both buffs", shop._rows[Supplements.PROTEIN]["note"].text.begins_with("ACTIVE") and shop._rows[Supplements.PREWORKOUT]["note"].text.begins_with("ACTIVE"), "notes='%s' '%s'" % [shop._rows[Supplements.PROTEIN]["note"].text, shop._rows[Supplements.PREWORKOUT]["note"].text])
	var boosted_gain := await _gain_per_rep()
	check("protein doubles muscle gain from a rep (x%.2f) (via reward_rep)" % (boosted_gain["muscle"] / base_gain["muscle"]), near(boosted_gain["muscle"] / base_gain["muscle"], 2.0, 0.1), "base=%s boosted=%s" % [base_gain, boosted_gain])
	check("protein doubles XP from a rep (x%.2f) (via reward_rep)" % (boosted_gain["xp"] / base_gain["xp"]), near(boosted_gain["xp"] / base_gain["xp"], 2.0, 0.1), "base=%s boosted=%s" % [base_gain, boosted_gain])
	var boosted_regen := await _regen_rate(0.3)
	check("pre-workout regenerates stamina 3.5x as fast (%.1f/s vs %.1f/s)" % [boosted_regen, base_regen], near(boosted_regen / base_regen, 3.5, 0.35), "boosted=%.2f base=%.2f ratio=%.2f" % [boosted_regen, base_regen, boosted_regen / base_regen])
	PlayerStats.stamina = PlayerStats.max_stamina
	check("pre-workout gives +20%% punch speed (%.2f -> %.2f)" % [base_speed, PlayerStats.get_fight_speed()], near(PlayerStats.get_fight_speed() / base_speed, 1.2, 0.01), "base=%.3f boosted=%.3f" % [base_speed, PlayerStats.get_fight_speed()])
	check("pre-workout gives +20%% lifting power (%.1f -> %.1f)" % [base_strength, PlayerStats.get_effective_strength()], near(PlayerStats.get_effective_strength() / base_strength, 1.2, 0.01), "base=%.3f boosted=%.3f" % [base_strength, PlayerStats.get_effective_strength()])
	check("each purchase leaves the cash exactly as spent ($300 - 15 - 60 - 40 - 75 = $110)", PlayerStats.cash == 110 and hud.cash_label.text == "$110", "cash=%d label=%s" % [PlayerStats.cash, hud.cash_label.text])
	check("the shop shows the wallet", shop._cash.text == "$110", "shop cash='%s'" % shop._cash.text)
	# Close with E.
	await tap_key(KEY_E)
	await frames(3)
	check("E closes the shop and hands control back", not shop.is_open() and player.controls_enabled, "open=%s controls=%s" % [shop.is_open(), player.controls_enabled])
	var jab_pre := await _jab_timing()
	check("pre-workout really speeds up punches in the cage code (jab start-up %.3f s -> %.3f s, x1.2)" % [jab_base["startup"], jab_pre["startup"]], jab_base["stance"] and jab_pre["stance"] and jab_base["startup"] > 0.0 and near(jab_base["startup"] / jab_pre["startup"], 1.2, 0.03) and near(jab_base["recovery"] / jab_pre["recovery"], 1.2, 0.03), "base=%s pre=%s" % [jab_base, jab_pre])
	await place_player(player.global_position, 0.0)
	var again := await aim_and_find(spots, bar.global_transform * Vector3(0.0, 1.25, 0.46))
	await press_e()
	await frames(3)
	check("the shop can be reopened and Esc closes it too", again != null and shop.is_open(), "open=%s" % shop.is_open())
	await press_escape()
	await frames(3)
	check("Esc closes the shop and hands control back (the pause menu stays shut)", not shop.is_open() and player.controls_enabled and not pause.is_open(), "shop=%s controls=%s pause=%s" % [shop.is_open(), player.controls_enabled, pause.is_open()])
	# Buff expiry: pre-workout after 2 minutes, protein after 3.
	await until(func() -> bool: return not PlayerStats.has_preworkout(), 130.0)
	await frames(3)
	check("pre-workout wears off after 2 minutes (popup, badge hidden, protein still active)", not hud.preworkout_badge.visible and popups.has("Pre-workout wore off") and PlayerStats.has_protein(), "pre=%s protein=%s" % [PlayerStats.has_preworkout(), PlayerStats.has_protein()])
	await secs(1.2)
	check("the purple pulse fades out once pre-workout is gone", not hud.pulse_vignette.visible, "pulse visible=%s" % hud.pulse_vignette.visible)
	check("pre-workout effects are gone after expiry", near(PlayerStats.get_effective_strength(), base_strength, 0.5) and near(PlayerStats.get_fight_speed(), base_speed, 0.05), "strength=%.2f base=%.2f speed=%.3f base=%.3f" % [PlayerStats.get_effective_strength(), base_strength, PlayerStats.get_fight_speed(), base_speed])
	var protein_left := PlayerStats.protein_timer
	check("protein is still running at that point (%.0f s left of 180)" % protein_left, protein_left > 40.0 and protein_left < 70.0, "left=%.1f" % protein_left)
	await until(func() -> bool: return not PlayerStats.has_protein(), 70.0)
	await frames(3)
	var gain_after := await _gain_per_rep()
	check("protein wears off after 3 minutes (popup, badge hidden, gains back to x1)", not hud.protein_badge.visible and popups.has("Protein shake wore off") and near(gain_after["muscle"] / base_gain["muscle"], 1.0, 0.1), "badge=%s ratio=%.2f" % [hud.protein_badge.visible, gain_after["muscle"] / base_gain["muscle"]])
