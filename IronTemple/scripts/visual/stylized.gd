class_name Stylized
extends RefCounted
## The shared look of the game: procedural noise maps for skin, fabric, leather, metal and
## masonry, the StandardMaterial3D factories built on them and the conversion of imported
## materials to the stylized PBR shader. Everything is cached, so repeated surfaces batch.

enum Surface { PLAIN, SKIN, FABRIC, LEATHER, METAL, RUBBER, MASONRY, STEEL, KNURL, CANVAS, FOAM, WOOD }

const SHADER_PATH := "res://shaders/stylized_pbr.gdshader"
## Scanned CC0 tiling maps fetched by tools/fetch_assets.py. Each is optional: concrete and
## rubber replace the noise normal of their surface, leather and cloth are layered over the
## procedural one as fine detail. Without the files everything stays fully procedural.
const TEXTURES_DIR := "res://assets/textures/"
const _SCANS := {Surface.MASONRY: "concrete_normal", Surface.RUBBER: "rubber_normal"}
const _DETAIL_SCANS := {Surface.LEATHER: "leather_normal", Surface.FABRIC: "fabric_normal"}
## Rim light of the stylized shaders: a soft, slightly warm edge where light grazes. On
## StandardMaterial3D the engine's rim widens with roughness until it covers the whole
## surface, so there it is kept for glossy finishes only (see `standard`).
const RIM := 0.45
const RIM_TINT := 0.4
const _RIM_SHARE := {Surface.PLAIN: 1.0, Surface.SKIN: 1.15, Surface.FABRIC: 0.7, Surface.LEATHER: 1.0, Surface.METAL: 0.5, Surface.RUBBER: 0.7, Surface.MASONRY: 0.2, Surface.STEEL: 0.8, Surface.KNURL: 0.5, Surface.CANVAS: 0.6, Surface.FOAM: 0.6, Surface.WOOD: 0.8}

# Noise recipe per surface: type, frequency, octaves, bump strength, texture size, tiling per
# metre, normal depth, and the roughness band the noise is remapped into.
const _RECIPES := {
	Surface.PLAIN: {"type": FastNoiseLite.TYPE_SIMPLEX_SMOOTH, "freq": 0.045, "octaves": 3, "bump": 3.0, "size": Vector2i(256, 256), "tiling": 0.9, "depth": 0.3, "band": Vector2(0.86, 1.0)},
	Surface.SKIN: {"type": FastNoiseLite.TYPE_CELLULAR, "freq": 0.11, "octaves": 2, "bump": 2.2, "size": Vector2i(256, 256), "tiling": 9.0, "depth": 0.35, "band": Vector2(0.78, 1.0)},
	Surface.FABRIC: {"type": FastNoiseLite.TYPE_VALUE, "freq": 0.42, "octaves": 2, "bump": 5.0, "size": Vector2i(256, 256), "tiling": 7.0, "depth": 0.4, "band": Vector2(0.9, 1.0)},
	Surface.LEATHER: {"type": FastNoiseLite.TYPE_CELLULAR, "freq": 0.06, "octaves": 3, "bump": 6.0, "size": Vector2i(256, 256), "tiling": 6.0, "depth": 0.7, "band": Vector2(0.62, 1.0)},
	# A wide, short texture stretches the noise into brushed streaks.
	Surface.METAL: {"type": FastNoiseLite.TYPE_VALUE, "freq": 0.2, "octaves": 2, "bump": 3.0, "size": Vector2i(512, 48), "tiling": 2.0, "depth": 0.3, "band": Vector2(0.6, 1.0)},
	Surface.RUBBER: {"type": FastNoiseLite.TYPE_VALUE, "freq": 0.3, "octaves": 3, "bump": 4.0, "size": Vector2i(256, 256), "tiling": 4.0, "depth": 0.6, "band": Vector2(0.85, 1.0)},
	Surface.MASONRY: {"type": FastNoiseLite.TYPE_SIMPLEX_SMOOTH, "freq": 0.03, "octaves": 5, "bump": 3.0, "size": Vector2i(512, 512), "tiling": 0.6, "depth": 0.14, "band": Vector2(0.93, 1.0)},
	# Powder-coated steel: a fine orange peel that only shows in the highlights.
	Surface.STEEL: {"type": FastNoiseLite.TYPE_VALUE, "freq": 0.55, "octaves": 2, "bump": 2.0, "size": Vector2i(256, 256), "tiling": 9.0, "depth": 0.22, "band": Vector2(0.84, 1.0)},
	# Knurled grip: cellular noise without jitter is a regular grid of little pyramids.
	Surface.KNURL: {"type": FastNoiseLite.TYPE_CELLULAR, "freq": 0.125, "octaves": 1, "bump": 8.0, "size": Vector2i(256, 256), "tiling": 9.0, "depth": 1.0, "band": Vector2(0.5, 1.0), "jitter": 0.0},
	Surface.CANVAS: {"type": FastNoiseLite.TYPE_VALUE, "freq": 0.5, "octaves": 1, "bump": 6.0, "size": Vector2i(256, 256), "tiling": 14.0, "depth": 0.5, "band": Vector2(0.9, 1.0)},
	# Closed-cell foam matting.
	Surface.FOAM: {"type": FastNoiseLite.TYPE_CELLULAR, "freq": 0.09, "octaves": 2, "bump": 3.0, "size": Vector2i(256, 256), "tiling": 10.0, "depth": 0.45, "band": Vector2(0.9, 1.0)},
	# Long, shallow grain.
	Surface.WOOD: {"type": FastNoiseLite.TYPE_SIMPLEX_SMOOTH, "freq": 0.02, "octaves": 4, "bump": 4.0, "size": Vector2i(512, 64), "tiling": 1.6, "depth": 0.35, "band": Vector2(0.72, 1.0)},
}

