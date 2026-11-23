extends SceneTree
## Dumps every sound the game synthesizes (via AudioManager's own bank and loop) to 16-bit stereo
## WAVs in /tmp/audio_out plus a manifest line per sound. Run:
## XDG_DATA_HOME=/tmp/xdg_audio godot --headless --path <project> -s res://tests/audio/dump_sounds.gd

const OUT_DIR := "/tmp/audio_out"

var _waited := 0.0


func _process(delta: float) -> bool:
	var manager: Node = root.get_node_or_null("AudioManager")
	if manager == null:
		push_error("AudioManager autoload missing")
		quit(2)
		return true
	_waited += delta
	if not manager.is_ready():
		if _waited > 60.0:
			push_error("AudioManager never finished rendering")
			quit(3)
		return false
	_dump(manager)
	quit(0)
	return true


func _dump(manager: Node) -> void:
	DirAccess.make_dir_recursive_absolute(OUT_DIR)
	var manifest := FileAccess.open(OUT_DIR + "/manifest.tsv", FileAccess.WRITE)
	manifest.store_line("name\trate\tsamples\tchannels\traw_min\traw_max\tnan_count\tseconds")
	var rate := int(manager.MIX_RATE)
	var names: Array = manager._bank.keys()
	names.sort()
	for sound_name in names:
		_write(manifest, str(sound_name), manager._bank[sound_name], rate)
	_write(manifest, "music_loop", manager._loop, rate)
	manifest.close()
	# Cross-check: the bank the game holds equals a fresh render with the same code.
	var fresh := SoundBank.render_all(manager.MIX_RATE)
	var same: bool = fresh.size() == manager._bank.size()
	for key in fresh:
		if not manager._bank.has(key) or fresh[key] != manager._bank[key]:
			same = false
			print("MISMATCH vs fresh render: ", key)
	print("registered=", names.size(), " bank_equals_fresh_render=", same)
	var registry := FileAccess.open(OUT_DIR + "/registered_names.txt", FileAccess.WRITE)
	for sound_name in names:
		registry.store_line(str(sound_name))
	registry.close()


func _write(manifest: FileAccess, sound_name: String, frames: PackedVector2Array, rate: int) -> void:
	var bytes := PackedByteArray()
	bytes.resize(frames.size() * 4)
	var lo := INF
	var hi := -INF
	var bad := 0
	for i in frames.size():
		for c in 2:
			var v: float = frames[i][c]
			if is_nan(v) or is_inf(v):
				bad += 1
				v = 0.0
			lo = minf(lo, v)
			hi = maxf(hi, v)
			bytes.encode_s16(i * 4 + c * 2, clampi(roundi(v * 32767.0), -32768, 32767))
	var file := FileAccess.open("%s/%s.wav" % [OUT_DIR, sound_name], FileAccess.WRITE)
	var data_size := bytes.size()
	file.store_buffer("RIFF".to_ascii_buffer())
	file.store_32(36 + data_size)
	file.store_buffer("WAVEfmt ".to_ascii_buffer())
	file.store_32(16)
	file.store_16(1)
	file.store_16(2)
	file.store_32(rate)
	file.store_32(rate * 4)
	file.store_16(4)
	file.store_16(16)
	file.store_buffer("data".to_ascii_buffer())
	file.store_32(data_size)
	file.store_buffer(bytes)
	file.close()
	manifest.store_line("%s\t%d\t%d\t2\t%.6f\t%.6f\t%d\t%.4f" % [sound_name, rate, frames.size(), lo, hi, bad, float(frames.size()) / rate])
