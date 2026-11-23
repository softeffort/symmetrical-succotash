class_name CombatZone
extends Node3D
## A place where the fighter's hands come up: around a heavy bag, inside the cage.
## A cylinder standing on this node's origin.

@export var radius := 2.4
@export var height := 3.0
@export var enabled := true


func _ready() -> void:
	add_to_group(&"combat_zones")


func contains(point: Vector3) -> bool:
	if not enabled or not is_visible_in_tree():
		return false
	var offset := point - global_position
	return offset.y > -0.6 and offset.y < height and Vector2(offset.x, offset.z).length() <= radius
