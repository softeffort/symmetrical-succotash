#!/bin/bash
# Creates tests/combat_rules/<name>.tscn for a runner script of the same name.
for name in "$@"; do
cat > "$(dirname "$0")/${name}.tscn" <<EOT
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://tests/combat_rules/${name}.gd" id="1"]

[node name="Runner" type="Node"]
script = ExtResource("1")
EOT
done
