class_name BarKit
extends RefCounted
## Supplement-bar fittings (Step 7): the fluted counter with its LED strips and foot rail, the
## stock on the back shelves (protein tubs, shaker cups, energy cans), the glass-front
## mini-fridge, tube neon lettering and the lounge's lamps. Looks only: the fight for the
## counter's colliders and the SupplementBar's prompt is over before these are built.

const PURPLE := Color(0.52, 0.22, 1.0)
const AMBER := Color(1.0, 0.6, 0.16)
const STONE := Color(0.035, 0.033, 0.04)
const FLAVOURS: Array[Color] = [
	Color(0.95, 0.2, 0.3), Color(1.0, 0.55, 0.1), Color(0.98, 0.85, 0.2), Color(0.3, 0.85, 0.4),
	Color(0.15, 0.8, 0.9), Color(0.3, 0.45, 1.0), Color(0.65, 0.35, 1.0), Color(1.0, 0.35, 0.75),
]
## Stroke font for tube neon, on a grid 4 wide and 6 tall: each letter is a list of polylines.
static var _stone: StandardMaterial3D = null

const STROKES := {
	"A": [[Vector2(0, 0), Vector2(2, 6), Vector2(4, 0)], [Vector2(0.85, 2.3), Vector2(3.15, 2.3)]],
	"B": [[Vector2(0, 0), Vector2(0, 6), Vector2(2.2, 6), Vector2(3.3, 5.6), Vector2(3.6, 4.5), Vector2(3.3, 3.4), Vector2(2.2, 3.05), Vector2(0, 3.05)], [Vector2(2.2, 3.05), Vector2(3.5, 2.65), Vector2(3.9, 1.5), Vector2(3.5, 0.4), Vector2(2.4, 0), Vector2(0, 0)]],
	"D": [[Vector2(0, 0), Vector2(0, 6), Vector2(1.9, 6), Vector2(3.3, 5.2), Vector2(4, 3), Vector2(3.3, 0.8), Vector2(1.9, 0), Vector2(0, 0)]],
	"E": [[Vector2(4, 6), Vector2(0, 6), Vector2(0, 0), Vector2(4, 0)], [Vector2(0, 3.1), Vector2(3, 3.1)]],
	"F": [[Vector2(0, 0), Vector2(0, 6), Vector2(4, 6)], [Vector2(0, 3.2), Vector2(3, 3.2)]],
	"H": [[Vector2(0, 0), Vector2(0, 6)], [Vector2(4, 0), Vector2(4, 6)], [Vector2(0, 3), Vector2(4, 3)]],
	"I": [[Vector2(2, 0), Vector2(2, 6)], [Vector2(0.9, 0), Vector2(3.1, 0)], [Vector2(0.9, 6), Vector2(3.1, 6)]],
	"L": [[Vector2(0, 6), Vector2(0, 0), Vector2(4, 0)]],
	"M": [[Vector2(0, 0), Vector2(0, 6), Vector2(2, 2.4), Vector2(4, 6), Vector2(4, 0)]],
	"N": [[Vector2(0, 0), Vector2(0, 6), Vector2(4, 0), Vector2(4, 6)]],
	"O": [[Vector2(2, 0), Vector2(0.9, 0.35), Vector2(0.2, 1.4), Vector2(0, 3), Vector2(0.2, 4.6), Vector2(0.9, 5.65), Vector2(2, 6), Vector2(3.1, 5.65), Vector2(3.8, 4.6), Vector2(4, 3), Vector2(3.8, 1.4), Vector2(3.1, 0.35), Vector2(2, 0)]],
	"P": [[Vector2(0, 0), Vector2(0, 6), Vector2(2.2, 6), Vector2(3.4, 5.5), Vector2(3.8, 4.4), Vector2(3.4, 3.3), Vector2(2.2, 2.8), Vector2(0, 2.8)]],
	"R": [[Vector2(0, 0), Vector2(0, 6), Vector2(2.2, 6), Vector2(3.4, 5.5), Vector2(3.8, 4.5), Vector2(3.4, 3.5), Vector2(2.2, 3), Vector2(0, 3)], [Vector2(2.0, 3), Vector2(4, 0)]],
	"T": [[Vector2(0, 6), Vector2(4, 6)], [Vector2(2, 6), Vector2(2, 0)]],
	"U": [[Vector2(0, 6), Vector2(0, 1.6), Vector2(0.5, 0.5), Vector2(1.4, 0), Vector2(2.6, 0), Vector2(3.5, 0.5), Vector2(4, 1.6), Vector2(4, 6)]],
}


