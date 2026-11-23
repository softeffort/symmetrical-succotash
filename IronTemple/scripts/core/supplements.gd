class_name Supplements
extends RefCounted
## The supplement bar's menu: four consumables bought with fight cash and used on the spot.
## The effects themselves live in PlayerStats.

const ISOTONIC := &"isotonic"
const PROTEIN := &"protein"
const PREWORKOUT := &"preworkout"
const ELIXIR := &"elixir"

const ITEMS: Array[Dictionary] = [
	{"id": ISOTONIC, "name": "Isotonic Water", "price": 15, "color": Color(0.3, 0.8, 1.0), "effect": "Restores 100% Stamina and halves an active injury."},
	{"id": PROTEIN, "name": "Whey Protein Shake", "price": 40, "color": Color(0.96, 0.86, 0.72), "effect": "x2 Muscle and XP from every workout for 3 minutes."},
	{"id": PREWORKOUT, "name": "Hardcore Pre-Workout", "price": 75, "color": Color(1.0, 0.3, 0.75), "effect": "Ultra-fast Stamina regen, +20% punch speed and lifting power for 2 minutes."},
	{"id": ELIXIR, "name": "Recovery Elixir", "price": 60, "color": Color(0.45, 0.95, 0.75), "effect": "Ice pack in a bottle: heals a Strained muscle at once."},
]


static func find(id: StringName) -> Dictionary:
	for item in ITEMS:
		if item["id"] == id:
			return item
	return {}


## Why `id` cannot be bought right now, or an empty string when it can.
static func get_block_reason(id: StringName) -> String:
	var item := find(id)
	if item.is_empty():
		return "Not on the menu"
	var price: int = item["price"]
	if not PlayerStats.can_afford(price):
		return "Need %s more" % PlayerStats.format_cash(price - PlayerStats.cash)
	if id == ELIXIR and not PlayerStats.is_strained():
		return "No injury to heal"
	return ""


## Seconds left on the buff `id` gives, or 0 for instant items and inactive buffs.
static func get_time_left(id: StringName) -> float:
	if id == PROTEIN:
		return PlayerStats.protein_timer
	if id == PREWORKOUT:
		return PlayerStats.preworkout_timer
	return 0.0


## Pays for `id` and applies it. Returns false when it cannot be bought.
static func buy(id: StringName) -> bool:
	if not get_block_reason(id).is_empty():
		return false
	var item := find(id)
	var price: int = item["price"]
	if not PlayerStats.spend_cash(price):
		return false
	match id:
		ISOTONIC:
			PlayerStats.drink_isotonic()
			PlayerStats.popup_requested.emit("STAMINA RESTORED", &"status")
		PROTEIN:
			PlayerStats.drink_protein()
			PlayerStats.popup_requested.emit("PROTEIN  x2 GAINS", &"perfect")
		PREWORKOUT:
			PlayerStats.drink_preworkout()
			PlayerStats.popup_requested.emit("PRE-WORKOUT  LET'S GO!", &"perfect")
		ELIXIR:
			PlayerStats.heal_strain()
	return true
