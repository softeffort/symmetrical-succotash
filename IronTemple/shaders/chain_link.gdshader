shader_type spatial;
// Chain-link fencing for the cage: two families of coated wires drawn on a flat panel and
// blended by coverage, so the mesh stays see-through up close and turns into an even haze at
// a distance instead of crawling. Each wire gets a round normal across its width, which is
// what catches the fight lights as a moving glint.
render_mode blend_mix, depth_draw_never, cull_disabled;

#include "res://shaders/stylized_light.gdshaderinc"

// Panel size in metres (UV 0..1 spans it).
uniform vec2 size = vec2(3.3, 1.6);
// Diagonal of one diamond and the wire radius, in metres.
uniform float pitch = 0.06;
uniform float wire = 0.0042;
uniform vec3 color : source_color = vec3(0.07, 0.07, 0.08);
uniform float wire_roughness : hint_range(0.0, 1.0) = 0.36;
uniform float wire_metallic : hint_range(0.0, 1.0) = 0.9;
uniform float opacity : hint_range(0.0, 1.0) = 1.0;

void fragment() {
	vec2 p = UV * size / pitch;
	// Signed offset from the nearest wire of each family, in metres.
	float spacing = pitch * 0.7071;
	float a = (fract(p.x + p.y) - 0.5) * spacing;
	float b = (fract(p.x - p.y) - 0.5) * spacing;
	float pixel = max(fwidth(a), fwidth(b));
	float cover_a = 1.0 - smoothstep(wire - pixel, wire + pixel, abs(a));
	float cover_b = 1.0 - smoothstep(wire - pixel, wire + pixel, abs(b));
	// Thinner than a pixel, a wire keeps its share of the light rather than going solid.
	float thin = min(1.0, wire / max(pixel, 0.00001));
	float cover = max(cover_a, cover_b) * mix(1.0, thin, step(wire, pixel));

	// Round the lit wire: lean the normal across it.
	float lean = cover_a >= cover_b ? clamp(a / wire, -1.0, 1.0) : clamp(b / wire, -1.0, 1.0);
	vec2 across = cover_a >= cover_b ? vec2(0.7071, -0.7071) : vec2(0.7071, 0.7071);
	vec3 bent = vec3(across * lean * 0.85, sqrt(max(1.0 - lean * lean * 0.72, 0.0)));
	NORMAL_MAP = bent * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 1.0 - smoothstep(0.5, 2.0, pixel / wire);

	ALBEDO = color;
	METALLIC = wire_metallic;
	ROUGHNESS = wire_roughness;
	ALPHA = cover * opacity;
}
