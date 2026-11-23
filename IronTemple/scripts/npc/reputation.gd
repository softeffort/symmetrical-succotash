class_name Reputation
extends RefCounted
## How the gym sees the player. The tier comes from the level; what people actually say also
## depends on the physique (arm and torso muscle), the pump and the fight record.

enum Tier { LOW, MID, HIGH }

const MID_LEVEL := 4
const HIGH_LEVEL := 10
## Most extra spectators a champion can draw to the cage.
const MAX_CROWD := 9

## Each entry is a line and the condition it needs (see `matches`); &"" always fits.
const LOW_LINES: Array[Array] = [
	["First day, huh?", &"unproven"],
	["Careful with that bar, stickman!", &"skinny"],
	["The light dumbbells are over there.", &"skinny"],
	["You even lift, new guy?", &"skinny"],
	["Don't hurt yourself, rookie.", &""],
	["Lost? Cardio is by the door.", &""],
	["Stay out of the cage, kid.", &"unproven"],
	["Heard you got dropped. Ouch.", &"losing"],
	["One fight and he thinks he's a fighter.", &"fought"],
	["Arms like that and still a rookie?", &"built"],
]
const MID_LINES: Array[Array] = [
	["Solid pump!", &"pumped"],
	["Nice form, bro.", &""],
	["Saw your last bout!", &"fought"],
	["Looking sharp out there.", &""],
	["Arms are coming in!", &"built"],
	["That win streak, though!", &"streak"],
	["Tough loss. You'll get him next time.", &"losing"],
	["You fighting again soon?", &"fought"],
	["Keep grinding.", &""],
	["Respect.", &""],
	["Need a spot? Just ask.", &""],
	["Shake that strain off, bro.", &"strained"],
]
const HIGH_LINES: Array[Array] = [
	["Make way for the Machine!", &""],
	["Absolute beast!", &""],
	["Legend of the gym!", &""],
	["Iron Temple's finest!", &""],
	["After you, champ.", &""],
	["Can I get a photo?", &""],
	["The champ is in the building!", &"champion"],
	["The league is yours, no question.", &"champion"],
	["Teach me that Guard Breaker!", &"fought"],
	["Nobody's touching that streak!", &"streak"],
	["Those arms should be illegal!", &"built"],
]
const CHEERS: Array[String] = ["OHHH!", "LET'S GO!", "WHAT A SHOT!", "AGAIN!", "FINISH IT!", "BEAST!"]
const KO_CHEERS: Array[String] = ["KNOCKOUT!", "IT'S OVER!", "UNREAL!", "THAT'S OUR CHAMP!"]
const GROANS: Array[String] = ["Ooooh...", "Get up!", "Shake it off!", "He'll be back."]


static func tier() -> Tier:
	if PlayerStats.level >= HIGH_LEVEL:
		return Tier.HIGH
	return Tier.MID if PlayerStats.level >= MID_LEVEL else Tier.LOW


## "Rookie", "Respected" or "Legend".
static func tier_title() -> String:
	var titles: Array[String] = ["Rookie", "Respected", "Legend"]
	return titles[tier()]


## Whether a line's condition holds for the player right now.
static func matches(condition: StringName) -> bool:
	var physique := PlayerStats.muscle_arms + PlayerStats.muscle_torso
	var record := PlayerStats.fight_record
	match condition:
		&"skinny":
			return physique < 40.0
		&"built":
			return physique >= 90.0
		&"pumped":
			return PlayerStats.pump_level >= 40.0
		&"fought":
			return record.total() > 0
		&"unproven":
			return record.total() == 0
		&"streak":
			return record.win_streak >= 2
		&"losing":
			return record.losses > 0 and record.win_streak == 0
		&"champion":
			return PlayerStats.ladder_progress >= FighterRoster.LADDER_SIZE
		&"strained":
			return PlayerStats.is_strained()
	return true


## Something a regular says as the player walks by.
static func pick_line() -> String:
	var pools: Array[Array] = [LOW_LINES, MID_LINES, HIGH_LINES]
	var fitting: Array[String] = []
	for entry: Array in pools[tier()]:
		if matches(entry[1]):
			fitting.append(entry[0])
	return fitting.pick_random()


## Extra spectators who come to the cage for the player's fights: none until the top tier, then
## more with every level and every win in the current streak.
static func crowd_size() -> int:
	if tier() != Tier.HIGH:
		return 0
	return clampi(3 + (PlayerStats.level - HIGH_LEVEL) / 2 + PlayerStats.fight_record.win_streak, 3, MAX_CROWD)
