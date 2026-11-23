class_name SupplementBar
extends Node3D
## The working side of the third-floor bar: a bartender behind the counter and an
## `[E] Supplement Bar` prompt along its front that opens the BarShop. Sits at the middle of
## the counter, which runs along local X; customers stand on the +Z side.

signal used(player: Node)

const NPC := preload("res://scenes/npc/gym_npc.tscn")
const GREET_RANGE := 4.2
const GREETINGS: Array[String] = ["What'll it be?", "Protein's fresh today.", "Thirsty, champ?", "Refuel, then back to work."]
const THANKS: Array[String] = ["Drink up!", "Good choice.", "That'll do the trick.", "Go get it."]

@export var action_text := "Supplement Bar"
@export var counter_length := 13.0
## How far behind the counter the bartender stands.
@export var bartender_depth := 1.9

var bartender: GymNpc

var _shop: BarShop = null
var _greet_cooldown := 0.0


func _ready() -> void:
	# The prompt works along the whole front of the counter, over the stools.
	var front := Build.blocker(self, Vector3(counter_length, 2.3, 0.1), Vector3(0.0, 1.25, 0.46))
	front.name = "Counter"
	front.collision_layer = 8
	var interactable := Interactable.new()
	interactable.name = "Interactable"
	interactable.action_text = action_text
	front.add_child(interactable)
	interactable.interacted.connect(_on_used)

	bartender = NPC.instantiate()
	bartender.name = "Bartender"
	bartender.setup({
		"name": "Joe", "level": 12, "tenure": "6 Years", "activity": GymNpc.Activity.SERVE,
		"home": Vector3(0.0, 0.02, -bartender_depth), "yaw": 180.0, "room": 0.0,
		"build": Vector3(0.6, 0.65, 0.5), "height": 1.02,
		"skin": Color(0.78, 0.58, 0.44), "hair": Color(0.12, 0.1, 0.1),
		"shirt": Color(0.08, 0.08, 0.1), "shorts": Color(0.16, 0.14, 0.24), "shoes": Color(0.9, 0.9, 0.93),
	})
	add_child(bartender)


func _physics_process(delta: float) -> void:
	if not is_visible_in_tree():
		return
	var player := get_tree().get_first_node_in_group(&"player") as Node3D
	if player == null:
		return
	var spot := to_local(player.global_position)
	bartender.observe(spot, false)
	_greet_cooldown = maxf(_greet_cooldown - delta, 0.0)
	var near := absf(spot.y) < 1.5 and Vector2(spot.x - bartender.position.x, spot.z - bartender.position.z).length() < GREET_RANGE
	if near and _greet_cooldown <= 0.0 and (_shop == null or not _shop.is_open()):
		_greet_cooldown = 40.0
		bartender.say(GREETINGS.pick_random())


func _on_used(player: Node) -> void:
	used.emit(player)
	var customer := player as Player
	if customer == null or not _find_shop() or _shop.is_open():
		return
	_greet_cooldown = 40.0
	_shop.open(customer)


func _on_purchased(_item: Dictionary) -> void:
	bartender.say(THANKS.pick_random())
	bartender.nod()


func _find_shop() -> bool:
	if _shop == null:
		_shop = get_tree().get_first_node_in_group(&"bar_shop") as BarShop
		if _shop != null:
			_shop.purchased.connect(_on_purchased)
	return _shop != null
