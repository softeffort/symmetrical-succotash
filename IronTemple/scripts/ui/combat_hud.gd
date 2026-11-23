class_name CombatHUD
extends Control
## Fight overlay. While the stance is up it shows the hit counter and the fight controls; during
## a bout it adds both fighters' health with a thin chin gauge and two knockdown dots under it,
## stamina, the opponent's style and guard, the bout clock, the 3-2-1 countdown, callouts
## ("ROCKED!", "FEINTED!", "BODY SHOT!"), the clinch break bar and, at the end, the result
## screen with the reward breakdown.
##
## The RingManager opens and closes the bout views; everything else follows the player's
## CombatController and the opponent's signals.

signal rematch_requested
signal next_requested
signal exit_requested

const CONTROLS := "LMB  Jab     RMB  Cross     Ctrl + Click  Body Shot     F  Kick     A / D / S + Space  Slip\nShift  High Guard     Ctrl + Shift  Body Guard     Tap Shift as a punch starts  Feint"
const CALLOUT_COLORS := {&"good": UiKit.GOOD, &"bad": UiKit.BAD, &"info": UiKit.WHITE}
const GUARD_NAMES: Array[String] = ["NO GUARD", "HIGH GUARD", "BODY GUARD"]
## Height of the chin gauge and size of a knockdown dot.
const CHIN_HEIGHT := 5.0
const DOT_SIZE := 10.0
const MAX_KNOCKDOWNS := 2

var _combat: CombatController
var _combo_tween: Tween
var _count_tween: Tween
var _flash_tween: Tween
var _counter_tween: Tween
## The opponent of the bout on screen, and the guard its label is showing (-1 before the first read).
var _opponent: EnemyFighter = null
var _shown_guard := -1
var _callout_tween: Tween
var _time := 0.0
var _player_rocked := false
var _opponent_rocked := false

var _opponent_panel: Control
var _opponent_name: Label
var _opponent_style: Label
var _opponent_tag: Label
var _opponent_health: ProgressBar
var _opponent_chin: ProgressBar
var _opponent_dots: Array[Panel] = []
var _opponent_guard: ProgressBar
var _opponent_guard_caption: Label
var _opponent_stamina: ProgressBar
var _clock: Label
var _tell: Label
var _player_panel: Control
var _player_health: ProgressBar
var _player_health_text: Label
var _player_chin: ProgressBar
var _player_dots: Array[Panel] = []
var _player_stamina: ProgressBar
var _status: Label
var _streak_box: Control
var _streak_count: Label
var _combo_name: Label
var _count: Label
var _counter: Label
var _callout: Label
var _clinch_box: Control
var _clinch_prompt: Label
var _clinch_bar: ProgressBar
var _flash: ColorRect
var _hint: Label
var _result: Control
var _result_title: Label
var _result_subtitle: Label
var _result_rows: VBoxContainer
var _result_footer: Label
var _next_button: Button


func _ready() -> void:
	add_to_group(&"combat_hud")
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_flash()
	_build_opponent_panel()
	_build_player_panel()
	_build_streak()
	_build_centre()
	_build_clinch()
	_build_result()
	for node: Control in [_opponent_panel, _player_panel, _clock, _streak_box, _clinch_box, _hint, _result]:
		node.visible = false
	_count.modulate.a = 0.0
	_counter.modulate.a = 0.0
	_callout.modulate.a = 0.0
	_combo_name.modulate.a = 0.0
	PlayerStats.stamina_changed.connect(_on_stamina_changed)
	PlayerStats.status_changed.connect(_refresh_status)
	_on_stamina_changed(PlayerStats.stamina, PlayerStats.max_stamina)


