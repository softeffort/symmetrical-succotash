shader_type spatial;
// Printed canvas of the cage floor, painted in the mat's own space (+Z towards the gate): a
// border line inside the fence, the red and blue corner blocks, and the centre emblem, a
// ringed temple front that the "IRON TEMPLE" lettering sits across. Scuffs and a canvas weave
// keep it from looking freshly unrolled.
render_mode blend_mix, depth_draw_opaque, cull_back;

#include "res://shaders/stylized_light.gdshaderinc"

uniform vec3 canvas : source_color = vec3(0.74, 0.75, 0.77);
uniform vec3 ink : source_color = vec3(0.05, 0.05, 0.065);
uniform vec3 accent : source_color = vec3(1.0, 0.5, 0.1);
uniform vec3 red : source_color = vec3(0.9, 0.16, 0.16);
uniform vec3 blue : source_color = vec3(0.16, 0.42, 0.95);
// Distance from the centre to the middle of a side of the canvas.
uniform float apothem = 4.0;
uniform float emblem = 1.5;
uniform sampler2D weave : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform float weave_tiling = 14.0;

varying vec3 local_pos;

void vertex() {
	local_pos = VERTEX;
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

float band(float value, float from, float to, float pixel) {
	return smoothstep(from - pixel, from + pixel, value) * (1.0 - smoothstep(to - pixel, to + pixel, value));
}

void fragment() {
	vec2 p = local_pos.xz;
	float pixel = fwidth(p.x) + fwidth(p.y);
	float r = length(p);
	// Distance in the octagon's own metric: equal to the apothem all along the fence.
	float oct = max(max(abs(p.x), abs(p.y)), (abs(p.x) + abs(p.y)) * 0.70710678);

	vec3 color = canvas;
	float printed = 0.0;

	// Border line and a wide accent band just inside the fence.
	float border = band(oct, apothem - 0.5, apothem - 0.44, pixel);
	color = mix(color, ink, border);
	float apron = smoothstep(apothem - 0.2 - pixel, apothem - 0.2 + pixel, oct);
	color = mix(color, ink, apron);

	// Corner blocks at the two posts flanking the gate: red on the +X side, blue on -X.
	float bearing = atan(p.x, p.y);
	float block = band(oct, apothem - 1.15, apothem - 0.62, pixel);
	float at_red = 1.0 - smoothstep(0.17, 0.17 + pixel, abs(bearing - 0.3927));
	float at_blue = 1.0 - smoothstep(0.17, 0.17 + pixel, abs(bearing + 0.3927));
	color = mix(color, red, block * at_red);
	color = mix(color, blue, block * at_blue);

	// Emblem: two rings around a temple front. The lettering is a label laid over the frieze.
	float ring_outer = band(r, emblem * 0.93, emblem, pixel);
	float ring_inner = band(r, emblem * 0.84, emblem * 0.875, pixel);
	color = mix(color, ink, ring_outer);
	color = mix(color, accent, ring_inner);
	vec2 e = p / emblem;
	// Pediment: a triangle whose base sits above the frieze (towards -Z, the far side).
	float roof = step(-0.62, e.y) * step(e.y, -0.2) * step(abs(e.x), (e.y + 0.62) * 1.55);
	// Four columns under the frieze and the step they stand on.
	float columns = step(0.2, e.y) * step(e.y, 0.5) * step(abs(e.x), 0.62) * step(0.45, fract(e.x * 3.2 + 0.5));
	float plinth = step(0.5, e.y) * step(e.y, 0.58) * step(abs(e.x), 0.7);
	float temple = max(roof, max(columns, plinth)) * step(r, emblem * 0.8);
	color = mix(color, ink, temple);
	printed = max(max(border, apron), max(temple, max(ring_outer, ring_inner)));

	// Scuffing: broad wear in the middle where the fighting happens, and grime towards the fence.
	float weave_height = texture(weave, p * weave_tiling).r;
	float wear = texture(weave, p * 0.09).r;
	color *= mix(1.0, 0.86 + 0.2 * wear, 0.8);
	color *= mix(1.0, 0.9, smoothstep(apothem * 0.55, apothem, oct));

	ALBEDO = color;
	float fade = 1.0 - smoothstep(4.0, 14.0, -VERTEX.z);
	NORMAL = bump_normal(NORMAL, VERTEX, weave_height * 0.006 * fade);
	// Printed ink sits a touch glossier than bare canvas.
	ROUGHNESS = clamp(0.92 - printed * 0.18 + (weave_height - 0.5) * 0.08, 0.05, 1.0);
	METALLIC = 0.0;
}
