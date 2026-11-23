extends Node
## Autoload `PlayerStats`: the single source of truth for the fighter's progression and condition.
## Workout stations pay out through `reward_rep()`; the HUD, the player rig and the fight system
## read the properties and listen to the signals. Fights pay into `cash` and `fight_record`;
## the supplement bar spends the cash on timed buffs. `to_save()` and `apply_save()` are the
## career's save format (see SaveManager).
##
## Tuned to run about ten times faster than real life: roughly half an hour of training takes a
## skinny rookie to a lean, shredded build.

signal xp_changed(xp: float, xp_to_next: float)
signal level_up(new_level: int)
signal rank_changed(title: String)
signal tenure_changed(days: int)
signal strength_changed(strength: float)
signal stamina_changed(current: float, maximum: float)
signal exhausted
## Any of the three muscle groups changed.
signal muscle_changed
signal pump_changed(pump_level: float)
## The warm-up or injury state changed.
signal status_changed
signal injured(duration: float)
## Floating HUD text. `kind` is &"gain", &"perfect", &"level", &"status" or &"warning".
signal popup_requested(text: String, kind: StringName)
signal cash_changed(cash: int)
signal fight_record_changed(record: FightRecord)
## A supplement buff started or ran out.
signal buffs_changed
## A workout rep was paid out.
signal rep_completed(perfect: bool)
## The whole career was loaded or reset: re-read everything.
signal profile_reloaded

const MUSCLE_MAX := 100.0
const PUMP_MAX := 100.0
const MAX_PUMP_MULTIPLIER := 2.5
const WARMUP_DURATION := 300.0
const MIN_STRAIN_DURATION := 45.0
const MAX_STRAIN_DURATION := 60.0

## Titles unlock at these levels; past the last one a numeral is added every PRESTIGE_LEVELS.
const RANKS: Array[Dictionary] = [
	{"level": 1, "title": "Skinny Rookie"},
	{"level": 3, "title": "Gym Regular"},
	{"level": 6, "title": "Lean Grinder"},
	{"level": 9, "title": "Shredded Prospect"},
	{"level": 13, "title": "Cage Ready"},
	{"level": 17, "title": "Iron Machine"},
]
const PRESTIGE_LEVELS := 5
const MUSCLE_LABELS := {&"arms": "Arms", &"torso": "Torso", &"legs": "Legs"}

# Progression tuning.
const XP_BASE := 50.0
const XP_CURVE := 1.3
const XP_PER_REP := 12.0
const MUSCLE_PER_REP := 0.5
const STRENGTH_PER_REP := 0.2
const STAMINA_PER_LEVEL := 2.0
## Training time that counts as one day of gym tenure.
const DAY_SECONDS := 45.0

# Pump.
const PUMP_PER_REP := 6.0
const PUMP_GRACE := 3.0
const PUMP_DECAY := 3.0
## Extra stamina cost of effort at full pump.
const PUMP_STAMINA_DRAIN := 0.6

# Stamina.
const STAMINA_REGEN := 0.16
const STAMINA_REGEN_DELAY := 0.9
## After running dry, stamina must climb back to this share before it can be spent again.
const EXHAUSTION_RECOVERY := 0.25
## Below this share of stamina the lifter starts losing strength.
const FATIGUE_THRESHOLD := 0.25
const FATIGUE_STRENGTH_FACTOR := 0.75

# Injury.
const STRAIN_STRENGTH_FACTOR := 0.6
const STRAIN_SPEED_FACTOR := 0.6
const REST_RECOVERY_FACTOR := 2.0
const WARMUP_RISK_FACTOR := 0.2
const TIRED_RISK_FACTOR := 1.6