func _process(delta: float) -> void:
	_time += delta
	if not _player_panel.visible:
		return
	_refresh_status()
	# A rocked fighter's gauge is their chin running out: it pulses until it is over.
	var pulse := 0.5 + 0.5 * sin(_time * 18.0)
	if _player_rocked:
		UiKit.fill_of(_player_chin).bg_color = UiKit.BAD.lerp(UiKit.GOLD, pulse)
	if _opponent_rocked:
		UiKit.fill_of(_opponent_chin).bg_color = UiKit.BAD.lerp(UiKit.GOLD, pulse)
	if is_instance_valid(_opponent):
		var shown := _opponent.get_shown_guard()
		if shown != _shown_guard:
			_shown_guard = shown
			_opponent_guard_caption.text = GUARD_NAMES[shown]
			_opponent_guard_caption.add_theme_color_override(&"font_color", UiKit.MUTED if shown == EnemyFighter.Guard.NONE else UiKit.WHITE)
	if _clinch_box.visible:
		_clinch_bar.value = _combat.clinch_progress
		# The knee is coming up: one push now is worth several.
		var timed := _combat.is_clinch_window()
		_clinch_prompt.add_theme_color_override(&"font_color", UiKit.WHITE.lerp(UiKit.ACCENT_HOT, pulse) if timed else UiKit.WHITE)
		UiKit.fill_of(_clinch_bar).bg_color = UiKit.ACCENT_HOT if timed else UiKit.ACCENT


## Follows `player`'s CombatController.
func bind(player: Player) -> void:
	_combat = player.combat
	_combat.stance_changed.connect(_on_stance_changed)
	_combat.health_changed.connect(_on_health_changed)
	_combat.streak_changed.connect(_on_streak_changed)
	_combat.combo_landed.connect(_on_combo_landed)
	_combat.counter_opened.connect(_on_counter_opened)
	_combat.chin_changed.connect(_on_player_chin_changed)
	_combat.knocked_down.connect(_set_dots.bind(_player_dots))
	_combat.clinch_changed.connect(_on_clinch_changed)
	_combat.callout.connect(show_callout)


## Shows the bout views for a fight against `opponent`.
func open_bout(profile: FighterProfile, opponent: EnemyFighter) -> void:
	_result.visible = false
	_opponent_name.text = profile.fighter_name.to_upper()
	_opponent_style.text = profile.get_style_title().to_upper()
	_opponent_tag.text = profile.get_tag()
	_set_bar(opponent.health, profile.max_health, _opponent_health)
	_on_opponent_guard_changed(opponent.guard, profile.guard_max)
	_opponent = opponent
	_shown_guard = -1
	_set_bar(opponent.stamina, profile.max_stamina, _opponent_stamina)
	_on_opponent_chin_changed(0.0, false)
	_on_player_chin_changed(0.0, false)
	_set_dots(0, _opponent_dots)
	_set_dots(0, _player_dots)
	opponent.health_changed.connect(_set_bar.bind(_opponent_health))
	opponent.guard_changed.connect(_on_opponent_guard_changed)
	opponent.stamina_changed.connect(_set_bar.bind(_opponent_stamina))
	opponent.chin_changed.connect(_on_opponent_chin_changed)
	opponent.knocked_down.connect(_set_dots.bind(_opponent_dots))
	opponent.cue_changed.connect(_on_opponent_cue_changed)
	_on_opponent_cue_changed("", UiKit.WHITE)
	_opponent_panel.visible = true
	_player_panel.visible = true
	_clock.visible = true
	_clinch_box.visible = false
	set_clock(0.0)
	_on_health_changed(_combat.health, _combat.max_health)
	for node: Control in [_opponent_panel, _player_panel, _clock]:
		node.modulate.a = 0.0
		create_tween().tween_property(node, "modulate:a", 1.0, 0.25)


func close_bout() -> void:
	_tell.text = ""
	_opponent_panel.visible = false
	_player_panel.visible = false
	_clock.visible = false
	_clinch_box.visible = false
	_result.visible = false


## Bout clock under the opponent's panel, in seconds since "FIGHT!".
func set_clock(seconds: float) -> void:
	var whole := floori(seconds)
	_clock.text = "%d:%02d" % [floori(whole / 60.0), whole % 60]


