class_name FightPose
extends RefCounted
## Joint targets for CharacterModel's fight layer. Index 0 is the left side. Angles are radians
## in the model's own conventions: positive `leg` and `arm_x` swing forward, positive `arm_z`
## lifts the arm out to the side, positive `elbow` and negative `knee` bend the joint.

var leg: Array[float] = [0.0, 0.0]
var knee: Array[float] = [0.0, 0.0]
var arm_x: Array[float] = [0.0, 0.0]
var arm_z: Array[float] = [0.0, 0.0]
var elbow: Array[float] = [0.0, 0.0]
## Lean (x, negative is forward), twist (y, positive turns the right shoulder forward) and
## side bend (z).
var torso := Vector3.ZERO
var head := 0.0
var root_pos := Vector3.ZERO
var root_rot := Vector3.ZERO
