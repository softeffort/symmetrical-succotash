class_name CombatPopup
extends Label3D
## Floating combat text in the world: "COUNTER x2!", "GUARD BREAK!", "KNOCKOUT!", damage numbers.
## Faces the camera, draws over geometry, pops in, drifts up and fades. Popups keep one size
## on screen whatever the distance.

const WHITE := Color(0.96, 0.97, 1.0)
const ACCENT := Color(0.76, 0.58, 1.0)
const HOT := Color(1.0, 0.45, 0.85)
const WARN := Color(1.0, 0.82, 0.3)
const BAD := Color(1.0, 0.3, 0.32)
const MUTED := Color(0.7, 0.72, 0.8)
const FONT_SIZE := 96
## Apparent distance, in metres, a popup is sized for.
const VIEW_SCALE := 0.3

static var _font: FontVariation


## Spawns a popup under `host` at world position `at`. `letter_height` is roughly the letter
## height in metres as seen from a few steps away: 0.13 for a damage number, 0.3 for a callout.
static func spawn(host: Node, string: String, at: Vector3, color: Color = WHITE, letter_height: float = 0.2, lifetime: float = 0.9) -> CombatPopup:
	if _font == null:
		_font = FontVariation.new()
		_font.variation_embolden = 0.8
	var popup := CombatPopup.new()
	popup.text = string
	popup.font = _font
	popup.font_size = FONT_SIZE
	popup.outline_size = 24
	popup.modulate = color
	popup.outline_modulate = Color(0.06, 0.03, 0.12, 0.95)
	popup.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	popup.fixed_size = true
	popup.no_depth_test = true
	popup.render_priority = 4
	popup.outline_render_priority = 3
	# Animated every rendered frame, so physics interpolation would only smear it.
	popup.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	host.add_child(popup)
	popup.global_position = at + Vector3(randf_range(-0.14, 0.14), randf_range(-0.05, 0.05), randf_range(-0.14, 0.14))
	popup._play(letter_height * VIEW_SCALE / FONT_SIZE, lifetime)
	return popup


func _play(full_size: float, lifetime: float) -> void:
	pixel_size = full_size * 0.45
	var tween := create_tween()
	tween.set_parallel(true)
	tween.tween_property(self, "pixel_size", full_size, 0.13).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "position:y", position.y + 0.55, lifetime).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "modulate:a", 0.0, lifetime * 0.35).set_delay(lifetime * 0.65)
	tween.tween_property(self, "outline_modulate:a", 0.0, lifetime * 0.35).set_delay(lifetime * 0.65)
	tween.chain().tween_callback(queue_free)