# Fighting.
## Strength a rookie walks in with; punch power grows from here.
const FIGHT_BASE_STRENGTH := 20.0
const BASE_HEALTH := 140.0
const HEALTH_PER_LEVEL := 5.0
## Composure a rookie brings to a bout: the chin gauge clean hits have to fill to rock them.
const BASE_CHIN := 60.0
const CHIN_PER_LEVEL := 1.0
## Strike speed while strained, and with an empty stamina bar.
const STRAIN_FIGHT_SPEED := 0.72
const GASSED_FIGHT_SPEED := 0.6
## Days of gym tenure a fight camp is worth.
const WIN_TENURE_DAYS := 3.0
const LOSS_TENURE_DAYS := 1.0
# Heavy bag work, per clean strike.
const BAG_XP := 1.6
const BAG_CONDITIONING := 0.03
const BAG_MUSCLE := 0.03

# Supplements.
const PROTEIN_DURATION := 180.0
## Muscle and XP multiplier on workout reps while the shake lasts.
const PROTEIN_GAIN := 2.0
const PREWORKOUT_DURATION := 120.0
const PREWORKOUT_REGEN := 3.5
const PREWORKOUT_LIFT_POWER := 1.2
const PREWORKOUT_FIGHT_SPEED := 1.2

# A fresh career.
const START_STRENGTH := 20.0
const START_MAX_STAMINA := 100.0

var level := 1
var xp := 0.0
## Roughly the bench press, in kilograms, the fighter handles safely.
var strength := 20.0
var max_stamina := 100.0
var stamina := 100.0
## Muscle development per group, 0 to MUSCLE_MAX.
var muscle_arms := 0.0
var muscle_torso := 0.0
var muscle_legs := 0.0
## 0 to PUMP_MAX. Multiplies muscle and XP gains up to MAX_PUMP_MULTIPLIER.
var pump_level := 0.0
## Seconds of the "Warmed Up" buff left.
var warmup_timer := 0.0
## Progress towards the next warm-up buff, 0 to 1.
var warmup_progress := 0.0
## Seconds of the "Strained" debuff left.
var injury_timer := 0.0
## Days of training, as a fraction. Use `get_days()` for display.
var gym_tenure := 0.0
var rank_title := "Skinny Rookie"
var is_exhausted := false
## Set every physics tick by the player: resting doubles injury recovery, training adds tenure.
var resting := false
var training := false
## Prize money in dollars. Spend it through `spend_cash()`.
var cash := 0
var fight_record := FightRecord.new()
## Ladder opponents beaten so far, which is also the index of the next one.
var ladder_progress := 0
## Endless Championship League challengers beaten.
var league_wins := 0
## Seconds of the whey protein and pre-workout buffs left.
var protein_timer := 0.0
var preworkout_timer := 0.0

var _regen_delay := 0.0
var _pump_grace := 0.0


func _physics_process(delta: float) -> void:
	_tick_stamina(delta)
	_tick_pump(delta)
	_tick_status(delta)
	if training:
		var days := get_days()
		gym_tenure += delta / DAY_SECONDS
		if get_days() != days:
			tenure_changed.emit(get_days())


# --- Profile ---------------------------------------------------------------------------------

func get_days() -> int:
	return floori(gym_tenure)


## "Skinny Rookie | 0 Days"
func get_profile_title() -> String:
	var days := get_days()
	return "%s | %d %s" % [rank_title, days, "Day" if days == 1 else "Days"]


## "LVL 7 | Shredded Prospect | 14 Days": the tag that floats over the fighter's head.
func get_overhead_tag() -> String:
	return format_tag(level, rank_title, get_tenure_text())


## "14 Days"
func get_tenure_text() -> String:
	var days := get_days()
	return "%d %s" % [days, "Day" if days == 1 else "Days"]


## Overhead tag layout shared by the player and every opponent.
static func format_tag(tag_level: int, title: String, tenure: String) -> String:
	return "LVL %d | %s | %s" % [tag_level, title, tenure]


func get_rank_for(target_level: int) -> String:
	var title: String = RANKS[0]["title"]
	var top_level := 1
	for rank in RANKS:
		top_level = rank["level"]
		if target_level >= top_level:
			title = rank["title"]
	var prestige := floori((target_level - top_level) / float(PRESTIGE_LEVELS))
	if prestige > 0:
		title += " " + _roman(prestige + 1)
	return title