## Big centre-screen countdown text: "3", "2", "1", "FIGHT!".
func show_count(text: String) -> void:
	_count.text = text
	_count.add_theme_color_override(&"font_color", UiKit.ACCENT if text.length() > 1 else UiKit.WHITE)
	_count.pivot_offset = _count.size * 0.5
	_count.scale = Vector2.ONE * 1.7
	_count.modulate.a = 1.0
	if _count_tween != null:
		_count_tween.kill()
	_count_tween = create_tween()
	_count_tween.tween_property(_count, "scale", Vector2.ONE, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_count_tween.tween_interval(0.3)
	_count_tween.tween_property(_count, "modulate:a", 0.0, 0.2)


## Shouts something that just happened to the player across the middle of the screen.
func show_callout(text: String, kind: StringName = &"info") -> void:
	_callout.text = text
	_callout.add_theme_color_override(&"font_color", CALLOUT_COLORS.get(kind, UiKit.WHITE))
	_callout.pivot_offset = _callout.size * 0.5
	_callout.scale = Vector2.ONE * 1.3
	_callout.modulate.a = 1.0
	if _callout_tween != null:
		_callout_tween.kill()
	_callout_tween = create_tween()
	_callout_tween.tween_property(_callout, "scale", Vector2.ONE, 0.14).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_callout_tween.tween_interval(0.75)
	_callout_tween.tween_property(_callout, "modulate:a", 0.0, 0.3)


## Result screen. `summary` comes from RingManager: "won", "title", "subtitle", "rows" (label,
## value, colour), "footer", "has_next".
func show_result(summary: Dictionary) -> void:
	var won: bool = summary["won"]
	_result_title.text = summary["title"]
	_result_title.add_theme_color_override(&"font_color", UiKit.WHITE if won else UiKit.BAD)
	_result_subtitle.text = summary["subtitle"]
	_result_footer.text = summary["footer"]
	for child in _result_rows.get_children():
		child.queue_free()
	var rows: Array = summary["rows"]
	for entry: Array in rows:
		_result_rows.add_child(UiKit.row(entry[0], entry[1], entry[2]))
	_next_button.visible = summary["has_next"]
	_clinch_box.visible = false
	_clock.visible = false
	_tell.text = ""
	_result.visible = true
	_result.modulate.a = 0.0
	create_tween().tween_property(_result, "modulate:a", 1.0, 0.3)


# --- Signals ---------------------------------------------------------------------------------

func _on_stance_changed(active: bool) -> void:
	_hint.visible = active
	if not active:
		_streak_box.visible = false


func _on_health_changed(current: float, maximum: float) -> void:
	_set_bar(current, maximum, _player_health)
	_player_health_text.text = "%d / %d" % [ceili(current), ceili(maximum)]
	UiKit.fill_of(_player_health).bg_color = UiKit.BAD.lerp(UiKit.GOOD, clampf(current / maximum * 1.6, 0.0, 1.0))


func _on_stamina_changed(current: float, maximum: float) -> void:
	_set_bar(current, maximum, _player_stamina)
	UiKit.fill_of(_player_stamina).bg_color = UiKit.BAD.lerp(UiKit.WHITE, clampf(current / maximum * 2.5, 0.0, 1.0))


func _on_player_chin_changed(fill: float, rocked: bool) -> void:
	_player_rocked = rocked
	_show_chin(_player_chin, fill, rocked)


func _on_opponent_chin_changed(fill: float, rocked: bool) -> void:
	_opponent_rocked = rocked
	_show_chin(_opponent_chin, fill, rocked)


## The gauge fills white to hot pink as the stagger builds; rocked, it turns into the chin
## running out (the pulse is in `_process`).
func _show_chin(bar: ProgressBar, fill: float, rocked: bool) -> void:
	bar.value = fill
	if not rocked:
		UiKit.fill_of(bar).bg_color = UiKit.WHITE.lerp(UiKit.ACCENT, clampf(fill * 2.0, 0.0, 1.0)).lerp(UiKit.ACCENT_HOT, clampf(fill * 2.0 - 1.0, 0.0, 1.0))


func _on_opponent_guard_changed(current: float, maximum: float) -> void:
	_set_bar(current, maximum, _opponent_guard)
	UiKit.fill_of(_opponent_guard).bg_color = UiKit.BAD if current <= 0.0 else UiKit.ACCENT




## The opponent's tell, repeated under the clock.
func _on_opponent_cue_changed(text: String, color: Color) -> void:
	_tell.text = text
	_tell.add_theme_color_override(&"font_color", color)


func _on_clinch_changed(active: bool) -> void:
	_clinch_box.visible = active and _player_panel.visible
	_clinch_bar.value = 0.0


func _on_streak_changed(hits: int) -> void:
	_streak_box.visible = hits >= 2
	if hits < 2:
		return
	_streak_count.text = "x%d" % hits
	_streak_count.pivot_offset = _streak_count.size * 0.5
	_streak_count.scale = Vector2.ONE * 1.35
	create_tween().tween_property(_streak_count, "scale", Vector2.ONE, 0.14).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _on_combo_landed(text: String) -> void:
	if text.begins_with("COUNTER") or text.begins_with("KO") or text.begins_with("INTERCEPT"):
		_flash_screen(Color(1.0, 1.0, 1.0, 0.3), 0.22)
	_combo_name.text = text
	_combo_name.modulate.a = 1.0
	if _combo_tween != null:
		_combo_tween.kill()
	_combo_tween = create_tween()
	_combo_tween.tween_interval(0.9)
	_combo_tween.tween_property(_combo_name, "modulate:a", 0.0, 0.35)


## Perfect dodge: flash the screen and call the counter.
func _on_counter_opened(_seconds: float) -> void:
	_flash_screen(Color(0.85, 0.75, 1.0, 0.34), 0.3)
	_counter.modulate.a = 1.0
	if _counter_tween != null:
		_counter_tween.kill()
	_counter_tween = create_tween()
	_counter_tween.tween_property(_counter, "modulate:a", 0.0, 0.25).set_delay(0.45)


func _flash_screen(color: Color, seconds: float) -> void:
	_flash.color = color
	if _flash_tween != null:
		_flash_tween.kill()
	_flash_tween = create_tween()
	_flash_tween.set_parallel(true)
	_flash_tween.tween_property(_flash, "color:a", 0.0, seconds)


## One line under the stamina bar: the worst thing that is true right now.
func _refresh_status() -> void:
	var text := ""
	var color := UiKit.BAD
	if _combat != null and _combat.is_rocked():
		text = "ROCKED   no guard: slip and get away"
	elif PlayerStats.is_strained():
		text = "STRAINED   slower, weaker strikes"
	elif PlayerStats.is_exhausted:
		text = "GASSED   no guard, slow punches, a counter-hit puts you down"
		color = UiKit.GOLD
	elif _combat != null and _combat.in_bout and _combat.is_spent():
		text = "LOW STAMINA   a clean counter-hit puts you down"
		color = UiKit.GOLD
	elif _combat != null and _combat.is_sloppy():
		text = "SLOPPY   mashing: slow punches, x2 stamina, easy to slip"
		color = UiKit.GOLD
	if _status.text != text:
		_status.text = text
		_status.add_theme_color_override(&"font_color", color)


func _set_bar(current: float, maximum: float, bar: ProgressBar) -> void:
	bar.max_value = maximum
	bar.value = current


## Lights `count` of the knockdown dots.
func _set_dots(count: int, dots: Array[Panel]) -> void:
	for i in dots.size():
		(dots[i].get_theme_stylebox(&"panel") as StyleBoxFlat).bg_color = UiKit.BAD if i < count else UiKit.TRACK


# --- Layout ----------------------------------------------------------------------------------

func _build_flash() -> void:
	_flash = ColorRect.new()
	_flash.color = Color(1.0, 1.0, 1.0, 0.0)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_flash)


