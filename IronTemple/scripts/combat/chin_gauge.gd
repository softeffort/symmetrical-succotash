class_name ChinGauge
extends RefCounted
## One fighter's composure, shared by the player and every opponent. Clean hits fill `stagger`;
## a full gauge rocks the fighter for ROCKED_TIME. While they are rocked the gauge becomes the
## chin: any heavy clean blow, or enough light ones to empty it, puts them on the canvas.
## Left alone the stagger drains away, so it takes hits in bunches to rock anyone.

signal changed

enum Result { NONE, ROCKED, KNOCKDOWN }

const ROCKED_TIME := 1.5
## Seconds without a clean hit before the stagger starts to drain, and the share of the gauge
## that drains each second after that.
const DECAY_DELAY := 1.6
const DECAY_RATE := 0.22
## The chin a rocked fighter has left, as a share of the gauge.
const CHIN_SHARE := 0.5
## Stagger a fighter carries out of a rocked spell they survived.
const RECOVERED := 0.35
## A head shot this soon after a clean body shot is a set-up, which shakes the chin this much more.
const SETUP_WINDOW := 1.2
const SETUP_JOLT := 1.6

var maximum := 60.0
var stagger := 0.0
var rocked := false
## 1 to 0 while rocked; empty means a knockdown.
var chin := 1.0

var _rocked_left := 0.0
var _quiet := 0.0
var _since_body := 99.0


func reset(new_maximum: float = -1.0) -> void:
	if new_maximum > 0.0:
		maximum = new_maximum
	stagger = 0.0
	rocked = false
	chin = 1.0
	_rocked_left = 0.0
	_since_body = 99.0
	changed.emit()


## Advances the gauge. Returns true on the tick a rocked spell wears off.
func tick(delta: float) -> bool:
	_quiet += delta
	_since_body += delta
	if rocked:
		_rocked_left -= delta
		if _rocked_left > 0.0:
			return false
		rocked = false
		stagger = maximum * RECOVERED
		changed.emit()
		return true
	if stagger > 0.0 and _quiet > DECAY_DELAY:
		stagger = maxf(stagger - maximum * DECAY_RATE * delta, 0.0)
		changed.emit()
	return false


## Applies a clean hit worth `amount` composure and reports what it did.
func take(amount: float, heavy: bool) -> Result:
	_quiet = 0.0
	if rocked:
		chin = maxf(chin - amount / (maximum * CHIN_SHARE), 0.0)
		changed.emit()
		return Result.KNOCKDOWN if heavy or chin <= 0.0 else Result.NONE
	stagger = minf(stagger + amount, maximum)
	if stagger < maximum:
		changed.emit()
		return Result.NONE
	rocked = true
	chin = 1.0
	_rocked_left = ROCKED_TIME
	changed.emit()
	return Result.ROCKED


func note_body_hit() -> void:
	_since_body = 0.0


## True while a head shot counts as a body-to-head set-up.
func is_set_up() -> bool:
	return _since_body <= SETUP_WINDOW


## What the HUD bar shows, 0 to 1: the stagger filling up, then the chin running out.
func get_fill() -> float:
	return chin if rocked else stagger / maximum