func xp_to_next() -> float:
	return roundf(XP_BASE * pow(level, XP_CURVE))


func add_xp(amount: float) -> void:
	xp += amount
	var leveled := false
	while xp >= xp_to_next():
		xp -= xp_to_next()
		level += 1
		max_stamina += STAMINA_PER_LEVEL
		leveled = true
		level_up.emit(level)
		popup_requested.emit("LEVEL UP!  Lvl %d" % level, &"level")
	if leveled:
		# A level-up is a second wind.
		stamina = max_stamina
		is_exhausted = false
		stamina_changed.emit(stamina, max_stamina)
		var title := get_rank_for(level)
		if title != rank_title:
			rank_title = title
			rank_changed.emit(rank_title)
	xp_changed.emit(xp, xp_to_next())


# --- Training --------------------------------------------------------------------------------

## Pays out one successful rep. `focus` weights the groups worked, e.g. {&"torso": 1.0, &"arms": 0.5}.
## `intensity` scales every gain (load relative to what the lifter can handle), `strength_weight`
## and `stamina_growth` add Strength and MaxStamina. A perfect rep doubles pump and XP.
func reward_rep(focus: Dictionary, intensity: float = 1.0, perfect: bool = false, strength_weight: float = 0.0, stamina_growth: float = 0.0) -> void:
	var multiplier := get_gain_multiplier()
	# Whey protein doubles muscle and XP on top of the pump.
	var boost := multiplier * get_protein_multiplier()
	var labels := PackedStringArray()
	for group: StringName in focus:
		var weight: float = focus[group]
		if add_muscle(group, MUSCLE_PER_REP * weight * intensity * boost) > 0.0:
			labels.append("+" + String(MUSCLE_LABELS[group]))
	if strength_weight > 0.0:
		add_strength(STRENGTH_PER_REP * strength_weight * intensity * multiplier)
		labels.append("+Strength")
	if stamina_growth > 0.0:
		add_max_stamina(stamina_growth * multiplier)
		labels.append("+Stamina")
	if not labels.is_empty():
		popup_requested.emit("  ".join(labels), &"gain")
	var bonus := 2.0 if perfect else 1.0
	if perfect:
		popup_requested.emit("PERFECT REP!", &"perfect")
	add_pump(PUMP_PER_REP * bonus)
	add_xp(XP_PER_REP * intensity * boost * bonus)
	rep_completed.emit(perfect)


func get_muscle(group: StringName) -> float:
	match group:
		&"arms":
			return muscle_arms
		&"torso":
			return muscle_torso
		&"legs":
			return muscle_legs
	return 0.0


func set_muscle(group: StringName, value: float) -> void:
	var clamped := clampf(value, 0.0, MUSCLE_MAX)
	match group:
		&"arms":
			muscle_arms = clamped
		&"torso":
			muscle_torso = clamped
		&"legs":
			muscle_legs = clamped
	muscle_changed.emit()


## Adds growth with diminishing returns near the cap and returns what was actually gained.
func add_muscle(group: StringName, amount: float) -> float:
	var current := get_muscle(group)
	var room := 1.0 - 0.85 * pow(current / MUSCLE_MAX, 1.5)
	var updated := minf(current + amount * room, MUSCLE_MAX)
	set_muscle(group, updated)
	return updated - current


## Girth of a muscle group for the 3D models, 0 (lanky) to 1 (shredded). Early gains show most.
func get_muscle_visual(group: StringName) -> float:
	return pow(get_muscle(group) / MUSCLE_MAX, 0.75)


func add_strength(amount: float) -> void:
	strength += amount
	strength_changed.emit(strength)


func add_max_stamina(amount: float) -> void:
	max_stamina += amount
	stamina_changed.emit(stamina, max_stamina)


