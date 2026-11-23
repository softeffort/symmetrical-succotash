class_name FightBoard
extends Node3D
## Wall-mounted LED fight board and round timer, facing local +Z. It reads the cage it finds in
## the "ring" group: the clock runs with the bout, the corners name who is fighting (or who is
## next on the ladder), and the strip along the bottom is the ladder with the beaten names lit.
## It only listens; nothing about the fights depends on it.

const RED := Color(1.0, 0.2, 0.16)
const BLUE := Color(0.25, 0.55, 1.0)
const AMBER := Color(1.0, 0.7, 0.2)
const DIM := Color(0.35, 0.36, 0.42)
const GREEN := Color(0.3, 1.0, 0.5)

@export var width := 4.0
@export var height := 2.0

var _ring: RingManager = null
var _clock: Label3D
var _status: Label3D
var _blue_name: Label3D
var _blue_rank: Label3D
var _record: Label3D
var _ladder: Array[Label3D] = []
var _last_time := 0.0


func _ready() -> void:
	var casing := Assembly.new()
	var shell := Stylized.steel(Color(0.03, 0.03, 0.038), 0.4)
	var split := -width * 0.1
	casing.rbox(Vector3(width, height, 0.1), 0.03, Vector3(0.0, 0.0, 0.05), shell)
	casing.box(Vector3(width - 0.1, height - 0.1, 0.004), Vector3(0.0, 0.0, 0.101), GymKit.screen())
	casing.box(Vector3(width - 0.16, 0.012, 0.006), Vector3(0.0, height * 0.5 - 0.3, 0.103), Build.glow(RED, 2.4))
	casing.box(Vector3(width - 0.16, 0.008, 0.006), Vector3(0.0, -height * 0.5 + 0.42, 0.103), Build.glow(DIM, 1.2))
	casing.box(Vector3(0.008, height - 0.82, 0.006), Vector3(split, 0.03, 0.103), Build.glow(DIM, 1.2))
	# Corner colour blocks beside the names.
	casing.box(Vector3(0.07, 0.26, 0.006), Vector3(split + 0.14, 0.42, 0.103), Build.glow(RED, 2.6))
	casing.box(Vector3(0.07, 0.34, 0.006), Vector3(split + 0.14, 0.02, 0.103), Build.glow(BLUE, 2.6))
	for side: float in [-1.0, 1.0]:
		casing.box(Vector3(0.06, height * 0.5, 0.04), Vector3(side * width * 0.36, 0.0, -0.016), shell)
	casing.commit(self, "Casing")

	var face := 0.108
	var names_x := (split + width * 0.5) * 0.5 + 0.1
	Build.text(self, "FIGHT  BOARD", Vector3(-width * 0.5 + 0.86, height * 0.5 - 0.17, face), 0.17, RED, Vector3.ZERO, 2.4)
	Build.text(self, "IRON TEMPLE  /  2F MMA ARENA", Vector3(width * 0.5 - 1.0, height * 0.5 - 0.17, face), 0.085, DIM.lightened(0.4), Vector3.ZERO, 1.4)
	_clock = Build.text(self, "00:00", Vector3((split - width * 0.5) * 0.5, 0.26, face), 0.5, AMBER, Vector3.ZERO, 2.6)
	_status = Build.text(self, "NEXT BOUT", Vector3((split - width * 0.5) * 0.5, -0.22, face), 0.12, Color(0.9, 0.92, 1.0), Vector3.ZERO, 1.8)
	Build.text(self, "YOU", Vector3(names_x, 0.42, face), 0.2, Color(1.0, 0.86, 0.84), Vector3.ZERO, 1.9)
	_blue_name = Build.text(self, "", Vector3(names_x, 0.1, face), 0.16, Color(0.84, 0.9, 1.0), Vector3.ZERO, 1.9)
	_blue_rank = Build.text(self, "", Vector3(names_x, -0.08, face), 0.075, BLUE.lightened(0.3), Vector3.ZERO, 1.6)
	_record = Build.text(self, "", Vector3(names_x, -0.32, face), 0.1, AMBER, Vector3.ZERO, 1.7)
	# The ladder runs in two rows so the long ring names stay apart.
	var ladder := FighterRoster.ladder()
	var columns := ceili(ladder.size() / 2.0)
	for i in ladder.size():
		var column := i % columns
		var row := i / columns
		var x := lerpf(-width * 0.5 + 0.75, width * 0.5 - 0.75, column / maxf(columns - 1.0, 1.0))
		_ladder.append(Build.text(self, "", Vector3(x, -height * 0.5 + 0.31 - row * 0.15, face), 0.075, DIM, Vector3.ZERO, 1.5))

	PlayerStats.fight_record_changed.connect(_refresh.unbind(1))
	PlayerStats.profile_reloaded.connect(_refresh)
	var tick := Timer.new()
	tick.wait_time = 0.2
	tick.autostart = true
	tick.timeout.connect(_tick)
	add_child(tick)
	_refresh()


func _tick() -> void:
	if _ring == null:
		_ring = get_tree().get_first_node_in_group(&"ring") as RingManager
		if _ring == null:
			return
		_ring.bout_started.connect(_refresh.unbind(1))
		_ring.bout_finished.connect(_refresh.unbind(2))
		_refresh()
	match _ring.state:
		RingManager.State.COUNTDOWN:
			_show(0.0, "GET READY", AMBER)
		RingManager.State.FIGHT:
			_last_time = _ring.bout_time
			_show(_last_time, "LIVE", RED)
		RingManager.State.FINISH, RingManager.State.RESULT:
			_show(_last_time, "FINAL", GREEN)
		_:
			_show(0.0, "NEXT BOUT", Color(0.9, 0.92, 1.0))


func _show(seconds: float, status: String, color: Color) -> void:
	var whole := floori(seconds)
	_clock.text = "%02d:%02d" % [whole / 60, whole % 60]
	if _status.text != status:
		_status.text = status
		_status.modulate = Color(color.r * 1.8, color.g * 1.8, color.b * 1.8)


## Names the blue corner, the player's record and where the ladder stands.
func _refresh() -> void:
	var ladder := FighterRoster.ladder()
	var next: FighterProfile = null
	for i in ladder.size():
		var beaten := FighterRoster.is_beaten(ladder[i])
		if not beaten and next == null:
			next = ladder[i]
		var tint := GREEN if beaten else (AMBER if ladder[i] == next else DIM)
		_ladder[i].text = "%d  %s" % [i + 1, ladder[i].fighter_name.to_upper()]
		_ladder[i].modulate = Color(tint.r * 1.5, tint.g * 1.5, tint.b * 1.5)
	var opponent: FighterProfile = next
	if _ring != null and _ring.state != RingManager.State.IDLE and _ring.profile != null:
		opponent = _ring.profile
	if opponent != null:
		_blue_name.text = opponent.fighter_name.to_upper()
		_blue_rank.text = "LVL %d   %s" % [opponent.level, opponent.rank.to_upper()]
	else:
		_blue_name.text = "ENDLESS LEAGUE"
		_blue_rank.text = "THE LADDER IS YOURS"
	_record.text = "RECORD   %s" % PlayerStats.fight_record.to_text()
