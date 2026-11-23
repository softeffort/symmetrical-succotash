class_name FighterLook
extends RefCounted
## How each kind of opponent looks on the rigged body: outfit, hand gear, hair, posture and,
## for the top tier, an aura. Read from the FighterProfile's own colours and build, so the
## Endless League's generated challengers are dressed by the same rules as the ladder.

const GOLD := Color(0.95, 0.76, 0.2)
const TAPE := Color(0.93, 0.92, 0.88)


## Outfit for CharacterModel.look (see CharacterRig.dress), plus "aura" (a Color) for fighters
## who get one. A hybrid dresses as the style it opens with.
static func of(profile: FighterProfile) -> Dictionary:
	var pro := profile.is_league() or profile.style.archetype == FightStyle.Archetype.PRO
	var look := {
		"hands": CharacterRig.Hands.GLOVES,
		"glove_color": profile.gloves,
		"glove_trim": Color(0.95, 0.95, 0.97),
		"wrap_color": TAPE,
		"shoes": false,
		"hair": "characters/hair_buzzed",
	}
	match profile.style.archetype:
		FightStyle.Archetype.NOOB:
			# Lanky and unsure: a tee two sizes too big, long shorts, shoulders rolled forward.
			look["top"] = CharacterRig.Top.OVERSIZED
			look["top_color"] = profile.shirt
			look["top_trim"] = profile.shirt.darkened(0.25)
			look["shorts_len"] = 0.36
			look["hair"] = "characters/hair_parted"
			look["slouch"] = 0.26
			look["shoulders"] = -0.012
		FightStyle.Archetype.PRESSURE:
			# Lean engine: tank top, red wraps under red gloves.
			look["top"] = CharacterRig.Top.TANK
			look["top_color"] = Color(0.12, 0.13, 0.16)
			look["top_trim"] = Color(0.85, 0.14, 0.12)
			look["glove_color"] = Color(0.85, 0.12, 0.1)
			look["glove_trim"] = Color(0.98, 0.9, 0.86)
			look["wrap_color"] = Color(0.8, 0.1, 0.1)
			look["shorts_len"] = 0.2
		FightStyle.Archetype.SNIPER:
			# Sharp and economical: sleek fight shorts, dark gloves.
			look["top"] = CharacterRig.Top.BARE
			look["shorts_len"] = 0.3
			look["shorts_trim"] = profile.gloves
			look["glove_color"] = Color(0.08, 0.08, 0.1)
			look["glove_trim"] = profile.gloves
			look["hair"] = "characters/hair_parted"
		FightStyle.Archetype.DIRTY:
			# Stocky brawler: wide shoulders, taped fists, chin tucked behind them.
			look["top"] = CharacterRig.Top.BARE
			look["hands"] = CharacterRig.Hands.TAPED
			look["shorts_len"] = 0.24
			look["hair"] = ["characters/hair_buzzed", "characters/hair_beard"]
			look["slouch"] = 0.12
			look["shoulders"] = 0.028
		FightStyle.Archetype.PRO:
			look["top"] = CharacterRig.Top.BARE
			look["shorts_len"] = 0.27
			look["hair"] = ["characters/hair_buzzed", "characters/hair_beard"]
			look["shoulders"] = 0.018
	if pro:
		# Championship gear: black and gold gloves, gold trim, and the aura of a title holder.
		look["glove_color"] = Color(0.05, 0.05, 0.06) if not profile.is_league() else profile.gloves.darkened(0.55)
		look["glove_trim"] = GOLD
		look["shorts_trim"] = GOLD if not profile.shorts.is_equal_approx(GOLD) else Color(0.06, 0.06, 0.07)
		look["aura"] = GOLD if not profile.is_league() else profile.shorts.lerp(GOLD, 0.35)
	return look


## Slow motes rising around a top-tier fighter, tinted `color`, with a faint light to match.
static func add_aura(body: Node3D, color: Color, height: float) -> GPUParticles3D:
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
	process.emission_ring_axis = Vector3.UP
	process.emission_ring_radius = 0.42
	process.emission_ring_inner_radius = 0.26
	process.emission_ring_height = 0.2
	process.direction = Vector3.UP
	process.spread = 12.0
	process.initial_velocity_min = 0.35
	process.initial_velocity_max = 0.8
	process.gravity = Vector3(0.0, 0.25, 0.0)
	process.scale_min = 0.012
	process.scale_max = 0.03
	process.color = Color(color.r * 2.2, color.g * 2.2, color.b * 2.2)
	process.color_ramp = CombatFx.fade_ramp(0.25)
	var aura := GPUParticles3D.new()
	aura.name = "Aura"
	aura.amount = 36
	aura.lifetime = 1.9
	aura.process_material = process
	aura.draw_pass_1 = CombatFx.particle_mesh(true, true)
	aura.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	aura.visibility_aabb = AABB(Vector3(-1.2, -0.2, -1.2), Vector3(2.4, 3.2, 2.4))
	aura.position.y = 0.1
	body.add_child(aura)
	var light := OmniLight3D.new()
	light.name = "AuraLight"
	light.light_color = color
	light.light_energy = 0.55
	light.omni_range = 2.6
	light.position.y = height * 0.6
	body.add_child(light)
	return aura
