shader_type spatial;
// Volumetric-style beam under a spotlight: an additive cone that is brightest looked at
// side-on through its middle, soft at the silhouette and gone by the time it reaches the
// floor. UV.y runs from the far end (0) to the lamp (1).
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;

uniform vec3 color : source_color = vec3(1.0, 0.95, 0.85);
uniform float strength = 0.3;
// Higher values keep the glow closer to the lamp.
uniform float falloff = 1.5;
// Slow drift of haze through the beam.
uniform sampler2D haze : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform float haze_amount : hint_range(0.0, 1.0) = 0.35;

void fragment() {
	float facing = abs(dot(normalize(NORMAL), normalize(VIEW)));
	float body = pow(facing, 1.8);
	float reach = pow(clamp(UV.y, 0.0, 1.0), falloff);
	float drift = texture(haze, vec2(UV.x * 2.0 + TIME * 0.01, UV.y * 1.5 - TIME * 0.02)).r;
	ALBEDO = color * strength * body * reach * mix(1.0, 0.5 + drift, haze_amount);
}