static var _normals: Dictionary = {}
static var _roughness: Dictionary = {}
static var _heights: Dictionary = {}
static var _materials: Dictionary = {}
static var _converted: Dictionary = {}
static var _shaders: Dictionary = {}


## Tangent-space normal map of a surface kind, generated once on a worker thread.
static func normal_map(surface: Surface) -> NoiseTexture2D:
	if not _normals.has(surface):
		var texture := _noise_texture(surface)
		texture.as_normal_map = true
		texture.bump_strength = _RECIPES[surface]["bump"]
		_normals[surface] = texture
	return _normals[surface]


## Roughness map of a surface kind: the same noise squeezed into a narrow bright band, so it
## varies the gloss without changing its level much.
static func roughness_map(surface: Surface) -> NoiseTexture2D:
	if not _roughness.has(surface):
		var texture := _noise_texture(surface)
		var band: Vector2 = _RECIPES[surface]["band"]
		var ramp := Gradient.new()
		ramp.set_color(0, Color(band.x, band.x, band.x))
		ramp.set_color(1, Color(band.y, band.y, band.y))
		texture.color_ramp = ramp
		_roughness[surface] = texture
	return _roughness[surface]


## Greyscale height of a surface kind, for shaders that derive their own bump.
static func height_map(surface: Surface) -> NoiseTexture2D:
	if not _heights.has(surface):
		_heights[surface] = _noise_texture(surface)
	return _heights[surface]


## StandardMaterial3D with the noise normal and roughness maps of `surface` (triplanar, so it
## needs no UVs) and the shared rim light. Translucent colours stay plain.
static func standard(color: Color, roughness: float, metallic: float, surface: Surface) -> StandardMaterial3D:
	var key := "%s/%.2f/%.2f/%d" % [color.to_html(), roughness, metallic, surface]
	if _materials.has(key):
		return _materials[key]
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = roughness
	material.metallic = metallic
	if color.a < 1.0:
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
	else:
		var recipe: Dictionary = _RECIPES[surface]
		material.uv1_triplanar = true
		material.uv1_scale = Vector3.ONE * (recipe["tiling"] as float)
		material.normal_enabled = true
		var scan := scanned(_SCANS.get(surface, ""))
		material.normal_texture = scan if scan != null else normal_map(surface)
		material.normal_scale = recipe["depth"] * (2.2 if scan != null else 1.0)
		var detail := scanned(_DETAIL_SCANS.get(surface, ""))
		if detail != null:
			# The detail layer blends by its albedo's alpha: a texel of the surface's own
			# colour at half alpha mixes the two normals and leaves the colour alone.
			material.detail_enabled = true
			material.detail_blend_mode = BaseMaterial3D.BLEND_MODE_MIX
			material.detail_uv_layer = BaseMaterial3D.DETAIL_UV_1
			material.detail_normal = detail
			material.detail_albedo = _texel(Color(color.r, color.g, color.b, 0.5))
		material.roughness_texture = roughness_map(surface)
		material.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
		if roughness <= 0.6:
			material.rim_enabled = true
			material.rim = 0.3 * (_RIM_SHARE[surface] as float)
			material.rim_tint = RIM_TINT
		if metallic > 0.5:
			material.metallic_specular = 0.6
	_materials[key] = material
	return material


## Picks the surface kind a flat colour most likely stands for from its gloss and metalness.
static func guess(roughness: float, metallic: float) -> Surface:
	if metallic >= 0.5:
		return Surface.METAL
	if roughness >= 0.88:
		return Surface.MASONRY
	if roughness >= 0.72:
		return Surface.FABRIC
	if roughness <= 0.45:
		return Surface.RUBBER
	return Surface.PLAIN


