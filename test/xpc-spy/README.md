# XPC Spy test harness

`target.m` is a process that, every two seconds, sends plain messages,
async and sync requests over an in-process anonymous listener, makes fresh
connections and listeners (including an NSXPC one), reaches a missing mach
service to get an error event, and reads and writes a `UserDefaults` value.
`harness.ts` loads the instrument into it with a fake `ctx` that prints every
event and widget call, changes the settings halfway through, and disposes the
instrument after 16 seconds. `stress.ts` counts events instead of printing
them, for a target started with a burst size.

Build the target outside the repository, generate the typings the app would
write, and run the harness from the repository root:

```sh
clang -fobjc-arc -framework Foundation -o /tmp/xpc-spy-target test/xpc-spy/target.m
python3 test/xpc-spy/generate-typings.py ~/src/luma xpc-spy test/xpc-spy/luma.d.ts
/tmp/xpc-spy-target &
frida -p $! -l test/xpc-spy/harness.ts
```

For the stress run, start the target as `/tmp/xpc-spy-target 2000` and load
`test/xpc-spy/stress.ts`; the target prints how long each burst of 2000 sends
takes. Kill the target when done; `defaults delete re.frida.xpc-spy-test`
removes the value it writes.
