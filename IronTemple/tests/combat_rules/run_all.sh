#!/bin/bash
# Runs every Step 5 fight-rule runner in sequence (one Godot process at a time) and prints the
# totals. Exit code is non-zero if any check fails, a runner crashes, or the engine log contains
# SCRIPT ERROR / ERROR: / Parse Error.
#
#   tests/combat_rules/run_all.sh              the working tree
#   tests/combat_rules/run_all.sh --head       the committed HEAD (exported to /tmp, read-only for git)
#   tests/combat_rules/run_all.sh r05_dodge    only the named runners
#
# Environment: PROJECT_DIR (project to test), TAG (log/save-file name prefix), LIMIT (seconds per runner).
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
runners=(r01_guards r02_strikes r03_feint r04_intercept r05_dodge r06_spam r07_chin r08_clinch r09_tells r10_opponents r11_flow r12_hud)
only=()
for arg in "$@"; do
  if [ "$arg" = "--head" ]; then
    export PROJECT_DIR=/tmp/rules_head_tree
    export TAG=head
    rm -rf "$PROJECT_DIR" && mkdir -p "$PROJECT_DIR"
    (cd "$repo" && git archive HEAD) | tar -x -C "$PROJECT_DIR"
    cp -r "$repo/.godot" "$PROJECT_DIR/.godot" 2>/dev/null
    mkdir -p "$PROJECT_DIR/tests" && cp -r "$here" "$PROJECT_DIR/tests/combat_rules"
    here="$PROJECT_DIR/tests/combat_rules"
  else
    only+=("$arg")
  fi
done
[ ${#only[@]} -gt 0 ] && runners=("${only[@]}")

total_pass=0
total_fail=0
bad_runs=0
printf "%-16s %8s %8s %8s\n" runner passed failed seconds
for name in "${runners[@]}"; do
  start=$(date +%s)
  out="$("$here/run_one.sh" "$name" "${LIMIT:-400}")"
  code=$?
  secs=$(( $(date +%s) - start ))
  [ -n "$out" ] && echo "$out" | grep -v "^RESULT" | sed "s/^/  [$name] /"
  line="$(echo "$out" | grep "^RESULT" | tail -1)"
  p=$(echo "$line" | sed -n 's/.*passed=\([0-9]*\).*/\1/p')
  f=$(echo "$line" | sed -n 's/.*failed=\([0-9]*\).*/\1/p')
  p=${p:-0}; f=${f:-0}
  total_pass=$((total_pass + p))
  total_fail=$((total_fail + f))
  if [ $code -ne 0 ] && [ "$f" -eq 0 ]; then bad_runs=$((bad_runs + 1)); fi
  printf "%-16s %8d %8d %8d  (exit %d)\n" "$name" "$p" "$f" "$secs" "$code"
done
echo "TOTAL passed=$total_pass failed=$total_fail broken_runs=$bad_runs"
if [ "$total_fail" -gt 0 ] || [ "$bad_runs" -gt 0 ]; then exit 1; fi
exit 0
