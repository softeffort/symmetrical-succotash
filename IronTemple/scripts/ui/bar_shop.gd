class_name BarShop
extends Control
## The supplement bar's shop: the player's cash and four consumables that are used the moment
## they are bought. Docked to the left so the first-person drink animation stays in view.
## Opened by the SupplementBar; `E` or `Esc` closes it.

signal purchased(item: Dictionary)
signal closed

var _player: Player
var _cash: Label
var _rows: Dictionary = {}


func _ready() -> void:
	add_to_group(&"bar_shop")
	visible = false
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_build()
	set_process(false)


func _process(_delta: float) -> void:
	_refresh()


func _unhandled_input(event: InputEvent) -> void:
	if visible and (event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"interact")):
		get_viewport().set_input_as_handled()
		close()


func is_open() -> bool:
	return visible


## Opens the shop for `player`, who stands still with the mouse free until it closes.
func open(player: Player) -> void:
	_player = player
	_player.controls_enabled = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_refresh()
	visible = true
	set_process(true)
	modulate.a = 0.0
	create_tween().tween_property(self, "modulate:a", 1.0, 0.18)


## Closes the shop and hands control back.
func close() -> void:
	if not visible:
		return
	visible = false
	set_process(false)
	if _player != null:
		_player.controls_enabled = true
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	closed.emit()


func _buy(id: StringName) -> void:
	if _player.arms.is_drinking():
		return
	if not Supplements.buy(id):
		AudioManager.play(&"buzz", 0.5)
		return
	var item := Supplements.find(id)
	AudioManager.play(&"cash")
	AudioManager.play(&"gulp", 1.0, 1.0, 0.3)
	_player.arms.play_drink(item["color"])
	SaveManager.save_game()
	_refresh()
	purchased.emit(item)


func _refresh() -> void:
	_cash.text = PlayerStats.get_cash_text()
	var drinking := _player != null and _player.arms.is_drinking()
	for item in Supplements.ITEMS:
		var id: StringName = item["id"]
		var row: Dictionary = _rows[id]
		var reason := Supplements.get_block_reason(id)
		var left := Supplements.get_time_left(id)
		var note: Label = row["note"]
		var button: Button = row["button"]
		button.disabled = drinking or not reason.is_empty()
		if left > 0.0:
			note.text = "ACTIVE  %d:%02d" % [floori(left / 60.0), int(left) % 60]
			note.add_theme_color_override(&"font_color", UiKit.GOOD)
		else:
			note.text = reason
			note.add_theme_color_override(&"font_color", UiKit.MUTED)


func _build() -> void:
	var dim := ColorRect.new()
	dim.color = Color(0.02, 0.02, 0.04, 0.3)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	# Swallows clicks so the game does not grab the mouse back behind the shop.
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(dim)

	var panel := UiKit.panel(SIDE_LEFT, 26.0, UiKit.PANEL_SOLID)
	panel.anchor_top = 0.5
	panel.anchor_bottom = 0.5
	panel.offset_left = 70.0
	panel.offset_right = 770.0
	# A little below centre, clear of the profile panel and its badges.
	panel.offset_top = 70.0
	panel.offset_bottom = 70.0
	panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	add_child(panel)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override(&"separation", 14)
	panel.add_child(rows)

	var header := HBoxContainer.new()
	rows.add_child(header)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override(&"separation", 0)
	header.add_child(titles)
	titles.add_child(UiKit.label("SUPPLEMENT BAR", 38))
	titles.add_child(UiKit.label("IRON TEMPLE  |  3F", 15, UiKit.ACCENT))
	header.add_child(UiKit.spacer())
	var wallet := VBoxContainer.new()
	wallet.add_theme_constant_override(&"separation", 0)
	header.add_child(wallet)
	var caption := UiKit.label("CASH", 13, UiKit.MUTED)
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	wallet.add_child(caption)
	_cash = UiKit.label("$0", 34, UiKit.GOLD)
	_cash.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	wallet.add_child(_cash)

	for item in Supplements.ITEMS:
		rows.add_child(_item_row(item))
	rows.add_child(UiKit.label("Used on the spot      E / Esc  close", 15, UiKit.MUTED, false))


func _item_row(item: Dictionary) -> Control:
	var card := UiKit.panel(SIDE_LEFT, 14.0, Color(1.0, 1.0, 1.0, 0.05))
	var color: Color = item["color"]
	(card.get_theme_stylebox(&"panel") as StyleBoxFlat).border_color = color
	var line := HBoxContainer.new()
	line.add_theme_constant_override(&"separation", 16)
	card.add_child(line)

	var text := VBoxContainer.new()
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_theme_constant_override(&"separation", 2)
	line.add_child(text)
	text.add_child(UiKit.label(item["name"], 22))
	var effect := UiKit.label(item["effect"], 15, UiKit.MUTED, false)
	effect.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	effect.custom_minimum_size.x = 380.0
	text.add_child(effect)
	var note := UiKit.label("", 14, UiKit.MUTED)
	text.add_child(note)

	var price: int = item["price"]
	var cost := UiKit.label(PlayerStats.format_cash(price), 26, UiKit.GOLD)
	cost.custom_minimum_size.x = 64.0
	cost.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	cost.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(cost)
	var button := UiKit.button("BUY", true)
	button.custom_minimum_size = Vector2(104.0, 46.0)
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var id: StringName = item["id"]
	button.pressed.connect(_buy.bind(id))
	line.add_child(button)
	_rows[id] = {"note": note, "button": button}
	return card
