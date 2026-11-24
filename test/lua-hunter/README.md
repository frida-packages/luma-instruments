# Lua Hunter test harness

`host.c` embeds Lua and runs one interpreter per argument on a thread of its
own, each named and set to loop in one of these ways:

- `name:c` calls the script's `tick` from C with `lua_pcall` every 20 ms
- `name:lua` runs a Lua loop that calls `tick` and the host's `sleep_ms`
- `name:busy` calls `tick` from C as fast as it can and prints how often
- `name:idle` makes the interpreter and never runs it
- `name:churn` runs 50 ticks, closes the interpreter and makes a new one

`tick` counts, checks that its count has not been disturbed, and prints when
the global `marker` changes. The C side prints `CORRUPT` when it finds the
stack not as it left it. `LUA_HUNTER_BALLAST_MB` makes the host fill that much
memory with pointers first, for timing the memory search.

`build-targets.sh` downloads Lua 5.1.5, 5.2.4, 5.3.6, 5.4.7 and LuaJIT 2.1,
builds each as a static library and as a dylib, and links the host three
ways for each: against the dylib (`host-<lua>-dynamic`), statically with only
`main` exported (`host-<lua>-static`, symbols kept), and the same stripped
(`host-<lua>-stripped`). Build outside the repository:

```sh
test/lua-hunter/build-targets.sh /tmp/lua-hunter-targets
```

`harness.ts` loads the instrument with a fake `ctx` that prints every widget
call, and exposes the console, the table's actions and the console's **Clear**
over RPC. It is checked against the typings Luma would write into the
instrument's folder:

```sh
python3 test/xpc-spy/generate-typings.py ~/src/luma lua-hunter lua-hunter/luma.d.ts
```

`run.py` spawns a host with two interpreters, one looping in C and one in Lua,
and finds both. It checks that **Scan** was disabled during the sweep `create`
ran and enabled after, and that it is disabled during a sweep it starts and
enabled again once that ends. It reads, sets and checks a global in each
interpreter (the host's own script must report the change), runs chunks that
fail to compile, raise an error and return tables and several values, checks
that `print` is captured and given back, checks that **Clear** empties the
console and touches no other widget, then evaluates 300 chunks in each,
alternating, and checks every answer. After disposing it checks that the code
of the main program and of any Lua library is back to what it was, and that the
host is still running and reported nothing corrupt. Run it from the repository
root with the Python that has the `frida` module:

```sh
python3 test/lua-hunter/run.py /tmp/lua-hunter-targets/bin/host-5.4-stripped
python3 test/lua-hunter/run.py /tmp/lua-hunter-targets/bin/host-5.1-dynamic runs 1500
python3 test/lua-hunter/run.py /tmp/lua-hunter-targets/bin/host-luajit-stripped refuses
python3 test/lua-hunter/run.py /tmp/lua-hunter-targets/bin/host-5.4-dynamic lifecycle
```

`refuses` expects the interpreters to be found and code to be refused;
`lifecycle` runs a churning interpreter and expects the closed ones to be
shown as closed and the new ones to be found as they are made. `run-all.sh`
runs every host the way it should behave, writing a log per host to the
current directory:

```sh
PYTHON=python3 test/lua-hunter/run-all.sh /tmp/lua-hunter-targets
```

Given a pid instead of a host, `run.py` attaches to a running process, lists
what it finds and runs the given chunks in each interpreter:

```sh
sleep 100000 > /tmp/vlc.in &
/Applications/VLC.app/Contents/MacOS/VLC -I cli < /tmp/vlc.in &
python3 test/lua-hunter/run.py $(pgrep -f "VLC -I cli") "_VERSION" "vlc.misc.version()" "vlc.misc"
```

VLC's command line interface waits for input between commands, so its
interpreter only comes by when something is written to `/tmp/vlc.in`.

`overhead.py` starts a host with a busy and an idle interpreter and prints how
fast the busy one runs before the instrument is loaded, after, while a chunk
waits for the idle one, and after it is canceled:

```sh
python3 test/lua-hunter/overhead.py /tmp/lua-hunter-targets/bin/host-5.4-dynamic
```
