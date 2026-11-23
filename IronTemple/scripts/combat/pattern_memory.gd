class_name PatternMemory
extends RefCounted
## What the player keeps doing, as an adaptive opponent remembers it: the last few attack
## sequences ("LR" is jab then cross, lower case is a body shot, "f" a feint, "K" a kick) and
## the last few slips. The same sequence twice running is a habit; so is the same slip twice,
## which the third one pays for.

const DEPTH := 5
## Presses further apart than this belong to different sequences.
const SEQUENCE_GAP := 0.75

## Finished sequences, oldest first.
var sequences: Array[String] = []
## Slip directions, oldest first: -1 left, 1 right, 0 back.
var dodges: Array[int] = []
## The sequence being thrown right now.
var current := ""

var _gap := 0.0


func tick(delta: float) -> void:
	if current.is_empty():
		return
	_gap += delta
	if _gap > SEQUENCE_GAP:
		_close()


func note_strike(key: String) -> void:
	current += key
	_gap = 0.0


## The last strike noted turned out to be a feint.
func note_feint() -> void:
	if not current.is_empty():
		current = current.left(-1) + "f"


func note_dodge(direction: int) -> void:
	dodges.append(direction)
	if dodges.size() > DEPTH:
		dodges.pop_front()


## The sequence thrown twice running, or "" for none. A lone jab is a probe, not a habit.
func habit() -> String:
	var count := sequences.size()
	if count < 2 or sequences[count - 1] != sequences[count - 2] or sequences[count - 1] == "L":
		return ""
	return sequences[count - 1]


## True at the moment the attack in progress shows itself as a third helping of the habit:
## on its first strike for a single-strike habit, on its second for a combination.
func is_repeating() -> bool:
	var pattern := habit()
	if pattern.is_empty() or current.is_empty():
		return false
	return current.length() == mini(pattern.length(), 2) and pattern.begins_with(current)


## True when the last three slips all went the same way.
func is_dodge_repeating() -> bool:
	var count := dodges.size()
	return count >= 3 and dodges[count - 1] == dodges[count - 2] and dodges[count - 2] == dodges[count - 3]


func forget_attacks() -> void:
	sequences.clear()
	current = ""


func forget_dodges() -> void:
	dodges.clear()


func _close() -> void:
	sequences.append(current)
	if sequences.size() > DEPTH:
		sequences.pop_front()
	current = ""
