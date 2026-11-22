# Trainer test harness

`game.c` is a stand-in for a game. It keeps its health three ways: as a
32-bit integer in a global, as a float in a heap-allocated struct, and as a
double on the main thread's stack, plus eight copies of 4242 in a global
array. `SIGUSR1` takes a hit of 13 off all three; `SIGUSR2` starts a new
thread that takes 1 off each of them 5000 times. After each, it writes what
it would show on screen to `game_status`, and calls `game_status_changed`.

`harness.ts` loads the instrument into it with a fake `ctx` that prints every
widget call and keeps the tables, then plays a session: it scans for the
health it reads off `game_status`, signals hits and narrows by the new value,
by `dec 13`, `same` and `-`, and checks that the three known addresses are
still listed. It writes new values with `set` and checks the game took its
next hit from them, then tries `undo` and the table actions. It locks the
integer and the float, has the poison thread hammer them, and checks that both
held, that the poison loop and the hit are reported as writers, and that
unlocking lets them change again. Last, it checks that a fifth lock is
refused and that `reset` frees the watchpoints. It prints `PASS` at the end,
or `FAIL:` and what did not hold.

Build the target outside the repository, linked against CoreFoundation so
that Frida can name the functions that write locked values, generate the typings the app would
write, and run the harness from the repository root:

```sh
clang -O1 -g -framework CoreFoundation -o /tmp/trainer-game test/trainer/game.c
python3 test/trainer/generate-typings.py ~/src/luma trainer test/trainer/luma.d.ts
/tmp/trainer-game &
frida -p $! -l test/trainer/harness.ts -q -t 30
kill %1
```

`unload.ts` locks the game's integer health and then lets the script unload
without disposing the instrument, as when Luma loses the process. Once
`frida` has exited, `kill -USR2` the game: it must survive, and its integer
health must change again.

`large.ts` runs a first scan, a few narrowing steps, a stopped scan, a scan
for 0 and scans for every type and for unaligned values in a process of your
choosing, printing how long each took. `bench.ts` times `Memory.findPointers`
against `Memory.scanSync` for an aligned 32-bit value over the memory the
instrument scans:

```sh
frida -p <pid> -l test/trainer/large.ts -q -t 300
frida -p <pid> -l test/trainer/bench.ts -q -t 60
```
