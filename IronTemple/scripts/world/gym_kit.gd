class_name GymKit
extends RefCounted
## Shared dressing for the gym's three storeys (Step 7): the palette the library models are
## repainted in, flooring, wall finishes, ceiling steelwork, ducts, light fittings, signage
## and the per-room ambient probes. Everything here is decoration: nothing adds a collider,
## so the stations, triggers and walking routes are exactly where they were.

const ACCENT := Color(1.0, 0.5, 0.1)
const STEEL_DARK := Color(0.07, 0.075, 0.09)
const RUBBER_BLACK := Color(0.028, 0.028, 0.033)
const CHROME := Color(0.86, 0.88, 0.92)
const GALVANISED := Color(0.5, 0.52, 0.55)
const WALNUT := Color(0.24, 0.15, 0.09)
const COOL_WHITE := Color(0.9, 0.95, 1.0)
const WARM_WHITE := Color(1.0, 0.84, 0.66)
const FLOOR_SHADER := preload("res://shaders/gym_floor.gdshader")
const POSTER_SHADER := preload("res://shaders/poster.gdshader")
const CONE_SHADER := preload("res://shaders/light_cone.gdshader")

static var _materials: Dictionary = {}


# --- Materials -------------------------------------------------------------------------------

## Matte dark powder-coated steel of every frame, rack and truss.
static func frame() -> StandardMaterial3D:
	return Stylized.steel(STEEL_DARK)


static func chrome() -> StandardMaterial3D:
	return Stylized.chrome(CHROME)


static func rubber() -> StandardMaterial3D:
	return Stylized.rubber(RUBBER_BLACK)


## Dead-flat black of display faces and sign panels: no grain, so lettering stays clean.
static func screen() -> StandardMaterial3D:
	if not _materials.has("screen"):
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(0.008, 0.008, 0.012)
		material.roughness = 0.5
		_materials["screen"] = material
	return _materials["screen"]


## Moulded plastic housings.
static func plastic(color: Color = Color(0.05, 0.052, 0.06)) -> StandardMaterial3D:
	return Stylized.standard(color, 0.42, 0.0, Stylized.Surface.PLAIN)


## Repaint of a library model in the gym's finish, by the material names its pack uses (see
## ModelLoader's "palette" option). `overrides` replaces or adds entries.
static func palette(accent: Color = ACCENT, overrides: Dictionary = {}) -> Dictionary:
	var steel := {"color": STEEL_DARK, "roughness": 0.5, "metallic": 0.35, "surface": Stylized.Surface.STEEL}
	var bright := {"color": CHROME, "roughness": 0.22, "metallic": 0.78, "surface": Stylized.Surface.METAL, "bump": 0.12}
	var paint := {
		"frame": steel,
		"steel": steel,
		"ironDark": steel,
		"black": steel,
		"rubber": {"color": RUBBER_BLACK, "roughness": 0.86, "surface": Stylized.Surface.RUBBER},
		"dark": {"color": Color(0.045, 0.047, 0.055), "roughness": 0.5},
		"metal": bright,
		"chrome": bright,
		"accent": {"color": accent, "roughness": 0.5},
		"pad": Stylized.leather(Color(0.05, 0.05, 0.058), 0.52),
		"leather": Stylized.leather(Color(0.1, 0.045, 0.035), 0.52),
		"carcass": {"color": Color(0.11, 0.12, 0.15), "roughness": 0.5, "metallic": 0.3, "surface": Stylized.Surface.STEEL},
		"timber": {"color": Color(0.42, 0.27, 0.15), "roughness": 0.6, "surface": Stylized.Surface.WOOD},
	}
	paint.merge(overrides, true)
	return paint


## One baked, repainted mesh of a library model (see ModelLoader.flat), placed as a single node.
static func model(parent: Node, id: String, pos: Vector3, yaw_deg: float, size: float, options: Dictionary = {}) -> MeshInstance3D:
	var settings := options.duplicate()
	if not settings.has("palette"):
		settings["palette"] = palette()
	var shadows: bool = settings.get("shadows", true)
	settings.erase("shadows")
	var node := Assembly.place(parent, ModelLoader.flat(id, size, settings), pos, Vector3(0.0, yaw_deg, 0.0))
	node.name = id.get_file().to_pascal_case()
	if not shadows:
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node


