#!/bin/sh

here=$(cd "$(dirname "$0")" && pwd)
targets="$1"
apps="$2"
python=${PYTHON:-python3}
failures=0

run() {
    log=$1
    shift
    if ! "$python" "$here/run.py" "$@" > "$log.log" 2>&1; then
        failures=$((failures + 1))
    fi
    grep "^=== " "$log.log" || echo "=== $log: did not finish, see $log.log"
}

for version in v1 0.81.4 0.76.9 0.72.17; do
    run "hermes-$version" host "$targets/bin/hermes-host-$version" "$targets/bin/bundle-$version.hbc" bytecode exports
done
run hermes-plain host "$targets/bin/hermes-host-v1" "$here/bundle.js" plain exports
run hermes-churn churn "$targets/bin/hermes-host-v1" "$targets/bin/bundle-v1.hbc"
run jsc host "$targets/bin/jsc-host" "$here/bundle.js" plain exports
run jsc-stripped host "$targets/bin/jsc-host-stripped" "$here/bundle.js" plain "type names"
if [ -n "$apps" ]; then
    run app-old app "$apps/old-architecture.app/Contents/MacOS/RNSpyApp" old
    run app-new app "$apps/new-architecture.app/Contents/MacOS/RNSpyApp" new
fi

exit $failures
