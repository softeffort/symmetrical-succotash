class_name HUD
extends CanvasLayer
## Dark HUD: profile (rank, days, level, XP), stamina, pump, cash and fight record, status and
## supplement badges, objective, interaction prompt, floating gain popups, the damage vignette,
## the pre-workout pulse and a waypoint marker. Hosts the CombatHUD, the FightCard, the BarShop
## and the PauseMenu.
## Driven by PlayerStats and GameState signals plus the bound player.

const ACCENT := Color(0.66, 0.45, 1.0)
const ACCENT_HOT := Color(1.0, 0.45, 0.85)
const WHITE := Color(0.96, 0.97, 1.0)
const MUTED := Color(0.66, 0.69, 0.76)
const GOOD := Color(0.45, 0.95, 0.75)
const BAD := Color(1.0, 0.3, 0.32)
const WAYPOINT_MARGIN := 60.0
## Tint of the pulsing pre-workout vignette.
const PULSE_TINT := Color(0.72, 0.3, 1.0)
const POPUP_SLOTS := 5
## Font size and colour per popup kind.
const POPUP_STYLES := {
	&"gain": [26, Color(0.96, 0.97, 1.0)],
	&"perfect": [40, Color(0.78, 0.6, 1.0)],
	&"level": [46, Color(0.96, 0.97, 1.0)],
	&"status": [32, Color(0.45, 0.95, 0.75)],
	&"warning": [32, Color(1.0, 0.3, 0.32)],
}
const VIGNETTE_SHADER := """
shader_type canvas_item;
uniform float intensity = 0.0;
uniform vec3 tint : source_color = vec3(0.85, 0.04, 0.07);

void fragment() {
	float edge = smoothstep(0.3, 1.0, distance(UV, vec2(0.5)) * 1.4142);
	COLOR = vec4(tint, intensity * (0.12 + 0.88 * edge));
}
"""

## Font for the floating popups.
@export var popup_font: Font

var _prompt_tween: Tween
var _toast_tween: Tween
var _vignette_tween: Tween
var _stamina_fill: StyleBoxFlat
var _pump_fill: StyleBoxFlat
var _vignette_material: ShaderMaterial
var _pulse_material: ShaderMaterial
var _pulse := 0.0
var _pulse_time := 0.0
var _popup_slot := 0
var _in_station := false
var _in_stance := false
var _in_bout := false

@onready var root: Control = $Root
@onready var vignette: ColorRect = %Vignette
@onready var rank_label: Label = %RankLabel
@onready var level_label: Label = %LevelLabel
@onready var xp_bar: ProgressBar = %XPBar
@onready var xp_label: Label = %XPLabel
@onready var stamina_bar: ProgressBar = %StaminaBar
@onready var pump_bar: ProgressBar = %PumpBar
@onready var pump_label: Label = %PumpLabel
@onready var cash_label: Label = %CashLabel
@onready var record_label: Label = %RecordLabel
@onready var warmup_badge: Control = %WarmupBadge
@onready var warmup_label: Label = %WarmupLabel
@onready var injury_badge: Control = %InjuryBadge
@onready var injury_label: Label = %InjuryLabel
@onready var pulse_vignette: ColorRect = %PulseVignette
@onready var protein_badge: Control = %ProteinBadge
@onready var protein_label: Label = %ProteinLabel
@onready var preworkout_badge: Control = %PreworkoutBadge
@onready var preworkout_label: Label = %PreworkoutLabel
@onready var objective_label: Label = %ObjectiveLabel
@onready var crosshair: Control = %Crosshair
@onready var prompt: Control = %Prompt
@onready var prompt_key: Label = %PromptKey
@onready var prompt_label: Label = %PromptLabel
@onready var toast_label: Label = %ToastLabel
@onready var waypoint: Control = %Waypoint
@onready var waypoint_label: Label = %WaypointLabel
@onready var controls_hint: Label = %ControlsHint
@onready var popups: Control = %Popups
@onready var combat_hud: CombatHUD = %CombatHUD
@onready var fight_card: FightCard = %FightCard
@onready var bar_shop: BarShop = %BarShop
@onready var pause_menu: PauseMenu = %PauseMenu