## Flooring of a named finish, drawn in world space so neighbouring slabs line up.
static func floor_material(finish: StringName) -> ShaderMaterial:
	var key := "floor/%s" % finish
	if _materials.has(key):
		return _materials[key]
	var material := ShaderMaterial.new()
	material.shader = FLOOR_SHADER
	material.set_shader_parameter("grain", Stylized.height_map(Stylized.Surface.RUBBER))
	match finish:
		&"weights":
			# Charcoal rubber tiles with grey and orange chips.
			pass
		&"cardio":
			material.set_shader_parameter("base_color", Color(0.045, 0.06, 0.09))
			material.set_shader_parameter("fleck_a", Color(0.3, 0.55, 0.85))
			material.set_shader_parameter("fleck_b", Color(0.75, 0.85, 0.95))
			material.set_shader_parameter("fleck_density", 0.22)
		&"lifting":
			material.set_shader_parameter("base_color", Color(0.085, 0.03, 0.03))
			material.set_shader_parameter("fleck_a", Color(0.55, 0.14, 0.12))
			material.set_shader_parameter("fleck_b", Color(0.75, 0.7, 0.68))
			material.set_shader_parameter("fleck_density", 0.2)
			material.set_shader_parameter("fleck_share_b", 0.15)
		&"tatami_red", &"tatami_blue":
			# Jigsaw striking mats: plain foam squares with tight seams.
			material.set_shader_parameter("grain", Stylized.height_map(Stylized.Surface.FOAM))
			material.set_shader_parameter("base_color", Color(0.4, 0.06, 0.06) if finish == &"tatami_red" else Color(0.05, 0.12, 0.34))
			material.set_shader_parameter("fleck_density", 0.0)
			material.set_shader_parameter("tile", Vector2(1.05, 1.2))
			material.set_shader_parameter("seam_width", 0.01)
			material.set_shader_parameter("tile_variation", 0.12)
			material.set_shader_parameter("grain_tiling", 9.0)
			material.set_shader_parameter("grain_bump", 0.35)
			material.set_shader_parameter("roughness", 0.9)
		&"fight":
			# Near-black with a sparse red chip: the hall stays dark around the cage.
			material.set_shader_parameter("base_color", Color(0.03, 0.03, 0.036))
			material.set_shader_parameter("fleck_a", Color(0.34, 0.35, 0.4))
			material.set_shader_parameter("fleck_b", Color(0.8, 0.12, 0.1))
			material.set_shader_parameter("fleck_density", 0.1)
			material.set_shader_parameter("fleck_share_b", 0.4)
			material.set_shader_parameter("tile", Vector2(1.2, 1.2))
		&"boards", &"oak":
			var oak := finish == &"oak"
			material.set_shader_parameter("grain", Stylized.height_map(Stylized.Surface.WOOD))
			material.set_shader_parameter("base_color", Color(0.5, 0.33, 0.18) if oak else Color(0.2, 0.115, 0.065))
			material.set_shader_parameter("fleck_density", 0.0)
			material.set_shader_parameter("tile", Vector2(2.2, 0.19))
			material.set_shader_parameter("stagger", 0.37)
			material.set_shader_parameter("seam_width", 0.004)
			material.set_shader_parameter("seam_color", Color(0.03, 0.018, 0.01))
			material.set_shader_parameter("tile_variation", 0.5)
			material.set_shader_parameter("grain_tiling", 1.3)
			material.set_shader_parameter("grain_stretch", Vector2(0.2, 1.6))
			material.set_shader_parameter("grain_color", 0.45)
			material.set_shader_parameter("grain_bump", 0.25)
			material.set_shader_parameter("roughness", 0.42 if oak else 0.36)
			material.set_shader_parameter("rim_strength", 0.2)
	_materials[key] = material
	return material


# --- Walls -----------------------------------------------------------------------------------

