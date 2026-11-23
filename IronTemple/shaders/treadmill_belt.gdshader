shader_type spatial;
// Running belt of a treadmill. `scroll` is the distance the belt has travelled in metres: the
// station feeds it its own belt position every tick, so the ribs and the tread marks move at
// exactly the belt speed shown on the console. UV.y runs along the belt from the rear roller.
render_mode blend_mix, depth_draw_opaque, cull_back;

#include "res://shaders/stylized_light.gdshaderinc"

uniform float scroll = 0.0;
// Belt width and length in metres.
uniform vec2 size = vec2(0.5, 1.5);
uniform vec3 rubber : source_color = vec3(0.028, 0.028, 0.033);
uniform vec3 mark : source_color = vec3(0.2, 0.21, 0.24);
// Distance between the chevron tread marks, and between the fine cross ribs.
uniform float mark_spacing = 0.25;
uniform float rib_pitch = 0.012;
// (The station sets the rib pitch to a whole fraction of the mark spacing, so the wrapped
// scroll offset it sends never makes the ribs jump.)
uniform float roughness : hint_range(0.0, 1.0) = 0.72;

vec3 bump_normal(vec3 n, vec3 view_pos, float height) {
	vec3 dpdx = dFdx(view_pos);
	vec3 dpdy = dFdy(view_pos);
	vec3 r1 = cross(dpdy, n);
	vec3 r2 = cross(n, dpdx);
	float det = dot(dpdx, r1);
	vec3 grad = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
	return normalize(abs(det) * n - grad);
}

void fragment() {
	// The surface travels towards the rear roller, so the pattern slides against UV.y.
	float along = UV.y * size.y + scroll;
	float across = (UV.x - 0.5) * 2.0;

	float ribs = sin(along * TAU / rib_pitch);
	float rib_fade = 1.0 - smoothstep(0.25, 0.9, fwidth(along / rib_pitch));

	// Chevrons pointing the way the belt runs, kept clear of the edges.
	float cell = fract(along / mark_spacing - abs(across) * 0.22);
	float line = abs(cell - 0.5) * mark_spacing;
	float pixel = fwidth(along);
	float chevron = (1.0 - smoothstep(0.011 - pixel, 0.011 + pixel, line)) * step(abs(across), 0.82);
	// Worn, slightly polished lanes where the feet land.
	float lane = smoothstep(0.75, 0.2, abs(abs(across) - 0.36) * 2.4);

	vec3 color = rubber * (1.0 + 0.25 * ribs * rib_fade);
	color = mix(color, mark, chevron * 0.85);
	color *= 1.0 + lane * 0.35;
	ALBEDO = color;
	ROUGHNESS = clamp(roughness - lane * 0.2 + chevron * 0.1, 0.05, 1.0);
	METALLIC = 0.0;
	NORMAL = bump_normal(NORMAL, VERTEX, (ribs * 0.0005 * rib_fade) + chevron * 0.0004);
	// Edge of the belt dips under the side rails.
	ALBEDO *= mix(0.55, 1.0, smoothstep(1.0, 0.93, abs(across)));
}