func _build_opponent_panel() -> void:
	var panel := UiKit.panel(SIDE_TOP, 16.0)
	panel.name = "OpponentPanel"
	_anchor(panel, 0.5, 0.0, Vector2(-320.0, 26.0), Vector2(640.0, 0.0))
	add_child(panel)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override(&"separation", 7)
	panel.add_child(rows)
	var header := HBoxContainer.new()
	header.add_theme_constant_override(&"separation", 12)
	rows.add_child(header)
	_opponent_name = UiKit.label("OPPONENT", 26)
	header.add_child(_opponent_name)
	_opponent_style = UiKit.label("", 14, UiKit.ACCENT)
	_opponent_style.size_flags_vertical = Control.SIZE_SHRINK_END
	header.add_child(_opponent_style)
	header.add_child(UiKit.spacer())
	_opponent_tag = UiKit.label("", 16, UiKit.MUTED)
	header.add_child(_opponent_tag)
	_opponent_health = UiKit.bar(UiKit.WHITE, 18.0)
	rows.add_child(_opponent_health)
	var chin_row := _chin_row(_opponent_dots)
	rows.add_child(chin_row)
	_opponent_chin = chin_row.get_child(0) as ProgressBar
	var guard_row := HBoxContainer.new()
	guard_row.add_theme_constant_override(&"separation", 10)
	rows.add_child(guard_row)
	_opponent_guard_caption = UiKit.label(GUARD_NAMES[0], 13, UiKit.MUTED)
	_opponent_guard_caption.custom_minimum_size.x = 96.0
	guard_row.add_child(_opponent_guard_caption)
	_opponent_guard = UiKit.bar(UiKit.ACCENT, 10.0)
	guard_row.add_child(_opponent_guard)
	var stamina_row := HBoxContainer.new()
	stamina_row.add_theme_constant_override(&"separation", 10)
	rows.add_child(stamina_row)
	var stamina_caption := UiKit.label("STAMINA", 13, UiKit.MUTED)
	stamina_caption.custom_minimum_size.x = 96.0
	stamina_row.add_child(stamina_caption)
	_opponent_stamina = UiKit.bar(UiKit.GOLD, 6.0)
	stamina_row.add_child(_opponent_stamina)
	_opponent_panel = panel

	_clock = UiKit.outline(UiKit.label("0:00", 22), 6)
	_clock.name = "Clock"
	_clock.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_anchor(_clock, 0.5, 0.0, Vector2(-60.0, 190.0), Vector2(120.0, 28.0))
	add_child(_clock)
	_tell = UiKit.outline(UiKit.label("", 40), 10)
	_tell.name = "Tell"
	_tell.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_anchor(_tell, 0.5, 0.0, Vector2(-200.0, 222.0), Vector2(400.0, 52.0))
	add_child(_tell)