static func skin(color: Color) -> StandardMaterial3D:
	return standard(color, 0.62, 0.0, Surface.SKIN)


static func fabric(color: Color) -> StandardMaterial3D:
	return standard(color, 0.86, 0.0, Surface.FABRIC)


static func leather(color: Color, roughness: float = 0.48) -> StandardMaterial3D:
	return standard(color, roughness, 0.0, Surface.LEATHER)


static func metal(color: Color, roughness: float = 0.32) -> StandardMaterial3D:
	return standard(color, roughness, 1.0, Surface.METAL)


static func rubber(color: Color) -> StandardMaterial3D:
	return standard(color, 0.8, 0.0, Surface.RUBBER)


## Matte powder-coated steel for frames and racks.
static func steel(color: Color, roughness: float = 0.52) -> StandardMaterial3D:
	return standard(color, roughness, 0.35, Surface.STEEL)


## Polished plate. Not fully metallic: indoors a perfect mirror only shows the dark ceiling,
## so a share of the pale base colour is kept to read as bright metal from every angle.
static func chrome(color: Color = Color(0.86, 0.88, 0.92), roughness: float = 0.2) -> StandardMaterial3D:
	return standard(color, roughness, 0.78, Surface.METAL)


## Knurled bare metal: barbell shafts and dumbbell grips.
static func knurled(color: Color = Color(0.78, 0.8, 0.84), roughness: float = 0.36) -> StandardMaterial3D:
	return standard(color, roughness, 0.75, Surface.KNURL)


static func canvas(color: Color) -> StandardMaterial3D:
	return standard(color, 0.93, 0.0, Surface.CANVAS)


static func foam(color: Color) -> StandardMaterial3D:
	return standard(color, 0.9, 0.0, Surface.FOAM)


static func wood(color: Color, roughness: float = 0.58) -> StandardMaterial3D:
	return standard(color, roughness, 0.0, Surface.WOOD)


## The stylized PBR shader, optionally without back-face culling.
static func shader(double_sided: bool = false) -> Shader:
	if not _shaders.has(double_sided):
		var base: Shader = load(SHADER_PATH)
		if double_sided:
			var copy := Shader.new()
			copy.code = base.code.replace("cull_back", "cull_disabled")
			_shaders[double_sided] = copy
		else:
			_shaders[double_sided] = base
	return _shaders[double_sided]


## Turns an imported material into the stylized PBR pass, keeping its colour, textures and
## emission. Alpha-blended materials (glass) and anything that is not a BaseMaterial3D are
## returned unchanged. `tint` multiplies the albedo.
static func convert(source: Material, tint: Color = Color.WHITE, surface: Surface = Surface.PLAIN) -> Material:
	var base := source as BaseMaterial3D
	if base == null or base.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA:
		return source
	var key := "%d/%s/%d" % [source.get_instance_id(), tint.to_html(), surface]
	if _converted.has(key):
		return _converted[key]
	var material := ShaderMaterial.new()
	material.shader = shader(base.cull_mode == BaseMaterial3D.CULL_DISABLED)
	material.resource_name = source.resource_name
	material.set_shader_parameter("albedo", base.albedo_color)
	material.set_shader_parameter("tint", Color(tint.r, tint.g, tint.b))
	# A swatch of pixel noise over a colour factor (some packs ship one) reads as brickwork at
	# this scale: the factor is the real colour, so the swatch is dropped. Palette atlases
	# are larger and sit under a white factor, and are kept.
	var swatch := base.albedo_texture != null and maxi(base.albedo_texture.get_width(), base.albedo_texture.get_height()) <= 64 and not base.albedo_color.is_equal_approx(Color.WHITE)
	if base.albedo_texture != null and not swatch:
		material.set_shader_parameter("albedo_tex", base.albedo_texture)
	material.set_shader_parameter("roughness", base.roughness)
	material.set_shader_parameter("metallic", base.metallic)
	material.set_shader_parameter("specular", base.metallic_specular)
	if base.roughness_texture != null and base.roughness_texture == base.metallic_texture:
		material.set_shader_parameter("orm_tex", base.roughness_texture)
		material.set_shader_parameter("use_orm", true)
	if base.normal_enabled and base.normal_texture != null:
		material.set_shader_parameter("normal_tex", base.normal_texture)
		material.set_shader_parameter("normal_scale", base.normal_scale)
		material.set_shader_parameter("use_normal", true)
	if base.emission_enabled:
		material.set_shader_parameter("emission", base.emission)
		material.set_shader_parameter("emission_energy", base.emission_energy_multiplier)
		if base.emission_texture != null:
			material.set_shader_parameter("emission_tex", base.emission_texture)
		else:
			material.set_shader_parameter("emission_tex", _white())
	material.set_shader_parameter("use_vertex_color", base.vertex_color_use_as_albedo)
	if base.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR or base.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_HASH:
		material.set_shader_parameter("alpha_scissor", base.alpha_scissor_threshold if base.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR else 0.5)
	var recipe: Dictionary = _RECIPES[surface]
	material.set_shader_parameter("detail_height", height_map(surface))
	material.set_shader_parameter("detail_tiling", recipe["tiling"])
	material.set_shader_parameter("detail_bump", recipe["depth"])
	material.set_shader_parameter("rim_strength", RIM * (0.6 if base.metallic > 0.5 else 1.0))
	material.set_shader_parameter("rim_tint", RIM_TINT)
	_converted[key] = material
	return material


