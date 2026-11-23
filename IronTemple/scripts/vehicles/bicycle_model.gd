class_name BicycleModel
extends Node3D
## Primitive-built bicycle model. Owns the moving parts (wheels, crank, steering assembly) and the
## rider attachment points. Faces local -Z with the origin on the ground between the wheels.

const WHEEL_RADIUS := 0.34
## Backward tilt of the steering axis in radians.
const HEAD_TILT := 0.267
const CRANK_RATIO := 0.4

@export var frame_color := Color(0.93, 0.2, 0.22)
@export var accent_color := Color(1.0, 0.82, 0.2)

var steer_pivot: Node3D
var front_wheel: Node3D
var rear_wheel: Node3D
var crank: Node3D
var grip_left: Marker3D
var grip_right: Marker3D
## Where the rider's eyes sit.
var rider_anchor: Marker3D
var pedal_phase := 0.0

var _spin := 0.0
var _steer_rest := Basis(Vector3.RIGHT, HEAD_TILT)


func _ready() -> void:
	var paint := Build.mat(frame_color, 0.35, 0.1)
	var steel := Build.mat(Color(0.78, 0.8, 0.85), 0.3, 0.6)
	var rubber := Build.mat(Color(0.08, 0.08, 0.1), 0.9)
	var saddle := Build.mat(Color(0.35, 0.2, 0.12), 0.7)

	var rear_axle := Vector3(0.0, WHEEL_RADIUS, 0.52)
	var front_axle := Vector3(0.0, WHEEL_RADIUS, -0.56)
	var bracket := Vector3(0.0, 0.3, 0.08)
	var seat_top := Vector3(0.0, 0.84, 0.27)
	var head_top := Vector3(0.0, 0.9, -0.34)
	var head_bottom := Vector3(0.0, 0.68, -0.4)
	var bar_centre := Vector3(0.0, 1.2, -0.42)

	# Frame triangle and rear stays.
	Build.tube(self, bracket, seat_top, 0.028, paint)
	Build.tube(self, seat_top, head_top, 0.026, paint)
	Build.tube(self, bracket, head_bottom, 0.03, paint)
	Build.tube(self, head_bottom, head_top, 0.036, paint)
	for side: float in [-1.0, 1.0]:
		var hub := rear_axle + Vector3(side * 0.06, 0.0, 0.0)
		Build.tube(self, bracket + Vector3(side * 0.04, 0.0, 0.0), hub, 0.014, paint)
		Build.tube(self, seat_top + Vector3(side * 0.03, -0.05, 0.0), hub, 0.012, paint)
	Build.box(self, Vector3(0.012, 0.03, 0.44), Vector3(0.055, 0.31, 0.3), rubber)
	Build.tube(self, bracket + Vector3(-0.06, 0.0, 0.1), Vector3(-0.2, 0.02, 0.32), 0.01, steel)

	# Saddle.
	Build.tube(self, seat_top, seat_top + Vector3(0.0, 0.1, 0.01), 0.016, steel)
	Build.box(self, Vector3(0.15, 0.05, 0.2), Vector3(0.0, 0.96, 0.31), saddle)
	Build.box(self, Vector3(0.08, 0.045, 0.12), Vector3(0.0, 0.955, 0.17), saddle)

	rear_wheel = _wheel(self, rear_axle, steel, rubber)
	Build.box(self, Vector3(0.09, 0.012, 0.42), Vector3(0.0, 0.705, 0.56), Build.mat(accent_color, 0.4), false, Vector3(-10.0, 0.0, 0.0))

	# Crank and pedals.
	crank = Node3D.new()
	crank.position = bracket
	add_child(crank)
	Build.cyl(crank, 0.09, 0.012, Vector3(0.055, 0.0, 0.0), steel, false, Vector3(0.0, 0.0, 90.0))
	for side: float in [-1.0, 1.0]:
		var tip := Vector3(side * 0.08, side * 0.17, 0.0)
		Build.tube(crank, Vector3(side * 0.08, 0.0, 0.0), tip, 0.012, steel)
		Build.box(crank, Vector3(0.1, 0.025, 0.07), tip + Vector3(side * 0.06, 0.0, 0.0), rubber)

	# Steering assembly: fork, stem, handlebar and front wheel turn about the tilted head tube.
	steer_pivot = Node3D.new()
	steer_pivot.transform = Transform3D(_steer_rest, head_bottom)
	add_child(steer_pivot)
	var to_pivot := steer_pivot.transform.affine_inverse()
	for side: float in [-1.0, 1.0]:
		var offset := Vector3(side * 0.05, 0.0, 0.0)
		Build.tube(steer_pivot, to_pivot * (head_bottom + offset), to_pivot * (front_axle + offset), 0.014, steel)
	Build.tube(steer_pivot, to_pivot * head_top, to_pivot * bar_centre, 0.018, steel)
	Build.tube(steer_pivot, to_pivot * (bar_centre - Vector3(0.31, 0.0, 0.0)), to_pivot * (bar_centre + Vector3(0.31, 0.0, 0.0)), 0.014, steel)
	for side: float in [-1.0, 1.0]:
		var inner := bar_centre + Vector3(side * 0.19, 0.0, 0.0)
		var outer := bar_centre + Vector3(side * 0.32, 0.0, 0.0)
		Build.tube(steer_pivot, to_pivot * inner, to_pivot * outer, 0.021, rubber)
		var grip := Marker3D.new()
		grip.position = to_pivot * (bar_centre + Vector3(side * 0.255, 0.0, 0.0))
		steer_pivot.add_child(grip)
		if side < 0.0:
			grip_left = grip
		else:
			grip_right = grip
	Build.ball(steer_pivot, 0.028, to_pivot * (bar_centre + Vector3(0.1, 0.03, 0.0)), Build.mat(accent_color, 0.3, 0.5))
	Build.box(steer_pivot, Vector3(0.07, 0.07, 0.05), to_pivot * Vector3(0.0, 0.84, -0.45), Build.glow(Color(1.0, 0.95, 0.75), 1.5))
	front_wheel = _wheel(steer_pivot, to_pivot * front_axle, steel, rubber)

	rider_anchor = Marker3D.new()
	rider_anchor.position = Vector3(0.0, 1.6, 0.22)
	add_child(rider_anchor)
	rotation.z = Bicycle.PARKED_LEAN