# --- Pump ------------------------------------------------------------------------------------

func add_pump(amount: float) -> void:
	pump_level = clampf(pump_level + amount, 0.0, PUMP_MAX)
	if amount > 0.0:
		_pump_grace = PUMP_GRACE
	pump_changed.emit(pump_level)


## Muscle and XP multiplier from the pump, 1.0 to MAX_PUMP_MULTIPLIER.
func get_gain_multiplier() -> float:
	return 1.0 + (MAX_PUMP_MULTIPLIER - 1.0) * pump_level / PUMP_MAX


# --- Stamina ---------------------------------------------------------------------------------

## Spends `amount` and returns true, or returns false when exhausted.
func spend_stamina(amount: float) -> bool:
	if is_exhausted or stamina <= 0.0:
		return false
	stamina = maxf(stamina - amount, 0.0)
	_regen_delay = STAMINA_REGEN_DELAY
	if stamina <= 0.0:
		is_exhausted = true
		exhausted.emit()
	stamina_changed.emit(stamina, max_stamina)
	return true


func restore_stamina(amount: float) -> void:
	stamina = minf(stamina + amount, max_stamina)
	if is_exhausted and stamina >= max_stamina * EXHAUSTION_RECOVERY:
		is_exhausted = false
	stamina_changed.emit(stamina, max_stamina)


## Stamina cost of a rep: the pump makes every effort cost more.
func get_effort_cost(base_cost: float) -> float:
	return base_cost * (1.0 + PUMP_STAMINA_DRAIN * pump_level / PUMP_MAX)


func get_stamina_ratio() -> float:
	return stamina / max_stamina


# --- Warm-up and injury ----------------------------------------------------------------------

func is_warmed_up() -> bool:
	return warmup_timer > 0.0


func is_strained() -> bool:
	return injury_timer > 0.0


## Adds warm-up progress (0 to 1). A full bar grants the "Warmed Up" buff for WARMUP_DURATION.
func warm_up(amount: float) -> void:
	warmup_progress += amount
	if warmup_progress >= 1.0:
		warmup_progress = 0.0
		if not is_warmed_up():
			popup_requested.emit("WARMED UP!", &"status")
		warmup_timer = WARMUP_DURATION
	status_changed.emit()


## Applies a muscle strain. `severity` 0 to 1 picks a duration between the two limits.
func apply_strain(severity: float) -> void:
	var duration := lerpf(MIN_STRAIN_DURATION, MAX_STRAIN_DURATION, clampf(severity, 0.0, 1.0))
	injury_timer = maxf(injury_timer, duration)
	add_pump(-pump_level * 0.7)
	if not is_exhausted:
		spend_stamina(max_stamina * 0.2)
	popup_requested.emit("MUSCLE STRAIN!", &"warning")
	injured.emit(injury_timer)
	status_changed.emit()


## Strength available right now: a strain and deep fatigue both take some away, pre-workout
## adds lifting power.
func get_effective_strength() -> float:
	return strength * _condition() * (PREWORKOUT_LIFT_POWER if has_preworkout() else 1.0)


## Share of the fighter's power left after strain and fatigue, 0 to 1.
func _condition() -> float:
	var value := STRAIN_STRENGTH_FACTOR if is_strained() else 1.0
	var freshness := clampf(get_stamina_ratio() / FATIGUE_THRESHOLD, 0.0, 1.0)
	return value * lerpf(FATIGUE_STRENGTH_FACTOR, 1.0, freshness)


func get_lift_speed_factor() -> float:
	return STRAIN_SPEED_FACTOR if is_strained() else 1.0


## Multiplier on how fast an overloaded lift turns into an injury.
func get_injury_risk() -> float:
	var risk := 1.0
	if is_warmed_up():
		risk *= WARMUP_RISK_FACTOR
	if get_stamina_ratio() < 0.15:
		risk *= TIRED_RISK_FACTOR
	return risk


# --- Cash and fight record -------------------------------------------------------------------

