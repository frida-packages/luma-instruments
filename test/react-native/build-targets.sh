#!/bin/sh

set -e

here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
maven=https://repo1.maven.org/maven2/com/facebook
react_native=0.81.6
legacy_hermes="0.72.17 0.76.9 0.81.4"
hermes_v1=260318099.0.5

mkdir -p "$out/downloads" "$out/hermes" "$out/bin"

fetch() {
    if [ ! -f "$out/downloads/$2" ]; then
        curl -sSfL -o "$out/downloads/$2" "$1"
    fi
}

unpack_hermes() {
    mkdir -p "$out/hermes/$1"
    tar -xzf "$out/downloads/$2" -C "$out/hermes/$1"
}

build_hermes_host() {
    root="$out/hermes/$1/destroot"
    frameworks="$root/Library/Frameworks/macosx"
    framework=$(basename "$(ls -d "$frameworks"/*.framework)" .framework)
    clang++ -std=c++20 -O1 -I"$root/include" -F"$frameworks" -framework "$framework" -framework CoreFoundation \
        -Wl,-rpath,"$frameworks" -o "$out/bin/hermes-host-$1" "$here/jsi-host.cpp"
    "$root/bin/hermesc" -emit-binary -O -out "$out/bin/bundle-$1.hbc" "$here/bundle.js"
}

for version in $legacy_hermes; do
    fetch "$maven/react/react-native-artifacts/$version/react-native-artifacts-$version-hermes-ios-release.tar.gz" "hermes-$version.tar.gz"
    unpack_hermes "$version" "hermes-$version.tar.gz"
    build_hermes_host "$version"
done
fetch "$maven/hermes/hermes-ios/$hermes_v1/hermes-ios-$hermes_v1-hermes-ios-release.tar.gz" "hermes-$hermes_v1.tar.gz"
unpack_hermes v1 "hermes-$hermes_v1.tar.gz"
build_hermes_host v1

fetch "https://registry.npmjs.org/react-native/-/react-native-$react_native.tgz" "react-native-$react_native.tgz"
mkdir -p "$out/react-native"
tar -xzf "$out/downloads/react-native-$react_native.tgz" -C "$out/react-native" package/ReactCommon/jsi package/ReactCommon/jsc
common="$out/react-native/package/ReactCommon"
clang++ -std=c++20 -O1 -fvisibility=hidden -fvisibility-inlines-hidden -DJSI_HOST_JSC -I"$common/jsi" -I"$common/jsc" \
    -framework JavaScriptCore -framework CoreFoundation -o "$out/bin/jsc-host" \
    "$here/jsi-host.cpp" "$common/jsi/jsi/jsi.cpp" "$common/jsc/JSCRuntime.cpp"
cp "$out/bin/jsc-host" "$out/bin/jsc-host-stripped"
strip "$out/bin/jsc-host-stripped"
codesign -s - -f "$out/bin/jsc-host-stripped" 2>/dev/null

ls "$out/bin"
