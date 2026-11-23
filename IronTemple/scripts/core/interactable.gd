class_name Interactable
extends Node
## Add as a child of any physics body to make it usable through the player's interact ray.
## Connect to `interacted` (or extend this class) to react.

signal interacted(player: Node)

## Shown on the HUD after the key hint, e.g. "[E] Mount Bike".
@export var action_text := "Use"
@export var enabled := true


func interact(player: Node) -> void:
	if enabled:
		interacted.emit(player)


## Finds the Interactable belonging to a raycast collider: on the body itself or up to two ancestors
## above it, so props built from several colliders can share one component.
static func find_for(collider: Object) -> Interactable:
	var node := collider as Node
	for _depth in 3:
		if node == null:
			break
		for child in node.get_children():
			var candidate := child as Interactable
			if candidate != null and candidate.enabled:
				return candidate
		node = node.get_parent()
	return null
