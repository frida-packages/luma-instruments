# Lua Hunter

Finds the Lua interpreters embedded in a process, and gives you a console into
each of them: PUC-Rio Lua 5.1, 5.2, 5.3 and 5.4, and LuaJIT 2. Lua typed into
its console runs inside that interpreter, on the thread that owns it.

## Finding the Lua code

Every loaded module is looked at, the main executable included, and so is
every module loaded later. Lua is found in one of three ways:

- **Exported API**: the module exports `lua_gettop` and the rest of the C API,
  as a `liblua` or `lua51.dll` does, or as an application does that exports
  it for its plugins.
- **Symbols**: Lua is linked in statically and its functions are not
  exported, but the symbol table still names them. The module is found by
  Lua's release string, such as `$LuaVersion: Lua 5.4.7`, or `LuaJIT 2.1.…`.
- **Stripped**: Lua is linked in statically and nothing names its functions.
  The module is found by its release string, and the standard library by its
  registration tables: the arrays of name and function pairs that start with
  `"assert"`, `"collectgarbage"`… Five API functions are then recovered from
  the machine code of the base library's own functions, each from two places
  that must agree: `lua_gettop` is what `select` and `print` call first,
  `lua_settop` what `print` calls with -2 and `next` with 2, `lua_tolstring`
  what `select` calls with 1 and `NULL`, `lua_pcall` what `pcall` and
  `xpcall` call with `LUA_MULTRET`, and `lua_load` what `load` calls with a
  reader function, and what `dofile` reaches through `luaL_loadfile`. When
  they do not all agree, no code is run.

The version comes from `lua_ident` or the release string, and from which API
functions exist: `lua_pcallk` only from 5.2, `lua_rotate` from 5.3,
`lua_newuserdatauv` in 5.4, `luaJIT_setmode` in LuaJIT.

## Finding the interpreters

An interpreter is one `lua_State` made by `lua_newstate` or `luaL_newstate`,
with the coroutines made from it. Each is shown by its main `lua_State`.
They are found:

- **In memory**, even when they are idle. A global state holds pointers to
  code in Lua's module: its allocator, its panic function and, in 5.4, its
  warning function. All writable memory is searched for them, and each match
  is kept only when the global state and the main thread around it point at
  each other the way Lua lays them out, with the main thread marked as a
  thread. Which pointers to look for comes from `luaL_newstate`'s code, from
  the symbols `l_alloc` and `panic`, or, when stripped, from the code that
  refers to the `"PANIC: unprotected error in call to Lua API"` message. An
  interpreter made with an allocator of its own is not found this way until
  one of its kind has been seen calling into Lua; from then on, its allocator
  is looked for too.
- **As they are created and closed**, through `lua_newstate`, `luaL_newstate`
  and `lua_close`, when the API is exported or has symbols.
- **When they call into Lua**. For a while after it starts, and after
  `:scan`, the instrument watches the API functions an embedding application
  calls all the time, such as `lua_pcall`, `lua_getfield` and
  `luaL_checkinteger`; when stripped, the standard library functions instead.
  A state that passes through is traced to its interpreter.

No struct offsets are written into the instrument: where a state keeps its
global state, and how far before the global state the main thread lies, are
worked out from the first state seen and checked on every state after it. What
is relied on is what every version does: the main thread and the global state
are allocated together, point at each other, and the thread carries Lua's type
tag for threads.

## The table

A status line at the top says what the hunt last found: which Lua was found
in which module, and how much memory was searched in how long.

**Interpreters** has a row per interpreter: its number, which Lua it is,
the module its code is in and how it was found, the address of its main
`lua_State`, the thread last seen running it, and how many globals it has,
with the first few that are not part of the standard library, which is
usually what tells two interpreters apart. The last column says how many
chunks are waiting for it, and whether it has been seen running, has not been
seen running yet, was closed, or cannot run code. The table shows up to 6
rows and then scrolls.

Double-click a row, or select it and press Return, to open that interpreter's
page. **Scan**, in the table's header, does what `:scan` does; it is disabled
while memory is being searched. `:scan` typed during a search asks for one more
once it ends.

## The consoles

Each interpreter has a page of its own under the instrument in the sidebar,
named after it, with its module, main state, thread and number of globals
beside the name, and a badge: seen, not seen yet, how many chunks wait for it,
closed, or cannot run code. The page is a console that fills the window, and
what you type there runs in that interpreter. Every reply starts with which
interpreter ran it and on which thread. **Clear**, in the console's header,
empties it. The page of a closed interpreter stays for a minute, so its last
replies can be read, and then goes.

