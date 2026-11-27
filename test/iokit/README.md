# IOKit test harness

`target.c` opens a connection to IOSurfaceRoot before anything attaches,
then every second creates and locks an IOSurface, calls four selectors that do
not exist on its connection, through `IOConnectCallMethod` with a 300-byte
struct, `IOConnectCallAsyncScalarMethod`, `IOConnectCallScalarMethod` and
`IOConnectCallStructMethod`, each of which must be shown once, reads `IOPlatformUUID`, `model` and every property of
IOPlatformExpertDevice, looks up `IOService:/` and the USB host devices, and
every third second opens, maps and closes a connection of its own. Given a
number, it also makes that many calls in a burst each second and prints how
long they took.

`harness.ts` loads the instrument into it with a fake `ctx` that prints every
event and widget call. The first line of the log must say it found two
connections the process already held, IOSurface's own and the target's, both
`IOSurfaceRootUserClient` on `IOSurfaceRoot`. Through the explorer it lists `:help`, finds and opens
IOSurfaceRoot, probes selectors 0 to 40, calls one, walks the registry up and
down, reads a property, lists the connections, replays calls #1 and #2 of the log (the
second must be refused, as its struct was kept in part) and closes what it
opened. It shows log entry #3, chooses **Properties**, **Open** and **Rescan**
in the services table, chooses **Clear** on every widget after 5 seconds,
narrows the settings halfway through to IOSurface,
with backtraces, 8 data bytes and one call shown per second, so that the
console says how many were only counted, and disposes the instrument after 12
seconds. Nothing may be printed after `disposed`, and no event may exceed the
depth Luma shows.

`stress.ts` counts events instead of printing them, for a target started with
a burst size.

`luma.d.ts` is what Luma generates for the instrument's settings and widgets.
Build the target outside the repository, generate the typings, and run the
harness from the repository root:

```sh
clang -framework IOKit -framework IOSurface -framework CoreFoundation -o /tmp/iokit-target test/iokit/target.c
python3 test/generate-typings.py ~/src/luma iokit test/iokit/luma.d.ts
/tmp/iokit-target &
sleep 1
frida -p $! -l test/iokit/harness.ts -q -t 14
```

For the stress run, start the target as `/tmp/iokit-target 2000`, note how long
its bursts take, then load `test/iokit/stress.ts` and compare.
