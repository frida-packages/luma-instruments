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
held, that the poison loop and the hit are reported as writers, that
**Clear** empties the writers and the next writes are counted from zero, and
that unlocking lets them change again. It then clears the console. Last, it
checks that a fifth lock is refused and that `reset` frees the watchpoints. It
prints `PASS` at the end, or `FAIL:` and what did not hold.

Build the target outside the repository, linked against CoreFoundation so
that Frida can name the functions that write locked values, generate the typings the app would
write, and run the harness from the repository root:

```sh
clang -O1 -g -framework CoreFoundation -o /tmp/trainer-game test/trainer/game.c
python3 test/generate-typings.py ~/src/luma trainer test/trainer/luma.d.ts
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

`store-forms.c` is a target whose thread, on command, runs one of fifteen
stores at a locked 32-bit value: plain, wider than the value, byte and
halfword, unscaled, floating-point and vector, pre- and post-indexed, store
pairs, register offset, release, and an atomic swap. `store-forms.ts` locks
the value through the instrument's locks and runs each, checking that the
locked bytes held, that the bytes beside them and the base register came out
as the instruction would leave them, and that each write was counted once,
against the store, and as undone. The swap takes the path that lets the write
happen and puts the value back:

```sh
clang -O1 -o /tmp/store-forms test/trainer/store-forms.c
/tmp/store-forms &
frida -p $! -l test/trainer/store-forms.ts -q -t 20
```

`poison-count.ts` locks the integer and the float, sets off the poison thread
thirty times, and after each checks that both locks counted exactly 5000
writes from the poison loop. Run it in a fresh game each time, `-t 400`.

