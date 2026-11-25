#!/bin/sh

set -e

here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
react_native=0.81.6
react_native_macos=0.81.9

export npm_config_cache="$out/npm-cache" GEM_HOME="$out/gems" PATH="$out/gems/bin:$PATH"
export COCOAPODS_DISABLE_STATS=true DO_NOT_TRACK=1 LANG=en_US.UTF-8

if [ ! -x "$out/gems/bin/pod" ]; then
    gem install cocoapods --no-document
fi

make_app() {
    name=$1
    architecture=$2
    cd "$out"
    rm -rf "$name"
    npx --yes @react-native-community/cli@20 init RNSpyApp --version "$react_native" --directory "$name" \
        --skip-install --skip-git-init --install-pods false --pm npm
    cd "$name"
    node -e 'const p = require("./package.json"); delete p.dependencies["react-native-safe-area-context"]; require("fs").writeFileSync("package.json", JSON.stringify(p, null, 2));'
    npm install --no-audit --no-fund
    npx --yes react-native-macos-init@2.1.3 --version "$react_native_macos" --overwrite
    cp "$here/app/App.tsx" App.tsx
    cp "$here/app/AppDelegate.mm" "$here/app/main.m" macos/RNSpyApp-macOS/
    plutil -remove NSMainStoryboardFile macos/RNSpyApp-macOS/Info.plist
    plutil -insert LSBackgroundOnly -bool YES macos/RNSpyApp-macOS/Info.plist
    (cd macos && RCT_NEW_ARCH_ENABLED=$architecture pod install)
    xcodebuild -workspace macos/RNSpyApp.xcworkspace -scheme RNSpyApp-macOS -configuration Release \
        -derivedDataPath "$out/$name-build" CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO build || true
    app="$out/$name-build/Build/Products/Release/RNSpyApp.app"
    for framework in "$app"/Contents/Frameworks/*; do
        codesign -s - -f "$framework"
    done
    codesign -s - -f "$app"
    rm -rf "$out/$name.app"
    cp -R "$app" "$out/$name.app"
}

make_app old-architecture 0
make_app new-architecture 1
ls -d "$out"/*.app