## The stylized pass of an imported material with its finish replaced, so models from any
## pack take the gym's own palette. `spec` is a Color or a Dictionary with any of "color",
## "roughness", "metallic", "surface" (detail noise), "bump" (depth of that noise, 0 to 1),
## "emission" and "energy".
static func repaint(source: Material, spec: Variant, surface: Surface = Surface.PLAIN) -> Material:
	var finish: Dictionary = spec if spec is Dictionary else {"color": spec}
	var key := "paint/%d/%s/%d" % [source.get_instance_id(), finish, surface]
	if _converted.has(key):
		return _converted[key]
	var base := Stylized.convert(source, Color.WHITE, finish.get("surface", surface)) as ShaderMaterial
	if base == null:
		return source
	var material := base.duplicate() as ShaderMaterial
	if finish.has("color"):
		material.set_shader_parameter("albedo", finish["color"])
		material.set_shader_parameter("albedo_tex", null)
		material.set_shader_parameter("use_vertex_color", false)
	if finish.has("roughness"):
		material.set_shader_parameter("roughness", finish["roughness"])
		material.set_shader_parameter("use_orm", false)
	if finish.has("metallic"):
		material.set_shader_parameter("metallic", finish["metallic"])
		material.set_shader_parameter("use_orm", false)
		material.set_shader_parameter("rim_strength", RIM * (0.6 if (finish["metallic"] as float) > 0.5 else 1.0))
	if finish.has("bump"):
		material.set_shader_parameter("detail_bump", finish["bump"])
		material.set_shader_parameter("detail_roughness", 0.12 * minf((finish["bump"] as float) * 2.0, 1.0))
	if finish.has("emission"):
		material.set_shader_parameter("emission", finish["emission"])
		material.set_shader_parameter("emission_energy", finish.get("energy", 1.0))
		material.set_shader_parameter("emission_tex", _white())
	_converted[key] = material
	return material


static func _noise_texture(surface: Surface) -> NoiseTexture2D:
	var recipe: Dictionary = _RECIPES[surface]
	var noise := FastNoiseLite.new()
	noise.noise_type = recipe["type"]
	noise.frequency = recipe["freq"]
	noise.fractal_octaves = recipe["octaves"]
	if recipe.has("jitter"):
		noise.fractal_type = FastNoiseLite.FRACTAL_NONE
		noise.cellular_jitter = recipe["jitter"]
		noise.cellular_return_type = FastNoiseLite.RETURN_DISTANCE
	noise.seed = 1337 + int(surface) * 17
	var texture := NoiseTexture2D.new()
	var size: Vector2i = recipe["size"]
	texture.width = size.x
	texture.height = size.y
	texture.seamless = true
	texture.generate_mipmaps = true
	texture.noise = noise
	return texture


## A scanned map from the textures folder by name, or null if it was not fetched or imported.
static func scanned(name: String) -> Texture2D:
	if name == "":
		return null
	if not _heights.has(name):
		var path := TEXTURES_DIR + name + ".jpg"
		_heights[name] = load(path) if ResourceLoader.exists(path) else null
	return _heights[name]


static func _texel(color: Color) -> Texture2D:
	var key := "texel/" + color.to_html()
	if not _heights.has(key):
		var image := Image.create(1, 1, false, Image.FORMAT_RGBA8)
		image.fill(color)
		_heights[key] = ImageTexture.create_from_image(image)
	return _heights[key]


static func _white() -> Texture2D:
	if not _heights.has("white"):
		var image := Image.create(4, 4, false, Image.FORMAT_RGB8)
		image.fill(Color.WHITE)
		_heights["white"] = ImageTexture.create_from_image(image)
	return _heights["white"]
