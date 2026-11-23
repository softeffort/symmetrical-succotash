class_name WorkoutOverlay
extends Control
## Contextual HUD for workout stations: selector, balance, rhythm, arm, speed and strain gauges
## plus the danger warning. A station opens it and shows only the rows it uses.

const CALM := Color(0.96, 0.97, 1.0)
const HEAVY := Color(1.0, 0.78, 0.3)
const DANGER := Color(1.0, 0.3, 0.32)
const MUTED := Color(0.66, 0.69, 0.76)

var _time := 0.0
var _buzz_wait := 0.0

@onready var title_label: Label = %Title
@onready var counter_label: Label = %Counter
@onready var selector_row: Control = %Selector
@onready var prev_key: Control = %PrevKey
@onready var next_key: Control = %NextKey
@onready var selector_value: Label = %SelectorValue
@onready var selector_detail: Label = %SelectorDetail
@onready var balance_row: Control = %BalanceRow
@onready var balance: GaugeBar = %Balance
@onready var rhythm_row: Control = %RhythmRow
@onready var rhythm_caption: Label = %RhythmCaption
@onready var rhythm: GaugeBar = %Rhythm
@onready var arms_row: Control = %ArmsRow
@onready var left_arm: GaugeBar = %LeftArm
@onready var right_arm: GaugeBar = %RightArm
@onready var speed_row: Control = %SpeedRow
@onready var speed_caption: Label = %SpeedCaption
@onready var speed: GaugeBar = %Speed
@onready var strain_row: Control = %StrainRow
@onready var strain: GaugeBar = %Strain
@onready var hint_label: Label = %Hint
@onready var danger_label: Label = %Danger


func _ready() -> void:
	add_to_group(&"workout_overlay")
	visible = false


func _process(delta: float) -> void:
	_time += delta
	_buzz_wait = maxf(_buzz_wait - delta, 0.0)
	if danger_label.is_visible_in_tree():
		danger_label.modulate.a = 0.6 + 0.4 * sin(_time * 14.0)
		if _buzz_wait <= 0.0:
			_buzz_wait = 0.9
			AudioManager.play(&"buzz", 0.8)


func open(station_title: String) -> void:
	title_label.text = station_title.to_upper()
	counter_label.text = ""
	hint_label.text = ""
	for row: Control in [selector_row, selector_detail, balance_row, rhythm_row, arms_row, speed_row, strain_row, danger_label]:
		row.visible = false
	visible = true
	modulate.a = 0.0
	create_tween().tween_property(self, "modulate:a", 1.0, 0.2)


func close() -> void:
	visible = false


func set_counter(text: String) -> void:
	counter_label.text = text


func set_hint(text: String) -> void:
	hint_label.text = text


## Big value with an optional detail line. `level` tints it: 0 calm, 1 heavy, 2 danger.
## `adjustable` shows the keycaps for changing it.
func set_selector(shown: bool, text: String = "", detail: String = "", level: int = 0, adjustable: bool = true) -> void:
	selector_row.visible = shown
	selector_detail.visible = shown and not detail.is_empty()
	if not shown:
		return
	var tint: Color = [CALM, HEAVY, DANGER][clampi(level, 0, 2)]
	selector_value.text = text
	selector_value.add_theme_color_override(&"font_color", tint)
	selector_detail.text = detail
	selector_detail.add_theme_color_override(&"font_color", MUTED if level == 0 else tint)
	prev_key.modulate.a = 1.0 if adjustable else 0.0
	next_key.modulate.a = 1.0 if adjustable else 0.0


## `tilt` runs -1 to 1; `safe` is the half-width of the zone a perfect rep stays inside.
func set_balance(shown: bool, tilt: float = 0.0, safe: float = 0.4) -> void:
	balance_row.visible = shown
	if shown:
		balance.zone = Vector2(0.5 - safe * 0.5, 0.5 + safe * 0.5)
		balance.value = tilt * 0.5 + 0.5
		balance.marker_color = DANGER if absf(tilt) > 0.7 else CALM


func set_rhythm(shown: bool, marker: float = 0.0, zone_from: float = 0.0, zone_to: float = 0.0, caption: String = "") -> void:
	rhythm_row.visible = shown
	if shown:
		rhythm_caption.text = caption
		rhythm.zone = Vector2(zone_from, zone_to)
		rhythm.value = marker


## Curl height per arm, 0 to 1; reps count once a bar passes `top`.
func set_arms(shown: bool, left: float = 0.0, right: float = 0.0, top: float = 1.0) -> void:
	arms_row.visible = shown
	if shown:
		left_arm.zone = Vector2(top - 0.02, 1.0)
		right_arm.zone = Vector2(top - 0.02, 1.0)
		left_arm.value = left
		right_arm.value = right


func set_speed(shown: bool, ratio: float = 0.0, zone_from: float = 0.0, caption: String = "") -> void:
	speed_row.visible = shown
	if shown:
		speed_caption.text = caption
		speed.zone = Vector2(zone_from, 1.0)
		speed.value = ratio


func set_strain(shown: bool, value: float = 0.0) -> void:
	strain_row.visible = shown
	if shown:
		strain.value = value
		strain.fill_color = HEAVY.lerp(DANGER, clampf(value * 1.6, 0.0, 1.0))


## Flashes a warning across the top of the screen; an empty string clears it.
func set_danger(text: String) -> void:
	danger_label.visible = not text.is_empty()
	danger_label.text = text
