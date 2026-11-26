# React Native test harness

`jsi-host.cpp` embeds JSI runtimes, one per argument, each on a thread of its
own that runs a Core Foundation run loop, as React Native's JavaScript thread
does. Built against a Hermes framework it makes `HermesRuntime`s; built with
`-DJSI_HOST_JSC` and React Native's `JSCRuntime.cpp` it makes JavaScriptCore
runtimes. Each loads the bundle given first (`bundle.js`, or Hermes bytecode
compiled from it) and installs two host functions, `nativeReport` and
`nativeAdd`. The runtimes loop in one of these ways:

- `name:timer` calls the bundle's `tick` from the run loop every 20 ms
- `name:quiet` calls it every 4 s
- `name:idle` never calls it, on a thread named
  `com.facebook.react.JavaScript`
- `name:churn` calls it 250 times, destroys the runtime and makes a new one

`tick` counts and prints when the global `marker` changes; the host prints
`CORRUPT` when `tick` does not return the count it expects.

`build-targets.sh` downloads Hermes from React Native 0.72.17, 0.76.9 and
0.81.4 and Hermes V1 from Maven Central, and React Native 0.81.6's JSI and
JavaScriptCore sources from npm, and builds a host for each Hermes with its
bytecode bundle, and a JavaScriptCore host with everything hidden, once with
its symbol table and once stripped (`jsc-host-stripped` exports nothing but
`__mh_execute_header`, so its runtimes can only be found by their type
names). Build outside the repository:

```sh
test/react-native/build-targets.sh /tmp/react-native-targets
```

`build-apps.sh` makes a React Native 0.81.6 app with React Native for macOS
0.81.9, its JavaScript replaced by `app/App.tsx`, and builds it twice in
Release, on the old and on the new architecture. The app shows no window and
never becomes active (`app/main.m`, `app/AppDelegate.mm`, `LSBackgroundOnly`).
Every 500 ms it fetches `http://127.0.0.1:8765/tick`, which `run.py` serves,
and reads a few native modules. It needs Node, Xcode and Ruby, and installs
CocoaPods into the output folder; it uses several GB while building:

```sh
test/react-native/build-apps.sh /tmp/react-native-apps
```

`harness.ts` loads the instrument with a fake `ctx` that keeps every table's
rows, every console's entries and the runtimes' pages, and a fake
`respond.file` that hashes what is offered. It is checked against the typings
Luma would write:

```sh
python3 test/generate-typings.py ~/src/luma react-native test/react-native/luma.d.ts
```

`run.py host <host> <bundle> <bytecode|plain> [route]` runs a host with a
timer, a quiet and an idle runtime. It checks that **Scan** is disabled while
the first scan runs, that **Stop Scan** ends a scan and the status says so,
that the slots found from a framework's exported anchors
equal those found from the vtable's shape and those found through the type
name, and, given a route, that the runtimes were found that way. It finds
the three runtimes, reads `hostName` in each, sets a global the host's own
`tick` then reports, reads objects, captures `console.log`, calls a host
function, gets thrown and syntax errors back, values JSON cannot carry, and
non-ASCII text; it checks that the quiet runtime and the idle one, whose
thread is presumed from its name, answer within a second through their run
loops, that a promise's value arrives when it settles, that **Clear** empties
one console, that **Show** shows each page, that Hermes bytecode found in
memory is offered byte for byte (or that a plain bundle in no file is refused
with a reason), and runs 300 evaluations. After disposing, the code of the
host and of the engine must be back to what it was, and the host still
running with nothing corrupt.

`run.py churn <host> <bundle>` checks that a destroyed runtime's page is
badged destroyed and that a runtime made later is found by **Scan** and
answers.

`run.py app <app binary> <old|new>` runs one of the apps and checks what its
runtime says about itself (React Native, the architecture, Fabric, a
production bundle, React Native 0.81, `main.jsbundle`), reads and sets the
app's own globals, and checks the traffic: `fetch` as `Networking.sendRequest`
with its URL, events to JavaScript, a synchronous call's result and an
asynchronous call's outcome, that the module table lists view managers, that
**Show** puts a call in the Call console, that **Export Bundle** offers
`main.jsbundle` byte for byte, that after disposing a second instance finds
the bridge's message queue or the device event emitter and the `Networking`
module unwrapped, and that the app goes on fetching.

`run-all.sh` runs all of them, writing a log per run to the current
directory; the second argument, the apps' folder, is optional:

```sh
PYTHON=python3 test/react-native/run-all.sh /tmp/react-native-targets /tmp/react-native-apps
```

Given a process id, `run.py pid <pid> [JavaScript…]` prints what is found in
a running process and evaluates the given JavaScript in each runtime, and
`run.py summary <pid> <seconds>` evaluates `typeof globalThis` in each runtime, so that an idle one is reached, and prints only kinds and counts, for processes
whose traffic should not be printed.

Run from the repository root with a Python that has the `frida` module
17.25.0 or later; `Memory.findPointers` is needed.
