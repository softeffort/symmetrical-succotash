class_name SoundBank
extends RefCounted
## Every sound effect in the game, synthesized on start-up: low thuds with a pitch drop for
## hits, filtered noise for snaps, blocks and the crowd, ringing partials for the bell and the
## plates. `render_all()` returns stereo buffers keyed by name for AudioManager.

const S := Synth.Wave.SINE
const TRI := Synth.Wave.TRIANGLE
const SQUARE := Synth.Wave.SQUARE


static func render_all(rate: float) -> Dictionary:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7341
	return {
		# Gym.
		&"clank": _clank(rate, rng),
		&"plate": _plate(rate, rng),
		&"tick": _tick(rate, false),
		&"tick_perfect": _tick(rate, true),
		&"crunch": _crunch(rate, rng),
		&"buzz": _buzz(rate),
		&"gulp": _gulp(rate),
		&"cash": _cash(rate),
		&"level_up": _level_up(rate),
		&"ui_click": _click(rate),
		# Fights.
		&"hit_light": _hit(rate, rng, false),
		&"hit_heavy": _hit(rate, rng, true),
		&"block": _block(rate, rng),
		&"snap": _snap(rate, rng),
		&"whoosh": _whoosh(rate, rng),
		&"bass_drop": _bass_drop(rate, rng),
		&"bell": _bell(rate, rng),
		&"count": _count(rate),
		&"crowd": _crowd(rate, rng),
		# Technical combat: impacts, and the tell that goes with each dangerous move.
		&"counter_crunch": _counter_crunch(rate, rng),
		&"body_hit": _body_hit(rate, rng),
		&"knockdown": _knockdown(rate, rng),
		&"rocked": _rocked(rate),
		&"feint": _feint(rate, rng),
		&"swoosh": _swoosh(rate, rng),
		&"dip": _dip(rate, rng),
		&"lunge": _lunge(rate, rng),
		&"grab": _grab(rate, rng),
		&"exhale": _exhale(rate, rng),
	}


## Barbell plates meeting: inharmonic ringing partials, a hard click and a second rattle.
static func _clank(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.42)
	for hit: Vector2 in [Vector2(0.0, 1.0), Vector2(0.07, 0.45)]:
		Synth.noise(out, rate, rng, hit.x, 0.014, 0.8 * hit.y, 220.0, 7000.0, 2200.0)
		Synth.tone(out, rate, hit.x, 0.32, 1180.0, 1172.0, 0.6 * hit.y, 13.0)
		Synth.tone(out, rate, hit.x, 0.28, 1874.0, 1866.0, 0.5 * hit.y, 17.0)
		Synth.tone(out, rate, hit.x, 0.22, 2953.0, 2940.0, 0.4 * hit.y, 22.0)
		Synth.tone(out, rate, hit.x, 0.16, 4106.0, 4090.0, 0.22 * hit.y, 30.0)
	return Synth.finish(out, 0.6)


## One plate sliding onto the bar: a short, duller ring.
static func _plate(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.16)
	Synth.noise(out, rate, rng, 0.0, 0.01, 0.6, 250.0, 5000.0, 1500.0)
	Synth.tone(out, rate, 0.0, 0.14, 1420.0, 1410.0, 0.5, 30.0)
	Synth.tone(out, rate, 0.0, 0.1, 2260.0, 2250.0, 0.3, 40.0)
	return Synth.finish(out, 0.4)


## Rep counted. A perfect rep adds a second, higher note.
static func _tick(rate: float, perfect: bool) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.2 if perfect else 0.08)
	Synth.tone(out, rate, 0.0, 0.07, 1320.0, 1320.0, 0.7, 55.0)
	if perfect:
		Synth.tone(out, rate, 0.065, 0.13, 1980.0, 1980.0, 0.7, 24.0)
		Synth.tone(out, rate, 0.065, 0.13, 3960.0, 3960.0, 0.15, 30.0)
	return Synth.finish(out, 0.45)


## A muscle going: crackling grains over a low thump.
static func _crunch(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.45)
	for i in 9:
		Synth.noise(out, rate, rng, rng.randf_range(0.0, 0.2), 0.03, rng.randf_range(0.5, 1.0), 110.0, 1500.0, 300.0)
	Synth.tone(out, rate, 0.0, 0.4, 120.0, 48.0, 0.9, 11.0)
	return Synth.finish(out, 0.75, 1.5)


## Overload warning: two harsh low pulses.
static func _buzz(rate: float) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.36)
	for start: float in [0.0, 0.18]:
		Synth.tone(out, rate, start, 0.13, 146.0, 146.0, 0.6, 1.5, SQUARE, 0.004)
		Synth.tone(out, rate, start, 0.13, 219.0, 219.0, 0.25, 1.5, SQUARE, 0.004)
	Synth.low_pass(out, rate, 1800.0)
	return Synth.finish(out, 0.4)


## Three swallows: short rising blips.
static func _gulp(rate: float) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.68)
	for i in 3:
		var start := i * 0.21
		Synth.tone(out, rate, start, 0.11, 210.0 + i * 12.0, 520.0, 0.8, 16.0, S, 0.012)
		Synth.tone(out, rate, start + 0.01, 0.08, 420.0, 900.0, 0.2, 26.0, S, 0.01)
	return Synth.finish(out, 0.55)


