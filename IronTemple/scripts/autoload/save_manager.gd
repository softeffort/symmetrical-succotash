extends Node
## Autoload `SaveManager`: the career and the settings in one JSON file, `user://gym_mma_save.json`.
##
## Loads on start-up. Saves after every workout session, fight and bar purchase (their scripts
## call `save_game()`), from the pause menu, and when the window closes. `reset_career()` wipes
## the career and keeps the settings.

signal saved
signal settings_changed

const SAVE_PATH := "user://gym_mma_save.json"
const VERSION := 1
## Mouse sensitivity is a multiplier on the player's own setting.
const DEFAULT_SETTINGS := {"MouseSensitivity": 1.0, "MusicOn": true, "SfxOn": true}
const SENSITIVITY_RANGE := Vector2(0.3, 3.0)

var settings: Dictionary = DEFAULT_SETTINGS.duplicate()
## The player has already made the ride to the gym, so a new session starts at its door.
var reached_gym := false
## A save file was found or written this session.
var has_save := false


func _ready() -> void:
	# The career is written before the window closes; see `_notification`.
	get_tree().auto_accept_quit = false
	load_game()
	_apply_settings()
	AudioManager.music_toggled.connect(func(enabled: bool) -> void: set_setting("MusicOn", enabled))


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		save_game()
		get_tree().quit()


## Writes the career and settings. Returns false if the file could not be written.
func save_game() -> bool:
	var data := {
		"Version": VERSION,
		"SavedAt": Time.get_datetime_string_from_system(),
		"ReachedGym": reached_gym,
		"Career": PlayerStats.to_save(),
		"Settings": settings,
	}
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file == null:
		push_warning("SaveManager: cannot write %s (error %d)" % [SAVE_PATH, FileAccess.get_open_error()])
		return false
	# Full precision, so a career loads back exactly as it was saved.
	file.store_string(JSON.stringify(data, "\t", true, true))
	file.close()
	has_save = true
	saved.emit()
	return true


## Reads the save file into PlayerStats and the settings. Returns false when there is none or
## it cannot be read; the game then starts a fresh career.
func load_game() -> bool:
	if not FileAccess.file_exists(SAVE_PATH):
		return false
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if not parsed is Dictionary:
		push_warning("SaveManager: %s is not a valid save, starting fresh" % SAVE_PATH)
		return false
	var data: Dictionary = parsed
	var career: Variant = data.get("Career")
	if career is Dictionary:
		PlayerStats.apply_save(career)
	var stored: Variant = data.get("Settings")
	if stored is Dictionary:
		for key: String in DEFAULT_SETTINGS:
			var value: Variant = (stored as Dictionary).get(key)
			if DEFAULT_SETTINGS[key] is bool and value is bool:
				settings[key] = value
			elif DEFAULT_SETTINGS[key] is float and (value is float or value is int):
				settings[key] = float(value)
	settings["MouseSensitivity"] = clampf(settings["MouseSensitivity"], SENSITIVITY_RANGE.x, SENSITIVITY_RANGE.y)
	reached_gym = data.get("ReachedGym") == true
	has_save = true
	return true


## Starts the career over. Settings are kept; the next session begins with the ride again.
func reset_career() -> void:
	PlayerStats.reset_career()
	reached_gym = false
	save_game()


## Remembers that the intro ride is done.
func mark_gym_reached() -> void:
	if not reached_gym:
		reached_gym = true
		save_game()


func get_setting(key: String) -> Variant:
	return settings.get(key, DEFAULT_SETTINGS.get(key))


## Changes a setting, applies it and saves.
func set_setting(key: String, value: Variant) -> void:
	if not DEFAULT_SETTINGS.has(key) or settings.get(key) == value:
		return
	settings[key] = value
	_apply_settings()
	settings_changed.emit()
	save_game()


func get_mouse_sensitivity() -> float:
	return settings["MouseSensitivity"]


func _apply_settings() -> void:
	AudioManager.set_music_enabled(settings["MusicOn"])
	AudioManager.set_sfx_enabled(settings["SfxOn"])
