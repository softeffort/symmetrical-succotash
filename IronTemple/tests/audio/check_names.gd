extends SceneTree
## Runtime check: every sound name found in the code's play calls (/tmp/audio_out/played_names.txt)
## is registered in AudioManager and accepted by its real play() path.

var _waited := 0.0


func _process(delta: float) -> bool:
	var manager: Node = root.get_node_or_null("AudioManager")
	_waited += delta
	if manager == null or (not manager.is_ready() and _waited < 60.0):
		return false
	var played := FileAccess.get_file_as_string("/tmp/audio_out/played_names.txt").split("\n", false)
	var missing: Array[String] = []
	var rejected: Array[String] = []
	for sound_name in played:
		if not manager.has_sound(StringName(sound_name)):
			missing.append(sound_name)
			continue
		manager.set_sfx_enabled(false)
		manager.set_sfx_enabled(true)
		manager.play(StringName(sound_name))
		if manager.get_voice_count() != 1:
			rejected.append(sound_name)
	manager.set_sfx_enabled(false)
	var bank_names: Array = manager._bank.keys()
	var unused: Array[String] = []
	for key in bank_names:
		if not played.has(str(key)):
			unused.append(str(key))
	print("played names checked: ", played.size(), "  registered in bank: ", bank_names.size())
	print("played but not registered at runtime: ", missing)
	print("play() did not queue a voice: ", rejected)
	print("registered but never played: ", unused)
	print("MAX_VOICES=", manager.MAX_VOICES, " MIX_RATE=", manager.MIX_RATE, " MUSIC_VOLUME_DB=", manager.MUSIC_VOLUME_DB)
	for bus in [&"Master", &"SFX", &"Music"]:
		var index := AudioServer.get_bus_index(bus)
		print("bus ", bus, " idx=", index, " volume_db=", AudioServer.get_bus_volume_db(index) if index >= 0 else NAN,
				" effects=", AudioServer.get_bus_effect_count(index) if index >= 0 else -1)
	print("AudioServer mix rate: ", AudioServer.get_mix_rate(), "  classes: Limiter=", ClassDB.class_exists("AudioEffectLimiter"),
			" HardLimiter=", ClassDB.class_exists("AudioEffectHardLimiter"), " Compressor=", ClassDB.class_exists("AudioEffectCompressor"))
	quit(0)
	return true
