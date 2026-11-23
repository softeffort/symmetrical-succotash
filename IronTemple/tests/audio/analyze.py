"""Measures the WAVs dump_sounds.gd wrote and fails on a silent, clipped or clicking sound.

    XDG_DATA_HOME=/tmp/xdg_audio godot --headless --path . -s res://tests/audio/dump_sounds.gd
    python3 tests/audio/analyze.py [/tmp/audio_out]

Standard library only. Levels are dBFS; "stack" is the peak of sounds the game fires on the same
frame, which the limiter on the master bus has to absorb when it goes over 0.
"""
import array
import glob
import math
import os
import sys
import wave

# Sounds the fight code plays together on one frame.
STACKS = [("hit_heavy", "counter_crunch"), ("snap", "hit_heavy"), ("hit_heavy", "crowd")]


def load(path):
    with wave.open(path, "rb") as wav:
        channels = wav.getnchannels()
        rate = wav.getframerate()
        data = array.array("h")
        data.frombytes(wav.readframes(wav.getnframes()))
    mono = [sum(data[i:i + channels]) / channels / 32768.0 for i in range(0, len(data), channels)]
    return rate, mono


def db(value):
    return 20.0 * math.log10(value) if value > 1e-9 else -120.0


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else "/tmp/audio_out"
    sounds = {}
    for path in sorted(glob.glob(os.path.join(folder, "*.wav"))):
        sounds[os.path.splitext(os.path.basename(path))[0]] = load(path)
    if not sounds:
        print("no WAVs in", folder)
        return 2
    bad = []
    print(f"{'sound':16} {'ms':>6} {'peak':>7} {'rms':>7} {'clip':>5} {'ends':>6}")
    for name, (rate, mono) in sounds.items():
        peak = max(abs(x) for x in mono)
        rms = math.sqrt(sum(x * x for x in mono) / len(mono))
        clipped = sum(1 for x in mono if abs(x) >= 0.999)
        ends = max(abs(mono[0]), abs(mono[-1]))
        looped = "loop" in name or "music" in name or "beat" in name
        issues = []
        if peak < 0.02:
            issues.append("silent")
        if clipped:
            issues.append("clipped")
        if ends > 0.02 and not looped:
            issues.append("click")
        if issues:
            bad.append(f"{name}: {', '.join(issues)}")
        print(f"{name:16} {1000.0 * len(mono) / rate:6.0f} {db(peak):7.1f} {db(rms):7.1f} {clipped:5d} {ends:6.3f}  {' '.join(issues)}")
    for pair in STACKS:
        if all(name in sounds for name in pair):
            tracks = [sounds[name][1] for name in pair]
            size = max(len(track) for track in tracks)
            peak = max(abs(sum(track[i] for track in tracks if i < len(track))) for i in range(size))
            print(f"stack {' + '.join(pair)}: {db(peak):+.1f} dBFS")
    print("RESULT sounds=%d failed=%d" % (len(sounds), len(bad)))
    for line in bad:
        print("FAIL", line)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
