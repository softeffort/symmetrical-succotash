"""Prints one table row per simulated cell from the logs sim_matrix.sh wrote."""
import json
import os
import sys

out, opps, skills = sys.argv[1], sys.argv[2].split(), sys.argv[3].split()
bad = 0
print(f"{'opponent':10} {'skill':8} {'wins':>6} {'median':>7} {'p10':>6} {'p90':>6} {'max':>6}  finishes")
for opp in opps:
    for skill in skills:
        text = open(os.path.join(out, f"{opp}_{skill}.log")).read()
        lines = text.splitlines()
        errors = [l for l in lines if "SCRIPT ERROR" in l or l.startswith("ERROR")]
        line = next((l for l in lines if l.startswith("SUMMARY ")), None)
        if line is None or errors:
            bad += 1
            print(f"{opp:10} {skill:8} FAILED {errors[:2] or text[-300:]!r}")
            if line is None:
                continue
        s = json.loads(line[8:])
        fin = " ".join(f"{k}={v}" for k, v in sorted(s["finishes"].items()))
        a = s["avg"]
        print(
            f"{opp:10} {skill:8} {s['wins']:>3}/{s['bouts']:<2} {s['median']:>7.1f} {s['p10']:>6.1f} "
            f"{s['p90']:>6.1f} {s['max']:>6.1f}  {fin} | kd {a['kd_for']:.1f}/{a['kd_against']:.1f} "
            f"int {a['intercepts']:.1f} ctr {a['counters']:.1f} hp {a['hp']:.2f}/{a['foe_hp']:.2f}"
        )
sys.exit(1 if bad else 0)
