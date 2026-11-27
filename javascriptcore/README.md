# JavaScriptCore

Finds every JavaScriptCore context in an Apple app: the `JSContext`s and
`JSGlobalContextRef`s the app makes itself, and the windows of web pages it
shows with WebKit's legacy `WebView`. It gives you a console into each, opens
any of them to Safari's Web Inspector, samples what their VMs are running,
counts what their heaps hold, and logs the scripts the app hands to
JavaScriptCore, which you can export as files.

## Finding the contexts

Every global object JavaScriptCore makes has a companion object for remote
inspection, and that object points back to its global object. The instrument
finds the companions by their vtable, which it looks up in the shared cache's
symbols, by searching the heap that WebKit's allocator and `malloc` manage. It
reads memory only as copies the kernel makes, so memory the app lets go of
while it searches is skipped instead of touched. From then on it watches
global objects being made and destroyed, so contexts made later are listed as
they are made, and destroyed ones are badged so.

Each global object's class is read from its structure. The class says what
the context is:

| Kind | Classes | Evaluated on |
| --- | --- | --- |
| JSContext | `JSAPIGlobalObject`, `JSGlobalObject`, `CallbackGlobalObject` | a background thread, holding the VM's lock, as JavaScriptCore's API allows |
| Window | a web page's `Window` | the main thread |
| Worker | a worker's or worklet's global scope | not evaluated |
| Other | anything else, such as a shadow realm | not evaluated |

Where the class cannot be read, a context counts as a JSContext in a process
without WebCore, and as Other in one with it.

## The page

A status line says how many contexts are live in how many VMs, and what the last
scan searched. **Contexts** has a row per context: its kind, the name the app
gave it, its class, its VM, where it is evaluated, whether Web Inspector may
attach, and whether it is live, made since the instrument started, or destroyed.
The last eight destroyed contexts are kept. Double-clicking a row, or selecting
it and pressing Return, opens its page; **Allow Web Inspector** and **Disallow
Web Inspector** change whether Safari's Develop menu offers it; **Scan**
searches the heap again.

**VMs** has a row per VM: how many live contexts it has, its heap, the cells
in it, its global objects, and its profiler. **Heap Counts** counts the cells
in its heap by class into **Heap objects**; **Start Profiling** starts
JavaScriptCore's sampling profiler on it and **Stop Profiling** stops it.
While a VM is profiled, **Hot functions** counts its samples by the innermost
JavaScript function, as `name sourceID:line:column`, with the native function
it was in when it was in one; **Clear** starts the counts over. **Refresh**
reads every VM's heap again.

**Scripts** has a row per script the app evaluated through
`JSEvaluateScript` or `JSScriptEvaluate`, which `-[JSContext evaluateScript:]`
goes through too: when it first ran, in which context, its source URL, its
size and lines, how many times it ran, how its last run ended and how long it
took. The same source in the same context counts as one script. **Export**
offers its source as a file. **Clear** empties the table.

## The consoles

Each context's page has a console. JavaScript typed there is evaluated in the
context's global scope; globals you set are the app's own. The value of the
last expression comes back as a value you can expand, to four levels;
`console.log` and its siblings are captured while it runs; errors come back
with their stack; a promise is reported when it settles. A context's page
shows its name, class and VM beside its title, and a badge: ready, evaluating,
how many promises are pending, not evaluated, or destroyed.

| Directive | Does |
| --- | --- |
| `:list` | Lists the contexts, this one marked with ● |
| `:facts` | Shows what the instrument knows of the context, and what it says about itself: its global's class, its page's location, title and user agent, and how many globals it has |
| `:help` | Says all this |

The console puts a small helper into a context the first time it evaluates
there, kept on a hidden global, and removes it when the instrument is
removed.

## Settings

- **Log the scripts the app evaluates**: off, nothing is logged.
- **Megabytes of script source kept for Export**: the oldest scripts' sources
  are let go of first, and those scripts can no longer be exported.

## Limits

- Only contexts reachable through JavaScriptCore's own framework are found; a
  copy of JavaScriptCore linked into the app, as some React Native apps ship
  it, is not looked at. The [React Native](../react-native) instrument covers
  those runtimes.
- Finding contexts made before the instrument started needs the shared
  cache's local symbols, which macOS has. Without them, only contexts made
  from then on are listed.
- Scripts the app evaluated before the instrument started, and scripts a web
  page loads, are not logged; scripts a `JSScriptRef` holds that was made
  before then are logged without their source.
- A JSContext is evaluated on a thread of the instrument's, not the thread the
  app uses it on, so native objects the app exported to it run on that thread
  too.
- Allowing Web Inspector only makes a context inspectable; Safari's Develop
  menu has to be turned on to see it.
- Web pages in WebKit's own processes, which `WKWebView` uses, are in those
  processes, not the app's.

## Where it was run

Everything above was run on macOS 27 on Apple Silicon, with a program that
makes JavaScriptCore contexts through the C API and through `JSContext`, on
the main thread and on a thread of its own, evaluates a `JSScriptRef` on a
timer, makes and destroys a context every second, and shows a page in a
`WebView`, and with a program that loads JavaScriptCore only after the
instrument has started. The programs were arm64; arm64e processes, such as
Apple's own apps, have not been tried.
