class_name GymStation
extends Interactable
## Marks a piece of gym equipment. Step 2 connects workout minigames to `interacted`;
## for now using a station only confirms what it is.

## Identifier for workout logic, e.g. &"bench_press".
@export var station_type: StringName = &"generic"


func _ready() -> void:
	add_to_group(&"gym_stations")
	interacted.connect(_on_interacted)


func _on_interacted(_player: Node) -> void:
	GameState.notify("%s: training unlocks in the next update" % action_text)
