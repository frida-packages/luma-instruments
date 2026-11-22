# Trainer

Finds where a game keeps a value you can see, such as your health, ammo or
gold, and lets you change it, or hold it where it is and see which code
tries to change it.

## How to use it

1. Type the value the game shows, such as `100`, and press **Scan**. The
   instrument looks through the process's writable memory for every place
   that holds it, and says how many it found.
2. Play until the value changes, then type the new one, such as `87`. Only the
   places that now hold 87 are kept. Repeat until few are left.
3. Once there are 100 or fewer, they are listed with their address, type,
   current and previous value, and where they are: a module and offset such
   as `game+0x8000`, a thread's stack, or the heap.
4. Type `set 999` to write 999 to every listed row, or `set 3 999` to write
   row 3 only. `lock 3` holds row 3 at its value, so that the game cannot
   change it.
5. Type `reset` to start over.

When you cannot see the number, only a bar, narrow down by how it moved
instead:

| Type | Keeps the places whose value since the last step |
| --- | --- |
| `+` or `inc` | went up |
| `-` or `dec` | went down |
| `inc 5`, `dec 13` | went up by 5, or down by 13 |
| `changed` | changed |
| `same` | stayed the same |

The first step always needs a number.

Other commands:

- `undo` goes back one step.
- `set 1,4 999` and `set 2-5 999` write several rows. Rows are numbered as
  listed.
- `lock` holds every listed row at its value, `lock 3 999` holds row 3 at
  999, `unlock 2` releases lock 2 and `unlock` releases them all.
- `list` reads the listed rows again.
- `stop` stops a scan that is running.
- `help` shows these commands.

The rows of the candidate list can also be kept on their own, discarded,
locked, or shown in the **Memory** view, which shows the bytes around them
and can be decoded with a pattern, as when looking for the rest of a
player's struct.

## How values are matched

A number is looked for as a 32-bit integer, a float and a double at once, or
as the types chosen in the settings. A typed integer matches integers
exactly. Since a game shows a float rounded or cut off, `87` matches floats
and doubles from 86.5 up to, but not including, 88; a negative number is
treated the other way round. A number typed with decimals matches to the
digits typed: `87.4` matches from 87.35 to 87.45, and not integers.

Bytes are unsigned, from 0 to 255; the wider integers are signed. A 64-bit
integer is compared as a JavaScript number, so values beyond 2^53 lose their
lowest bits.

Only naturally aligned values are looked for unless the setting says
otherwise: a 32-bit value at an address that is a multiple of 4, and so on.
Games almost always keep their values that way, and aligned values are found
with `Memory.findPointers`, which went through 1.5 GiB about fourteen times
faster than `Memory.scanSync` did.

## What is scanned

Every readable and writable range of the process, except:

- memory the instrument itself and Frida use,
- on Apple platforms, the writable data of the system libraries in the shared
  cache, which never holds a game's state,
- pages that were never touched, on Apple platforms and Linux, so that
  scanning does not make the process use more memory. On Apple platforms,
  pages that are compressed or swapped out are still scanned; on Linux,
  swapped out pages are not.

The first scan runs `Memory.findPointers` over one slice of memory at a
time, sized by how many matches the slices before it had, so the instrument
stays responsive and the counter shows how far it has got. The
places found are then read once more and checked exactly, which is what the
later steps do too. Memory that went away or became unreadable since the last
step is skipped, and its places are dropped.

If more than five million places match, as for `0` or `1`, the scan stops and
asks for another value.

## Locks

`lock` sets a hardware watchpoint on the value in every thread of the
process, including threads started later. When the game writes the value,
the write is allowed to happen and the locked value is put back before the
writing thread runs its next instruction. Nothing is rewritten on a timer.
Each write costs the writing thread two traps; in the test game, 10,000
writes to two locked values took about 180 ms.

Each write is also counted against the code that made it: **Code that writes
locked values** shows the address of the instruction, its function or module
and offset, how many writes it made and to which locked address. This is how
to find the code that deals the damage. Function names come from Frida's
`DebugSymbol`, which on Apple platforms works only in processes that have
CoreFoundation loaded, as every app does; in other processes the column shows
the module and offset.

The processor has four watchpoints, so at most four values can be locked at
once. `unlock`, `reset` and removing the instrument release them.

Locking works on arm64 on Apple platforms. Elsewhere `lock` says that it is
not available there: stepping past a trapped write differs between
processors and has only been worked out and tested there.

Between a write and its undoing, another thread can read the game's new
value. A value written with an exclusive load and store loop, which is how
atomic operations are made for arm64 processors without single-instruction
atomics, would trap on every retry and never be written; code built for
Apple's processors normally uses the single instructions. This case has not
been tried.

Only one instrument in a process can use `Process.setExceptionHandler`, so
locks do not mix with another instrument that installs its own handler.

## Settings

- **Look for values stored as**: 32-bit integer, float or double (the
  default), any integer, float or double, or one type only. It applies from
  the next first scan.
- **Also look at unaligned addresses**: finds values at any address. This
  uses `Memory.scanSync` and is several times slower.

## Tested on

macOS 27 on Apple Silicon, with the test game in this repository and with a
Chrome renderer process using about 1.6 GB, whose page kept a few hundred
megabytes of numbers in typed arrays:

| Step | Time |
| --- | --- |
| First scan for `100` as 32-bit integer, float or double: 1.5 GiB, 101,075 places | 0.5 s |
| Narrowing those 101,075 places by a new value, or by `same` | 60 to 80 ms |
| First scan for `100` as any integer, float or double: 626,228 places | 1.4 s |
| First scan for `100` as a 32-bit integer at unaligned addresses | 1.1 s |
| Giving up on `0` | 2 s |

Linux, Windows and iOS have not been tried.