func _build_player_panel() -> void:
	var panel := UiKit.panel(SIDE_BOTTOM, 14.0)
	panel.name = "PlayerPanel"
	# Bottom left, clear of the gloves.
	_anchor(panel, 0.0, 1.0, Vector2(28.0, -36.0), Vector2(470.0, 0.0))
	add_child(panel)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override(&"separation", 7)
	panel.add_child(rows)
	var health_row := HBoxContainer.new()
	health_row.add_theme_constant_override(&"separation", 10)
	rows.add_child(health_row)
	var health_caption := UiKit.label("HEALTH", 13, UiKit.MUTED)
	health_caption.custom_minimum_size.x = 70.0
	health_row.add_child(health_caption)
	_player_health = UiKit.bar(UiKit.GOOD, 18.0)
	health_row.add_child(_player_health)
	_player_health_text = UiKit.label("100 / 100", 15)
	_player_health_text.custom_minimum_size.x = 86.0
	_player_health_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	health_row.add_child(_player_health_text)
	var chin_row := _chin_row(_player_dots, 70.0, 86.0)
	rows.add_child(chin_row)
	_player_chin = chin_row.get_child(1) as ProgressBar
	var stamina_row := HBoxContainer.new()
	stamina_row.add_theme_constant_override(&"separation", 10)
	rows.add_child(stamina_row)
	var stamina_caption := UiKit.label("STAMINA", 13, UiKit.MUTED)
	stamina_caption.custom_minimum_size.x = 70.0
	stamina_row.add_child(stamina_caption)
	_player_stamina = UiKit.bar(UiKit.WHITE, 10.0)
	stamina_row.add_child(_player_stamina)
	var pad := Control.new()
	pad.custom_minimum_size.x = 86.0
	stamina_row.add_child(pad)
	_status = UiKit.label("", 14, UiKit.BAD)
	rows.add_child(_status)
	_player_panel = panel