func add_cash(amount: int) -> void:
	cash = maxi(cash + amount, 0)
	cash_changed.emit(cash)


func can_afford(price: int) -> bool:
	return cash >= price


## Pays `price` and returns true, or returns false and leaves the wallet alone.
func spend_cash(price: int) -> bool:
	if price < 0 or cash < price:
		return false
	cash -= price
	cash_changed.emit(cash)
	return true


## "$1,250"
func get_cash_text() -> String:
	return format_cash(cash)


static func format_cash(amount: int) -> String:
	var digits := str(absi(amount))
	var grouped := ""
	while digits.length() > 3:
		grouped = "," + digits.right(3) + grouped
		digits = digits.left(digits.length() - 3)
	return ("-$" if amount < 0 else "$") + digits + grouped


## Books a finished bout: updates the record and adds the fight camp to the gym tenure.
func record_fight(won: bool) -> void:
	fight_record.add_result(won)
	add_tenure(WIN_TENURE_DAYS if won else LOSS_TENURE_DAYS)
	fight_record_changed.emit(fight_record)


func add_tenure(days: float) -> void:
	var before := get_days()
	gym_tenure += days
	if get_days() != before:
		tenure_changed.emit(get_days())


# --- Fighting --------------------------------------------------------------------------------

## Share of the fighter's power available right now: a strain and deep fatigue both cut it.
func get_fight_condition() -> float:
	return _condition()


## Damage multiplier for punches, from Strength and arm muscle. 1.0 for an untrained rookie.
func get_punch_power() -> float:
	var trained := maxf(strength - FIGHT_BASE_STRENGTH, 0.0) / 80.0 + 0.8 * muscle_arms / MUSCLE_MAX
	return (1.0 + trained) * get_fight_condition()


## Multiplier on the damage done to a blocking opponent's guard meter.
func get_guard_break_power() -> float:
	var trained := maxf(strength - FIGHT_BASE_STRENGTH, 0.0) / 160.0 + muscle_arms / MUSCLE_MAX
	return (1.0 + trained) * get_fight_condition()


## Damage, push and stamina-drain multiplier for kicks and knees, mostly from leg muscle.
func get_kick_power() -> float:
	var trained := maxf(strength - FIGHT_BASE_STRENGTH, 0.0) / 320.0 + 1.4 * muscle_legs / MUSCLE_MAX
	return (1.0 + trained) * get_fight_condition()


## Footwork from leg muscle, 0 to 1: faster slips, quicker feet. A strain slows it.
func get_footwork() -> float:
	return muscle_legs / MUSCLE_MAX * (STRAIN_SPEED_FACTOR if is_strained() else 1.0)


## Strike speed multiplier: punches slow down as stamina runs out and while strained.
func get_fight_speed() -> float:
	var speed := STRAIN_FIGHT_SPEED if is_strained() else 1.0
	if has_preworkout():
		speed *= PREWORKOUT_FIGHT_SPEED
	if is_exhausted:
		return speed * GASSED_FIGHT_SPEED
	return speed * lerpf(GASSED_FIGHT_SPEED, 1.0, clampf(get_stamina_ratio() / 0.35, 0.0, 1.0))


## Health for a bout: levels, a thick torso and a deep gas tank all take more punishment.
func get_max_health() -> float:
	return BASE_HEALTH + HEALTH_PER_LEVEL * (level - 1) + 0.5 * muscle_torso + 0.15 * (max_stamina - 100.0)


## Size of the chin gauge for a bout. Grows only a little with level and torso: a good chin
## helps, but not getting hit clean is what keeps a fighter standing.
func get_chin() -> float:
	return BASE_CHIN + CHIN_PER_LEVEL * (level - 1) + 0.15 * muscle_torso


