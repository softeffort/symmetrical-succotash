class_name FighterProfile
extends RefCounted
## Everything that makes one opponent: the fight card details, stats, fighting style, looks and
## purse. FighterRoster builds the ladder and the Endless League challengers from these.

var id: StringName = &""
var fighter_name := "Fighter"
var level := 1
## Rank title and gym tenure, shown on the overhead tag and the fight card.
var rank := "Skinny Rookie"
var tenure := "First Week"
## One line of scouting for the fight card.
var blurb := ""
## Position on the ladder (0 is the weakest), or -1 for an Endless League challenger.
var ladder_index := -1

# Stats. Health pools are small on purpose: clean strikes end fights, so a tier is harder
# because of its style, not because it soaks up more.
var max_health := 100.0
var max_stamina := 100.0
var stamina_regen := 9.0
## Damage of a jab; heavier strikes multiply it.
var damage := 5.0
## Size of the chin gauge: the composure clean hits have to get through to rock the fighter.
var chin := 50.0
var guard_max := 30.0
## Guard meter restored per second once the fighter has gone a moment without being hit.
var guard_regen := 10.0
## Seconds after shaking off a stagger in which the fighter cannot be staggered again. Stops
## endless stun-locks: the better the fighter, the sooner they hit back.
var composure := 0.5

# Style.
var style := FightStyle.new()
## Second style of a hybrid, switched to and from during the bout, or null.
var alt_style: FightStyle = null
## Remembers the player's combinations and slips, and punishes the third repeat.
var adaptive := false

# Looks.
## Height multiplier of the body.
var height := 1.0
## Arm, torso and leg girth, each 0 (lanky) to 1 (shredded).
var build := Vector3.ZERO
var skin := Color(0.96, 0.76, 0.62)
var hair := Color(0.26, 0.16, 0.1)
var shorts := Color(0.13, 0.15, 0.22)
## Worn unless `bare_chest`.
var shirt := Color(0.85, 0.86, 0.9)
var bare_chest := true
var gloves := Color(0.85, 0.15, 0.15)

# Purse for a first win.
var cash := 50
var xp := 100.0


## "LVL 3 | Gym Regular | 2 Months"
func get_tag() -> String:
	return PlayerStats.format_tag(level, rank, tenure)


## "Sniper", or "Sniper-Pressure" for a hybrid.
func get_style_title() -> String:
	return FightStyle.title_of(style, alt_style)


func is_league() -> bool:
	return ladder_index < 0