## The thin chin gauge with the knockdown dots at its end, lined up under a health bar. With
## `lead` the row starts with a "CHIN" caption that wide; `tail` is the width the dots sit in.
func _chin_row(dots: Array[Panel], lead: float = 0.0, tail: float = 0.0) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override(&"separation", 10)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if lead > 0.0:
		var caption := UiKit.label("CHIN", 11, UiKit.MUTED)
		caption.custom_minimum_size.x = lead
		row.add_child(caption)
	var bar := UiKit.bar(UiKit.WHITE, CHIN_HEIGHT)
	bar.max_value = 1.0
	bar.add_theme_stylebox_override(&"background", UiKit.box(UiKit.TRACK, 2))
	bar.add_theme_stylebox_override(&"fill", UiKit.box(UiKit.WHITE, 2))
	row.add_child(bar)
	var marks := HBoxContainer.new()
	marks.add_theme_constant_override(&"separation", 6)
	marks.alignment = BoxContainer.ALIGNMENT_END
	marks.custom_minimum_size.x = tail
	marks.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(marks)
	var tag := UiKit.label("KD", 11, UiKit.MUTED)
	marks.add_child(tag)
	for i in MAX_KNOCKDOWNS:
		var dot := Panel.new()
		dot.custom_minimum_size = Vector2(DOT_SIZE, DOT_SIZE)
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		dot.add_theme_stylebox_override(&"panel", UiKit.box(UiKit.TRACK, int(DOT_SIZE * 0.5)))
		marks.add_child(dot)
		dots.append(dot)
	return row


func _build_streak() -> void:
	var box := VBoxContainer.new()
	box.name = "Streak"
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	_anchor(box, 1.0, 0.5, Vector2(-300.0, -110.0), Vector2(240.0, 150.0))
	add_child(box)
	_streak_count = UiKit.outline(UiKit.label("x2", 76), 12)
	_streak_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_streak_count)
	var caption := UiKit.outline(UiKit.label("HITS", 18, UiKit.MUTED), 6)
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(caption)
	_streak_box = box


func _build_centre() -> void:
	_count = UiKit.outline(UiKit.label("3", 170), 22)
	_count.name = "Count"
	_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_anchor(_count, 0.5, 0.5, Vector2(-450.0, -230.0), Vector2(900.0, 240.0))
	add_child(_count)

	_counter = UiKit.outline(UiKit.label("COUNTER!", 54, UiKit.ACCENT_HOT), 12)
	_counter.name = "Counter"
	_counter.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_anchor(_counter, 0.5, 0.5, Vector2(-400.0, 90.0), Vector2(800.0, 70.0))
	add_child(_counter)

	_callout = UiKit.outline(UiKit.label("", 50, UiKit.BAD), 12)
	_callout.name = "Callout"
	_callout.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_anchor(_callout, 0.5, 0.5, Vector2(-400.0, 168.0), Vector2(800.0, 66.0))
	add_child(_callout)

	_combo_name = UiKit.outline(UiKit.label("", 36, UiKit.ACCENT_HOT), 10)
	_combo_name.name = "ComboName"
	_combo_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_anchor(_combo_name, 1.0, 0.5, Vector2(-500.0, 44.0), Vector2(480.0, 50.0))
	add_child(_combo_name)

	_hint = UiKit.outline(UiKit.label(CONTROLS, 17, Color(0.9, 0.92, 0.97, 0.9), false), 6)
	_hint.name = "Hint"
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_anchor(_hint, 0.5, 1.0, Vector2(-640.0, -84.0), Vector2(1280.0, 56.0))
	add_child(_hint)