func _ready() -> void:
	_stamina_fill = stamina_bar.get_theme_stylebox(&"fill") as StyleBoxFlat
	_pump_fill = pump_bar.get_theme_stylebox(&"fill") as StyleBoxFlat
	var shader := Shader.new()
	shader.code = VIGNETTE_SHADER
	_vignette_material = ShaderMaterial.new()
	_vignette_material.shader = shader
	vignette.material = _vignette_material
	_pulse_material = ShaderMaterial.new()
	_pulse_material.shader = shader
	_pulse_material.set_shader_parameter("tint", PULSE_TINT)
	pulse_vignette.material = _pulse_material
	prompt.modulate.a = 0.0
	toast_label.modulate.a = 0.0
	waypoint.visible = false
	prompt_key.text = _key_name(&"interact")

	GameState.objective_changed.connect(_set_objective)
	GameState.toast_requested.connect(show_toast)
	PlayerStats.xp_changed.connect(_on_xp_changed)
	PlayerStats.level_up.connect(_on_level_up)
	PlayerStats.rank_changed.connect(_on_rank_changed)
	PlayerStats.tenure_changed.connect(_on_tenure_changed)
	PlayerStats.stamina_changed.connect(_on_stamina_changed)
	PlayerStats.pump_changed.connect(_on_pump_changed)
	PlayerStats.injured.connect(_on_injured)
	PlayerStats.popup_requested.connect(show_popup)
	PlayerStats.cash_changed.connect(_on_cash_changed)
	PlayerStats.fight_record_changed.connect(_on_fight_record_changed)
	PlayerStats.profile_reloaded.connect(_refresh_profile)
	_on_cash_changed(PlayerStats.cash)
	_on_fight_record_changed(PlayerStats.fight_record)
	_refresh_profile()
	_on_xp_changed(PlayerStats.xp, PlayerStats.xp_to_next())
	_on_stamina_changed(PlayerStats.stamina, PlayerStats.max_stamina)
	_on_pump_changed(PlayerStats.pump_level)
	_set_objective(GameState.objective)

	var fade := create_tween()
	fade.tween_interval(14.0)
	fade.tween_property(controls_hint, "modulate:a", 0.0, 1.5)


## Hooks the HUD to a player's prompt, station and combat signals.
func bind_player(player: Player) -> void:
	player.interact_prompt_changed.connect(set_prompt)
	player.station_changed.connect(_on_station_changed)
	player.combat.stance_changed.connect(_on_stance_changed)
	player.combat.damage_taken.connect(_on_damage_taken)
	player.combat.bout_changed.connect(func(active: bool) -> void: _in_bout = active)
	player.pause_requested.connect(pause_menu.open)
	combat_hud.bind(player)


## Shows "[key] text" under the crosshair, or hides the prompt when `text` is empty.
func set_prompt(text: String) -> void:
	if not text.is_empty():
		prompt_label.text = text
	if _prompt_tween != null:
		_prompt_tween.kill()
	_prompt_tween = create_tween()
	_prompt_tween.tween_property(prompt, "modulate:a", 0.0 if text.is_empty() else 1.0, 0.12)


func show_toast(text: String) -> void:
	toast_label.text = text
	if _toast_tween != null:
		_toast_tween.kill()
	_toast_tween = create_tween()
	_toast_tween.tween_property(toast_label, "modulate:a", 1.0, 0.15)
	_toast_tween.tween_interval(2.4)
	_toast_tween.tween_property(toast_label, "modulate:a", 0.0, 0.5)