## Pays out one clean strike on a heavy bag: a little XP, conditioning and muscle. `power` is
## the strike's weight (about 1 for a jab). Quiet on purpose, the bag shows its own feedback.
func reward_bag_strike(power: float, kick: bool = false) -> void:
	add_max_stamina(BAG_CONDITIONING * power)
	add_muscle(&"legs" if kick else &"arms", BAG_MUSCLE * power)
	add_xp(BAG_XP * power)


# --- Supplements -----------------------------------------------------------------------------

func has_protein() -> bool:
	return protein_timer > 0.0


func has_preworkout() -> bool:
	return preworkout_timer > 0.0


## Muscle and XP multiplier from the protein shake: PROTEIN_GAIN while it lasts, otherwise 1.
func get_protein_multiplier() -> float:
	return PROTEIN_GAIN if has_protein() else 1.0


## Isotonic water: a full stamina bar, and an active strain heals in half the time left.
func drink_isotonic() -> void:
	is_exhausted = false
	restore_stamina(max_stamina)
	if is_strained():
		injury_timer *= 0.5
		status_changed.emit()


## Whey protein: double muscle and XP from workout reps for PROTEIN_DURATION.
func drink_protein() -> void:
	protein_timer = PROTEIN_DURATION
	buffs_changed.emit()


## Pre-workout: fast stamina regeneration, quicker punches and more lifting power for
## PREWORKOUT_DURATION.
func drink_preworkout() -> void:
	preworkout_timer = PREWORKOUT_DURATION
	buffs_changed.emit()


## Recovery elixir: heals an active strain at once. Returns false when there was none.
func heal_strain() -> bool:
	if not is_strained():
		return false
	injury_timer = 0.0
	popup_requested.emit("Strain healed", &"status")
	status_changed.emit()
	return true


# --- Saving ----------------------------------------------------------------------------------

## The career as plain data for the save file. Buffs, pump and injuries are not kept.
func to_save() -> Dictionary:
	return {
		"Level": level, "XP": xp, "Cash": cash,
		"Strength": strength, "MaxStamina": max_stamina,
		"MuscleArms": muscle_arms, "MuscleTorso": muscle_torso, "MuscleLegs": muscle_legs,
		"GymTenure": gym_tenure, "FightRecord": fight_record.to_save(),
		"LadderProgress": ladder_progress, "LeagueWins": league_wins,
		"EndlessLeagueUnlocked": ladder_progress >= FighterRoster.LADDER_SIZE,
	}


## Restores a career written by `to_save()`. Missing or damaged fields keep their defaults.
func apply_save(data: Dictionary) -> void:
	_set_defaults()
	level = maxi(int(_number(data, "Level", 1.0)), 1)
	xp = maxf(_number(data, "XP", 0.0), 0.0)
	cash = maxi(int(_number(data, "Cash", 0.0)), 0)
	strength = maxf(_number(data, "Strength", START_STRENGTH), 1.0)
	max_stamina = maxf(_number(data, "MaxStamina", START_MAX_STAMINA), 10.0)
	muscle_arms = clampf(_number(data, "MuscleArms", 0.0), 0.0, MUSCLE_MAX)
	muscle_torso = clampf(_number(data, "MuscleTorso", 0.0), 0.0, MUSCLE_MAX)
	muscle_legs = clampf(_number(data, "MuscleLegs", 0.0), 0.0, MUSCLE_MAX)
	gym_tenure = maxf(_number(data, "GymTenure", 0.0), 0.0)
	ladder_progress = clampi(int(_number(data, "LadderProgress", 0.0)), 0, FighterRoster.LADDER_SIZE)
	league_wins = maxi(int(_number(data, "LeagueWins", 0.0)), 0)
	if data.get("EndlessLeagueUnlocked") == true:
		ladder_progress = FighterRoster.LADDER_SIZE
	var record: Variant = data.get("FightRecord")
	if record is Dictionary:
		fight_record.load_save(record)
	stamina = max_stamina
	rank_title = get_rank_for(level)
	_announce()


## Back to a skinny rookie on day zero.
func reset_career() -> void:
	_set_defaults()
	_announce()


