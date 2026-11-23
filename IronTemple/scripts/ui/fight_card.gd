class_name FightCard
extends Control
## Fight selection menu, opened from the terminal beside the cage. Lists the five ladder
## fighters and the Endless Championship League with level, tenure, scouting notes and purse;
## beaten fighters can be fought again, the next one is highlighted, the rest are locked.

signal fight_selected(profile: FighterProfile)
signal closed

var _player: Player
var _entries: Array[FighterProfile] = []
var _buttons: Array[Button] = []
var _selected := 0

var _record: Label
var _list: VBoxContainer
var _name: Label
var _tag: Label
var _blurb: Label
var _facts: VBoxContainer
var _enter: Button


func _ready() -> void:
	add_to_group(&"fight_card")
	visible = false
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_build()


func _unhandled_input(event: InputEvent) -> void:
	if not visible:
		return
	if event.is_action_pressed(&"ui_cancel"):
		get_viewport().set_input_as_handled()
		close()
	elif event.is_action_pressed(&"ui_accept"):
		get_viewport().set_input_as_handled()
		_confirm()


func is_open() -> bool:
	return visible


## Opens the menu for `player`, who stands still with the mouse free until it closes.
func open(player: Player) -> void:
	_player = player
	_player.controls_enabled = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_refresh()
	visible = true
	modulate.a = 0.0
	create_tween().tween_property(self, "modulate:a", 1.0, 0.18)


## Closes the menu and hands control back.
func close() -> void:
	visible = false
	if _player != null:
		_player.controls_enabled = true
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	closed.emit()


func _confirm() -> void:
	var profile := _entries[_selected]
	if not FighterRoster.is_unlocked(profile):
		return
	# The ring takes over the player from here.
	visible = false
	fight_selected.emit(profile)


func _refresh() -> void:
	_record.text = "%s      RECORD  %s      CASH  %s" % [PlayerStats.get_overhead_tag(), PlayerStats.fight_record.to_text(), PlayerStats.get_cash_text()]
	_entries = FighterRoster.ladder()
	_entries.append(FighterRoster.league_challenger(FighterRoster.next_league_level()))
	for button in _buttons:
		_list.remove_child(button)
		button.queue_free()
	_buttons.clear()
	var pick := -1
	for i in _entries.size():
		var profile := _entries[i]
		var button := _entry_button(profile, i)
		_list.add_child(button)
		_buttons.append(button)
		# Default to the next fight on the card.
		if pick < 0 and FighterRoster.is_unlocked(profile) and not FighterRoster.is_beaten(profile):
			pick = i
	_select(maxi(pick, 0))


func _select(index: int) -> void:
	_selected = index
	for i in _buttons.size():
		_buttons[i].set_pressed_no_signal(i == index)
	var profile := _entries[index]
	var unlocked := FighterRoster.is_unlocked(profile)
	var beaten := FighterRoster.is_beaten(profile)
	_name.text = profile.fighter_name.to_upper()
	_tag.text = ("ENDLESS CHAMPIONSHIP LEAGUE   " if profile.is_league() else "") + profile.get_tag()
	_blurb.text = profile.blurb if unlocked else _lock_reason(profile)
	for child in _facts.get_children():
		child.queue_free()
	var share := FighterRoster.REMATCH_SHARE if beaten else 1.0
	var gap := profile.level - PlayerStats.level
	var odds := "Even match" if absi(gap) <= 1 else ("You outlevel them by %d" % -gap if gap < 0 else "%d levels above you" % gap)
	_facts.add_child(UiKit.row("Your level", "Lvl %d   %s" % [PlayerStats.level, odds], UiKit.BAD if gap > 2 else UiKit.WHITE))
	_facts.add_child(UiKit.row("Style", profile.get_style_title() + ("   adaptive" if profile.adaptive else "") if unlocked else "?", UiKit.ACCENT))
	_facts.add_child(UiKit.row("Health", str(roundi(profile.max_health))))
	_facts.add_child(UiKit.row("Purse" + ("  (rematch)" if beaten else ""), PlayerStats.format_cash(roundi(profile.cash * share)), UiKit.GOLD))
	_facts.add_child(UiKit.row("Experience", "+%d XP" % roundi(profile.xp * share), UiKit.ACCENT))
	_facts.add_child(UiKit.row("Status", "DEFEATED" if beaten else ("READY" if unlocked else "LOCKED"), UiKit.GOOD if beaten else (UiKit.WHITE if unlocked else UiKit.MUTED)))
	_enter.disabled = not unlocked
	_enter.text = "ENTER RING" if unlocked else "LOCKED"


func _lock_reason(profile: FighterProfile) -> String:
	if profile.is_league():
		return "Opens when The Iron Champ falls. Endless Pro-tier challengers, level 16 and up, each mixing two styles, remembering your habits and reading you a little faster than the last."
	return "Locked. Beat %s first." % _entries[profile.ladder_index - 1].fighter_name


