class_name GymBeat
extends RefCounted
## The gym speakers' loop: four bars of a driving phonk-style beat, synthesized once into a
## seamless buffer. An 808 kick and sliding sub-bass, claps, hats, a pulsing low-passed synth
## and a quiet cowbell line, all run through a low-pass so it sits behind the action.

const BPM := 128.0
const BARS := 4
const STEPS_PER_BAR := 16
## The bass root, A1.
const ROOT_HZ := 55.0

const KICKS: Array[int] = [0, 6, 10]
const CLAPS: Array[int] = [4, 12]
## Bass notes per bar: (step, semitones from the root, length in steps).
const BASS: Array[Array] = [
	[Vector3(0, 0, 5), Vector3(6, 0, 3), Vector3(10, 0, 5)],
	[Vector3(0, 0, 5), Vector3(6, 0, 3), Vector3(10, 3, 5)],
	[Vector3(0, -4, 5), Vector3(6, -4, 3), Vector3(10, -4, 5)],
	[Vector3(0, -2, 5), Vector3(6, -2, 3), Vector3(10, -5, 3), Vector3(14, -5, 2)],
]
## Cowbell line per bar: (step, semitones above A4).
const BELLS: Array[Array] = [
	[Vector2(0, 0), Vector2(3, 0), Vector2(6, 3), Vector2(8, 0), Vector2(11, 5), Vector2(14, 3)],
	[Vector2(0, 0), Vector2(3, 0), Vector2(6, 3), Vector2(8, 7), Vector2(11, 5), Vector2(14, 3)],
	[Vector2(0, -4), Vector2(3, -4), Vector2(6, 0), Vector2(8, -4), Vector2(11, 3), Vector2(14, 0)],
	[Vector2(0, -2), Vector2(3, -2), Vector2(6, 2), Vector2(8, -2), Vector2(11, 5), Vector2(14, 7)],
]


## Length of the loop in seconds.
static func length() -> float:
	return BARS * STEPS_PER_BAR * _step()


static func render(rate: float) -> PackedVector2Array:
	var rng := RandomNumberGenerator.new()
	rng.seed = 128
	var step := _step()
	var out := Synth.buffer(rate, length())
	for bar in BARS:
		var bar_start := bar * STEPS_PER_BAR * step
		var last := bar == BARS - 1
		for kick in KICKS:
			_kick(out, rate, bar_start + kick * step)
		if last:
			_kick(out, rate, bar_start + 14 * step)
		for clap in CLAPS:
			Synth.noise(out, rate, rng, bar_start + clap * step, 0.16, 0.5, 24.0, 2600.0, 700.0, 0.001, true)
			Synth.noise(out, rate, rng, bar_start + clap * step + 0.012, 0.1, 0.35, 34.0, 2600.0, 700.0, 0.001, true)
		for index in STEPS_PER_BAR:
			var at := bar_start + index * step
			# Hats on the off-beats, a pulsing synth on every sixteenth that is not a kick.
			if index % 2 == 1 or (last and index >= 12):
				Synth.noise(out, rate, rng, at, 0.04, 0.16 if index % 4 == 3 else 0.1, 90.0, 9000.0, 4500.0, 0.001, true)
			if not KICKS.has(index):
				Synth.tone(out, rate, at, step * 0.8, ROOT_HZ * 2.0, ROOT_HZ * 2.0, 0.11, 16.0, Synth.Wave.SAW, 0.004, true)
		var notes: Array = BASS[bar]
		for note: Vector3 in notes:
			var hz := ROOT_HZ * pow(2.0, note.y / 12.0)
			var at := bar_start + note.x * step
			# The 808 slides down into its note.
			Synth.tone(out, rate, at, 0.05, hz * 1.6, hz, 0.75, 0.0, Synth.Wave.SINE, 0.004, true)
			Synth.tone(out, rate, at + 0.05, note.z * step - 0.05, hz, hz, 0.75, 2.2, Synth.Wave.SINE, 0.002, true)
			Synth.tone(out, rate, at, note.z * step, hz * 2.0, hz * 2.0, 0.16, 5.0, Synth.Wave.TRIANGLE, 0.004, true)
		var bells: Array = BELLS[bar]
		for bell: Vector2 in bells:
			var hz := 440.0 * pow(2.0, bell.y / 12.0)
			var at := bar_start + bell.x * step
			Synth.tone(out, rate, at, 0.12, hz, hz, 0.075, 26.0, Synth.Wave.SQUARE, 0.002, true)
			Synth.tone(out, rate, at, 0.12, hz * 1.48, hz * 1.48, 0.05, 30.0, Synth.Wave.SQUARE, 0.002, true)
	Synth.low_pass(out, rate, 2600.0, true)
	return Synth.finish(out, 0.75, 1.3)


static func _kick(out: PackedFloat32Array, rate: float, at: float) -> void:
	Synth.tone(out, rate, at, 0.28, 150.0, 42.0, 1.0, 12.0, Synth.Wave.SINE, 0.002, true)
	Synth.tone(out, rate, at, 0.02, 900.0, 200.0, 0.25, 90.0, Synth.Wave.TRIANGLE, 0.001, true)


static func _step() -> float:
	return 60.0 / BPM / 4.0
