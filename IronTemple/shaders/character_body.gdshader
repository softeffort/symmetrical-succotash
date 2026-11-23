shader_type spatial;
// Body of a rigged character: tinted skin over the model's own atlas, plus clothing and fight
// gear that are painted and puffed out from the same mesh. Every mask is worked out from the
// rest pose (baked into CUSTOM0 by CharacterRig: xyz in metres, w = thumb weight), so shorts,
// shirts, shoes, hand wraps and MMA gloves follow the skin exactly however the rig is posed.
// The rest pose must be a T-pose facing +Z.
render_mode blend_mix, depth_draw_opaque, cull_back;

#include "res://shaders/stylized_light.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 skin_tint = vec3(1.0);
uniform float skin_roughness : hint_range(0.0, 1.0) = 0.56;
// Pump and sweat: a wet sheen on the skin.
uniform float sweat : hint_range(0.0, 1.0) = 0.0;
// Deepens the painted muscle shading.
uniform float definition : hint_range(0.0, 1.0) = 0.4;
uniform float veins : hint_range(0.0, 1.0) = 0.0;
// Metres added along the normal on the arms (x), torso (y) and legs (z).
uniform vec3 girth = vec3(0.0);
// Only the arms are drawn (first-person view model). The cut at the shoulder is kept inside
// the sleeve PlayerArms draws over it.
uniform bool arms_only = false;
uniform float arm_cut = 0.04;

// Rest-pose landmarks, in the model's own metres.
uniform float hip_y = 0.97;
uniform float waist_y = 1.02;
uniform float ankle_y = 0.086;
uniform float neck_y = 1.52;
uniform float arm_y = 1.455;
uniform float arm_z = -0.065;
uniform float shoulder_x = 0.212;
uniform float elbow_x = 0.463;
uniform float wrist_x = 0.706;
uniform float hand_len = 0.223;

uniform vec3 shorts_color : source_color = vec3(0.13, 0.15, 0.22);
uniform vec3 shorts_trim : source_color = vec3(0.9, 0.9, 0.92);
// Hem below the hip joint, in metres.
uniform float shorts_len = 0.24;
// 0 bare, 1 tank top, 2 t-shirt, 3 oversized t-shirt, 4 crop top.
uniform int top_style = 0;
uniform vec3 top_color : source_color = vec3(0.16, 0.62, 0.86);
uniform vec3 top_trim : source_color = vec3(0.1, 0.4, 0.6);
// 0 barefoot, 1 trainers.
uniform int shoe_style = 0;
uniform vec3 shoe_color : source_color = vec3(0.93, 0.25, 0.2);
uniform vec3 shoe_trim : source_color = vec3(0.95, 0.95, 0.96);
// 0 bare, 1 wrist wraps, 2 taped fists, 3 fingerless MMA gloves over hand wraps.
uniform int hand_style = 0;
uniform vec3 glove_color : source_color = vec3(0.1, 0.1, 0.13);
uniform vec3 glove_trim : source_color = vec3(0.66, 0.45, 1.0);
uniform vec3 wrap_color : source_color = vec3(0.93, 0.92, 0.88);
// Wind-up glow of the left (x) and right (y) glove.
uniform vec2 glove_glow = vec2(0.0);
uniform vec3 glow_color : source_color = vec3(1.0, 0.45, 0.1);

uniform sampler2D skin_height : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform sampler2D fabric_height : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform sampler2D leather_height : filter_linear_mipmap, repeat_enable, hint_default_white;
uniform sampler2D soft_height : filter_linear_mipmap, repeat_enable, hint_default_white;

varying vec4 rest;

float band(float value, float low, float high, float soft) {
	return smoothstep(low - soft, low + soft, value) * (1.0 - smoothstep(high - soft, high + soft, value));
}

float ellipse(vec2 point, vec2 centre, vec2 radii) {
	return length((point - centre) / radii);
}

