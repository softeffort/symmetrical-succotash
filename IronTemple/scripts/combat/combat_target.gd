class_name CombatTarget
extends Node3D
## Add to anything the player can strike: heavy bags, opponents. Its position is the aim point
## (chest height). The owner connects `struck` and writes the result into the Strike it receives.

signal struck(strike: Strike)

## How far the body reaches out from the aim point.
@export var radius := 0.3
@export var enabled := true


func _ready() -> void:
	add_to_group(&"combat_targets")


func receive(strike: Strike) -> void:
	if enabled:
		struck.emit(strike)
