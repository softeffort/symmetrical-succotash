extends Node
## Autoload `AudioManager`: all of the game's audio, synthesized in code with no audio files.
##
## Two AudioStreamGenerator players are fed from `_process`: one mixes sound-effect voices from
## the SoundBank, the other streams the GymBeat loop for the gym's speakers. The buffers are
## rendered on a worker thread at start-up, so sounds requested in the first moment are skipped.
##
## Call `AudioManager.play(&"hit_heavy")` from anywhere. The gym beat follows `gym_presence`
## (set by the Gym as the listener walks in and out) and is toggled with the `toggle_music`
## action (M).

signal music_toggled(enabled: bool)

const MIX_RATE := 22050.0
const BUFFER_SECONDS := 0.3
## Audio kept queued in each generator. Short for effects so hits sound on time.
const SFX_QUEUE := 0.07
const MUSIC_QUEUE := 0.16
const MAX_VOICES := 10
const SFX_BUS := &"SFX"
const MUSIC_BUS := &"Music"
const MUSIC_VOLUME_DB := -13.0
## Seconds for the speakers to fade in or out.
const MUSIC_FADE := 0.8


class Voice:
	var frames: PackedVector2Array
	var position := 0.0
	var step := 1.0
	var gain := 1.0
	## Frames of silence before the voice starts.
	var wait := 0


var music_enabled := true
var sfx_enabled := true
## How well the listener hears the gym speakers: 0 out on the street, 1 inside.
var gym_presence := 0.0

var _bank: Dictionary = {}
var _loop := PackedVector2Array()
var _loop_position := 0
var _voices: Array[Voice] = []
var _sfx: AudioStreamPlayer
var _music: AudioStreamPlayer
var _sfx_playback: AudioStreamGeneratorPlayback
var _music_playback: AudioStreamGeneratorPlayback
var _sfx_capacity := 0
var _music_capacity := 0
var _music_level := 0.0
var _render_task := -1
var _rendered := false


func _ready() -> void:
	# Keeps playing behind the pause menu.
	process_mode = Node.PROCESS_MODE_ALWAYS
	_ensure_bus(SFX_BUS)
	_ensure_bus(MUSIC_BUS)
	if AudioServer.get_bus_effect_count(0) == 0:
		# A heavy hit, a crunch and the crowd on one frame add up past full scale.
		AudioServer.add_bus_effect(0, AudioEffectHardLimiter.new())
	_sfx = _make_player(SFX_BUS)
	_sfx_playback = _sfx.get_stream_playback() as AudioStreamGeneratorPlayback
	_sfx_capacity = _sfx_playback.get_frames_available()
	_music = _make_player(MUSIC_BUS)
	_music_playback = _music.get_stream_playback() as AudioStreamGeneratorPlayback
	_music_capacity = _music_playback.get_frames_available()
	_music.stream_paused = true
	_render_task = WorkerThreadPool.add_task(_render, false, "Synthesizing audio")

	PlayerStats.rep_completed.connect(_on_rep_completed)
	PlayerStats.injured.connect(_on_injured)
	PlayerStats.level_up.connect(_on_level_up)


func _exit_tree() -> void:
	if _render_task >= 0:
		WorkerThreadPool.wait_for_task_completion(_render_task)
		_render_task = -1
	# Let go of the generator playbacks before the audio server shuts down.
	set_process(false)
	_sfx_playback = null
	_music_playback = null
	_sfx.stop()
	_music.stop()


func _process(delta: float) -> void:
	_stream_music(delta)
	_mix_voices()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"toggle_music") and not event.is_echo():
		set_music_enabled(not music_enabled)
		GameState.notify("Gym speakers %s" % ("on" if music_enabled else "muted"))


# --- Playing ---------------------------------------------------------------------------------

## True once the sounds have been synthesized.
func is_ready() -> bool:
	return _rendered


func has_sound(sound: StringName) -> bool:
	return _bank.has(sound)


## Plays a sound from the bank. `pitch` 2 is an octave up; `delay` is in seconds.
func play(sound: StringName, volume: float = 1.0, pitch: float = 1.0, delay: float = 0.0) -> void:
	if not sfx_enabled or not _bank.has(sound):
		return
	if _voices.size() >= MAX_VOICES:
		_voices.remove_at(0)
	var voice := Voice.new()
	voice.frames = _bank[sound]
	voice.gain = volume
	voice.step = clampf(pitch, 0.25, 4.0)
	voice.wait = int(delay * MIX_RATE)
	_voices.append(voice)


