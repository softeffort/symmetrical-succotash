class_name ComboTracker
extends RefCounted
## Timed chain detection for the two punch buttons. Each press is "L" or "R" for the head and
## "l" or "r" for the body; presses less than WINDOW apart build a chain, and the chain decides
## both the strike a press throws and the named combo it completes:
##
##   L      jab         L after a jab      left hook        l   liver hook
##   R      cross       R after a cross    right overhand   r   body cross
##   L R    1-2 Combo   L L R  Guard Breaker (uppercut)     R L R  KO Finisher (overhand)
##
## Body shots chain like any other press but only head shots complete the named combos.

const WINDOW := 0.9
const MAX_KEYS := 3
const LABELS := {
	Strike.ONE_TWO: "1-2 COMBO",
	Strike.GUARD_BREAKER: "GUARD BREAKER",
	Strike.KO_FINISHER: "KO FINISHER",
}

## Recent presses, oldest first, e.g. "LL".
var chain := ""

var _age := 0.0
var _last_kind: StringName = &""


## Call with unscaled time so slow motion does not stretch the window.
func tick(delta: float) -> void:
	if chain.is_empty():
		return
	_age += delta
	if _age > WINDOW:
		clear()


func clear() -> void:
	chain = ""
	_age = 0.0
	_last_kind = &""


## The strike the next press of `key` throws.
func next_kind(key: String) -> StringName:
	if key == "l":
		return Strike.BODY_HOOK
	if key == "r":
		return Strike.BODY_CROSS
	if key == "L":
		return Strike.HOOK if _last_kind == Strike.JAB else Strike.JAB
	if chain.ends_with("LL"):
		return Strike.UPPERCUT
	if chain.ends_with("RL") or _last_kind == Strike.CROSS:
		return Strike.OVERHAND
	return Strike.CROSS


## Adds a press and returns the combo it completes, or &"" for none.
func push(key: String) -> StringName:
	_last_kind = next_kind(key)
	chain = (chain + key).right(MAX_KEYS)
	_age = 0.0
	if chain.ends_with("RLR"):
		_restart()
		return Strike.KO_FINISHER
	if chain.ends_with("LLR"):
		_restart()
		return Strike.GUARD_BREAKER
	if chain.ends_with("LR"):
		return Strike.ONE_TWO
	return &""


## A finished three-hit combo starts a fresh chain, so finishers cannot be looped every press.
func _restart() -> void:
	chain = ""
	_last_kind = &""