## Dark wainscot along a wall from `from` to `to` (floor level, on the wall face), `height`
## tall, with a capping rail and panel joints. `inward` points into the room.
static func wainscot(parent: Node, from: Vector3, to: Vector3, inward: Vector3, height: float = 1.15, color: Color = Color(0.085, 0.09, 0.105)) -> MeshInstance3D:
	# Local +X runs along the wall and +Z into the room, whichever way the ends were given.
	if (to - from).cross(Vector3.UP).dot(inward) < 0.0:
		var swap := from
		from = to
		to = swap
	var span := to - from
	var length := span.length()
	var assembly := Assembly.new()
	var panel := Stylized.standard(color, 0.62, 0.0, Stylized.Surface.MASONRY)
	var trim := Stylized.steel(color.darkened(0.35), 0.45)
	assembly.box(Vector3(length, height, 0.016), Vector3(length * 0.5, height * 0.5, 0.008), panel)
	assembly.box(Vector3(length, 0.045, 0.034), Vector3(length * 0.5, height + 0.0225, 0.017), trim)
	assembly.box(Vector3(length, 0.09, 0.026), Vector3(length * 0.5, 0.045, 0.013), trim)
	var panels := maxi(roundi(length / 1.25), 1)
	for i in range(1, panels):
		assembly.box(Vector3(0.012, height - 0.09, 0.02), Vector3(length * i / panels, height * 0.5 + 0.045, 0.01), trim)
	var node := assembly.commit(parent, "Wainscot", from)
	var along := span / length
	node.basis = Basis(along, Vector3.UP, along.cross(Vector3.UP))
	return node


## Framed print on a wall, facing local +Z: `style` picks the artwork (see poster.gdshader),
## `title` is set across it. `lit` backlights it like a light box.
static func poster(parent: Node, pos: Vector3, yaw_deg: float, size: Vector2, style: int, color_a: Color, color_b: Color, title: String, tagline: String = "", lit: bool = false) -> Node3D:
	var root := Build.group(parent, "Poster", pos, yaw_deg)
	var border := 0.045
	Assembly.spawn(root, "poster_frame/%s" % size, func(a: Assembly) -> void:
		var metal := Stylized.steel(Color(0.03, 0.03, 0.035), 0.4)
		for side: float in [-1.0, 1.0]:
			a.box(Vector3(size.x + border * 2.0, border, 0.04), Vector3(0.0, side * (size.y + border) * 0.5, 0.02), metal)
			a.box(Vector3(border, size.y, 0.04), Vector3(side * (size.x + border) * 0.5, 0.0, 0.02), metal)
		a.box(Vector3(size.x + border, size.y + border, 0.012), Vector3(0.0, 0.0, 0.006), metal)
	)
	var print_mesh := QuadMesh.new()
	print_mesh.size = size
	var art := ShaderMaterial.new()
	art.shader = POSTER_SHADER
	art.set_shader_parameter("color_a", color_a)
	art.set_shader_parameter("color_b", color_b)
	art.set_shader_parameter("style", style)
	art.set_shader_parameter("aspect", size.x / size.y)
	art.set_shader_parameter("glow", 0.55 if lit else 0.0)
	var sheet := Assembly.place(root, print_mesh, Vector3(0.0, 0.0, 0.016))
	sheet.material_override = art
	sheet.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var letter := size.x / maxf(float(_longest_line(title)), 4.0) * 1.25
	var heading := Build.text(root, title, Vector3(0.0, size.y * 0.3, 0.02), minf(letter, size.y * 0.2), Color(0.97, 0.97, 0.95), Vector3.ZERO, 1.25 if lit else 1.0)
	heading.outline_size = 14
	heading.outline_modulate = Color(0.0, 0.0, 0.0, 0.85)
	heading.line_spacing = -18.0
	if tagline != "":
		Build.text(root, tagline, Vector3(0.0, -size.y * 0.41, 0.02), size.x / maxf(float(tagline.length()), 8.0) * 1.3, Color(0.96, 0.96, 0.94), Vector3.ZERO, 1.0).outline_size = 8
	return root


## Glowing level marker set into the floor at a stair head or foot: a lit plate with the
## storey and what is on it, readable from where the stairs are climbed.
static func floor_marker(parent: Node, pos: Vector3, yaw_deg: float, storey: String, title: String, color: Color) -> Node3D:
	var root := Build.group(parent, "FloorMarker", pos, yaw_deg)
	Assembly.spawn(root, "floor_marker/%s" % color.to_html(), func(a: Assembly) -> void:
		var rim := Stylized.steel(Color(0.04, 0.04, 0.05), 0.4)
		a.box(Vector3(2.9, 0.012, 1.0), Vector3(0.0, 0.006, 0.0), rim)
		a.box(Vector3(2.8, 0.006, 0.9), Vector3(0.0, 0.013, 0.0), screen())
		var lit := Build.glow(color, 2.6)
		for side: float in [-1.0, 1.0]:
			a.box(Vector3(2.8, 0.008, 0.035), Vector3(0.0, 0.016, side * 0.42), lit)
			# Chevrons at both ends, pointing away from the reader.
			for step in 2:
				for arm: float in [-1.0, 1.0]:
					a.box(Vector3(0.15, 0.008, 0.028), Vector3(side * 1.24 + arm * 0.048, 0.016, -0.1 + step * 0.17), lit, Vector3(0.0, arm * 42.0, 0.0))
	)
	Build.text(root, storey, Vector3(-0.78, 0.02, 0.0), 0.5, color, Vector3(-90.0, 0.0, 0.0), 2.4)
	Build.text(root, title, Vector3(0.3, 0.02, 0.0), 0.19, Color(0.95, 0.96, 1.0), Vector3(-90.0, 0.0, 0.0), 1.6)
	return root


