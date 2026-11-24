# GStreamer test harness

`target.c` makes these top-level bins before the harness attaches, prints
`ready`, and runs a main loop:

| Bin | Type | State | Exercises |
| --- | --- | --- | --- |
| `tee-pipeline` | `GstPipeline` | playing | `gst_parse_launch`, a tee feeding two queues, caps long enough that the verbose graph shows more than the default one |
| `nested-pipeline` | `GstPipeline` | playing | `filter-bin` inside it and `inner-bin` inside that, each with ghost pads |
| `app-pipeline` | `TestAppPipeline` | paused | a `GstPipeline` subclass the target defines, holding `spare-bin`, which must never be listed |
| `lonely-bin` | `GstBin` | null | a top-level bin that is not a pipeline |
| `adopted-bin` | `GstBin` | null | a bin with no parent yet, added to `late-pipeline` after attach |
| `freed-pipeline` | `GstPipeline` | — | played, stopped and freed before attach: must not be listed |

On `SIGUSR1` it adds `adopted-bin` to a new `late-pipeline` and plays it,
then removes `spare-bin` from `app-pipeline`, sets it to null and releases
it, the usual teardown of a sub-bin, and releases `app-pipeline`. On
`SIGUSR2` it stops and releases every bin it still holds, and exits with 0 only
if every bin it made was finalized. It exports `gstreamer_expectations`, a JSON
list of each bin's name, type, kind, state, element count, how it should be
found, the element names its graph must show, and whether it should be listed
before the signal, after it, both or never.

`harness.ts` loads the instrument with a fake `ctx` that records every widget
call, and checks that:

- the scan lists exactly the expected bins, with their names, types, kinds,
  states, recursive element counts, addresses as row ids and "memory scan" as
  how they were found, and again after **Rescan memory** in the `pipelines`
  table's header, which is disabled during each scan and enabled after it;
- a pipeline's graph is shown without asking;
- **Show** on each row sends that bin's graph, with a `digraph` payload naming
  each of its elements;
- each detail level sends a graph with that `details`: states leaves the caps
  out, the default shows them cut short, and verbose shows them in full;
- an unchanging graph is not sent again while the refresh timer runs;
- after `SIGUSR1`, `late-pipeline` is listed as found by a state change, the
  rows of `app-pipeline` and of `adopted-bin`, which now has a parent, are
  gone, `spare-bin` was never listed, and the view, which was showing
  `app-pipeline`, went on to `late-pipeline` without being cleared;
- after `dispose()` no widget call is made and `gst_element_set_state` is back
  to its original bytes.

`run.py` starts the target, attaches, runs the harness, detaches, sends
`SIGUSR2`, and exits non-zero if a check failed or the target could not
finalize its bins. It writes the graphs the instrument sent as `.dot` files
into the output directory.

Luma compiles instruments against its own frida-gum typings. Link them into
the repository (`node_modules` is ignored), generate the typings the app
would write, and build the target outside the repository:

```sh
mkdir -p node_modules/@types
ln -s ~/src/luma/Agent/node_modules/@types/frida-gum node_modules/@types/frida-gum
python3 test/xpc-spy/generate-typings.py ~/src/luma gstreamer test/gstreamer/luma.d.ts
clang -o /tmp/gstreamer-target test/gstreamer/target.c $(pkg-config --cflags --libs gstreamer-1.0)
```

Then, from the repository root, with the Python that has the `frida` module:

```sh
python3 test/gstreamer/run.py /tmp/gstreamer-target /tmp/gstreamer-dots
```

To look at another process instead, give its pid and how many seconds to wait
after the scan; every bin found is shown at the default and verbose detail,
and its graphs saved:

```sh
gst-launch-1.0 videotestsrc ! tee name=t ! queue ! videoconvert ! fakesink t. ! queue ! fakesink &
python3 test/gstreamer/run.py --pid $! /tmp/gstreamer-dots/tee 2
gst-launch-1.0 audiotestsrc is-live=true ! wavenc ! decodebin ! audioconvert ! fakesink sync=true &
python3 test/gstreamer/run.py --pid $! /tmp/gstreamer-dots/decodebin 2
```

The target uses `g_unix_signal_add`, so it runs on macOS and Linux; it was run
on macOS arm64 with GStreamer 1.28.8 from Homebrew.

## The view

`view/` checks the Smalltalk of the Graph view in Luma's own image.
`view/check.sh [output-dir]` builds `view/harness/`, a Swift package that
depends on `../luma`, a checkout of Luma beside this repository with its
Pharo image staged as `make check-examples` needs. Every run builds into the
same directory, `$PIPELINE_GRAPH_CHECK_BUILD`, or
`$TMPDIR/pipeline-graph-check-build` when that is not set, so repeated runs
share one build of Luma, about 4 GB, rather than making one per output
directory. It boots the image without a window and installs `gstreamer/*.st`
with the code Luma uses for an instrument's files, so a load Luma would refuse
prints `REFUSED`. It then feeds every dot in `view/fixtures/` to `state:data:`
through Luma's own view context, answering its requests to the host itself, and
checks:

- the elements, bins, pads and links read against `view/expect.py`'s
  independent reading of the same file;
- the layout: no sibling boxes overlap, every pad is on its element, every
  link ends on a pad's edge, no link runs through a box other than its ends'
  elements and the bins holding them, and hit-testing answers the right
  object for each element, pad and link; it prints how many caps labels
  overlap each other and how many links pass behind a label;
- that the view declares one view, the canvas, with no state and with each
  fixture;
- pan, zoom, fit and clicks replayed on `playbin3`, each click reaching the
  host as a `spawn:` whose object answers its own views: an element, a pad, a
  link, a bin, the outermost bin and the caption line, which both open the
  pipeline with its Elements, Links and Dot views, and empty canvas, which
  opens nothing;
- that a change of state alone keeps the layout.

It draws the canvas offscreen with Metal, in light and dark appearance, into
`<output-dir>/png`, prints how long `state:data:` took for each fixture, and
exits non-zero on any mismatch or error. Look at the pictures: a blank or
mirrored frame is not something the checks see.

`view/dump.py "<gst-launch description>" <prefix> <seconds>` makes fixtures
at the three detail levels with GStreamer's Python bindings.
