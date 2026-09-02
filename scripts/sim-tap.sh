#!/usr/bin/env bash
# Tap something in the app on the booted iOS Simulator, via Maestro.
# Never touches the host mouse/keyboard.
#
#   ./scripts/sim-tap.sh "Machines"      # tap by visible/accessibility text
#   ./scripts/sim-tap.sh 50%,11%         # tap by screen percentage
#
# Element labels can be listed with:
#   ~/.maestro/bin/maestro hierarchy
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <text|X%,Y%>" >&2
  exit 2
fi

maestro_bin="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
target="$1"
flow=$(mktemp /tmp/ghostex-sim-tap.XXXXXX.yaml)
trap 'rm -f "$flow"' EXIT

{
  echo "appId: ${GHOSTEX_IOS_BUNDLE_ID:-com.maddada.ghostex.ios}"
  echo '---'
  if [[ "$target" == *%,*% ]]; then
    printf -- '- tapOn:\n    point: %s\n' "'$target'"
  else
    printf -- '- tapOn: %s\n' "'$target'"
  fi
} > "$flow"

if [ -n "${SIM_UDID:-}" ]; then
  "$maestro_bin" --device "$SIM_UDID" test "$flow"
else
  "$maestro_bin" test "$flow"
fi
