#!/bin/bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
luma=$(cd "$repo/../luma" && pwd)
out=${1:-$(mktemp -d -t pipeline-graph-check)}
build=${PIPELINE_GRAPH_CHECK_BUILD:-${TMPDIR:-/tmp}/pipeline-graph-check-build}
log="$out/harness.log"
failures=0

mkdir -p "$out"
"$luma/Scripts/in-build-environment.sh" swift build --disable-sandbox \
    --package-path "$here/harness" --scratch-path "$build" > "$out/build.log" 2>&1 || {
    tail -20 "$out/build.log"
    exit 1
}
harness="$build/debug/PipelineGraphCheck"
fixtures=("$here"/fixtures/*.dot)
ordered=()
for each in "${fixtures[@]}"; do
    [[ "$each" == */playbin3-playing-verbose.dot ]] || ordered+=("$each")
done
ordered+=("$here/fixtures/playbin3-playing-verbose.dot")

CLICK="vqueue (GstQueue);audiotee.src_0;audiotee.src_0 → streamsynchronizer0.sink_1;abin (GstBin);playbin3-0 (GstPlayBin3)" \
FOCUS="urisourcebin0@1.0;playsink@0.6" \
    "$harness" "$repo/gstreamer" "$here/harness/GstCheck.class.st" "$out/png" "${ordered[@]}" > "$log" 2>&1

for each in "${ordered[@]}"; do
    name=$(basename "$each" .dot)
    python3 -I "$here/expect.py" "$each" > "$out/$name.expected"
    awk -v heading="== $name " 'index($0, heading) == 1 { on = 1; next } /^== / { on = 0 } on && (/^elements / || /^link /)' "$log" \
        | sed 's/ layout [0-9]*$//' > "$out/$name.read"
    overlaps=$(awk -v heading="== $name " 'index($0, heading) == 1 { on = 1; next } /^== / { on = 0 } on && /^overlaps: /' "$log")
    if diff -q "$out/$name.expected" "$out/$name.read" > /dev/null; then
        echo "read as expected: $name: $(head -1 "$out/$name.expected"); $overlaps"
    else
        echo "READ DIFFERS: $name"
        diff "$out/$name.expected" "$out/$name.read" | head -10
        failures=$((failures + 1))
    fi
done

SAME_ID=1 "$harness" "$repo/gstreamer" "$here/harness/GstCheck.class.st" "$out/png-refresh" \
    "$here/fixtures/tee-playing.dot" "$here/fixtures/tee-paused.dot" > "$out/refresh.log" 2>&1
layouts=$(grep -o 'links [0-9]* layout [0-9]*' "$out/refresh.log" | awk '{ print $4 }' | sort -u | wc -l | tr -d ' ')
if [[ "$layouts" == 1 ]]; then
    echo "a state change alone kept the layout"
else
    echo "A STATE CHANGE ALONE MADE A NEW LAYOUT"
    failures=$((failures + 1))
fi

if grep -q '^  view 2 ' "$log"; then
    echo "THE VIEW DECLARES MORE THAN ONE VIEW"
    failures=$((failures + 1))
fi

problems=$(grep -E 'ERROR|REFUSED|siblings overlap|runs through|outside|away from|does not|no point|picking|DREW NOTHING|pipeline failed' "$log" "$out/refresh.log" || true)
if [[ -n "$problems" ]]; then
    echo "$problems"
    failures=$((failures + 1))
fi
grep -E "^(loaded|geometry|clicked|\(that was|spawned|  [a-zA-Z]+ '|host requests)" "$log"
paste -d ' ' <(grep '^== ' "$log" | grep -v steering | grep -v clear) <(grep '^state:data' "$log" | awk 'NR % 2 == 1') <(grep '^state:data' "$log" | awk 'NR % 2 == 0')
echo "pictures in $out/png"
exit "$failures"
