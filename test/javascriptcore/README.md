# JavaScriptCore test harness

`target.m` makes these JavaScriptCore contexts:

- `plain`, made with `JSGlobalContextCreate`, and `sibling`, made in the same
  group, so the two share a VM. A timer evaluates a `JSScriptRef` in
  `sibling` every 500 ms.
- `objc`, a `JSContext` on the main thread with a `nativeAdd` block, a
  `marker` global and `waitLater()`, whose promise a timer resolves to
  `marker * 7` within 250 ms.
- `worker`, a `JSContext` on a thread of its own that calls `tick()` every
  5 ms, which spends most of its time in `busy()` and `Math.sqrt`.
- A context named `short-lived`, made and destroyed every second on another
  thread.
- Given `web`, a legacy `WebView` showing a page titled `Luma test page`, at
  `https://luma.test/page.html`, that sets `pageMarker` to 42.

Build it outside the repository:

```sh
clang -fobjc-arc -Wno-deprecated-declarations -o /tmp/jsc-target test/javascriptcore/target.m \
    -framework JavaScriptCore -framework WebKit -framework Foundation -framework AppKit
```

`harness.ts` loads the instrument with a fake `ctx` that keeps every table's
rows, every histogram's buckets, every console's entries and the contexts'
pages, and a fake `respond.file` that keeps what is offered. `dispose`
reports whether the hooked JavaScriptCore functions are back to their
original bytes. It is checked against the typings Luma would write:

```sh
python3 test/generate-typings.py ~/src/luma javascriptcore test/javascriptcore/instrument-typings.d.ts
```

Run `run.py` with the Python that has the `frida` module. It spawns the
target, or attaches to a pid, and takes steps:

| Step | Does |
| --- | --- |
| `wait=S` | Waits `S` seconds |
| `state` | Prints every widget and page |
| `act=WIDGET,ACTION[,ITEM[,CHILD]]` | Chooses an action, of a context's page when `CHILD` is given |
| `input=CHILD\|TEXT` | Submits `TEXT` in the console of context `CHILD` |
| `configure=JSON` | Changes the settings |
| `dispose` | Removes the instrument |

```sh
python3 test/javascriptcore/run.py "/tmp/jsc-target web" wait=3 state \
    act=contexts,show,3 'input=3|nativeAdd(2, 40)' 'input=3|waitLater()' \
    act=vms,heap,2 act=vms,profile,4 wait=2 act=vms,unprofile,4 \
    act=contexts,inspect,3 act=scripts,export,1 wait=1 state dispose
```

The contexts are numbered as the scan finds them: with `web`, 1 and 2 are
`plain` and `sibling`, 3 is `objc`, 4 is the page's window and 5 is
`worker`, in VMs 1 to 4; without it, `worker` is 4, in VM 3. Contexts made
after the scan, the short-lived ones, come after.