## Money changing hands: two bright pings.
static func _cash(rate: float) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.6)
	for note: Vector2 in [Vector2(0.0, 1568.0), Vector2(0.09, 2093.0)]:
		Synth.tone(out, rate, note.x, 0.5, note.y, note.y, 0.6, 8.0)
		Synth.tone(out, rate, note.x, 0.3, note.y * 2.0, note.y * 2.0, 0.2, 14.0)
	return Synth.finish(out, 0.45)


static func _level_up(rate: float) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.8)
	var notes: Array[float] = [523.25, 659.25, 783.99, 1046.5]
	for i in notes.size():
		Synth.tone(out, rate, i * 0.09, 0.5, notes[i], notes[i], 0.55, 7.0, TRI)
		Synth.tone(out, rate, i * 0.09, 0.3, notes[i] * 2.0, notes[i] * 2.0, 0.15, 10.0)
	return Synth.finish(out, 0.5)


static func _click(rate: float) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.05)
	Synth.tone(out, rate, 0.0, 0.045, 900.0, 640.0, 0.6, 80.0)
	return Synth.finish(out, 0.3)


## A fist landing: a sine dropping in pitch under a slap of noise. Heavy hits go lower, longer
## and are driven into saturation.
static func _hit(rate: float, rng: RandomNumberGenerator, heavy: bool) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.4 if heavy else 0.18)
	if heavy:
		Synth.tone(out, rate, 0.0, 0.38, 150.0, 40.0, 1.0, 10.0)
		Synth.tone(out, rate, 0.0, 0.3, 84.0, 36.0, 0.6, 8.0)
		Synth.noise(out, rate, rng, 0.0, 0.07, 0.9, 55.0, 1500.0)
		Synth.noise(out, rate, rng, 0.0, 0.012, 0.6, 200.0, 5000.0, 1200.0)
		return Synth.finish(out, 0.8, 2.2)
	Synth.tone(out, rate, 0.0, 0.16, 200.0, 72.0, 1.0, 26.0)
	Synth.noise(out, rate, rng, 0.0, 0.04, 0.7, 85.0, 2600.0)
	return Synth.finish(out, 0.7, 1.4)


## A strike caught on the gloves: the same thud, muffled.
static func _block(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.22)
	Synth.tone(out, rate, 0.0, 0.2, 124.0, 66.0, 0.8, 22.0)
	Synth.noise(out, rate, rng, 0.0, 0.09, 1.0, 40.0, 480.0)
	return Synth.finish(out, 0.55)


## The crack of a counter landing: bright noise over a fast pitch drop.
static func _snap(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.24)
	Synth.noise(out, rate, rng, 0.0, 0.05, 1.0, 85.0, 7000.0, 1900.0)
	Synth.tone(out, rate, 0.0, 0.07, 1500.0, 420.0, 0.4, 55.0, TRI)
	Synth.tone(out, rate, 0.0, 0.22, 180.0, 58.0, 0.7, 18.0)
	return Synth.finish(out, 0.85, 1.6)


static func _whoosh(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.26)
	Synth.sweep(out, rate, rng, 0.0, 0.25, 1.0, 500.0, 3200.0)
	return Synth.finish(out, 0.35)


## Slow motion kicking in: a long sub-bass dive.
static func _bass_drop(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 1.0)
	Synth.tone(out, rate, 0.0, 0.98, 170.0, 30.0, 1.0, 2.4, S, 0.01)
	Synth.tone(out, rate, 0.0, 0.7, 340.0, 60.0, 0.22, 4.5, TRI, 0.01)
	Synth.noise(out, rate, rng, 0.0, 0.5, 0.25, 7.0, 320.0)
	return Synth.finish(out, 0.85, 1.5)


## Ring bell: a struck click and a stack of inharmonic partials ringing out.
static func _bell(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 1.4)
	var base := 1040.0
	Synth.noise(out, rate, rng, 0.0, 0.012, 0.5, 250.0, 6000.0, 2500.0)
	Synth.tone(out, rate, 0.0, 1.38, base, base, 1.0, 3.0)
	Synth.tone(out, rate, 0.0, 1.2, base * 2.0, base * 2.0, 0.5, 4.2)
	Synth.tone(out, rate, 0.0, 1.0, base * 2.76, base * 2.76, 0.42, 5.5)
	Synth.tone(out, rate, 0.0, 0.8, base * 4.07, base * 4.07, 0.25, 7.5)
	Synth.tone(out, rate, 0.0, 0.5, base * 5.4, base * 5.4, 0.14, 10.0)
	return Synth.finish(out, 0.6)


## Countdown beep.
static func _count(rate: float) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.16)
	Synth.tone(out, rate, 0.0, 0.15, 740.0, 740.0, 0.7, 14.0, TRI)
	return Synth.finish(out, 0.4)


