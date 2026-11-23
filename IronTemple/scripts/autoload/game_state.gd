extends Node
## Autoload `GameState`: session flow shared between scenes (current objective, HUD messages).
## The fighter's stats and progression live in `PlayerStats`.

signal objective_changed(text: String)
signal toast_requested(text: String)

var objective := ""


func set_objective(text: String) -> void:
	objective = text
	objective_changed.emit(text)


## Shows a short message on the HUD.
func notify(text: String) -> void:
	toast_requested.emit(text)