## "[SPACE] / [F]  BREAK CLINCH!" over a thin bar that fills as the player struggles.
func _build_clinch() -> void:
	var box := VBoxContainer.new()
	box.name = "Clinch"
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_theme_constant_override(&"separation", 8)
	_anchor(box, 0.5, 0.5, Vector2(-230.0, 250.0), Vector2(460.0, 60.0))
	add_child(box)
	_clinch_prompt = UiKit.outline(UiKit.label("%s  BREAK CLINCH!" % _keys_of(&"clinch_break"), 30), 10)
	_clinch_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_clinch_prompt)
	_clinch_bar = UiKit.bar(UiKit.ACCENT, 7.0)
	_clinch_bar.max_value = 1.0
	box.add_child(_clinch_bar)
	_clinch_box = box


## "[SPACE] / [F]" for the keys bound to `action`, so the prompt follows rebinds.
func _keys_of(action: StringName) -> String:
	var names: Array[String] = []
	for event in InputMap.action_get_events(action):
		var key := event as InputEventKey
		if key != null:
			var code := key.physical_keycode if key.physical_keycode != KEY_NONE else key.keycode
			names.append("[%s]" % OS.get_keycode_string(code).to_upper())
	return " / ".join(names) if not names.is_empty() else "[SPACE] / [F]"


func _build_result() -> void:
	_result = ColorRect.new()
	_result.name = "Result"
	(_result as ColorRect).color = Color(0.02, 0.02, 0.04, 0.62)
	_result.set_anchors_preset(Control.PRESET_FULL_RECT)
	# Swallows clicks so the game does not grab the mouse back behind the buttons.
	_result.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_result)
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_result.add_child(centre)
	var panel := UiKit.panel(SIDE_TOP, 30.0, UiKit.PANEL_SOLID)
	panel.custom_minimum_size.x = 580.0
	centre.add_child(panel)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override(&"separation", 10)
	panel.add_child(rows)
	_result_title = UiKit.label("VICTORY", 64)
	_result_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rows.add_child(_result_title)
	_result_subtitle = UiKit.label("", 20, UiKit.MUTED, false)
	_result_subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rows.add_child(_result_subtitle)
	rows.add_child(_rule())
	_result_rows = VBoxContainer.new()
	_result_rows.add_theme_constant_override(&"separation", 8)
	rows.add_child(_result_rows)
	rows.add_child(_rule())
	_result_footer = UiKit.label("", 17, UiKit.ACCENT)
	_result_footer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rows.add_child(_result_footer)
	var buttons := HBoxContainer.new()
	buttons.alignment = BoxContainer.ALIGNMENT_CENTER
	buttons.add_theme_constant_override(&"separation", 14)
	rows.add_child(buttons)
	_next_button = UiKit.button("NEXT FIGHT", true)
	_next_button.pressed.connect(func() -> void: next_requested.emit())
	buttons.add_child(_next_button)
	var rematch_button := UiKit.button("REMATCH")
	rematch_button.pressed.connect(func() -> void: rematch_requested.emit())
	buttons.add_child(rematch_button)
	var exit_button := UiKit.button("EXIT RING")
	exit_button.pressed.connect(func() -> void: exit_requested.emit())
	buttons.add_child(exit_button)


func _rule() -> ColorRect:
	var line := ColorRect.new()
	line.color = Color(1.0, 1.0, 1.0, 0.12)
	line.custom_minimum_size.y = 2.0
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return line


## Pins `node` to a point of the screen (`ax`, `ay` as fractions) with an offset and a size.
func _anchor(node: Control, ax: float, ay: float, offset: Vector2, extent: Vector2) -> void:
	node.anchor_left = ax
	node.anchor_right = ax
	node.anchor_top = ay
	node.anchor_bottom = ay
	node.offset_left = offset.x
	node.offset_top = offset.y
	node.offset_right = offset.x + extent.x
	node.offset_bottom = offset.y + extent.y
	node.grow_horizontal = Control.GROW_DIRECTION_BOTH
	node.grow_vertical = Control.GROW_DIRECTION_END if ay < 1.0 else Control.GROW_DIRECTION_BEGIN