## Backlit wayfinding panel on a wall, facing local +Z.
static func wall_sign(parent: Node, pos: Vector3, yaw_deg: float, lines: Array[String], colors: Array[Color], width: float = 2.6) -> Node3D:
	var root := Build.group(parent, "WallSign", pos, yaw_deg)
	var row := 0.4
	var height := row * lines.size() + 0.2
	var casing := Assembly.new()
	casing.rbox(Vector3(width, height, 0.07), 0.02, Vector3(0.0, 0.0, 0.035), Stylized.steel(Color(0.035, 0.035, 0.045), 0.4))
	casing.box(Vector3(width - 0.12, height - 0.12, 0.004), Vector3(0.0, 0.0, 0.072), screen())
	for i in lines.size():
		var y := height * 0.5 - 0.1 - row * (i + 0.5)
		casing.box(Vector3(0.05, row * 0.62, 0.006), Vector3(-width * 0.5 + 0.14, y, 0.074), Build.glow(colors[i % colors.size()], 2.6))
		if i > 0:
			casing.box(Vector3(width - 0.3, 0.006, 0.005), Vector3(0.0, y + row * 0.5, 0.074), Build.mat(Color(0.12, 0.12, 0.15), 0.4))
	casing.commit(root, "Casing")
	for i in lines.size():
		var y := height * 0.5 - 0.1 - row * (i + 0.5)
		Build.text(root, lines[i], Vector3(0.07, y, 0.08), 0.21, colors[i % colors.size()], Vector3.ZERO, 1.9)
	return root


# --- Ceiling ---------------------------------------------------------------------------------

## Open-web steel joist from `from` to `to` (its top chord against the slab), `depth` deep.
static func joist(parent: Node, from: Vector3, to: Vector3, depth: float = 0.5) -> MeshInstance3D:
	var span := to - from
	var length := span.length()
	var mesh := Assembly.cached("joist/%.2f/%.2f" % [length, depth], func(a: Assembly) -> void:
		var steel := Stylized.steel(Color(0.055, 0.058, 0.07), 0.55)
		a.box(Vector3(length, 0.045, 0.13), Vector3(length * 0.5, -0.0225, 0.0), steel)
		a.box(Vector3(length, 0.06, 0.03), Vector3(length * 0.5, -0.075, 0.0), steel)
		a.box(Vector3(length - depth * 0.6, 0.04, 0.11), Vector3(length * 0.5, -depth + 0.02, 0.0), steel)
		var bays := maxi(roundi(length / (depth * 1.1)), 2)
		for i in bays:
			var x0 := length * i / bays
			var x1 := length * (i + 1) / bays
			var top := Vector3((x0 + x1) * 0.5, -0.06, 0.0)
			a.tube(Vector3(x0 + 0.05, -depth + 0.04, 0.0), top, 0.017, steel, 6)
			a.tube(top, Vector3(x1 - 0.05, -depth + 0.04, 0.0), 0.017, steel, 6)
		for end: float in [0.0, 1.0]:
			a.box(Vector3(0.16, 0.2, 0.16), Vector3(lerpf(0.08, length - 0.08, end), -0.1, 0.0), steel)
	)
	var node := Assembly.place(parent, mesh, from)
	node.name = "Joist"
	node.basis = Basis(span / length, Vector3.UP, (span / length).cross(Vector3.UP))
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node