## `play` with a little random pitch, so repeated hits do not sound stamped out.
func play_varied(sound: StringName, volume: float = 1.0, spread: float = 0.07) -> void:
	play(sound, volume, randf_range(1.0 - spread, 1.0 + spread))


## Number of sound effects currently sounding.
func get_voice_count() -> int:
	return _voices.size()


func set_music_enabled(enabled: bool) -> void:
	if enabled == music_enabled:
		return
	music_enabled = enabled
	music_toggled.emit(enabled)


func set_sfx_enabled(enabled: bool) -> void:
	sfx_enabled = enabled
	if not enabled:
		_voices.clear()


# --- Mixing ----------------------------------------------------------------------------------

func _mix_voices() -> void:
	if _voices.is_empty():
		return
	var want := _frames_wanted(_sfx_playback, _sfx_capacity, SFX_QUEUE)
	if want <= 0:
		return
	var mix := PackedVector2Array()
	mix.resize(want)
	for index in range(_voices.size() - 1, -1, -1):
		var voice := _voices[index]
		var i := mini(voice.wait, want)
		voice.wait -= i
		var frames := voice.frames
		var size := frames.size()
		var position := voice.position
		var step := voice.step
		var gain := voice.gain
		if is_equal_approx(step, 1.0):
			while i < want and position < size:
				mix[i] += frames[int(position)] * gain
				position += 1.0
				i += 1
		else:
			while i < want and position < size:
				var at := int(position)
				mix[i] += frames[at].lerp(frames[mini(at + 1, size - 1)], position - at) * gain
				position += step
				i += 1
		voice.position = position
		if position >= size:
			_voices.remove_at(index)
	_sfx_playback.push_buffer(mix)


func _stream_music(delta: float) -> void:
	var target := gym_presence if music_enabled and _rendered else 0.0
	_music_level = move_toward(_music_level, target, delta / MUSIC_FADE)
	var audible := _music_level > 0.001
	if _music.stream_paused == audible:
		_music.stream_paused = not audible
	if not audible:
		return
	_music.volume_db = MUSIC_VOLUME_DB + linear_to_db(_music_level)
	var want := _frames_wanted(_music_playback, _music_capacity, MUSIC_QUEUE)
	while want > 0:
		var chunk := mini(want, _loop.size() - _loop_position)
		_music_playback.push_buffer(_loop.slice(_loop_position, _loop_position + chunk))
		_loop_position = (_loop_position + chunk) % _loop.size()
		want -= chunk


## Frames to push so that `queue` seconds of audio are waiting in the generator.
func _frames_wanted(playback: AudioStreamGeneratorPlayback, capacity: int, queue: float) -> int:
	var available := playback.get_frames_available()
	var queued := capacity - available
	return mini(int(queue * MIX_RATE) - queued, available)


# --- Setup -----------------------------------------------------------------------------------

## Runs on a worker thread: synthesizes every buffer, then hands them to the main thread.
func _render() -> void:
	var bank := SoundBank.render_all(MIX_RATE)
	var loop := GymBeat.render(MIX_RATE)
	_install.call_deferred(bank, loop)


func _install(bank: Dictionary, loop: PackedVector2Array) -> void:
	_bank = bank
	_loop = loop
	_rendered = true
	if _render_task >= 0:
		WorkerThreadPool.wait_for_task_completion(_render_task)
		_render_task = -1


func _ensure_bus(bus: StringName) -> void:
	if AudioServer.get_bus_index(bus) >= 0:
		return
	AudioServer.add_bus()
	var index := AudioServer.bus_count - 1
	AudioServer.set_bus_name(index, bus)
	AudioServer.set_bus_send(index, &"Master")


func _make_player(bus: StringName) -> AudioStreamPlayer:
	var stream := AudioStreamGenerator.new()
	stream.mix_rate = MIX_RATE
	stream.buffer_length = BUFFER_SECONDS
	var player := AudioStreamPlayer.new()
	player.stream = stream
	player.bus = bus
	add_child(player)
	player.play()
	return player


func _on_rep_completed(perfect: bool) -> void:
	play(&"tick_perfect" if perfect else &"tick")


func _on_injured(_duration: float) -> void:
	play(&"crunch")
	play(&"buzz", 0.7, 1.0, 0.25)


func _on_level_up(_level: int) -> void:
	play(&"level_up")
