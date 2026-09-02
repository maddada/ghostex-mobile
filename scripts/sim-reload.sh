#!/usr/bin/env bash
# Force the dev-client app on the booted iOS Simulator to re-load its JS bundle
# from Metro. Uses Maestro so nothing touches the host mouse/keyboard.
#
# Note: for ordinary JS/TS edits you do NOT need this — Metro Fast Refresh
# already pushes the change. Use it after a Metro restart, a cache clear, or
# when the app is sitting on the dev launcher.
set -euo pipefail

bundle_id="${GHOSTEX_IOS_BUNDLE_ID:-com.maddada.ghostex.ios}"
metro="${METRO_URL:-http://localhost:8081}"
maestro_bin="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"

encoded=$(printf '%s' "$metro" | sed -e 's|:|%3A|g' -e 's|/|%2F|g')

flow=$(mktemp /tmp/ghostex-sim-reload.XXXXXX.yaml)
trap 'rm -f "$flow"' EXIT

cat > "$flow" <<EOF
appId: $bundle_id
---
- launchApp
- openLink: $bundle_id://expo-development-client/?url=$encoded
- runFlow:
    when:
      visible: 'Open'
    commands:
      - tapOn: 'Open'
- extendedWaitUntil:
    visible: 'Ghostex'
    timeout: 60000
EOF

if [ -n "${SIM_UDID:-}" ]; then
  "$maestro_bin" --device "$SIM_UDID" test "$flow"
else
  "$maestro_bin" test "$flow"
fi

echo "reloaded from $metro"