## Called by the bicycle every physics tick so the motion is interpolated with the body.
func animate(delta: float, speed: float, bar_angle: float, lean: float, pedaling: bool) -> void:
	var roll := speed / WHEEL_RADIUS * delta
	_spin = fmod(_spin + roll, TAU)
	front_wheel.rotation.x = -_spin
	rear_wheel.rotation.x = -_spin
	if pedaling:
		pedal_phase = fmod(pedal_phase + roll * CRANK_RATIO, TAU)
		crank.rotation.x = -pedal_phase
	steer_pivot.basis = _steer_rest * Basis(Vector3.UP, bar_angle)
	rotation.z = lean


func _wheel(parent: Node3D, axle: Vector3, steel: Material, rubber: Material) -> Node3D:
	var wheel := Node3D.new()
	wheel.position = axle
	parent.add_child(wheel)
	Build.ring(wheel, WHEEL_RADIUS - 0.026, 0.026, Vector3.ZERO, rubber, Vector3(0.0, 0.0, 90.0))
	Build.ring(wheel, WHEEL_RADIUS - 0.062, 0.012, Vector3.ZERO, steel, Vector3(0.0, 0.0, 90.0))
	Build.cyl(wheel, 0.03, 0.1, Vector3.ZERO, steel, false, Vector3(0.0, 0.0, 90.0), -1.0, 8)
	for i in 6:
		var angle := i * PI / 6.0
		var spoke := Vector3(0.0, cos(angle), sin(angle)) * (WHEEL_RADIUS - 0.06)
		Build.tube(wheel, -spoke, spoke, 0.004, steel, 4)
	return wheel
