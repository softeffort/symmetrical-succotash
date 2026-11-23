shader_type spatial;
// Gym flooring drawn in world space, so slabs laid side by side read as one floor: speckled
// rubber with a seam grid, or staggered boards when `tile` is long and narrow. Seams and
// flecks are faded out by their size on screen, so nothing shimmers across a 30 m room.
render_mode blend_mix, depth_draw_opaque, cull_back;

#include "res://shaders/stylized_light.gdshaderinc"

uniform vec3 base_color : source_color = vec3(0.05, 0.052, 0.06);
uniform vec3 fleck_a : source_color = vec3(0.5, 0.52, 0.58);
uniform vec3 fleck_b : source_color = vec3(0.9, 0.42, 0.12);
// Share of the surface covered in flecks, and how many of those take the second colour.
uniform float fleck_density : hint_range(0.0, 1.0) = 0.16;
uniform float fleck_share_b : hint_range(0.0, 1.0) = 0.25;
// Fleck cells per metre.
uniform float fleck_scale = 90.0;
// Tile (or board) size along world X and Z, and the shift of every other row, in tiles.
uniform vec2 tile = vec2(1.0, 1.0);
uniform float stagger = 0.0;
uniform float seam_width = 0.006;
uniform vec3 seam_color : source_color = vec3(0.012, 0.012, 0.015);
uniform float seam_depth = 1.0;
// Brightness spread from one tile or board to the next.
uniform float tile_variation = 0.0;
uniform float roughness : hint_range(0.0, 1.0) = 0.85;
uniform float metallic : hint_range(0.0, 1.0) = 0.0;
uniform sampler2D grain : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform float grain_tiling = 3.0;
uniform vec2 grain_stretch = vec2(1.0, 1.0);
uniform float grain_bump = 0.5;
uniform float grain_roughness = 0.1;
// How far the grain darkens the colour (wood figure); 0 leaves it to the bump alone.
uniform float grain_color = 0.0;

varying vec3 world_pos;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

// Integer hash of a grid cell: exact however far the gym stands from the world origin.
float hash21(vec2 p) {
	uvec2 q = uvec2(ivec2(floor(p))) * uvec2(1597334673u, 3812015801u);
	uint n = (q.x ^ q.y) * 1597334673u;
	return float(n >> 8u) * (1.0 / 16777215.0);
}

vec3 bump_normal(vec3 n, vec3 view_pos, float height) {
	vec3 dpdx = dFdx(view_pos);
	vec3 dpdy = dFdy(view_pos);
	vec3 r1 = cross(dpdy, n);
	vec3 r2 = cross(n, dpdx);
	float det = dot(dpdx, r1);
	vec3 grad = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
	return normalize(abs(det) * n - grad);
}

// Coverage and colour of one layer of flecks: a round chip in some of the cells of a grid.
vec4 flecks(vec2 p, float cells, float density) {
	vec2 g = p * cells;
	vec2 cell = floor(g);
	vec2 f = fract(g);
	float pick = hash21(cell);
	vec2 centre = 0.3 + 0.4 * vec2(hash21(cell + vec2(3.0, 71.0)), hash21(cell + vec2(9.0, 133.0)));
	float size = 0.2 + 0.18 * hash21(cell + vec2(5.0, 211.0));
	float chip = step(pick, density) * (1.0 - smoothstep(size * 0.7, size, length(f - centre)));
	// Once a cell is smaller than a pixel the layer becomes its average tint.
	float lod = smoothstep(0.35, 1.3, fwidth(g.x) + fwidth(g.y));
	vec3 tint = mix(fleck_a, fleck_b, step(1.0 - fleck_share_b, hash21(cell + vec2(17.0, 331.0))));
	vec3 average = mix(fleck_a, fleck_b, fleck_share_b);
	return vec4(mix(tint, average, lod), mix(chip, density * 0.22, lod));
}

void fragment() {
	vec2 p = world_pos.xz;
	vec2 t = p / tile;
	t.x += stagger * mod(floor(t.y), 2.0);
	vec2 cell = floor(t);
	vec2 edge = min(fract(t), 1.0 - fract(t)) * tile;
	float seam_distance = min(edge.x, edge.y);
	float pixel = fwidth(seam_distance);
	float seam = 1.0 - smoothstep(seam_width * 0.5 - pixel, seam_width * 0.5 + pixel, seam_distance);
	seam *= min(1.0, seam_width / max(pixel * 2.0, 0.00001));

	vec2 grain_uv = (p + hash21(cell) * 13.0 * step(0.0001, tile_variation)) * grain_tiling * grain_stretch;
	float figure = texture(grain, grain_uv).r;

	vec3 color = base_color * (1.0 + (hash21(cell + vec2(2.0, 47.0)) - 0.5) * tile_variation);
	color *= mix(1.0, 0.55 + 0.9 * figure, grain_color);
	float chips = 0.0;
	if (fleck_density > 0.0) {
		vec4 fine = flecks(p, fleck_scale, fleck_density);
		vec4 coarse = flecks(p + 4.7, fleck_scale * 0.43, fleck_density * 0.45);
		color = mix(color, fine.rgb, fine.a);
		color = mix(color, coarse.rgb, coarse.a);
		chips = max(fine.a, coarse.a);
	}
	ALBEDO = mix(color, seam_color, seam * 0.9);

	float fade = 1.0 - smoothstep(6.0, 18.0, -VERTEX.z);
	float height = figure * grain_bump * 0.02 * fade - seam * seam_depth * 0.0035;
	NORMAL = bump_normal(NORMAL, VERTEX, height);
	ROUGHNESS = clamp(roughness + (figure - 0.5) * 2.0 * grain_roughness * fade - chips * 0.08 + seam * 0.1, 0.04, 1.0);
	METALLIC = metallic;
}