# --- Stock -----------------------------------------------------------------------------------

## Protein tub standing on the origin: dark body, a flavour-coloured label with a faint
## backlit glow, a pale stripe and a screw lid.
static func tub_mesh(color: Color) -> ArrayMesh:
	return Assembly.cached("tub/%s" % color.to_html(), func(a: Assembly) -> void:
		var body := GymKit.plastic(Color(0.035, 0.035, 0.042))
		a.lathe(PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.1, 0.0), Vector2(0.11, 0.012), Vector2(0.11, 0.25), Vector2(0.104, 0.262)]), Vector3.ZERO, body, Vector3.ZERO, 16)
		a.lathe(PackedVector2Array([Vector2(0.1115, 0.045), Vector2(0.1115, 0.205)]), Vector3.ZERO, Build.glow(color, 0.3), Vector3.ZERO, 16)
		a.lathe(PackedVector2Array([Vector2(0.1125, 0.15), Vector2(0.1125, 0.172)]), Vector3.ZERO, Build.mat(Color(0.95, 0.95, 0.93), 0.5), Vector3.ZERO, 16)
		a.lathe(PackedVector2Array([Vector2(0.112, 0.256), Vector2(0.117, 0.262), Vector2(0.117, 0.292), Vector2(0.11, 0.3), Vector2(0.0, 0.3)]), Vector3.ZERO, GymKit.plastic(color.darkened(0.35)), Vector3.ZERO, 16)
	)


## Shaker cup: a tinted cup with a measure band, a screw lid and a flip cap.
static func shaker_mesh(color: Color) -> ArrayMesh:
	return Assembly.cached("shaker/%s" % color.to_html(), func(a: Assembly) -> void:
		var cup := Stylized.standard(Color(0.12, 0.125, 0.14), 0.25, 0.0, Stylized.Surface.PLAIN)
		var lid := GymKit.plastic(color.darkened(0.15))
		a.lathe(PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.036, 0.0), Vector2(0.04, 0.008), Vector2(0.047, 0.152), Vector2(0.045, 0.156)]), Vector3.ZERO, cup, Vector3.ZERO, 12)
		a.lathe(PackedVector2Array([Vector2(0.0445, 0.06), Vector2(0.0465, 0.1)]), Vector3.ZERO, Build.glow(color, 0.25), Vector3.ZERO, 12)
		a.lathe(PackedVector2Array([Vector2(0.049, 0.15), Vector2(0.05, 0.178), Vector2(0.04, 0.196), Vector2(0.021, 0.2), Vector2(0.021, 0.222), Vector2(0.0, 0.224)]), Vector3.ZERO, lid, Vector3.ZERO, 12)
		a.box(Vector3(0.012, 0.012, 0.04), Vector3(0.0, 0.214, -0.03), lid)
	)


## Slim energy can: brushed aluminium with a printed sleeve.
static func can_mesh(color: Color) -> ArrayMesh:
	return Assembly.cached("can/%s" % color.to_html(), func(a: Assembly) -> void:
		a.lathe(PackedVector2Array([Vector2(0.0, 0.004), Vector2(0.02, 0.0), Vector2(0.027, 0.008), Vector2(0.027, 0.118), Vector2(0.022, 0.13), Vector2(0.02, 0.134), Vector2(0.0, 0.132)]), Vector3.ZERO, Stylized.chrome(Color(0.75, 0.77, 0.8), 0.28), Vector3.ZERO, 10)
		a.lathe(PackedVector2Array([Vector2(0.0275, 0.012), Vector2(0.0275, 0.112)]), Vector3.ZERO, Build.glow(color, 0.2), Vector3.ZERO, 10)
		a.lathe(PackedVector2Array([Vector2(0.028, 0.05), Vector2(0.028, 0.066)]), Vector3.ZERO, Build.mat(Color(0.04, 0.04, 0.05), 0.4), Vector3.ZERO, 10)
	)


