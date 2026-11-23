class_name FightCardTerminal
extends Node3D
## Kiosk beside the cage: a glowing screen on a post with an `[E] Fight Card / Enter Ring`
## prompt. The screen faces local +Z. Emits `used` when the player interacts with it.

signal used(player: Node)

@export var action_text := "Fight Card / Enter Ring"


func _ready() -> void:
	var dark := Build.mat(Color(0.08, 0.08, 0.1), 0.6, 0.2)
	var accent := Color(0.66, 0.45, 1.0)
	Build.box(self, Vector3(0.62, 0.08, 0.5), Vector3(0.0, 0.04, 0.0), dark)
	Build.cyl(self, 0.06, 1.0, Vector3(0.0, 0.56, 0.0), GymProps.frame())
	# Screen tilted up towards whoever stands in front of it.
	var screen := Build.group(self, "Screen", Vector3(0.0, 1.22, 0.03))
	screen.rotation_degrees.x = -22.0
	Build.box(screen, Vector3(0.94, 0.58, 0.07), Vector3.ZERO, dark)
	Build.box(screen, Vector3(0.86, 0.5, 0.01), Vector3(0.0, 0.0, 0.036), Build.glow(Color(0.24, 0.13, 0.5), 1.1))
	Build.box(screen, Vector3(0.86, 0.02, 0.012), Vector3(0.0, 0.2, 0.038), Build.glow(accent, 2.4))
	Build.text(screen, "FIGHT CARD", Vector3(0.0, 0.07, 0.045), 0.11, Color(0.96, 0.97, 1.0), Vector3.ZERO, 1.5)
	Build.text(screen, "[E]  ENTER RING", Vector3(0.0, -0.1, 0.045), 0.06, Color(0.8, 0.64, 1.0), Vector3.ZERO, 1.5)
	# Header sign on two thin posts.
	for side: float in [-1.0, 1.0]:
		Build.cyl(self, 0.018, 0.5, Vector3(side * 0.4, 1.72, -0.06), GymProps.frame(), false, Vector3.ZERO, -1.0, 6)
	Build.box(self, Vector3(1.0, 0.2, 0.05), Vector3(0.0, 2.02, -0.06), dark)
	Build.text(self, "ENTER THE CAGE", Vector3(0.0, 2.02, -0.03), 0.1, accent, Vector3.ZERO, 1.6)
	Build.omni(self, Vector3(0.0, 1.5, 0.6), accent, 0.7, 3.0)

	# Tall enough for a level interact ray to find it.
	var body := Build.blocker(self, Vector3(1.0, 2.1, 0.4), Vector3(0.0, 1.05, 0.0))
	body.name = "Body"
	var interactable := Interactable.new()
	interactable.name = "Interactable"
	interactable.action_text = action_text
	body.add_child(interactable)
	interactable.interacted.connect(func(player: Node) -> void: used.emit(player))
