// Shared lighting of the stylized shaders: Lambert with a slightly wrapped terminator, GGX
// highlights and a Fresnel rim. The rim is driven by each light (it only appears where light
// actually reaches the edge, and takes its colour) and its width does not depend on roughness,
// so a matte surface gets a crisp edge instead of an overall wash.

uniform vec3 rim_color : source_color = vec3(1.0, 0.96, 0.9);
uniform float rim_strength : hint_range(0.0, 2.0) = 0.35;
// How much of the surface colour the rim takes on.
uniform float rim_tint : hint_range(0.0, 1.0) = 0.35;
uniform float rim_power : hint_range(1.0, 8.0) = 3.6;

void light() {
	float n_dot_l = dot(NORMAL, LIGHT);
	float lit = clamp(n_dot_l, 0.0, 1.0);
	float n_dot_v = clamp(dot(NORMAL, VIEW), 0.0001, 1.0);
	vec3 radiance = ATTENUATION * LIGHT_COLOR;

	float wrapped = clamp((n_dot_l + 0.15) / 1.15, 0.0, 1.0);
	DIFFUSE_LIGHT += mix(lit, wrapped, 0.4) * radiance / PI;
	// Thin skin and cloth pass a little light through from behind.
	DIFFUSE_LIGHT += clamp(-n_dot_l, 0.0, 1.0) * BACKLIGHT * radiance / PI;

	vec3 halfway = normalize(VIEW + LIGHT);
	float n_dot_h = clamp(dot(NORMAL, halfway), 0.0, 1.0);
	float v_dot_h = clamp(dot(VIEW, halfway), 0.0, 1.0);
	float alpha = max(ROUGHNESS * ROUGHNESS, 0.003);
	float alpha2 = alpha * alpha;
	float spread = n_dot_h * n_dot_h * (alpha2 - 1.0) + 1.0;
	float distribution = alpha2 / (PI * spread * spread);
	float k = alpha * 0.5;
	float visibility = 0.25 / ((lit * (1.0 - k) + k) * (n_dot_v * (1.0 - k) + k));
	vec3 f0 = mix(vec3(0.04), ALBEDO, METALLIC);
	vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - v_dot_h, 5.0);
	SPECULAR_LIGHT += distribution * visibility * fresnel * lit * radiance * SPECULAR_AMOUNT;

	float edge = pow(1.0 - n_dot_v, rim_power) * smoothstep(-0.3, 0.55, n_dot_l);
	SPECULAR_LIGHT += edge * rim_strength * rim_color * mix(vec3(1.0), ALBEDO, rim_tint) * radiance / PI;
}
