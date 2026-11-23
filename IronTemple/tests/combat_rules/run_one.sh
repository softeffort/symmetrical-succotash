#!/bin/bash
# Usage: run_one.sh r01_guards [timeout_seconds]
# Runs one runner scene headless on a fixed 60 fps step with an isolated save file.
# Fails on a non-zero exit, a missing RESULT line, or SCRIPT ERROR / ERROR: / Parse Error output.
# GODOT picks the binary (default "godot").
name="$1"
limit="${2:-300}"
dir="${PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
log="/tmp/rules_${TAG:-live}_${name}.log"
rm -rf "/tmp/xdg_rules_${TAG:-live}_${name}"
XDG_DATA_HOME="/tmp/xdg_rules_${TAG:-live}_${name}" timeout "$limit" "${GODOT:-godot}" --headless --path "$dir" --fixed-fps 60 "res://tests/combat_rules/${name}.tscn" > "$log" 2>&1 &
pid=$!
# A script that fails to parse leaves the scene idle forever: stop as soon as it shows up.
while kill -0 "$pid" 2>/dev/null; do
  sleep 1
  if grep -qE "Parse Error|Failed to load script" "$log" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    break
  fi
done
wait "$pid" 2>/dev/null
code=$?
grep -E "^(FAIL|RESULT|INFO)" "$log"
errors=$(grep -E "SCRIPT ERROR|ERROR:|Parse Error" "$log" | head -5)
if [ -n "$errors" ]; then
  echo "FAIL log-clean $name: engine errors in output:"
  echo "$errors"
  code=3
fi
if ! grep -q "^RESULT " "$log"; then
  echo "FAIL $name: no RESULT line (exit code $code)"
  code=4
fi
exit $code
