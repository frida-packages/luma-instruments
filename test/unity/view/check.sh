#!/bin/bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
luma=$(cd "$repo/../luma" && pwd)
build=${SCENE_VIEW_CHECK_BUILD:-${TMPDIR:-/tmp}/scene-view-check-build}

"$luma/Scripts/in-build-environment.sh" swift build --disable-sandbox \
    --package-path "$here/harness" --scratch-path "$build" > "$build.log" 2>&1 || {
    tail -20 "$build.log"
    exit 1
}
"$build/debug/SceneViewCheck" "$repo/unity" "$here/harness/SceneCheck.class.st" "$@"
