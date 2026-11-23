class_name GaugeBar
extends Control
## Flat gauge for the workout mini-games: a track, an optional highlighted zone, an optional
## fill and a marker. Positions are fractions of the width, 0 to 1.

@export_range(0.0, 1.0) var value := 0.0: set = set_value
## Highlighted target range (start, end); hidden while the two are equal.
@export var zone := Vector2.ZERO: set = set_zone
## Fills the track up to the value, or outwards from the middle when `centered`.
@export var fill := false
@export var centered := false
@export var marker := true
@export var track_color := Color(1.0, 1.0, 1.0, 0.13)
@export var zone_color := Color(0.66, 0.45, 1.0, 0.5)
@export var fill_color := Color(0.66, 0.45, 1.0): set = set_fill_color
@export var marker_color := Color(0.96, 0.97, 1.0): set = set_marker_color

var _box := StyleBoxFlat.new()


func _init() -> void:
	_box.set_corner_radius_all(5)


func set_value(next: float) -> void:
	next = clampf(next, 0.0, 1.0)
	if not is_equal_approx(next, value):
		value = next
		queue_redraw()


func set_zone(next: Vector2) -> void:
	if not next.is_equal_approx(zone):
		zone = next
		queue_redraw()


func set_fill_color(next: Color) -> void:
	fill_color = next
	queue_redraw()


func set_marker_color(next: Color) -> void:
	marker_color = next
	queue_redraw()


func _draw() -> void:
	var track := Rect2(0.0, size.y * 0.25, size.x, size.y * 0.5)
	_paint(track, track_color)
	if zone.y > zone.x:
		var from := clampf(zone.x, 0.0, 1.0)
		var to := clampf(zone.y, 0.0, 1.0)
		_paint(Rect2(from * size.x, track.position.y, (to - from) * size.x, track.size.y), zone_color)
	if fill:
		var origin := 0.5 if centered else 0.0
		var left := minf(origin, value) * size.x
		var right := maxf(origin, value) * size.x
		if right - left > 1.0:
			_paint(Rect2(left, track.position.y, right - left, track.size.y), fill_color)
	if centered:
		draw_rect(Rect2(size.x * 0.5 - 1.0, 0.0, 2.0, size.y), Color(1.0, 1.0, 1.0, 0.4))
	if marker:
		_paint(Rect2(value * size.x - 4.0, 0.0, 8.0, size.y), marker_color)


func _paint(rect: Rect2, color: Color) -> void:
	_box.bg_color = color
	draw_style_box(_box, rect)