## Run of round spiral ducting hung under the slab from `from` to `to` (points on the duct's
## top line), built from the library's duct module, with a grille under every other length.
static func duct(parent: Node, from: Vector3, to: Vector3, diameter: float = 0.5) -> Node3D:
	var span := to - from
	var length := span.length()
	var root := Build.group(parent, "Duct", from)
	root.basis = Basis(span.cross(Vector3.UP).normalized() * -1.0, Vector3.UP, span / length)
	var paint := palette(ACCENT, {"steel": {"color": GALVANISED, "roughness": 0.42, "metallic": 0.9, "surface": Stylized.Surface.METAL}, "hiVis": {"color": ACCENT, "roughness": 0.5}})
	var module := ModelLoader.flat("gym/duct_run", diameter, {"fit": ModelLoader.Fit.WIDTH, "palette": paint})
	var bounds := module.get_aabb()
	var count := maxi(roundi(length / bounds.size.z), 1)
	var stretch := length / (count * bounds.size.z)
	var grille := Assembly.cached("duct_grille/%.2f" % diameter, func(a: Assembly) -> void:
		var dark := Build.mat(Color(0.03, 0.03, 0.035), 0.6)
		a.box(Vector3(diameter * 0.7, 0.05, 0.42), Vector3.ZERO, Stylized.chrome(GALVANISED, 0.42))
		for slot in 6:
			a.box(Vector3(diameter * 0.6, 0.012, 0.03), Vector3(0.0, -0.026, -0.15 + slot * 0.06), dark)
	)
	for i in count:
		var piece := Assembly.place(root, module, Vector3(0.0, -bounds.size.y, (i + 0.5) * length / count))
		piece.scale.z = stretch
		piece.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		if i % 2 == 0:
			Assembly.place(root, grille, Vector3(0.0, -bounds.size.y + 0.02, (i + 0.5) * length / count)).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return root


## Linear LED pendant (the library's light bar) hung with its cables against the ceiling at
## `pos`, with a shadowless spot under it. Returns the light.
static func led_pendant(parent: Node, pos: Vector3, yaw_deg: float, color: Color, energy: float, reach: float = 9.0, angle_deg: float = 76.0, stripe: Color = ACCENT) -> SpotLight3D:
	var paint := palette(stripe, {
		"light": {"color": Color(1.0, 1.0, 1.0), "emission": color, "energy": 3.2},
		"teal": {"color": stripe, "roughness": 0.5},
	})
	var mesh := ModelLoader.flat("gym/light_bar", 0.0, {"palette": paint})
	var drop := mesh.get_aabb().size.y
	var fitting := Assembly.place(parent, mesh, pos - Vector3(0.0, drop, 0.0), Vector3(0.0, yaw_deg, 0.0))
	fitting.name = "LedPendant"
	fitting.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return Build.spot_down(parent, pos - Vector3(0.0, drop + 0.04, 0.0), color, energy, reach, angle_deg)


## Surface-mounted LED strip: an aluminium channel with a glowing diffuser, `length` along
## local X, lighting towards local -Y.
static func led_strip(parent: Node, pos: Vector3, rot_deg: Vector3, length: float, color: Color, energy: float = 3.0) -> MeshInstance3D:
	var assembly := Assembly.new()
	assembly.box(Vector3(length, 0.022, 0.034), Vector3(0.0, 0.011, 0.0), Stylized.chrome(Color(0.3, 0.31, 0.34), 0.4))
	assembly.box(Vector3(length - 0.02, 0.01, 0.024), Vector3(0.0, -0.004, 0.0), Build.glow(color, energy))
	var node := assembly.commit(parent, "LedStrip", pos, rot_deg)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node