func _entry_button(profile: FighterProfile, index: int) -> Button:
	var unlocked := FighterRoster.is_unlocked(profile)
	var beaten := FighterRoster.is_beaten(profile)
	var button := Button.new()
	button.toggle_mode = true
	button.focus_mode = Control.FOCUS_NONE
	button.custom_minimum_size = Vector2(0.0, 64.0)
	button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	var title := "ENDLESS LEAGUE" if profile.is_league() and not unlocked else profile.fighter_name.to_upper()
	button.text = "   LVL %d    %s" % [profile.level, title]
	button.add_theme_font_override(&"font", UiKit.bold())
	button.add_theme_font_size_override(&"font_size", 20)
	var ink := UiKit.WHITE if unlocked else Color(UiKit.MUTED, 0.6)
	for state: StringName in [&"font_color", &"font_hover_color", &"font_pressed_color", &"font_hover_pressed_color", &"font_focus_color"]:
		button.add_theme_color_override(state, ink)
	button.add_theme_stylebox_override(&"normal", UiKit.box(Color(1.0, 1.0, 1.0, 0.06), 8))
	button.add_theme_stylebox_override(&"hover", UiKit.box(Color(1.0, 1.0, 1.0, 0.13), 8))
	button.add_theme_stylebox_override(&"pressed", UiKit.box(Color(UiKit.ACCENT, 0.3), 8, SIDE_LEFT))
	button.add_theme_stylebox_override(&"hover_pressed", UiKit.box(Color(UiKit.ACCENT, 0.38), 8, SIDE_LEFT))
	button.add_theme_stylebox_override(&"focus", StyleBoxEmpty.new())
	button.pressed.connect(_select.bind(index))

	var status := UiKit.label("LOCKED", 14, UiKit.MUTED)
	if beaten:
		status.text = "DEFEATED"
		status.add_theme_color_override(&"font_color", UiKit.GOOD)
	elif unlocked:
		status.text = "NEXT FIGHT"
		status.add_theme_color_override(&"font_color", UiKit.ACCENT)
	status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	status.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	status.set_anchors_preset(Control.PRESET_FULL_RECT)
	status.offset_right = -18.0
	button.add_child(status)
	return button


func _build() -> void:
	var dim := ColorRect.new()
	dim.color = Color(0.02, 0.02, 0.04, 0.66)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	# Swallows clicks so the game does not grab the mouse back behind the menu.
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(dim)
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	var panel := UiKit.panel(SIDE_TOP, 30.0, UiKit.PANEL_SOLID)
	panel.custom_minimum_size = Vector2(1080.0, 0.0)
	centre.add_child(panel)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override(&"separation", 16)
	panel.add_child(rows)

	var header := HBoxContainer.new()
	rows.add_child(header)
	header.add_child(UiKit.label("FIGHT CARD", 44))
	header.add_child(UiKit.spacer())
	var subtitle := UiKit.label("IRON TEMPLE  |  2F OCTAGON", 16, UiKit.ACCENT)
	subtitle.size_flags_vertical = Control.SIZE_SHRINK_END
	header.add_child(subtitle)
	_record = UiKit.label("", 17, UiKit.MUTED)
	rows.add_child(_record)

	var body := HBoxContainer.new()
	body.add_theme_constant_override(&"separation", 26)
	rows.add_child(body)
	_list = VBoxContainer.new()
	_list.custom_minimum_size.x = 500.0
	_list.add_theme_constant_override(&"separation", 8)
	body.add_child(_list)

	var detail := UiKit.panel(SIDE_LEFT, 22.0, Color(1.0, 1.0, 1.0, 0.05))
	detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(detail)
	var info := VBoxContainer.new()
	info.add_theme_constant_override(&"separation", 10)
	detail.add_child(info)
	_name = UiKit.label("", 32)
	info.add_child(_name)
	_tag = UiKit.label("", 17, UiKit.ACCENT)
	info.add_child(_tag)
	_blurb = UiKit.label("", 18, UiKit.MUTED, false)
	_blurb.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_blurb.custom_minimum_size = Vector2(440.0, 78.0)
	info.add_child(_blurb)
	_facts = VBoxContainer.new()
	_facts.add_theme_constant_override(&"separation", 8)
	_facts.size_flags_vertical = Control.SIZE_EXPAND_FILL
	info.add_child(_facts)

	var footer := HBoxContainer.new()
	footer.add_theme_constant_override(&"separation", 14)
	rows.add_child(footer)
	footer.add_child(UiKit.label("Enter  fight      Esc  close", 16, UiKit.MUTED, false))
	footer.add_child(UiKit.spacer())
	var back := UiKit.button("CLOSE")
	back.pressed.connect(close)
	footer.add_child(back)
	_enter = UiKit.button("ENTER RING", true)
	_enter.custom_minimum_size.x = 230.0
	_enter.pressed.connect(_confirm)
	footer.add_child(_enter)