## One shelf's worth of stock in a row `length` long, centred on the origin and standing on
## y = 0: `kind` is &"tubs", &"shakers" or &"cans".
static func shelf_stock(parent: Node, kind: StringName, length: float, pos: Vector3, seed_offset: int = 0) -> MeshInstance3D:
	var row := Assembly.new()
	match kind:
		&"tubs":
			var count := floori(length / 0.31)
			for i in count:
				var color := FLAVOURS[(i * 3 + seed_offset) % FLAVOURS.size()]
				row.stamp(tub_mesh(color), Vector3(-length * 0.5 + (i + 0.5) * length / count, 0.0, 0.0), Vector3(0.0, (i * 37) % 30 - 15.0, 0.0))
		&"shakers":
			var count := floori(length / 0.17)
			for i in count:
				var color := FLAVOURS[(i * 5 + seed_offset) % FLAVOURS.size()]
				# Stacked two deep, the back row a touch off the front one.
				row.stamp(shaker_mesh(color), Vector3(-length * 0.5 + (i + 0.5) * length / count, 0.0, 0.05 if i % 3 != 0 else -0.07), Vector3(0.0, (i * 53) % 360, 0.0))
		&"cans":
			var groups := floori(length / 0.5)
			for group in groups:
				var color := FLAVOURS[(group * 3 + seed_offset) % FLAVOURS.size()]
				for i in 6:
					var x := -length * 0.5 + (group + 0.5) * length / groups + (i % 3 - 1) * 0.062
					row.stamp(can_mesh(color), Vector3(x, 0.0, 0.06 if i < 3 else -0.04))
	var node := row.commit(parent, String(kind).capitalize(), pos)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node


# --- Counter ---------------------------------------------------------------------------------

## Fluted bar front `length` long and `height` tall facing local +Z, under a stone top that
## overhangs it: dark slats, a chrome foot rail on brackets, a purple strip under the overhang
## and an amber one in the toe kick. Origin on the floor at the middle of the front face.
static func counter_front_mesh(length: float, height: float) -> ArrayMesh:
	return Assembly.cached("counter_front/%.2f/%.2f" % [length, height], func(a: Assembly) -> void:
		var panel := Stylized.wood(Color(0.075, 0.055, 0.075), 0.5)
		var slat := Stylized.wood(Color(0.13, 0.085, 0.1), 0.45)
		a.box(Vector3(length, height - 0.12, 0.02), Vector3(0.0, 0.12 + (height - 0.12) * 0.5, 0.01), panel)
		var slats := floori(length / 0.07)
		for i in slats:
			a.box(Vector3(0.038, height - 0.2, 0.024), Vector3(-length * 0.5 + (i + 0.5) * length / slats, 0.14 + (height - 0.2) * 0.5, 0.03), slat)
		# Recessed toe kick with its amber strip, and the purple strip tucked under the top.
		a.box(Vector3(length, 0.12, 0.02), Vector3(0.0, 0.06, -0.05), GymKit.plastic(Color(0.02, 0.02, 0.025)))
		a.box(Vector3(length - 0.06, 0.016, 0.016), Vector3(0.0, 0.112, -0.03), Build.glow(AMBER, 2.6))
		a.box(Vector3(length - 0.06, 0.016, 0.02), Vector3(0.0, height - 0.035, 0.05), Build.glow(PURPLE, 3.2))
		# Foot rail.
		var chrome := GymKit.chrome()
		a.tube(Vector3(-length * 0.5 + 0.1, 0.2, 0.17), Vector3(length * 0.5 - 0.1, 0.2, 0.17), 0.022, chrome, 10)
		var brackets := maxi(roundi(length / 1.6), 2)
		for i in brackets + 1:
			var x := lerpf(-length * 0.5 + 0.15, length * 0.5 - 0.15, i / float(brackets))
			a.path([Vector3(x, 0.2, 0.17), Vector3(x, 0.2, 0.06), Vector3(x, 0.14, 0.02)] as Array[Vector3], 0.012, chrome, 6)
	)


## Polished dark stone of the bar tops and shelves: smooth, so it mirrors the strips and lamps.
static func stone() -> StandardMaterial3D:
	if _stone == null:
		_stone = StandardMaterial3D.new()
		_stone.albedo_color = STONE
		_stone.roughness = 0.2
		_stone.metallic = 0.15
		_stone.rim_enabled = true
		_stone.rim = 0.25
		_stone.rim_tint = Stylized.RIM_TINT
	return _stone