## Spotlight can on a yoke, hung at `pos` and aimed at `target`, with the visible beam under
## it. `shadows` makes it one of the few lights in the gym that cast them.
static func stage_spot(parent: Node, pos: Vector3, target: Vector3, color: Color, energy: float, angle_deg: float = 26.0, shadows: bool = false, beam: float = 0.3) -> SpotLight3D:
	var aim := target - pos
	var reach := aim.length()
	var head := Build.group(parent, "StageSpot", pos)
	head.basis = Build.basis_along(-aim)
	# The head's local -Y looks down the beam.
	Assembly.spawn(head, "stage_spot/%s" % color.to_html(), func(a: Assembly) -> void:
		var body := Stylized.steel(Color(0.03, 0.03, 0.036), 0.45)
		a.lathe(PackedVector2Array([Vector2(0.0, 0.2), Vector2(0.075, 0.2), Vector2(0.09, 0.17), Vector2(0.09, -0.02), Vector2(0.115, -0.1), Vector2(0.115, -0.12), Vector2(0.1, -0.12)]), Vector3.ZERO, body, Vector3.ZERO, 14)
		a.cyl(0.1, 0.006, Vector3(0.0, -0.118, 0.0), Build.glow(color, 5.0), Vector3.ZERO, -1.0, 14)
		for fin in 5:
			a.cyl(0.097, 0.008, Vector3(0.0, 0.03 + fin * 0.032, 0.0), body, Vector3.ZERO, -1.0, 14)
		# Yoke and clamp up to the truss.
		for side: float in [-1.0, 1.0]:
			a.box(Vector3(0.012, 0.2, 0.035), Vector3(side * 0.105, 0.14, 0.0), body)
		a.box(Vector3(0.222, 0.012, 0.035), Vector3(0.0, 0.24, 0.0), body)
		a.cyl(0.02, 0.07, Vector3(0.0, 0.275, 0.0), body, Vector3.ZERO, -1.0, 8)
	)
	if beam > 0.0:
		var spread := tan(deg_to_rad(angle_deg)) * reach
		var cone := Assembly.place(head, Shapes.lathe(PackedVector2Array([Vector2(spread, -reach), Vector2(0.09, -0.12)]), 20))
		cone.material_override = cone_material(color, beam)
		cone.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		cone.name = "Beam"
	var light := SpotLight3D.new()
	light.position = pos + aim.normalized() * 0.12
	light.light_color = color
	light.light_energy = energy
	light.spot_range = reach + 2.5
	light.spot_angle = angle_deg
	light.spot_attenuation = 0.6
	light.spot_angle_attenuation = 0.7
	light.shadow_enabled = shadows
	light.shadow_blur = 1.6
	light.shadow_bias = 0.06
	# Aimed in the parent's own space: the storeys sit well away from the world origin.
	light.basis = Basis.looking_at(aim, Vector3.UP if absf(aim.normalized().y) < 0.99 else Vector3.FORWARD)
	parent.add_child(light)
	return light


static func cone_material(color: Color, strength: float) -> ShaderMaterial:
	var key := "cone/%s/%.2f" % [color.to_html(), strength]
	if not _materials.has(key):
		var material := ShaderMaterial.new()
		material.shader = CONE_SHADER
		material.set_shader_parameter("color", color)
		material.set_shader_parameter("strength", strength)
		material.set_shader_parameter("haze", Stylized.height_map(Stylized.Surface.PLAIN))
		_materials[key] = material
	return _materials[key]


## Ambient light and reflections of one room: inside the box the sky's fill is replaced by
## `ambient`, which is what lets each storey have its own mood, and polished steel mirrors the
## room instead of the sky.
static func room_probe(parent: Node, centre: Vector3, size: Vector3, ambient: Color, energy: float) -> ReflectionProbe:
	var probe := ReflectionProbe.new()
	probe.name = "RoomProbe"
	# The box reaches below the floor: a probe fades out towards its faces, which would hand
	# the floor and the foot of everything standing on it back to the sky.
	probe.position = centre - Vector3(0.0, 0.2, 0.0)
	probe.size = size + Vector3(0.0, 0.4, 0.0)
	probe.interior = true
	probe.box_projection = true
	probe.enable_shadows = false
	probe.update_mode = ReflectionProbe.UPDATE_ONCE
	probe.ambient_mode = ReflectionProbe.AMBIENT_COLOR
	probe.ambient_color = ambient
	probe.ambient_color_energy = energy
	probe.max_distance = 40.0
	# Keep the room's own reflections right up to the walls instead of fading to the sky.
	probe.blend_distance = 0.25
	parent.add_child(probe)
	return probe


## Swaps the plain box meshes of furniture-sized parts under `root` for chamfered ones, so
## their edges catch the light. Only the drawn mesh changes: colliders keep their shapes.
static func soften_boxes(root: Node) -> int:
	var swapped := 0
	var pending: Array[Node] = [root]
	while not pending.is_empty():
		var node: Node = pending.pop_back()
		pending.append_array(node.get_children())
		var instance := node as MeshInstance3D
		var box: BoxMesh = (instance.mesh as BoxMesh) if instance != null else null
		if box == null:
			continue
		var material := instance.material_override if instance.material_override != null else box.material
		var soft := Shapes.soft_box(box.size, material)
		if soft != null:
			instance.mesh = soft
			swapped += 1
	return swapped


static func _longest_line(text: String) -> int:
	var longest := 0
	for line in text.split("\n"):
		longest = maxi(longest, line.length())
	return longest
