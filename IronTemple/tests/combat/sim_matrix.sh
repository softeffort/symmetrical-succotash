#!/usr/bin/env bash
# Runs the bout simulator over opponents x skills and prints one table row per cell.
#   tests/combat/sim_matrix.sh [bouts] [edge] ["opp ..."] ["skill ..."]
# JOBS cells run at a time (default 2); each gets its own save directory so nothing touches a
# real career. EXTRA is passed on to the simulator, e.g. EXTRA="--foe_hp=1.2".
set -u
cd "$(dirname "$0")/../.."
BOUTS="${1:-20}"
EDGE="${2:-0}"
OPPS="${3:-sam carl viktor boris champ league16 league20 league28}"
SKILLS="${4:-novice average skilled}"
GODOT="${GODOT:-godot}"
OUT="$(mktemp -d)"
cell() {
	XDG_DATA_HOME="$OUT/xdg_$1_$2" timeout 900 "$GODOT" --headless --path . --fixed-fps 60 res://tests/combat/sim.tscn -- \
		--opp="$1" --skill="$2" --bouts="$BOUTS" --edge="$EDGE" --seed="${SEED:-1}" ${EXTRA:-} > "$OUT/$1_$2.log" 2>&1
}
for opp in $OPPS; do
	for skill in $SKILLS; do
		while [ "$(jobs -rp | wc -l)" -ge "${JOBS:-2}" ]; do sleep 0.5; done
		cell "$opp" "$skill" &
	done
done
wait
python3 tests/combat/sim_table.py "$OUT" "$OPPS" "$SKILLS"
status=$?
rm -rf "$OUT"
exit $status