func _set_defaults() -> void:
	level = 1
	xp = 0.0
	strength = START_STRENGTH
	max_stamina = START_MAX_STAMINA
	stamina = max_stamina
	muscle_arms = 0.0
	muscle_torso = 0.0
	muscle_legs = 0.0
	pump_level = 0.0
	warmup_timer = 0.0
	warmup_progress = 0.0
	injury_timer = 0.0
	gym_tenure = 0.0
	rank_title = get_rank_for(1)
	is_exhausted = false
	cash = 0
	fight_record = FightRecord.new()
	ladder_progress = 0
	league_wins = 0
	protein_timer = 0.0
	preworkout_timer = 0.0
	_regen_delay = 0.0
	_pump_grace = 0.0


## Tells every listener that all the numbers changed.
func _announce() -> void:
	xp_changed.emit(xp, xp_to_next())
	strength_changed.emit(strength)
	stamina_changed.emit(stamina, max_stamina)
	muscle_changed.emit()
	pump_changed.emit(pump_level)
	status_changed.emit()
	buffs_changed.emit()
	cash_changed.emit(cash)
	fight_record_changed.emit(fight_record)
	profile_reloaded.emit()


static func _number(data: Dictionary, key: String, fallback: float) -> float:
	var value: Variant = data.get(key)
	if value is float or value is int:
		return float(value)
	return fallback


## Plain-data copy of every stat, for the fight system and for saving.
func get_snapshot() -> Dictionary:
	return {
		"level": level, "xp": xp, "rank": rank_title, "days": get_days(),
		"strength": strength, "stamina": stamina, "max_stamina": max_stamina,
		"muscle_arms": muscle_arms, "muscle_torso": muscle_torso, "muscle_legs": muscle_legs,
		"pump_level": pump_level, "warmed_up": is_warmed_up(), "strained": is_strained(),
		"cash": cash, "fight_record": fight_record.to_dictionary(),
		"ladder_progress": ladder_progress, "league_wins": league_wins,
		"protein": has_protein(), "preworkout": has_preworkout(),
	}


func _tick_stamina(delta: float) -> void:
	var rate := PREWORKOUT_REGEN if has_preworkout() else 1.0
	if _regen_delay > 0.0:
		_regen_delay -= delta * rate
	elif stamina < max_stamina:
		restore_stamina(max_stamina * STAMINA_REGEN * rate * delta)


func _tick_pump(delta: float) -> void:
	if _pump_grace > 0.0:
		_pump_grace -= delta
	elif pump_level > 0.0:
		pump_level = maxf(pump_level - PUMP_DECAY * delta, 0.0)
		pump_changed.emit(pump_level)


func _tick_status(delta: float) -> void:
	if warmup_timer > 0.0:
		warmup_timer -= delta
		if warmup_timer <= 0.0:
			warmup_timer = 0.0
			popup_requested.emit("Warm-up wore off", &"warning")
			status_changed.emit()
	if injury_timer > 0.0:
		injury_timer -= delta * (REST_RECOVERY_FACTOR if resting else 1.0)
		if injury_timer <= 0.0:
			injury_timer = 0.0
			popup_requested.emit("Strain healed", &"status")
			status_changed.emit()
	if protein_timer > 0.0:
		protein_timer -= delta
		if protein_timer <= 0.0:
			protein_timer = 0.0
			popup_requested.emit("Protein shake wore off", &"warning")
			buffs_changed.emit()
	if preworkout_timer > 0.0:
		preworkout_timer -= delta
		if preworkout_timer <= 0.0:
			preworkout_timer = 0.0
			popup_requested.emit("Pre-workout wore off", &"warning")
			buffs_changed.emit()


static func _roman(number: int) -> String:
	var values: Array[int] = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
	var symbols: Array[String] = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"]
	var text := ""
	var rest := number
	for i in values.size():
		while rest >= values[i]:
			text += symbols[i]
			rest -= values[i]
	return text
