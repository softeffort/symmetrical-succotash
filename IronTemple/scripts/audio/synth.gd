class_name Synth
extends RefCounted
## Building blocks for the procedural audio: oscillators with pitch glides and filtered noise
## bursts, written straight into mono sample buffers. SoundBank and GymBeat compose every sound
## in the game from these, so there are no audio files.

enum Wave { SINE, TRIANGLE, SQUARE, SAW }


static func buffer(rate: float, seconds: float) -> PackedFloat32Array:
	var samples := PackedFloat32Array()
	samples.resize(int(rate * seconds))
	return samples


## Adds an oscillator that glides from `from_hz` to `to_hz` and dies away at `decay` per second.
## With `wrap` a tail that runs past the end continues at the start (seamless loops).
static func tone(out: PackedFloat32Array, rate: float, start: float, length: float, from_hz: float, to_hz: float, level: float, decay: float, wave: Wave = Wave.SINE, attack: float = 0.002, wrap: bool = false) -> void:
	var size := out.size()
	var first := int(start * rate)
	var count := int(length * rate)
	if not wrap:
		count = mini(count, size - first)
	if count <= 0:
		return
	var glide := to_hz / from_hz
	var fade := maxf(0.004 * rate, 1.0)
	var rise := maxf(attack * rate, 1.0)
	var phase := 0.0
	for i in count:
		var hz := from_hz * pow(glide, float(i) / count)
		phase = fmod(phase + hz / rate, 1.0)
		var sample := 0.0
		if wave == Wave.SINE:
			sample = sin(phase * TAU)
		elif wave == Wave.TRIANGLE:
			sample = 1.0 - 4.0 * absf(phase - 0.5)
		elif wave == Wave.SQUARE:
			sample = 1.0 if phase < 0.5 else -1.0
		else:
			sample = 2.0 * phase - 1.0
		var envelope := exp(-decay * i / rate) * minf(i / rise, 1.0) * minf((count - i) / fade, 1.0)
		out[(first + i) % size] += sample * envelope * level


## Adds a burst of white noise through a one-pole low-pass, and a high-pass when `high_pass_hz`
## is above zero.
static func noise(out: PackedFloat32Array, rate: float, rng: RandomNumberGenerator, start: float, length: float, level: float, decay: float, low_pass_hz: float, high_pass_hz: float = 0.0, attack: float = 0.001, wrap: bool = false) -> void:
	var size := out.size()
	var first := int(start * rate)
	var count := int(length * rate)
	if not wrap:
		count = mini(count, size - first)
	if count <= 0:
		return
	var smooth := 1.0 - exp(-TAU * low_pass_hz / rate)
	var slow := 1.0 - exp(-TAU * high_pass_hz / rate)
	var fade := maxf(0.004 * rate, 1.0)
	var rise := maxf(attack * rate, 1.0)
	var low := 0.0
	var floor_level := 0.0
	for i in count:
		low += (rng.randf_range(-1.0, 1.0) - low) * smooth
		var sample := low
		if high_pass_hz > 0.0:
			floor_level += (low - floor_level) * slow
			sample = low - floor_level
		var envelope := exp(-decay * i / rate) * minf(i / rise, 1.0) * minf((count - i) / fade, 1.0)
		out[(first + i) % size] += sample * envelope * level


## Adds noise whose low-pass sweeps from `from_hz` to `to_hz` under a smooth swell: a whoosh.
static func sweep(out: PackedFloat32Array, rate: float, rng: RandomNumberGenerator, start: float, length: float, level: float, from_hz: float, to_hz: float) -> void:
	var first := int(start * rate)
	var count := mini(int(length * rate), out.size() - first)
	var low := 0.0
	var floor_level := 0.0
	for i in count:
		var progress := float(i) / count
		var cutoff := from_hz * pow(to_hz / from_hz, progress)
		low += (rng.randf_range(-1.0, 1.0) - low) * (1.0 - exp(-TAU * cutoff / rate))
		floor_level += (low - floor_level) * 0.04
		out[first + i] += (low - floor_level) * sin(progress * PI) * level


## Smooths the whole buffer with a one-pole low-pass, as if heard through a speaker grille.
static func low_pass(samples: PackedFloat32Array, rate: float, cutoff_hz: float, wrap: bool = false) -> void:
	var smooth := 1.0 - exp(-TAU * cutoff_hz / rate)
	var low := 0.0
	# A looping buffer is run through twice so the filter state matches across the seam.
	for run in (2 if wrap else 1):
		for i in samples.size():
			low += (samples[i] - low) * smooth
			if run == (1 if wrap else 0):
				samples[i] = low


## Scales the buffer to `peak`, saturates it by `drive` and returns stereo frames.
static func finish(samples: PackedFloat32Array, peak: float = 0.8, drive: float = 1.0) -> PackedVector2Array:
	var loudest := 0.0001
	for sample in samples:
		loudest = maxf(loudest, absf(sample))
	var gain := drive / loudest
	var trim := peak / tanh(drive)
	var frames := PackedVector2Array()
	frames.resize(samples.size())
	for i in samples.size():
		var value := tanh(samples[i] * gain) * trim
		frames[i] = Vector2(value, value)
	return frames
