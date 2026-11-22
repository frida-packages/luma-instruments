#!/bin/sh

here=$(cd "$(dirname "$0")" && pwd)
bin="$1/bin"
python=${PYTHON:-python3}
failures=0

expectation() {
    if [ "$1-$2" = luajit-stripped ]; then
        echo refuses
    else
        echo runs
    fi
}

run() {
    if ! "$python" "$here/run.py" "$bin/$1" "$2" > "$1.$2.log" 2>&1; then
        failures=$((failures + 1))
    fi
    grep "^=== " "$1.$2.log" || echo "=== $1: did not finish, see $1.$2.log"
}

for flavor in 5.1 5.2 5.3 5.4 luajit; do
    for style in dynamic static stripped; do
        run "host-$flavor-$style" "$(expectation "$flavor" "$style")"
    done
done
run host-5.4-dynamic lifecycle
run host-5.1-static lifecycle

exit $failures
