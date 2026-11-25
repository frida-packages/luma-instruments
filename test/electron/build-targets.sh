#!/bin/sh

set -e

here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
shift
versions=${*:-"35.7.5 40.10.6 45.5.0"}
arch=$(uname -m)

mkdir -p "$out/downloads" "$out/electron" "$out/apps" "$out/tools"

if [ ! -d "$out/tools/node_modules/@electron/fuses" ]; then
    (cd "$out/tools" && echo '{ "private": true }' > package.json && npm install --silent --no-audit --no-fund @electron/asar@3 @electron/fuses@1)
fi

for version in $versions; do
    if [ ! -d "$out/electron/$version/Electron.app" ]; then
        zip="$out/downloads/electron-v$version-darwin-$arch.zip"
        curl -sSfL -o "$zip" "https://github.com/electron/electron/releases/download/v$version/electron-v$version-darwin-$arch.zip"
        mkdir -p "$out/electron/$version"
        ditto -x -k "$zip" "$out/electron/$version"
        rm "$zip"
    fi
    for layout in asar dir esm; do
        node "$here/package-fixture.mjs" "$out/electron/$version/Electron.app" "$here/fixture" \
            "$out/apps/Fixture-$version-$layout.app" "$layout" "$out/tools"
    done
done