## A crowd reacting: two bands of noise swelling and falling, with an uneven tremble.
static func _crowd(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 1.7)
	Synth.noise(out, rate, rng, 0.0, 1.68, 1.0, 2.0, 1300.0, 320.0, 0.22)
	Synth.noise(out, rate, rng, 0.05, 1.6, 0.55, 2.6, 2800.0, 900.0, 0.3)
	for i in out.size():
		var t := i / rate
		out[i] *= 0.72 + 0.16 * sin(t * 41.0) + 0.12 * sin(t * 67.0 + 1.3)
	return Synth.finish(out, 0.6)


## An intercept counter landing flush: a crack, a spray of crunching grains and a deep thump.
static func _counter_crunch(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.42)
	Synth.noise(out, rate, rng, 0.0, 0.03, 1.0, 120.0, 6500.0, 1800.0)
	for i in 7:
		Synth.noise(out, rate, rng, rng.randf_range(0.005, 0.11), 0.025, rng.randf_range(0.5, 0.9), 130.0, 2200.0, 500.0)
	Synth.tone(out, rate, 0.0, 0.4, 130.0, 34.0, 1.0, 9.0)
	Synth.tone(out, rate, 0.0, 0.1, 900.0, 240.0, 0.35, 45.0, TRI)
	return Synth.finish(out, 0.8, 2.4)


## A fist sinking into the body: a low, dull thud and the air going out.
static func _body_hit(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.32)
	Synth.tone(out, rate, 0.0, 0.3, 110.0, 44.0, 1.0, 12.0)
	Synth.noise(out, rate, rng, 0.0, 0.06, 0.8, 60.0, 700.0)
	Synth.noise(out, rate, rng, 0.03, 0.2, 0.3, 14.0, 1600.0, 500.0, 0.02)
	return Synth.finish(out, 0.85, 1.8)


## A body meeting the canvas: two heavy thumps, shoulders then hips.
static func _knockdown(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.5)
	Synth.tone(out, rate, 0.0, 0.3, 90.0, 36.0, 1.0, 10.0)
	Synth.noise(out, rate, rng, 0.0, 0.1, 0.7, 40.0, 500.0)
	Synth.tone(out, rate, 0.13, 0.3, 70.0, 32.0, 0.7, 9.0)
	Synth.noise(out, rate, rng, 0.13, 0.12, 0.5, 30.0, 400.0)
	return Synth.finish(out, 0.9, 1.8)


## Ears ringing: two high tones beating against each other over a slow, queasy sub.
static func _rocked(rate: float) -> PackedVector2Array:
	var out := Synth.buffer(rate, 1.4)
	Synth.tone(out, rate, 0.0, 1.38, 3150.0, 3060.0, 0.35, 2.6, S, 0.02)
	Synth.tone(out, rate, 0.0, 1.3, 3163.0, 3071.0, 0.3, 2.8, S, 0.02)
	Synth.tone(out, rate, 0.0, 0.7, 72.0, 48.0, 0.5, 5.0, S, 0.01)
	return Synth.finish(out, 0.27)


## A feint: the flick of a glove that goes nowhere.
static func _feint(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.07)
	Synth.noise(out, rate, rng, 0.0, 0.06, 1.0, 70.0, 6000.0, 2200.0)
	return Synth.finish(out, 0.25)


## Tell of an overhand or power hook: the shoulder turning away, a soft rising rush of air.
static func _swoosh(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.28)
	Synth.sweep(out, rate, rng, 0.0, 0.26, 1.0, 240.0, 1500.0)
	return Synth.finish(out, 0.3)


## Tell of a body shot: the level dropping, a short falling note.
static func _dip(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.16)
	Synth.tone(out, rate, 0.0, 0.15, 330.0, 150.0, 0.8, 16.0, S, 0.006)
	Synth.noise(out, rate, rng, 0.0, 0.1, 0.25, 24.0, 900.0)
	return Synth.finish(out, 0.4)


## Tell of a clinch attempt: the lead foot stamping in and the rush of both arms.
static func _lunge(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.26)
	Synth.tone(out, rate, 0.0, 0.16, 110.0, 55.0, 1.0, 18.0)
	Synth.noise(out, rate, rng, 0.0, 0.12, 0.6, 20.0, 900.0)
	Synth.sweep(out, rate, rng, 0.02, 0.22, 0.6, 400.0, 1800.0)
	return Synth.finish(out, 0.55)


## The clinch closing: bodies meeting and gloves rustling round the neck.
static func _grab(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.24)
	Synth.tone(out, rate, 0.0, 0.2, 140.0, 60.0, 0.9, 15.0)
	Synth.noise(out, rate, rng, 0.0, 0.18, 0.8, 14.0, 1800.0, 300.0)
	return Synth.finish(out, 0.6)


## Tell of an explosive burst: one sharp breath out through the teeth.
static func _exhale(rate: float, rng: RandomNumberGenerator) -> PackedVector2Array:
	var out := Synth.buffer(rate, 0.26)
	Synth.noise(out, rate, rng, 0.0, 0.24, 1.0, 16.0, 5200.0, 1400.0, 0.012)
	Synth.noise(out, rate, rng, 0.0, 0.1, 0.5, 30.0, 9000.0, 3500.0, 0.004)
	return Synth.finish(out, 0.32)