// Clothing coverage at a rest-pose point: x shorts, y top, z shoes.
vec3 clothes(vec3 p, float soft) {
	float ax = abs(p.x);
	vec3 cover = vec3(0.0);
	cover.x = band(p.y, hip_y - shorts_len, waist_y, soft) * (1.0 - step(0.45, ax));
	if (top_style > 0) {
		bool loose = top_style == 3;
		float hem = top_style == 4 ? waist_y + 0.2 : waist_y - (loose ? 0.13 : 0.03);
		float sleeve = top_style == 1 || top_style == 4 ? -0.03 : (loose ? 0.2 : 0.12);
		float body = band(p.y, hem, neck_y + 0.06, soft) * (1.0 - smoothstep(shoulder_x + sleeve - soft, shoulder_x + sleeve + soft, ax));
		vec2 collar = top_style == 1 || top_style == 4 ? vec2(0.108, 0.19) : vec2(0.082, 0.095);
		float collar_y = top_style == 1 || top_style == 4 ? neck_y + 0.02 : neck_y + 0.045;
		float hole = 1.0 - smoothstep(1.0 - soft * 9.0, 1.0 + soft * 9.0, ellipse(p.xy, vec2(0.0, collar_y), collar));
		float armhole = 0.0;
		if (top_style == 1 || top_style == 4) {
			armhole = 1.0 - smoothstep(1.0 - soft * 8.0, 1.0 + soft * 8.0, ellipse(vec2(ax, p.y), vec2(shoulder_x + 0.03, arm_y - 0.01), vec2(0.115, 0.15)));
		}
		cover.y = body * (1.0 - hole) * (1.0 - armhole);
	}
	if (shoe_style > 0) {
		cover.z = 1.0 - smoothstep(ankle_y + 0.035 - soft, ankle_y + 0.035 + soft, p.y);
	}
	return cover;
}

// Hand gear at a rest-pose point: x wraps or tape, y glove leather, z knuckle padding, w strap.
vec4 hand_gear(vec3 p, float thumb, float soft) {
	vec4 gear = vec4(0.0);
	if (hand_style == 0) {
		return gear;
	}
	float u = (abs(p.x) - wrist_x) / hand_len;
	float s = soft / hand_len;
	float back = p.y - arm_y;
	// Skin weights fade across the thumb's base; the gear wants a clean edge there.
	float on_thumb = smoothstep(0.3, 0.55, thumb);
	if (hand_style == 1) {
		gear.x = band(u, -0.3, 0.06, s);
	} else if (hand_style == 2) {
		gear.x = band(u, -0.4, 0.6, s) * (1.0 - on_thumb * smoothstep(0.3, 0.34, u));
	} else {
		// The thumb is sleeved to its last joint, the fingers to their middle one.
		float thumb_cut = 1.0 - on_thumb * smoothstep(0.34, 0.38, u);
		gear.x = band(u, -0.44, 0.6, s) * thumb_cut;
		gear.y = band(u, -0.02, 0.69, s) * thumb_cut;
		gear.w = band(u, -0.33, 0.0, s);
		gear.z = band(u, 0.17, 0.7, s * 1.5) * smoothstep(-0.002, 0.012, back) * (1.0 - on_thumb);
	}
	return gear;
}

// Extra muscle (or less of it) along the normal, by body region.
float muscle(vec3 p) {
	float ax = abs(p.x);
	float arm_span = smoothstep(shoulder_x - 0.04, shoulder_x + 0.05, ax) * (1.0 - smoothstep(wrist_x - 0.09, wrist_x - 0.02, ax));
	float upper_d = (ax - mix(shoulder_x, elbow_x, 0.5)) / 0.1;
	float fore_d = (ax - mix(elbow_x, wrist_x, 0.3)) / 0.08;
	float upper = exp(-upper_d * upper_d);
	float fore = exp(-fore_d * fore_d);
	float arms = arm_span * (0.55 + 0.45 * upper + 0.3 * fore);
	float torso = (1.0 - smoothstep(shoulder_x - 0.03, shoulder_x + 0.04, ax)) * smoothstep(waist_y - 0.02, waist_y + 0.3, p.y) * (1.0 - smoothstep(neck_y, neck_y + 0.06, p.y));
	float legs = smoothstep(ankle_y + 0.06, ankle_y + 0.3, p.y) * (1.0 - smoothstep(hip_y - 0.02, hip_y + 0.08, p.y)) * (1.0 - step(0.4, ax));
	return girth.x * arms + girth.y * torso + girth.z * legs * (0.6 + 0.4 * smoothstep(hip_y - 0.45, hip_y - 0.15, p.y));
}

