class_name FightGear
extends RefCounted
## Stylized MMA gear for CharacterModel fighters.


## Builds a glove on a CharacterModel hand attachment (see `CharacterModel.get_hand`) and
## returns it. Pass a material of your own as `padding` to make the glove glow later.
## On a rigged body the glove is part of the skin shader instead (see CharacterRig) and the
## returned node is an empty marker; a look that already chose its hand gear keeps it.
static func glove(hand: Node3D, padding: Material, trim: Color, layers: int = 1) -> Node3D:
	var root := Node3D.new()
	root.name = "Glove"
	hand.add_child(root)
	var owner := hand.get_parent()
	while owner != null and not owner is CharacterModel:
		owner = owner.get_parent()
	var model := owner as CharacterModel
	if model != null and model.rig != null:
		if not model.look.has("hands"):
			var base := padding as BaseMaterial3D
			model.set_hand_gear(CharacterRig.Hands.GLOVES, base.albedo_color if base != null else Color(0.1, 0.1, 0.13), trim)
		return root
	Build.ball(root, 0.064, Vector3(0.0, -0.004, -0.004), padding, Vector3(0.95, 1.2, 1.08), 10)
	Build.cyl(root, 0.044, 0.05, Vector3(0.0, 0.085, 0.0), Build.mat(trim, 0.5), false, Vector3.ZERO, -1.0, 10)
	for mesh: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		mesh.layers = layers
	return root