## Stone bar top `size` (x, thickness, z) with a softened edge, centred on the origin.
static func counter_top_mesh(size: Vector3) -> ArrayMesh:
	return Assembly.cached("counter_top/%s" % size, func(a: Assembly) -> void:
		a.rbox(size, 0.016, Vector3.ZERO, stone(), Vector3.ZERO, 2)
		a.box(Vector3(size.x - 0.04, 0.012, size.z - 0.04), Vector3(0.0, -size.y * 0.5 - 0.006, 0.0), GymKit.plastic(Color(0.02, 0.02, 0.025)))
	)


## Glass-front mini-fridge standing on the origin and facing local +Z, stocked with cans and
## lit from inside.
static func mini_fridge(parent: Node, pos: Vector3, yaw_deg: float) -> Node3D:
	var root := Build.group(parent, "MiniFridge", pos, yaw_deg)
	var size := Vector3(0.95, 0.9, 0.56)
	Assembly.spawn(root, "mini_fridge", func(a: Assembly) -> void:
		var shell := Stylized.steel(Color(0.04, 0.04, 0.05), 0.4)
		var liner := Build.glow(Color(0.82, 0.92, 1.0), 0.9)
		var chrome := GymKit.chrome()
		var wall := 0.035
		a.box(Vector3(size.x, wall, size.z), Vector3(0.0, wall * 0.5 + 0.06, 0.0), shell)
		a.box(Vector3(size.x, wall, size.z), Vector3(0.0, size.y - wall * 0.5, 0.0), shell)
		a.box(Vector3(size.x, size.y - 0.06, wall), Vector3(0.0, 0.06 + (size.y - 0.06) * 0.5, -size.z * 0.5 + wall * 0.5), shell)
		for side: float in [-1.0, 1.0]:
			a.box(Vector3(wall, size.y - 0.06, size.z), Vector3(side * (size.x - wall) * 0.5, 0.06 + (size.y - 0.06) * 0.5, 0.0), shell)
		a.box(Vector3(size.x - 0.04, 0.06, size.z - 0.06), Vector3(0.0, 0.03, -0.01), GymKit.plastic(Color(0.02, 0.02, 0.025)))
		# Lit liner: back and ceiling of the cabinet glow, which is the fridge's interior light.
		a.box(Vector3(size.x - wall * 2.0, size.y - 0.16, 0.006), Vector3(0.0, 0.5, -size.z * 0.5 + wall + 0.004), liner)
		a.box(Vector3(size.x - wall * 2.0, 0.006, size.z - wall * 2.0), Vector3(0.0, size.y - wall - 0.004, 0.0), liner)
		# Wire shelves and the stock on them.
		for level in 3:
			var y := 0.1 + level * 0.25
			if level > 0:
				a.box(Vector3(size.x - wall * 2.0, 0.006, size.z - wall * 2.0 - 0.03), Vector3(0.0, y - 0.004, 0.0), chrome)
			for column in 10:
				var color := FLAVOURS[(column / 2 + level * 3) % FLAVOURS.size()]
				for depth in 3:
					a.stamp(can_mesh(color), Vector3(-0.37 + column * 0.082, y, 0.14 - depth * 0.12))
		# Door frame, hinges and the long handle; the glass itself is a pane of its own.
		var front := size.z * 0.5 + 0.012
		var sill := 0.07
		var head := size.y - 0.01
		for side: float in [-1.0, 1.0]:
			a.box(Vector3(0.045, head - sill, 0.024), Vector3(side * (size.x * 0.5 - 0.0225), (sill + head) * 0.5, front), shell)
		a.box(Vector3(size.x, 0.045, 0.024), Vector3(0.0, sill + 0.0225, front), shell)
		a.box(Vector3(size.x, 0.045, 0.024), Vector3(0.0, head - 0.0225, front), shell)
		a.path([Vector3(size.x * 0.5 - 0.08, 0.26, front + 0.012), Vector3(size.x * 0.5 - 0.08, 0.26, front + 0.05), Vector3(size.x * 0.5 - 0.08, 0.74, front + 0.05), Vector3(size.x * 0.5 - 0.08, 0.74, front + 0.012)] as Array[Vector3], 0.011, chrome, 8)
		a.box(Vector3(0.26, 0.03, 0.004), Vector3(-0.2, size.y - 0.022, front + 0.013), Build.glow(Color(0.55, 0.85, 1.0), 1.8))
	)
	var pane := Build.box(root, Vector3(size.x - 0.09, size.y - 0.17, 0.008), Vector3(0.0, 0.07 + (size.y - 0.08) * 0.5, size.z * 0.5 + 0.012), Build.glass(Color(0.75, 0.9, 1.0, 0.12)))
	pane.name = "Glass"
	pane.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	Build.omni(root, Vector3(0.0, 0.5, 0.45), Color(0.8, 0.92, 1.0), 0.5, 2.2)
	return root


