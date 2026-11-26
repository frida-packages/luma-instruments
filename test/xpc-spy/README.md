# XPC Spy test harness

`target.m` is a process that, every two seconds, sends plain messages,
async and sync requests over an in-process anonymous listener, makes fresh
connections and listeners (including an NSXPC one), reaches a missing mach
service to get an error event, and reads and writes a `UserDefaults` value.

Before its first tick it also sets up connections whose event handlers are
set only then, with block code no later connection uses: a standing listener,
a client of it, and the peer that listener accepts. The client sends the peer
a request that the peer holds and answers on tick 3, and pokes it on every
tick; the peer pushes a note back each time. On ticks 1, 5, 9 and so on a
visitor connects to the standing listener, which serves it with the ordinary
peer handler. The fresh connections, the first new NSXPC one among them, are
made on ticks 3, 7, 11 and so on, so on ticks 1 and 2 what the standing
connections and the NSXPC listener's peer receive is seen only if the
instrument found them when it started.

`harness.ts` loads the instrument into it with a fake `ctx` that prints how
long creating the instrument took and every event and widget call, the first
of which says how many connections and requests awaiting a reply it found. It
shows message 3, chooses **Clear** on both widgets after 5 seconds and asks
for message 3 again, which must then be refused, changes the settings halfway
through, down to one message shown per second, so that the rest of each tick
is only counted and the console says how many, and disposes the instrument
after 16 seconds. `stress.ts` counts
events instead of printing them, for a target started with a burst size.
`restart.ts` creates the instrument, disposes it after 4 seconds and creates
it again in the same script, as Luma does when an instrument is loaded again,
and prints how long each creation took, what each found, and how many events
each run emitted, which must be none after the run was disposed.

`probe.ts` has the instrument learn libxpc's layout and checks that the
connections and the request it made to learn it are gone afterwards: no
connection or request awaiting a reply is left that was not there before.

`luma.d.ts` is what Luma generates for the instrument's settings and widgets.
Build the target outside the repository, generate the typings, and run the
harness from the repository root, giving the target a moment to set up its
connections first:

```sh
clang -fobjc-arc -framework Foundation -o /tmp/xpc-spy-target test/xpc-spy/target.m
python3 test/generate-typings.py ~/src/luma xpc-spy test/xpc-spy/luma.d.ts
/tmp/xpc-spy-target &
sleep 1
frida -p $! -l test/xpc-spy/harness.ts
```

Load `restart.ts` and `probe.ts` the same way, into a fresh target each, with
`-q -t 10` and `-q -t 1`. Building with `-arch arm64e` gives a target in which
libxpc signs the pointers it keeps, as it does in Apple's own apps.

For the stress run, start the target as `/tmp/xpc-spy-target 2000` and load
`test/xpc-spy/stress.ts`; the target prints how long each burst of 2000 sends
takes. Kill the target when done; `defaults delete re.frida.xpc-spy-test`
removes the value it writes.

`churn.m` is a process whose threads, four unless given another number, each
create a client of an in-process listener, send it a request and cancel it, in
a tight loop, with at most 32 connections in flight per thread so that they
cannot outrun the listener. Given a second number, it first connects that many
standing clients, each with a request the listener's peer holds unanswered.
`churn.ts` searches its memory for existing connections and requests awaiting
a reply 100 times while that goes on, and prints how many searches threw, how
many of the handler functions found are not at the start of a block's code,
and how long the process was stopped; the first two should be 0, and the
target should keep printing its round count. On a heavily loaded machine a
search can throw because the process's threads could not all be stopped
outside the allocator in time, which is the instrument failing closed:

```sh
clang -fobjc-arc -framework Foundation -o /tmp/xpc-spy-churn test/xpc-spy/churn.m
/tmp/xpc-spy-churn 4 &
sleep 1
frida -p $! -l test/xpc-spy/churn.ts -q -t 2
```

`/tmp/xpc-spy-churn 4 300` gives a process with many connections under churn.