## Floating text that drifts up beside the crosshair and fades.
func show_popup(text: String, kind: StringName = &"gain") -> void:
	if kind == &"level" and _in_bout:
		return  # the fight result screen lists the level-up itself
	var style: Array = POPUP_STYLES.get(kind, POPUP_STYLES[&"gain"])
	var label := Label.new()
	label.text = text
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if popup_font != null:
		label.add_theme_font_override(&"font", popup_font)
	label.add_theme_font_size_override(&"font_size", style[0])
	label.add_theme_color_override(&"font_color", style[1])
	label.add_theme_color_override(&"font_outline_color", Color(0.05, 0.03, 0.1, 0.95))
	label.add_theme_constant_override(&"outline_size", 10)
	popups.add_child(label)
	# Each popup takes the next row, so a burst of gains stacks instead of overlapping.
	var centre := root.size * 0.5
	var big := kind == &"perfect" or kind == &"level"
	var start := Vector2(centre.x - label.get_minimum_size().x * 0.5, centre.y - 210.0) if big else Vector2(centre.x + 150.0, centre.y - 70.0 + _popup_slot * 38.0)
	if not big:
		_popup_slot = (_popup_slot + 1) % POPUP_SLOTS
	label.position = start
	label.modulate.a = 0.0
	var tween := label.create_tween()
	tween.set_parallel(true)
	tween.tween_property(label, "modulate:a", 1.0, 0.1)
	tween.tween_property(label, "position:y", start.y - 70.0, 1.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(label, "modulate:a", 0.0, 0.4).set_delay(0.9)
	tween.chain().tween_callback(label.queue_free)


## Flashes the red injury vignette.
func flash_vignette(strength: float = 1.0, duration: float = 1.4) -> void:
	if _vignette_tween != null:
		_vignette_tween.kill()
	_vignette_material.set_shader_parameter("intensity", strength)
	_vignette_tween = create_tween()
	_vignette_tween.tween_property(_vignette_material, "shader_parameter/intensity", 0.0, duration).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)


func _process(delta: float) -> void:
	_update_badges()
	_update_waypoint()
	_update_pulse(delta)


func _update_badges() -> void:
	if PlayerStats.is_warmed_up():
		warmup_badge.visible = true
		warmup_label.text = "WARMED UP  %s" % _clock(PlayerStats.warmup_timer)
		warmup_label.add_theme_color_override(&"font_color", GOOD)
	elif PlayerStats.warmup_progress > 0.0:
		warmup_badge.visible = true
		warmup_label.text = "WARMING UP  %d%%" % roundi(PlayerStats.warmup_progress * 100.0)
		warmup_label.add_theme_color_override(&"font_color", MUTED)
	else:
		warmup_badge.visible = false
	injury_badge.visible = PlayerStats.is_strained()
	if injury_badge.visible:
		var pace := "  -  resting x2" if PlayerStats.resting else ""
		injury_label.text = "STRAINED  %s%s" % [_clock(PlayerStats.injury_timer), pace]
	protein_badge.visible = PlayerStats.has_protein()
	if protein_badge.visible:
		protein_label.text = "PROTEIN x2  %s" % _clock(PlayerStats.protein_timer)
	preworkout_badge.visible = PlayerStats.has_preworkout()
	if preworkout_badge.visible:
		preworkout_label.text = "PRE-WORKOUT  %s" % _clock(PlayerStats.preworkout_timer)


## Pre-workout shows as a faint purple pulse at the edges of the screen.
func _update_pulse(delta: float) -> void:
	_pulse = move_toward(_pulse, 1.0 if PlayerStats.has_preworkout() else 0.0, delta * 1.5)
	if _pulse <= 0.0 and not pulse_vignette.visible:
		return
	_pulse_time += delta
	pulse_vignette.visible = _pulse > 0.0
	_pulse_material.set_shader_parameter("intensity", _pulse * (0.2 + 0.09 * sin(_pulse_time * 5.2)))


