class_name PauseMenu
extends Control
## Pause menu: resume, manual save, mouse sensitivity, music and sound toggles, career reset
## (with confirmation) and quit. Opened with `Esc` while not at a station or in a fight; the
## whole game is paused behind it.

var _status: Label
var _sensitivity: HSlider
var _sensitivity_value: Label
var _music: Button
var _sfx: Button
var _career: Label
var _confirm: Control
var _reset: Button


func _ready() -> void:
	add_to_group(&"pause_menu")
	# Stays alive while the tree is paused.
	process_mode = Node.PROCESS_MODE_ALWAYS
	visible = false
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_build()


func _unhandled_input(event: InputEvent) -> void:
	if visible and event.is_action_pressed(&"ui_cancel"):
		get_viewport().set_input_as_handled()
		if _confirm.visible:
			_show_confirm(false)
		else:
			close()


func is_open() -> bool:
	return visible


func open() -> void:
	if visible:
		return
	_career.text = "%s      %s      %s" % [PlayerStats.get_overhead_tag(), PlayerStats.fight_record.to_text(), PlayerStats.get_cash_text()]
	_status.text = ""
	_sensitivity.set_value_no_signal(SaveManager.get_mouse_sensitivity())
	_sensitivity_value.text = "%.2fx" % SaveManager.get_mouse_sensitivity()
	_set_toggle(_music, SaveManager.get_setting("MusicOn"))
	_set_toggle(_sfx, SaveManager.get_setting("SfxOn"))
	_show_confirm(false)
	visible = true
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func close() -> void:
	if not visible:
		return
	visible = false
	get_tree().paused = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _save() -> void:
	_status.text = "Saved  %s" % Time.get_time_string_from_system() if SaveManager.save_game() else "Could not write the save file"


func _reset_career() -> void:
	SaveManager.reset_career()
	visible = false
	get_tree().paused = false
	# Rebuilds the world around the fresh career; the player wakes up at home again.
	get_tree().reload_current_scene()


func _quit() -> void:
	SaveManager.save_game()
	get_tree().quit()


func _show_confirm(shown: bool) -> void:
	_confirm.visible = shown
	_reset.visible = not shown


func _set_toggle(button: Button, on: bool) -> void:
	button.set_pressed_no_signal(on)
	button.text = "ON" if on else "OFF"


func _on_sensitivity_changed(value: float) -> void:
	_sensitivity_value.text = "%.2fx" % value
	SaveManager.set_setting("MouseSensitivity", value)


func _on_toggled(on: bool, button: Button, setting: String) -> void:
	button.text = "ON" if on else "OFF"
	SaveManager.set_setting(setting, on)


func _build() -> void:
	var dim := ColorRect.new()
	dim.color = Color(0.02, 0.02, 0.04, 0.7)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(dim)
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	var panel := UiKit.panel(SIDE_TOP, 30.0, UiKit.PANEL_SOLID)
	panel.custom_minimum_size.x = 560.0
	centre.add_child(panel)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override(&"separation", 12)
	panel.add_child(rows)

	var title := UiKit.label("PAUSED", 52)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rows.add_child(title)
	_career = UiKit.label("", 15, UiKit.ACCENT)
	_career.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rows.add_child(_career)

	var resume := UiKit.button("RESUME", true)
	resume.pressed.connect(close)
	rows.add_child(resume)
	var save := UiKit.button("SAVE GAME")
	save.pressed.connect(_save)
	rows.add_child(save)
	_status = UiKit.label("", 14, UiKit.GOOD)
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rows.add_child(_status)

	var look := _setting_row("Mouse sensitivity")
	_sensitivity = UiKit.slider(SaveManager.SENSITIVITY_RANGE.x, SaveManager.SENSITIVITY_RANGE.y, 0.05)
	_sensitivity.custom_minimum_size.x = 220.0
	_sensitivity.value_changed.connect(_on_sensitivity_changed)
	look.add_child(_sensitivity)
	_sensitivity_value = UiKit.label("1.00x", 17)
	_sensitivity_value.custom_minimum_size.x = 62.0
	_sensitivity_value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	look.add_child(_sensitivity_value)
	rows.add_child(look)

	var music := _setting_row("Gym speakers  (M)")
	_music = UiKit.toggle()
	_music.toggled.connect(_on_toggled.bind(_music, "MusicOn"))
	music.add_child(_music)
	rows.add_child(music)
	var sfx := _setting_row("Sound effects")
	_sfx = UiKit.toggle()
	_sfx.toggled.connect(_on_toggled.bind(_sfx, "SfxOn"))
	sfx.add_child(_sfx)
	rows.add_child(sfx)

	_reset = UiKit.button("RESET CAREER")
	_reset.pressed.connect(_show_confirm.bind(true))
	rows.add_child(_reset)
	_confirm = UiKit.panel(SIDE_LEFT, 14.0, Color(0.32, 0.05, 0.08, 0.9))
	(_confirm.get_theme_stylebox(&"panel") as StyleBoxFlat).border_color = UiKit.BAD
	var ask := VBoxContainer.new()
	ask.add_theme_constant_override(&"separation", 10)
	_confirm.add_child(ask)
	var warning := UiKit.label("Erase your level, stats, cash and fight record?", 17)
	warning.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ask.add_child(warning)
	var choice := HBoxContainer.new()
	choice.alignment = BoxContainer.ALIGNMENT_CENTER
	choice.add_theme_constant_override(&"separation", 12)
	ask.add_child(choice)
	var yes := UiKit.button("YES, RESET")
	yes.pressed.connect(_reset_career)
	choice.add_child(yes)
	var no := UiKit.button("CANCEL", true)
	no.pressed.connect(_show_confirm.bind(false))
	choice.add_child(no)
	rows.add_child(_confirm)

	var quit := UiKit.button("SAVE AND QUIT")
	quit.pressed.connect(_quit)
	rows.add_child(quit)


func _setting_row(caption: String) -> HBoxContainer:
	var line := HBoxContainer.new()
	line.add_theme_constant_override(&"separation", 12)
	line.add_child(UiKit.label(caption, 18, UiKit.MUTED, false))
	line.add_child(UiKit.spacer())
	return line
