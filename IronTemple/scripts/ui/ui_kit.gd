class_name UiKit
extends RefCounted
## Flat dark UI pieces for the combat HUD, the fight card, the bar shop and the pause menu, in
## the HUD's palette: near-black panels, crisp white text, purple accents.

const PANEL := Color(0.055, 0.063, 0.082, 0.9)
const PANEL_SOLID := Color(0.07, 0.078, 0.1, 0.98)
const ACCENT := Color(0.66, 0.45, 1.0)
const ACCENT_HOT := Color(1.0, 0.45, 0.85)
const WHITE := Color(0.96, 0.97, 1.0)
const MUTED := Color(0.66, 0.69, 0.76)
const GOOD := Color(0.45, 0.95, 0.75)
const BAD := Color(1.0, 0.3, 0.32)
const GOLD := Color(1.0, 0.82, 0.3)
const TRACK := Color(1.0, 1.0, 1.0, 0.13)
const INK := Color(0.07, 0.07, 0.09)
const OUTLINE := Color(0.05, 0.03, 0.1, 0.95)

static var _bold: FontVariation


static func bold() -> FontVariation:
	if _bold == null:
		_bold = FontVariation.new()
		_bold.variation_embolden = 0.7
	return _bold


## Rounded flat box. `accent_side` gets a coloured edge (pass -1 for none).
static func box(color: Color, radius: int = 10, accent_side: int = -1, accent: Color = ACCENT, margin: float = 0.0) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.set_corner_radius_all(radius)
	style.set_content_margin_all(margin)
	if accent_side >= 0:
		style.set_border_width(accent_side as Side, 4)
		style.border_color = accent
	return style


static func panel(accent_side: int = SIDE_LEFT, margin: float = 16.0, color: Color = PANEL) -> PanelContainer:
	var container := PanelContainer.new()
	container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	container.add_theme_stylebox_override(&"panel", box(color, 10, accent_side, ACCENT, margin))
	return container


static func label(text: String, size: int, color: Color = WHITE, strong: bool = true) -> Label:
	var node := Label.new()
	node.text = text
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.add_theme_font_size_override(&"font_size", size)
	node.add_theme_color_override(&"font_color", color)
	if strong:
		node.add_theme_font_override(&"font", bold())
	return node


## Adds a dark outline so text stays readable over the 3D view.
static func outline(node: Label, size: int = 8) -> Label:
	node.add_theme_color_override(&"font_outline_color", OUTLINE)
	node.add_theme_constant_override(&"outline_size", size)
	return node


static func bar(fill: Color, height: float = 14.0) -> ProgressBar:
	var node := ProgressBar.new()
	node.show_percentage = false
	node.custom_minimum_size = Vector2(0.0, height)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.add_theme_stylebox_override(&"background", box(TRACK, 5))
	node.add_theme_stylebox_override(&"fill", box(fill, 5))
	return node


## The bar's own fill style, for recolouring.
static func fill_of(node: ProgressBar) -> StyleBoxFlat:
	return node.get_theme_stylebox(&"fill") as StyleBoxFlat


static func button(text: String, primary: bool = false) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.custom_minimum_size = Vector2(170.0, 48.0)
	node.add_theme_font_override(&"font", bold())
	node.add_theme_font_size_override(&"font_size", 19)
	var ink := INK if primary else WHITE
	for state: StringName in [&"font_color", &"font_hover_color", &"font_pressed_color", &"font_focus_color"]:
		node.add_theme_color_override(state, ink)
	node.add_theme_color_override(&"font_disabled_color", Color(MUTED, 0.5))
	var rest := ACCENT if primary else Color(1.0, 1.0, 1.0, 0.1)
	var hover := ACCENT.lightened(0.18) if primary else Color(1.0, 1.0, 1.0, 0.2)
	var down := WHITE if primary else Color(ACCENT, 0.55)
	node.add_theme_stylebox_override(&"normal", box(rest, 8, -1, ACCENT, 10.0))
	node.add_theme_stylebox_override(&"hover", box(hover, 8, -1, ACCENT, 10.0))
	node.add_theme_stylebox_override(&"pressed", box(down, 8, -1, ACCENT, 10.0))
	node.add_theme_stylebox_override(&"disabled", box(Color(1.0, 1.0, 1.0, 0.04), 8, -1, ACCENT, 10.0))
	node.add_theme_stylebox_override(&"focus", StyleBoxEmpty.new())
	node.pressed.connect(func() -> void: AudioManager.play(&"ui_click"))
	return node


## ON / OFF switch. Connect `toggled` and update the text to match.
static func toggle() -> Button:
	var node := button("ON")
	node.toggle_mode = true
	node.custom_minimum_size = Vector2(96.0, 40.0)
	node.add_theme_stylebox_override(&"pressed", box(ACCENT, 8, -1, ACCENT, 10.0))
	node.add_theme_stylebox_override(&"hover_pressed", box(ACCENT.lightened(0.18), 8, -1, ACCENT, 10.0))
	node.add_theme_color_override(&"font_pressed_color", INK)
	node.add_theme_color_override(&"font_hover_pressed_color", INK)
	return node


static func slider(from: float, to: float, step: float) -> HSlider:
	var node := HSlider.new()
	node.min_value = from
	node.max_value = to
	node.step = step
	node.focus_mode = Control.FOCUS_NONE
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var track := box(TRACK, 4)
	track.content_margin_top = 4.0
	track.content_margin_bottom = 4.0
	node.add_theme_stylebox_override(&"slider", track)
	node.add_theme_stylebox_override(&"grabber_area", box(ACCENT, 4))
	node.add_theme_stylebox_override(&"grabber_area_highlight", box(ACCENT.lightened(0.18), 4))
	return node


static func spacer() -> Control:
	var node := Control.new()
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


## Label on the left, value on the right.
static func row(caption: String, value: String, value_color: Color = WHITE, size: int = 19) -> HBoxContainer:
	var line := HBoxContainer.new()
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	line.add_child(label(caption, size, MUTED, false))
	line.add_child(spacer())
	line.add_child(label(value, size + 1, value_color))
	return line
