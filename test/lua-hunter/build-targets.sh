#!/bin/sh

set -e

here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
puc_versions="5.1.5 5.2.4 5.3.6 5.4.7"
luajit_branch=v2.1

mkdir -p "$out/downloads" "$out/sources" "$out/lib" "$out/bin"

fetch() {
    if [ ! -f "$out/downloads/$2" ]; then
        curl -sSfL -o "$out/downloads/$2" "$1"
    fi
    tar -xzf "$out/downloads/$2" -C "$out/sources"
}

build_puc() {
    version=$1
    series=$(echo "$version" | cut -d. -f1-2)
    src="$out/sources/lua-$version/src"
    objects="$out/sources/lua-$version/objects"
    mkdir -p "$objects"
    for file in "$src"/*.c; do
        case $(basename "$file") in
            lua.c | luac.c | print.c) continue ;;
        esac
        cc -O2 -w -fPIC -DLUA_USE_MACOSX -DLUA_COMPAT_5_2 -DLUA_COMPAT_5_3 -c "$file" -o "$objects/$(basename "$file" .c).o"
    done
    rm -f "$out/lib/liblua$series.a"
    ar rcs "$out/lib/liblua$series.a" "$objects"/*.o
    cc -dynamiclib -install_name "@rpath/liblua$series.dylib" -o "$out/lib/liblua$series.dylib" "$objects"/*.o
    link_hosts "$series" "lua$series" "-I$src"
}

build_luajit() {
    src="$out/sources/LuaJIT-${luajit_branch#v}"
    make -s -C "$src" MACOSX_DEPLOYMENT_TARGET=15.0 >/dev/null
    cp "$src/src/libluajit.a" "$out/lib/libluajit.a"
    cc -dynamiclib -install_name "@rpath/libluajit.dylib" -o "$out/lib/libluajit.dylib" \
        -Wl,-all_load "$src/src/libluajit.a"
    link_hosts luajit luajit "-I$src/src"
}

link_hosts() {
    flavor=$1
    library=$2
    includes=$3
    cc -O2 $includes -o "$out/bin/host-$flavor-dynamic" "$here/host.c" -L"$out/lib" -l"$library" -Wl,-rpath,"$out/lib"
    cc -O2 $includes -o "$out/bin/host-$flavor-static" "$here/host.c" "$out/lib/lib$library.a" -Wl,-exported_symbol,_main
    cp "$out/bin/host-$flavor-static" "$out/bin/host-$flavor-stripped"
    strip "$out/bin/host-$flavor-stripped"
    codesign -s - -f "$out/bin/host-$flavor-stripped" 2>/dev/null
}

for version in $puc_versions; do
    fetch "https://www.lua.org/ftp/lua-$version.tar.gz" "lua-$version.tar.gz"
    build_puc "$version"
done
fetch "https://github.com/LuaJIT/LuaJIT/archive/refs/heads/$luajit_branch.tar.gz" "luajit-$luajit_branch.tar.gz"
build_luajit

ls "$out/bin"
