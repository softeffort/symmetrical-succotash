shader_type spatial;
// Printed artwork for framed gym posters and banners: bold two-colour graphics that the
// lettering (a label in front) sits on. `style` picks the layout; `glow` backlights it for
// light boxes. UV runs 0..1 over the print with (0, 0) at the top left.
render_mode blend_mix, depth_draw_opaque, cull_back;

#include "res://shaders/stylized_light.gdshaderinc"

uniform vec3 color_a : source_color = vec3(0.05, 0.05, 0.06);
uniform vec3 color_b : source_color = vec3(1.0, 0.5, 0.1);
uniform vec3 paper : source_color = vec3(0.9, 0.9, 0.88);
// 0 diagonal slashes, 1 sunburst, 2 halftone fade, 3 chevrons, 4 target rings.
uniform int style = 0;
// Width divided by height of the print.
uniform float aspect = 0.7;
uniform float glow = 0.0;
uniform float gloss : hint_range(0.0, 1.0) = 0.75;

void fragment() {
	vec2 uv = UV;
	vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
	float pixel = fwidth(p.x) + fwidth(p.y);
	float mask = 0.0;
	if (style == 0) {
		float slash = fract((p.x + p.y * 0.8) * 5.0);
		mask = step(0.55, slash) * step(0.3, uv.y);
	} else if (style == 1) {
		vec2 from = p - vec2(0.0, 0.22);
		float rays = step(0.5, fract(atan(from.x, from.y) / TAU * 16.0));
		mask = max(rays * step(0.12, length(from)), 1.0 - smoothstep(0.1, 0.1 + pixel, length(from)));
	} else if (style == 2) {
		vec2 grid = fract(p * 26.0) - 0.5;
		float dot_size = mix(0.05, 0.62, clamp(uv.y * 1.25 - 0.1, 0.0, 1.0));
		mask = 1.0 - smoothstep(dot_size - 0.06, dot_size + 0.06, length(grid) * 2.0);
	} else if (style == 3) {
		float chevron = fract((p.y + abs(p.x) * 0.9) * 5.5);
		mask = step(0.5, chevron) * step(0.38, uv.y);
	} else {
		float rings = fract(length(p - vec2(0.0, 0.12)) * 7.0);
		mask = step(0.5, rings) * step(length(p - vec2(0.0, 0.12)), 0.43);
	}
	vec3 color = mix(color_a, color_b, mask);
	// White margin, as a print has.
	vec2 margin = min(uv, 1.0 - uv) * vec2(aspect, 1.0);
	color = mix(paper, color, smoothstep(0.018, 0.018 + pixel, min(margin.x, margin.y)));
	ALBEDO = color;
	EMISSION = color * glow;
	ROUGHNESS = 1.0 - gloss;
	METALLIC = 0.0;
	SPECULAR = 0.6;
}
