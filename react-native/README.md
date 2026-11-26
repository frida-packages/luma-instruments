# React Native

Finds the JavaScript runtimes a React Native app runs, gives you a console
into each of them, and shows the calls between JavaScript and native as they
happen: native module and TurboModule calls with their arguments and results,
calls native code makes into JavaScript, and the events it emits. It lists the
app's native modules and its bundles, and exports any bundle as a file.

It works with Hermes, from the Hermes that shipped with React Native 0.72 to
Hermes V1, and with JavaScriptCore as React Native uses it, on the old
architecture (the bridge, with or without TurboModules) and the new one
(bridgeless, with Fabric).

## Finding the runtimes

A React Native runtime is a `jsi::Runtime`: Hermes's `HermesRuntimeImpl`,
React Native's `JSCRuntime` over JavaScriptCore, or `V8Runtime`. They are
found by their C++ type information, which survives stripping: the class's
type name leads to its type info, the type info to its vtable, and the vtable
to the objects in the heap that point at it. The JSI functions the instrument
calls are located in `jsi::Runtime`'s own vtable, either from the symbols a
framework exports, as Hermes's does, or, in a stripped binary, from the
vtable's shape alone: the first pure virtual slot is `evaluateJavaScript`,
and the others are counted from the first slot JSI implements itself. The
status line says which way each was found.

A scan reads memory only as copies the kernel makes, so memory the app lets
go of while the scan runs is skipped instead of touched. That matters in apps
with a crash reporter of their own, such as Microsoft Office's: such a
reporter sees the fault before Frida can catch it, and hangs or ends the app.
A pointer to a runtime's vtable counts as a runtime only when it starts a
live heap block, and each time the instrument is about to evaluate in a
runtime it checks again that the runtime is still there; one that is not is
badged destroyed.

A runtime is used only on its own thread. That thread is learned the first
time it calls into its runtime, while the instrument watches for a few
seconds after it starts and after **Scan**, or whenever something waits for
that runtime. An app whose JavaScript thread is idle, and that has a single
runtime on a thread with React Native's name for it, has that thread presumed;
the runtime's page says so.

## The page

A status line says what the last scan found. **Runtimes** has a row per
runtime: its engine and version (for Hermes, its release and bytecode
version), React Native's version, the architecture, whether the bundle is a
production or a development one, the bundle's name, the thread and the
status. **Show** opens the runtime's page; **Export Bundle** offers its
bundle. **Scan** looks again and **Stop Scan** ends a scan early; a scan also
ends by itself after a minute and keeps what it found. Under the status line
are how much memory the scan searched, how much it skipped because the app had
let go of it, how many pointers it skipped because they were not at the start
of a live object, and why it stopped early, if it did.

**Bundles** lists the bundles found: files mapped into the process whose
names end in `.jsbundle`, `.bundle` or `.hbc`, the file a runtime says it
loaded, and Hermes bytecode lying in memory. Each says whether it is
JavaScript or Hermes bytecode, with the bytecode version, its size and which
runtime loaded it. **Export** offers it as a file, read straight from the file
or from memory; a bundle larger than 64 MiB cannot be offered.

**Traffic** has a row per call: when, in which runtime, its direction
(JavaScript to native, native to JavaScript, or an event), the module, the
method, its arguments, and its outcome when it has one: returned, resolved,
rejected, called back or threw, with how long it took. **Show** prints the
call in full in the **Call** console beside it, as a value you can expand;
`show 1:42` there does the same by row id, and `stats` counts what was seen.
**Clear** empties the table.

**Modules** lists the app's native modules, TurboModules, view managers and
Fabric component views, as their classes register them, with how many
methods each exports and how many calls were seen.

On a wide window the runtimes and bundles share a row, and so do the traffic
and the call console; on a phone everything is one column.

## The consoles

Each runtime has a page of its own in the sidebar, with its engine, React
Native version, architecture and thread beside its name, and a badge: seen,
not seen yet, thread presumed, how many evaluations wait, cannot evaluate, or
destroyed. JavaScript typed there is evaluated in the app's global scope, on
the runtime's own thread, at the top of that thread's run loop, where React
Native runs its own work. Globals you set are the app's own. The value of the
last expression comes back as a value you can expand, to four levels;
`console.log` and its siblings are captured while it runs; errors come back
with their stack; a promise is reported when it settles. **Export Bundle**
offers this runtime's bundle; **Clear** empties the console.

| Directive | Does |
| --- | --- |
| `:list` | Lists the runtimes, this one marked with ● |
| `:facts` | Shows what the runtime says about itself |
| `:cancel` | Drops what is waiting for this runtime |
| `:scan` | Looks through memory for runtimes again |
| `:help` | Says all this |

## How the calls are watched

The instrument puts a small helper into each runtime, kept on a hidden
global. On the old architecture it wraps the bridge's message queue, so every
call JavaScript makes to native, every call native makes into JavaScript,
events included, and every callback is seen; the module and method names
come from the bridge's own tables. On both architectures it wraps the methods
of the native modules the app has already loaded, so TurboModule calls are
seen with their results, and on the new architecture it wraps React Native's
device event emitter. The helper buffers what it sees and the instrument
collects it a few times a second. Removing the instrument puts every wrapped
method back.

`fetch` and `XMLHttpRequest` go through the `Networking` module, so requests
show as `Networking.sendRequest` with their URL, method and headers, and
responses as `didReceiveNetworkResponse`, `didReceiveNetworkData` and
`didCompleteNetworkResponse` events.

## Settings

- **Capture calls between JavaScript and native**: off, nothing is wrapped.
- **Also watch native modules the app has not loaded yet**: loads them to
  wrap them. Loading a module the app was not going to use runs its setup,
  which can block on the main thread or crash; it is off by default.
- **Only show calls whose module or method matches**: a regular expression
  over `Module.method`.
- **Bytes kept of each call's arguments and of its result**: longer ones are
  cut.
- **Calls each runtime holds between updates**: the oldest go first, and
  `stats` counts them.

## Limits

- The traffic of methods called through a reference taken before the
  instrument wrapped them is not seen, such as React Native's own renderer
  calling Fabric's UI manager; on the old architecture those calls are still
  seen on the bridge.
- Which native modules are loaded, the module table and the bridge's names
  come from the Objective-C runtime, so they are Apple-only.
- A runtime whose thread never calls into JSI and has no run loop cannot be
  reached; one that is idle on a run loop is woken.
- Only 64-bit processes are handled, and it is offered on arm64 only: the
  x86-64 calling path is written but has not been run.

## What it does not cover

- V8 runtimes are recognized but have not been tried.
- Android, iOS and Windows have not been tried; see below.
- Fabric's UI operations and the inspector protocol.

## Where it was run

Everything above was run on macOS 27 on Apple Silicon, with programs that
embed Hermes from React Native 0.72, 0.76 and 0.81 and Hermes V1 (with Hermes
bytecode and with plain JavaScript), a program that links React Native's
`JSCRuntime` statically and is stripped of all symbols, React Native for
macOS 0.81 release builds on the old and the new architecture, and Microsoft
Outlook for Mac, whose React Native for macOS runs on JavaScriptCore.

On iOS the instrument is expected to behave as on macOS, since the
frameworks, the Objective-C runtime and the run loops are the same. It is
offered on Apple platforms only.