func _update_waypoint() -> void:
	var target := get_tree().get_first_node_in_group(&"waypoint") as Beacon
	var camera := get_viewport().get_camera_3d()
	if target == null or camera == null or not target.active or _in_station:
		waypoint.visible = false
		return
	var point := target.global_position + Vector3.UP * target.marker_height
	var view := root.size
	var screen := camera.unproject_position(point)
	if camera.is_position_behind(point):
		# Pin the marker to the screen edge on the side the target lies.
		var side := (camera.global_transform.affine_inverse() * point).x
		screen = Vector2(view.x if side > 0.0 else 0.0, view.y * 0.5)
	var margin := Vector2(WAYPOINT_MARGIN, WAYPOINT_MARGIN)
	waypoint.position = screen.clamp(margin, view - margin)
	waypoint.visible = true
	waypoint_label.text = "%s  %d m" % [target.title, roundi(camera.global_position.distance_to(point))]


func _refresh_profile() -> void:
	rank_label.text = PlayerStats.get_profile_title()
	level_label.text = "Lvl %d" % PlayerStats.level


func _set_objective(text: String) -> void:
	objective_label.text = text
	objective_label.visible = not text.is_empty()


func _on_xp_changed(xp: float, xp_to_next: float) -> void:
	xp_bar.max_value = xp_to_next
	xp_bar.value = xp
	xp_label.text = "%d / %d XP" % [floori(xp), roundi(xp_to_next)]


func _on_level_up(_level: int) -> void:
	_refresh_profile()


func _on_rank_changed(title: String) -> void:
	_refresh_profile()
	show_toast("New rank: %s" % title)


func _on_tenure_changed(_days: int) -> void:
	_refresh_profile()


func _on_stamina_changed(current: float, maximum: float) -> void:
	stamina_bar.max_value = maximum
	stamina_bar.value = current
	if _stamina_fill != null:
		_stamina_fill.bg_color = BAD.lerp(WHITE, clampf(current / maximum * 2.5, 0.0, 1.0))


func _on_pump_changed(pump_level: float) -> void:
	pump_bar.value = pump_level
	pump_label.text = "x%.1f" % PlayerStats.get_gain_multiplier()
	pump_label.add_theme_color_override(&"font_color", MUTED.lerp(ACCENT_HOT, pump_level / PlayerStats.PUMP_MAX))
	if _pump_fill != null:
		_pump_fill.bg_color = ACCENT.lerp(ACCENT_HOT, pump_level / PlayerStats.PUMP_MAX)


func _on_injured(_duration: float) -> void:
	flash_vignette()


func _on_station_changed(station: WorkoutStation) -> void:
	_in_station = station != null
	crosshair.visible = not _in_station
	controls_hint.visible = not _in_station and not _in_stance


## The combat HUD shows the fight controls while the hands are up.
func _on_stance_changed(active: bool) -> void:
	_in_stance = active
	controls_hint.visible = not _in_station and not _in_stance


## Red vignette on every hit taken; a blocked one barely shows.
func _on_damage_taken(amount: float, blocked: bool) -> void:
	var strength := clampf(0.3 + amount / 40.0, 0.3, 0.9)
	flash_vignette(strength * (0.35 if blocked else 1.0), 0.55)


func _on_cash_changed(cash: int) -> void:
	cash_label.text = PlayerStats.format_cash(cash)


func _on_fight_record_changed(record: FightRecord) -> void:
	record_label.text = record.to_text()


## Minutes and seconds, e.g. "4:07".
func _clock(seconds: float) -> String:
	var whole := ceili(seconds)
	return "%d:%02d" % [floori(whole / 60.0), whole % 60]


## Display name of the first key bound to `action`, so prompts follow rebinds.
func _key_name(action: StringName) -> String:
	for event in InputMap.action_get_events(action):
		var key := event as InputEventKey
		if key != null:
			var code := key.physical_keycode if key.physical_keycode != KEY_NONE else key.keycode
			return OS.get_keycode_string(code)
	return "?"
