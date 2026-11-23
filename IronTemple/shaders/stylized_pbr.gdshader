shader_type spatial;
// Unified stylized PBR pass for imported models: the source albedo/normal/ORM maps are kept, then a
// shared layer of micro surface noise and the stylized lighting (wrapped diffuse, GGX highlights
// and a light-driven Fresnel rim, see stylized_light.gdshaderinc) is laid over them, so models
// from different packs read as one art style. No tangents are needed: the detail bump is derived
// in screen space from an object-space triplanar height.
render_mode blend_mix, depth_draw_opaque, cull_back;

#include "res://shaders/stylized_light.gdshaderinc"

uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform vec3 tint : source_color = vec3(1.0);
uniform float saturation = 1.08;
uniform float roughness : hint_range(0.0, 1.0) = 0.7;
uniform float metallic : hint_range(0.0, 1.0) = 0.0;
uniform float specular : hint_range(0.0, 1.0) = 0.5;
// glTF packing: green is roughness, blue is metallic.
uniform sampler2D orm_tex : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform bool use_orm = false;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap, repeat_enable;
uniform bool use_normal = false;
uniform float normal_scale = 1.0;
uniform sampler2D emission_tex : source_color, filter_linear_mipmap, repeat_enable, hint_default_black;
uniform vec3 emission : source_color = vec3(0.0);
uniform float emission_energy = 0.0;
uniform bool use_vertex_color = false;
uniform float alpha_scissor = 0.0;

uniform sampler2D detail_height : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform float detail_tiling = 3.0;
uniform float detail_bump = 0.35;
uniform float detail_roughness = 0.12;

varying vec3 object_pos;
varying vec3 object_normal;

void vertex() {
	object_pos = VERTEX;
	object_normal = NORMAL;
}

float triplanar_height(vec3 p, vec3 n) {
	vec3 w = pow(abs(n), vec3(4.0));
	w /= max(w.x + w.y + w.z, 0.0001);
	return texture(detail_height, p.zy).r * w.x + texture(detail_height, p.xz).r * w.y + texture(detail_height, p.xy).r * w.z;
}

vec3 bump_normal(vec3 n, vec3 view_pos, float height, float strength) {
	vec3 dpdx = dFdx(view_pos);
	vec3 dpdy = dFdy(view_pos);
	vec3 r1 = cross(dpdy, n);
	vec3 r2 = cross(n, dpdx);
	float det = dot(dpdx, r1);
	vec3 grad = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
	return normalize(abs(det) * n - strength * grad);
}

void fragment() {
	vec4 base = texture(albedo_tex, UV) * albedo;
	if (use_vertex_color) {
		base *= COLOR;
	}
	if (alpha_scissor > 0.0 && base.a < alpha_scissor) {
		discard;
	}
	vec3 color = base.rgb * tint;
	float grey = dot(color, vec3(0.299, 0.587, 0.114));
	ALBEDO = max(mix(vec3(grey), color, saturation), vec3(0.0));

	float rough = roughness;
	float metal = metallic;
	if (use_orm) {
		vec3 orm = texture(orm_tex, UV).rgb;
		rough *= orm.g;
		metal *= orm.b;
	}
	if (use_normal) {
		NORMAL_MAP = texture(normal_tex, UV).rgb;
		NORMAL_MAP_DEPTH = normal_scale;
	}

	// Micro detail fades with distance so it never shimmers.
	float fade = 1.0 - smoothstep(5.0, 16.0, -VERTEX.z);
	float height = triplanar_height(object_pos * detail_tiling, object_normal);
	if (fade > 0.0 && detail_bump > 0.0) {
		NORMAL = bump_normal(NORMAL, VERTEX, height, detail_bump * 0.02 * fade);
	}
	ROUGHNESS = clamp(rough + (height - 0.5) * 2.0 * detail_roughness * fade, 0.04, 1.0);
	METALLIC = metal;
	SPECULAR = specular;

	EMISSION = texture(emission_tex, UV).rgb * emission * emission_energy;
}
