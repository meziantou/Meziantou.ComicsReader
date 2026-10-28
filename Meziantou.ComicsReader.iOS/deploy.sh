#!/usr/bin/env bash
# Build the app, install it on a connected iPad or iPhone, and launch it.
#
# Usage: ./deploy.sh [--device <udid>] [--team <team id>] [--configuration Debug|Release] [--no-launch]
#
# By default, the device is the only connected physical device and the team is
# $DEVELOPMENT_TEAM, or the first team signed in to Xcode.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$SCRIPT_DIR/ComicsReader.xcodeproj"
SCHEME="ComicsReader"
BUNDLE_ID="net.meziantou.comicsreader"
DERIVED_DATA="$SCRIPT_DIR/DerivedData"

device=""
team="${DEVELOPMENT_TEAM:-}"
configuration="Debug"
launch=true

usage() {
    sed -n '2,7s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"
}

fail() {
    echo "error: $*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -d|--device) device="${2:?missing value for $1}"; shift 2 ;;
        -t|--team) team="${2:?missing value for $1}"; shift 2 ;;
        -c|--configuration) configuration="${2:?missing value for $1}"; shift 2 ;;
        --no-launch) launch=false; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "unknown option: $1" ;;
    esac
done

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# Select the device
if [[ -z "$device" ]]; then
    xcrun devicectl list devices --json-output "$tmp_dir/devices.json" >/dev/null
    devices="$(jq -r '.result.devices[]
        | select(.hardwareProperties.reality == "physical"
            and .connectionProperties.pairingState == "paired"
            and .connectionProperties.transportType != null)
        | "\(.hardwareProperties.udid)\t\(.deviceProperties.name) (\(.hardwareProperties.marketingName))"' "$tmp_dir/devices.json")"

    count="$(grep -c . <<< "$devices" || true)"
    case "$count" in
        0) fail "no connected device found. Connect the device, unlock it, and make sure it is paired with this Mac." ;;
        1) device="$(cut -f1 <<< "$devices")" ;;
        *) echo "Several devices are connected:" >&2
           sed 's/^/  /' <<< "$devices" >&2
           fail "select one with --device <udid>" ;;
    esac
    echo "Device: $(cut -f2 <<< "$devices") [$device]"
fi

# Select the development team
if [[ -z "$team" ]]; then
    team="$(defaults export com.apple.dt.Xcode - 2>/dev/null \
        | plutil -extract IDEProvisioningTeamByIdentifier json -o - - 2>/dev/null \
        | jq -r '[.[][].teamID] | first // empty' || true)"
    [[ -n "$team" ]] || fail "no development team found. Sign in to Xcode (Settings > Accounts), or use --team <team id>."
fi
echo "Team: $team"

# Build and sign
echo "Building $SCHEME ($configuration)..."
xcodebuild build \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$configuration" \
    -destination "id=$device" \
    -derivedDataPath "$DERIVED_DATA" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$team" \
    -quiet

app="$(find "$DERIVED_DATA/Build/Products/$configuration-iphoneos" -maxdepth 1 -name '*.app' -print -quit)"
[[ -n "$app" ]] || fail "the built app was not found in $DERIVED_DATA"

# Install
echo "Installing $(basename "$app")..."
xcrun devicectl device install app --device "$device" "$app" >/dev/null

# Launch
if [[ "$launch" == true ]]; then
    echo "Launching $BUNDLE_ID..."
    if ! xcrun devicectl device process launch --device "$device" --terminate-existing "$BUNDLE_ID" > "$tmp_dir/launch.log" 2>&1; then
        if grep -q "explicitly trusted" "$tmp_dir/launch.log"; then
            echo "The app is installed, but iOS blocked the launch because the developer is not trusted yet." >&2
            echo "On the device, open Settings > General > VPN & Device Management, trust the developer app, and run this script again." >&2
        else
            cat "$tmp_dir/launch.log" >&2
        fi
        exit 1
    fi
fi

echo "Done."
