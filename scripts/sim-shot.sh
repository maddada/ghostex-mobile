#!/usr/bin/env bash
# Screenshot the booted iOS Simulator into ~/Desktop/ghostex-sim/<timestamp>.png
set -euo pipefail

udid="${SIM_UDID:-booted}"
out_dir="${GHOSTEX_SIM_SHOT_DIR:-$HOME/Desktop/ghostex-sim}"
mkdir -p "$out_dir"
out="$out_dir/$(date +%Y%m%d-%H%M%S).png"

xcrun simctl io "$udid" screenshot "$out" >/dev/null
echo "$out"