# --- Neon and lamps --------------------------------------------------------------------------

## Tube neon lettering on a wall, facing local +Z and centred on `pos`: every letter is bent
## from glowing tube standing off the wall on little posts. Unknown characters leave a gap.
static func neon_text(parent: Node, text: String, pos: Vector3, yaw_deg: float, letter_height: float, color: Color, energy: float = 4.2) -> Node3D:
	var root := Build.group(parent, "Neon" + text.to_pascal_case(), pos, yaw_deg)
	var unit := letter_height / 6.0
	var advance := 5.5 * unit
	var width := text.length() * advance - 1.5 * unit
	var tube := Assembly.new()
	var glass := Build.glow(color, energy)
	var post := Build.mat(Color(0.05, 0.05, 0.06), 0.4)
	var radius := letter_height * 0.036
	var off := radius + 0.045
	for index in text.length():
		var strokes: Array = STROKES.get(text[index], [])
		var left := -width * 0.5 + index * advance
		for stroke: Array in strokes:
			var points: Array[Vector3] = []
			for point: Vector2 in stroke:
				points.append(Vector3(left + point.x * unit, (point.y - 3.0) * unit, off))
			tube.path(points, radius, glass, 8)
			# Capped ends with a post back to the wall.
			for end: Vector3 in [points[0], points[points.size() - 1]]:
				tube.ball(radius, end, glass, Vector3.ONE, 8)
				tube.tube(Vector3(end.x, end.y, 0.0), Vector3(end.x, end.y, off - radius * 0.5), radius * 0.55, post, 6)
	tube.commit(root, "Tubes").cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	Build.omni(root, Vector3(0.0, 0.0, 1.1), color, 1.6, maxf(width * 1.1, 4.0))
	return root


## Dome pendant from the library hung from the ceiling point `pos` on a `drop` long cord,
## with a warm pool of light under it.
static func pendant(parent: Node, pos: Vector3, drop: float, color: Color, energy: float, reach: float = 5.0) -> void:
	var paint := {
		"black": {"color": Color(0.03, 0.03, 0.035), "roughness": 0.45, "metallic": 0.4, "surface": Stylized.Surface.STEEL},
		"glass": {"color": Color(1.0, 0.95, 0.85), "roughness": 0.3, "emission": color, "energy": 3.4},
		"linen": {"color": Color(0.9, 0.85, 0.75), "roughness": 0.9, "emission": color, "energy": 0.5},
	}
	var lamp := Assembly.place(parent, ModelLoader.flat("gym/pendant_dome", drop, {"palette": paint}), pos - Vector3(0.0, drop, 0.0))
	lamp.name = "Pendant"
	lamp.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	Build.spot_down(parent, pos - Vector3(0.0, drop - 0.05, 0.0), color, energy, reach, 62.0)


## Floor lamp: weighted base, slim stem and a glowing drum shade.
static func floor_lamp(parent: Node, pos: Vector3, color: Color) -> Node3D:
	var root := Build.group(parent, "FloorLamp", pos)
	Assembly.spawn(root, "floor_lamp/%s" % color.to_html(), func(a: Assembly) -> void:
		var brass := Stylized.standard(Color(0.62, 0.45, 0.22), 0.3, 1.0, Stylized.Surface.METAL)
		a.lathe(PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.17, 0.0), Vector2(0.17, 0.015), Vector2(0.04, 0.04), Vector2(0.014, 0.07), Vector2(0.014, 1.5), Vector2(0.03, 1.52)]), Vector3.ZERO, brass, Vector3.ZERO, 16)
		a.lathe(PackedVector2Array([Vector2(0.2, 1.48), Vector2(0.17, 1.84), Vector2(0.165, 1.84), Vector2(0.195, 1.48)]), Vector3.ZERO, Build.glow(color, 1.6), Vector3.ZERO, 20)
		a.ball(0.045, Vector3(0.0, 1.66, 0.0), Build.glow(color, 4.0), Vector3.ONE, 10)
	)
	Build.omni(root, Vector3(0.0, 1.7, 0.0), color, 1.3, 5.5)
	return root