void vertex() {
	rest = CUSTOM0;
	vec3 p = rest.xyz;
	vec3 cover = clothes(p, 0.02);
	vec4 gear = hand_gear(p, rest.w, 0.012);
	float u = (abs(p.x) - wrist_x) / hand_len;
	float push = muscle(p);
	push += cover.x * 0.011;
	push += cover.y * (top_style == 3 ? 0.03 : (top_style == 2 ? 0.011 : 0.006));
	// Thicker over the toes, so they merge into one toe cap.
	push += cover.z * (0.008 + 0.009 * smoothstep(0.05, 0.11, p.z));
	push += gear.x * 0.0018 + gear.y * 0.0042 + gear.w * 0.004;
	// The padding is a pillow: thickest over the knuckles, rolling off at both ends.
	push += gear.z * 0.0125 * (0.72 + 0.28 * sin(clamp((u - 0.17) / 0.53, 0.0, 1.0) * PI));
	VERTEX += NORMAL * push;
}

vec3 rest_normal() {
	return normalize(cross(dFdx(rest.xyz), dFdy(rest.xyz)));
}

float triplanar(sampler2D map, vec3 p, vec3 n) {
	vec3 w = n * n;
	w /= max(w.x + w.y + w.z, 0.0001);
	return texture(map, p.zy).r * w.x + texture(map, p.xz).r * w.y + texture(map, p.xy).r * w.z;
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

void fragment() {
	vec3 p = rest.xyz;
	float ax = abs(p.x);
	if (arms_only && ax < shoulder_x + arm_cut) {
		discard;
	}
	vec3 n_rest = rest_normal();
	float fade = 1.0 - smoothstep(4.0, 12.0, -VERTEX.z);
	vec3 cover = clothes(p, 0.0035);
	vec4 gear = hand_gear(p, rest.w, 0.0025);
	float u = (ax - wrist_x) / hand_len;
	float across = p.z - arm_z;
	float back = p.y - arm_y;

	// Skin: the atlas, re-toned. Cloth painted into the atlas is desaturated; skin is not.
	vec3 texel = texture(albedo_tex, UV).rgb;
	float top_channel = max(texel.r, max(texel.g, texel.b));
	float chroma = (top_channel - min(texel.r, min(texel.g, texel.b))) / max(top_channel, 0.001);
	float painted = (1.0 - smoothstep(0.16, 0.3, chroma)) * band(p.y, hip_y - 0.2, waist_y + 0.1, 0.01);
	vec3 skin = pow(texel, vec3(mix(0.92, 1.3, definition))) * skin_tint;
	float pores = triplanar(skin_height, p * 9.0, n_rest);
	float height = (pores - 0.5) * 0.00012 * fade;
	float rough = mix(skin_roughness, 0.3, sweat * 0.7) + (pores - 0.5) * 0.14;
	vec3 color = skin;
	vec3 glow = vec3(0.0);
	float is_skin = 1.0;

	// Veins: ridges of stretched noise along the arms, raised and a touch cooler.
	if (veins > 0.0 && ax > shoulder_x) {
		float along = ax - shoulder_x;
		float around = atan(across, back) / 6.2832;
		vec2 vein_uv = vec2(along * 0.5 + around * 0.08, around * 0.2 + along * 0.16);
		float ridge = 1.0 - abs(texture(soft_height, vein_uv).r * 2.0 - 1.0);
		float patches = smoothstep(0.4, 0.6, texture(soft_height, vein_uv * 0.37 + vec2(0.37, 0.11)).r);
		float span = smoothstep(shoulder_x + 0.06, shoulder_x + 0.14, ax) * (1.0 - smoothstep(wrist_x + 0.03, wrist_x + 0.1, ax));
		float vein = smoothstep(0.93, 0.985, ridge) * patches * span * veins;
		height += vein * 0.0012;
		color = mix(color, color * vec3(0.8, 0.88, 0.97), vein * 0.5);
	}

	// Shorts: fabric with a waistband, side stripes and a stitched hem.
	float shorts = max(cover.x, painted);
	if (shorts > 0.0) {
		float weave = triplanar(fabric_height, p * 7.0, n_rest);
		vec3 cloth = shorts_color * (0.9 + 0.2 * weave);
		float waistband = smoothstep(waist_y - 0.04, waist_y - 0.036, p.y);
		float stripe = smoothstep(0.02, 0.016, abs(p.z + 0.03)) * step(0.1, ax) * step(p.y, waist_y - 0.04);
		float hem = band(p.y, hip_y - shorts_len + 0.008, hip_y - shorts_len + 0.012, 0.0015);
		cloth = mix(cloth, shorts_trim * (0.92 + 0.16 * weave), max(waistband, stripe));
		cloth *= 1.0 - 0.25 * hem;
		color = mix(color, cloth, shorts);
		rough = mix(rough, 0.82 + (weave - 0.5) * 0.2, shorts);
		height = mix(height, (weave - 0.5) * 0.0003 * fade - hem * 0.0006 + waistband * 0.0012, shorts);
		is_skin *= 1.0 - shorts;
	}

	// Top: folds from low-frequency noise, ribbed collar and hems.
	if (cover.y > 0.0) {
		float weave = triplanar(fabric_height, p * 7.0, n_rest);
		float folds = triplanar(soft_height, p * (top_style == 3 ? 1.6 : 2.6), n_rest);
		bool scoop = top_style == 1 || top_style == 4;
		float collar_d = ellipse(p.xy, vec2(0.0, scoop ? neck_y + 0.02 : neck_y + 0.045), scoop ? vec2(0.108, 0.19) : vec2(0.082, 0.095));
		float rib = 1.0 - smoothstep(1.1, 1.13, collar_d);
		if (scoop) {
			rib = max(rib, 1.0 - smoothstep(1.09, 1.12, ellipse(vec2(ax, p.y), vec2(shoulder_x + 0.03, arm_y - 0.01), vec2(0.115, 0.15))));
		} else {
			float sleeve_end = shoulder_x + (top_style == 3 ? 0.2 : 0.12);
			rib = max(rib, smoothstep(sleeve_end - 0.016, sleeve_end - 0.012, ax));
		}
		vec3 cloth = mix(top_color, top_trim, rib) * (0.9 + 0.2 * weave) * (0.86 + 0.28 * folds);
		color = mix(color, cloth, cover.y);
		rough = mix(rough, 0.86 + (weave - 0.5) * 0.2, cover.y);
		float loose = top_style == 3 ? 0.006 : 0.0022;
		height = mix(height, (weave - 0.5) * 0.0003 * fade + (folds - 0.5) * loose + rib * 0.0008, cover.y);
		is_skin *= 1.0 - cover.y;
	}

	// Trainers: a pale sole under a coloured upper.
	if (cover.z > 0.0) {
		float grain = triplanar(leather_height, p * 9.0, n_rest);
		float sole = 1.0 - smoothstep(0.02, 0.024, p.y);
		float toe = smoothstep(0.1, 0.105, p.z) * (1.0 - sole);
		vec3 shoe = mix(shoe_color * (0.9 + 0.2 * grain), shoe_trim, max(sole, toe * 0.85));
		color = mix(color, shoe, cover.z);
		rough = mix(rough, mix(0.5, 0.8, sole), cover.z);
		height = mix(height, (grain - 0.5) * 0.0004 * fade + sole * 0.001, cover.z);
		is_skin *= 1.0 - cover.z;
	}

	// Hand wraps: overlapping diagonal turns of cloth tape.
	if (gear.x > 0.0) {
		float weave = triplanar(fabric_height, p * 14.0, n_rest);
		float turn = fract((u * hand_len + across * 0.8 + back * 0.5) / 0.021);
		float edge = smoothstep(0.0, 0.1, turn) * (1.0 - smoothstep(0.86, 1.0, turn));
		vec3 tape = wrap_color * (0.86 + 0.16 * weave) * (0.84 + 0.16 * edge);
		color = mix(color, tape, gear.x);
		rough = mix(rough, 0.9, gear.x);
		height = mix(height, (weave - 0.5) * 0.00035 * fade + edge * 0.0007, gear.x);
		if (hand_style == 2) {
			glow = glow_color * (p.x > 0.0 ? glove_glow.x : glove_glow.y) * gear.x * 0.8;
		}
		is_skin *= 1.0 - gear.x;
	}

	// MMA glove: grained leather, a split knuckle pad, a wrist strap and stitched seams.
	if (gear.y + gear.w > 0.0) {
		float coat = max(gear.y, gear.w);
		float grain = triplanar(leather_height, p * 11.0, n_rest);
		vec3 leather = glove_color * (0.82 + 0.3 * grain);
		float pad = gear.z;
		// The pad is quilted: a groove across the knuckles and one between each finger.
		float knuckle_groove = smoothstep(0.02, 0.0, abs(u - 0.47)) * pad;
		float finger_groove = smoothstep(0.004, 0.001, abs(fract((across + 0.009) / 0.0235) - 0.5) * 0.0235) * pad * smoothstep(0.45, 0.52, u);
		float groove = max(knuckle_groove, finger_groove);
		// Seams: stitches just inside the pad's edge and round both edges of the strap.
		float pad_ring = band(hand_gear(p, rest.w, 0.011).z, 0.28, 0.5, 0.05) * gear.y;
		float strap_seam = max(band(u, -0.304, -0.296, 0.0012), band(u, -0.038, -0.03, 0.0012)) * gear.w;
		float around = atan(across, back);
		float thread = max(pad_ring * step(0.4, fract((u * hand_len + across) / 0.0046)), strap_seam * step(0.4, fract(around * 7.5)));
		// The strap: a trim-coloured hook-and-loop flap wrapped over the back of the wrist.
		float flap = gear.w * smoothstep(-0.008, -0.002, back) * band(u, -0.265, -0.065, 0.003);
		leather = mix(leather, glove_trim * (0.85 + 0.25 * grain), flap * 0.92);
		// The pad is a shade lighter than the body and carries a trim band across the knuckles.
		leather = mix(leather, mix(glove_color, vec3(0.5), 0.1) * (0.9 + 0.3 * grain), pad * 0.8);
		leather = mix(leather, glove_trim * (0.85 + 0.25 * grain), band(u, 0.3, 0.36, 0.003) * pad * 0.9);
		leather *= 1.0 - 0.35 * groove;
		leather = mix(leather, mix(glove_trim, vec3(0.9), 0.55), thread * 0.8);
		// A trim piping where the glove opens over the fingers.
		float piping = band(u, 0.655, 0.69, 0.004) * gear.y;
		leather = mix(leather, glove_trim, piping * 0.85);
		color = mix(color, leather, coat);
		rough = mix(rough, mix(0.42, 0.56, grain) + flap * 0.3, coat);
		float relief = (grain - 0.5) * 0.0005 * fade - groove * 0.0028 + thread * 0.0005 + flap * 0.0012 + piping * 0.0008;
		height = mix(height, relief, coat);
		float side_glow = p.x > 0.0 ? glove_glow.x : glove_glow.y;
		glow = mix(glow, glow_color * side_glow * (0.6 + 0.8 * pad), coat);
		is_skin *= 1.0 - coat;
	}

	ALBEDO = color;
	ROUGHNESS = clamp(rough, 0.05, 1.0);
	SPECULAR = mix(0.5, 0.42, is_skin);
	NORMAL = bump_normal(NORMAL, VERTEX, height);
	// Skin lets a little light through at grazing angles and from behind.
	BACKLIGHT = vec3(0.3, 0.1, 0.06) * is_skin * skin_tint;
	EMISSION = glow;
}
