#!/usr/bin/env bash
# Runs every walkthrough area against the real main scene, headless, one Godot process at a time.
#
#   tests/walkthrough/run_all.sh            # whole suite (about 2-3 minutes)
#   tests/walkthrough/run_all.sh street_bike first_floor   # only some areas
#
# Environment: GODOT (binary, default "godot"), WALK_XDG (isolated user-data dir, default
# /tmp/xdg_walk_suite), WALK_LOGS (per-run logs, default /tmp/walk_logs), WALK_TIMEOUT (seconds per
# process, default 300).
#
# A run fails when a check prints FAIL, when its RESULT line is missing, when the process exits
# non-zero, or when its output holds SCRIPT ERROR, ERROR: or Parse Error. Leaked-instance
# warnings at exit are only reported. The one allow-listed engine ERROR is listed under "known".

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-godot}"
XDG="${WALK_XDG:-/tmp/xdg_walk_suite}"
LOGS="${WALK_LOGS:-/tmp/walk_logs}"
LIMIT="${WALK_TIMEOUT:-300}"
mkdir -p "$LOGS"

total_pass=0
total_fail=0
total_err=0
total_known=0
declare -a SUMMARY=()
declare -a FAILURES=()
declare -a ERRORS=()
declare -a KNOWN=()
declare -a LEAKS=()
start_all=$(date +%s)

fresh_save() {
	rm -rf "$XDG"
	mkdir -p "$XDG"
}

# run_one <label> <scene> [user-arg]
run_one() {
	local label="$1" scene="$2" arg="${3:-}"
	local log="$LOGS/$label.log"
	local began=$(date +%s)
	if [ -n "$arg" ]; then
		XDG_DATA_HOME="$XDG" timeout "$LIMIT" "$GODOT" --headless --path "$ROOT" --fixed-fps 60 "res://tests/walkthrough/$scene.tscn" -- "$arg" >"$log" 2>&1
	else
		XDG_DATA_HOME="$XDG" timeout "$LIMIT" "$GODOT" --headless --path "$ROOT" --fixed-fps 60 "res://tests/walkthrough/$scene.tscn" >"$log" 2>&1
	fi
	local code=$?
	local took=$(( $(date +%s) - began ))
	local passes fails result
	passes=$(grep -c '^PASS ' "$log")
	fails=$(grep -c '^FAIL ' "$log")
	result=$(grep -c '^RESULT ' "$log")
	local errs known leak
	errs=$(grep -E 'SCRIPT ERROR|ERROR:|Parse Error' "$log" | grep -vE 'still in use at exit|leaked at exit' | grep -vE 'Parse JSON failed. Error at line 0: Expected key' || true)
	known=$(grep -E 'Parse JSON failed. Error at line 0: Expected key' "$log" || true)
	leak=$(grep -E 'leaked at exit|still in use at exit' "$log" | head -1 || true)
	local nerr=0 nknown=0
	[ -n "$errs" ] && nerr=$(printf '%s\n' "$errs" | wc -l)
	[ -n "$known" ] && nknown=$(printf '%s\n' "$known" | wc -l)
	# The corrupt-save probe is expected to trigger exactly the allow-listed engine error.
	local status="ok"
	if [ "$result" -lt 1 ]; then status="NO RESULT LINE"; fi
	if [ "$fails" -gt 0 ]; then status="FAILED CHECKS"; fi
	if [ "$nerr" -gt 0 ]; then status="ERROR LINES"; fi
	if [ "$code" -ne 0 ] && [ "$status" = "ok" ]; then status="exit code $code"; fi
	total_pass=$((total_pass + passes))
	total_fail=$((total_fail + fails))
	total_err=$((total_err + nerr))
	total_known=$((total_known + nknown))
	[ "$result" -lt 1 ] && total_fail=$((total_fail + 1))
	[ "$code" -ne 0 ] && [ "$fails" -eq 0 ] && [ "$result" -ge 1 ] && total_fail=$((total_fail + 1))
	SUMMARY+=("$(printf '%-34s pass=%-4s fail=%-3s errors=%-2s %3ss  %s' "$label" "$passes" "$fails" "$nerr" "$took" "$status")")
	grep '^FAIL ' "$log" | while IFS= read -r line; do echo "  [$label] $line"; done >>"$LOGS/failures.txt"
	[ "$nerr" -gt 0 ] && ERRORS+=("[$label] $(printf '%s' "$errs" | head -3 | tr '\n' '|')")
	[ "$nknown" -gt 0 ] && KNOWN+=("[$label] $(printf '%s' "$known" | head -1)")
	[ -n "$leak" ] && LEAKS+=("[$label] $leak")
	echo "== $label: pass=$passes fail=$fails errors=$nerr (${took}s, $status)"
}

want() {
	[ $# -eq 0 ] && return 0
	local name="$1"
	shift
	[ ${#SELECT[@]} -eq 0 ] && return 0
	for s in "${SELECT[@]}"; do [ "$s" = "$name" ] && return 0; done
	return 1
}

SELECT=("$@")
: >"$LOGS/failures.txt"

if want street_bike; then
	fresh_save
	run_one street_bike street_bike
fi
if want first_floor; then
	fresh_save
	run_one first_floor first_floor
fi
if want second_floor; then
	fresh_save
	run_one second_floor second_floor
fi
if want living_gym; then
	fresh_save
	run_one living_gym living_gym
fi
if want bar_audio_pause; then
	fresh_save
	run_one bar_audio_pause bar_audio_pause
fi
if want persistence; then
	fresh_save
	for phase in phase1 phase2 phase3; do
		run_one "persistence_$phase" persistence "$phase"
	done
	fresh_save
	for kind in legacy league damaged corrupt; do
		run_one "persistence_${kind}_write" persistence "${kind}_write"
		run_one "persistence_${kind}_check" persistence "${kind}_check"
	done
fi

echo
echo "================ walkthrough summary ================"
for line in "${SUMMARY[@]}"; do echo "$line"; done
echo "-----------------------------------------------------"
echo "TOTAL checks passed=$total_pass failed=$total_fail error_lines=$total_err known_engine_errors=$total_known  wall=$(( $(date +%s) - start_all ))s"
if [ -s "$LOGS/failures.txt" ]; then
	echo "Failing checks:"
	cat "$LOGS/failures.txt"
fi
for e in "${ERRORS[@]:-}"; do [ -n "$e" ] && echo "ERROR LINES: $e"; done
for k in "${KNOWN[@]:-}"; do [ -n "$k" ] && echo "KNOWN engine error (corrupt save probe, not counted): $k"; done
for l in "${LEAKS[@]:-}"; do [ -n "$l" ] && echo "leak at exit (not a failure): $l"; done
echo "Logs: $LOGS"
if [ "$total_fail" -gt 0 ] || [ "$total_err" -gt 0 ]; then
	echo "RESULT passed=$total_pass failed=$((total_fail + total_err))"
	exit 1
fi
echo "RESULT passed=$total_pass failed=0"