A `lua_State` can only be used by the thread running it, so the chunk waits
until that thread next calls into the Lua API (or the standard library, when
stripped), and runs right there, inside a protected call. The stack is left as
it was found. When the interpreter does not come by within a moment, the
console says it is waiting; when other interpreters keep coming by while this
one does not, it says it may be idle. A chunk that never returns keeps that
thread inside it.

An expression shows its value, so `config` is the same as `return config`.
Results are shown as values you can expand, at most 64 of them: tables become
objects, or arrays when their keys run from 1 without gaps, to two levels,
with deeper tables summarized as text. Integers, floats, booleans and nil keep
their type; strings longer than 4 KiB are cut. Functions,
userdata and threads are shown by address, and C functions with where their
code is. Errors, from compiling or running, are shown as errors.

The chunk runs with an environment of its own, in which `print` adds a line
to the reply; everything else, reading globals and setting them, goes through
to the interpreter's own globals, so a global you set is seen by the
application's scripts. A function defined in the console keeps that
environment, and once the chunk has returned its `print` is the
interpreter's again.

Directives start with a colon:

| Directive | Does |
| --- | --- |
| `:list` | Lists the interpreters, this one marked with ● |
| `:cancel` | Drops what is waiting for this interpreter |
| `:scan` | Looks through memory again, and watches for interpreters calling into Lua for a while |
| `:now <lua>` | Runs Lua at once, on the instrument's own thread |
| `:help` | Says all this |

`:now` is for an interpreter whose thread never comes by. It is only safe
while that thread is not running Lua, which the instrument cannot know.

## Settings

- **Find idle interpreters in memory**: turn off to skip the memory search;
  interpreters are then only found as they are created or call into Lua.
- **Entries shown per table**: how many entries of each table are shown.

## Limits

- Searching memory took 1.3 s for 6.3 GiB of writable memory, and 0.2 s for
  VLC's 1.2 GiB, on an Apple Silicon Mac. It runs in slices and does not keep
  the instrument from answering.
- While a chunk waits, every call to a watched function costs the calling
  thread a little. A test program that called `lua_getglobal` and `lua_pcall`
  200,000 times a second each ran 5% slower while a chunk waited for another
  interpreter. When stripped, the standard library functions are watched as
  well, and the same program, whose script calls `tostring` 64 times a tick,
  ran at less than half its speed. Once nothing waits, and the first few
  thousand calls after a start or `:scan` have passed, nothing is watched.
- Running code in a stripped build uses Lua itself to set up the environment
  and to turn results into values, so it needs `load` (or `loadstring` and
  `setfenv`), `setmetatable`, `pcall`, `select`, `tostring`, `next`, `string`,
  `table` and `math` to be there under their usual names. With the API, only
  the C API is used.
- In 5.2 and later the globals are found through the registry with the
  default `LUAI_MAXSTACK`; a Lua built with another stack limit, a `float`
  `lua_Number`, or 32-bit integers is not handled.

## What it does not cover

- **Stripped LuaJIT.** It is found and its interpreters are listed, but its
  standard library has no registration tables to recover the API from, so no
  code can be run in it.
- **Stripped builds where the API was inlined** into the base library, as in
  single-file and link-time-optimized builds. They are listed, but the API
  is not recovered.
- **Lua derivatives with an API of their own**, such as Luau.

## Where it was run

Everything above was run on macOS 27 on Apple Silicon, with programs
embedding each of Lua 5.1.5, 5.2.4, 5.3.6, 5.4.7 and LuaJIT 2.1 linked as a
library, statically with symbols, and statically stripped; with VLC 3.0.23,
whose Lua plugin links Lua 5.1.5 statically and stripped; and with Wireshark
4.6.4's `tshark`, which exports Lua 5.4.7 and gives it an allocator of its
own.

It is also offered on Linux, including Android, and on Windows, where it has
never been run:

- **Exported API and symbols** rely on nothing specific to macOS, and are
  expected to work there on arm64 and x86 alike, as with a `lua51.dll` or a
  `liblua5.4.so`.
- **Stripped builds** need arm64: recovering the API and finding the panic
  function read arm64 machine code. On x86, as on Intel Macs and most Windows
  and desktop Linux machines, a stripped interpreter is listed only once one
  of its kind calls a standard library function, and cannot run code.
