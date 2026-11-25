#!/bin/sh

here=$(cd "$(dirname "$0")" && pwd)
apps="$1/apps"
python=${PYTHON:-python3}
status=0

for app in "$apps"/Fixture-*.app; do
    name=$(basename "$app" .app)
    scenarios=main
    case $name in
        Fixture-34.*-asar) scenarios= ;;
        *-asar) scenarios="main processes flood spawn" ;;
    esac
    for scenario in $scenarios; do
        "$python" "$here/run.py" "$app" "$scenario" > "$name-$scenario.log" 2>&1 || status=1
        tail -n 1 "$name-$scenario.log"
    done
done

exit $status
