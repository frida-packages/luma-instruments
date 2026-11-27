# IOKit

Shows how a macOS process talks to the kernel's drivers through IOKit: the
user clients it opens, the methods it calls on them with their scalars,
structs and results, the services it looks up and the registry properties it
reads. An explorer console lets you do the same yourself: find services, read
their properties, open a user client and call its methods.

## What it shows

Calls are taken from `IOConnectCallMethod`, `IOConnectCallAsyncMethod` and
their scalar and struct forms, `IOConnectCallScalarMethod`,
`IOConnectCallStructMethod`, `IOConnectCallAsyncScalarMethod` and
`IOConnectCallAsyncStructMethod`, which frameworks such as IOSurface go
through too; a call one of these makes through another is shown once. Each
call is shown with its connection, its selector, the input scalars and
struct, the output scalars and struct when it succeeded, its result, and how
long it took. Opening and closing connections is taken from
`IOServiceOpen` and `IOServiceClose`, and mapping a user client's memory from
`IOConnectMapMemory64`.

Service lookups are taken from `IOServiceGetMatchingService`,
`IOServiceGetMatchingServices`, `IOServiceAddMatchingNotification` and
`IORegistryEntryFromPath`, with the matching dictionary as a value and what was
found. Property reads are taken from `IORegistryEntryCreateCFProperty`,
`IORegistryEntrySearchCFProperty` and `IORegistryEntryCreateCFProperties`, with
the entry, the key and the value. A read that one of these makes through
another is shown once, as the call the process made. Reads like these are how a
process learns the machine's serial number, its `IOPlatformUUID` and its model,
so this is also where to look for fingerprinting.

The **Connections** table has a row per connection the process holds that the
instrument has seen: its port, its user client class, its service, the type it
was opened with, when it was opened, and how many calls were made on it. A row
goes when the connection is closed. The connections the process already holds
when the instrument starts are found among its port rights and shown as opened
before Luma attached, and the **Recent activity** console starts with a line
saying how many there were.

The user client class of a connection is what the kernel answers for its port
through `mach_port_kobject_description`, which names the user client and its
registry entry ID, so it is exact even for a connection opened before Luma
attached. Its service is that user client's provider in the registry.

The **Methods** table has a row per user client class and selector, with how
many calls were made, how many failed, their mean time in microseconds and the
last call's input and outcome. **Service lookups** has a row per way of looking
up and matching dictionary, and **Registry properties read** a row per entry
class and key, each with how often and the last result or value. These three
survive a reload of the instrument, and **Clear** in each header empties it.

Each call, open, close, mapping, lookup and property read also becomes an event
in Luma's event stream, and a line in the **Recent activity** console, starting
with its number. Type a number there to show it in full; the last 500 can be
shown this way. **Clear** empties the console and forgets them. Calls over the
**Method calls shown per second** are counted in the tables and not shown, and
a line says how many there were.

| Field | Meaning |
| --- | --- |
| `kind` | `call`, `open`, `close`, `map`, `lookup` or `property` |
| `seq` | The number in **Recent activity** |
| `port`, `userClient`, `service` | The connection, for calls, opens, closes and mappings |
| `selector`, `async` | The method called, and whether through `IOConnectCallAsyncMethod` |
| `input`, `output` | `scalars` and `struct`; a struct longer than the setting keeps its start, with its full `length` |
| `outputCapacity` | How many output scalars and struct bytes the caller made room for |
| `result` | `success`, or the code and what it means, such as `0xe00002c2 (iokit/common) invalid argument` |
| `durationUs` | How long the call took |
| `via`, `matching` | For lookups, the function and the matching dictionary or path |
| `entry`, `entryId`, `key`, `value` | For property reads |
| `backtrace` | Where it was called from, when backtraces are switched on |

Registry values become JavaScript values: dictionaries become objects, arrays
arrays, strings strings, numbers numbers (or 64-bit integers when too large),
booleans booleans and data bytes. In the tables and the console, data that
holds a C string is shown as that string, as in `<8 bytes: "Mac17,2">`.

## Exploring

The **Services with user clients** table lists the services in the registry that
a process can try to open: those that name an `IOUserClientClass`, and those
that have user clients open right now, by any process, with how many. Selecting
a row shows the service's properties in the explorer, and **Open** on a row
opens a connection to it with type 0. The table is filled when the instrument
starts; **Rescan** fills it again.

The **Explorer** console runs JavaScript in the process, with `io` in scope.
`:help` lists what it offers:

```js
io.find("IOSurfaceRoot")            // the services of a class
io.named("AppleKeyStore")           // the services of a name
io.entry("0x1000007c6")             // the service with that registry entry ID
io.path("IOService:/")              // the entry at a registry path; io.root is the root
io.openable(/HID/)                  // services in the table whose class or user client class matches
io.connections                      // the connections in the Connections table
io.connection(0x1a03)               // one of them by port, also one the process opened
io.replay(12)                       // makes call #12 of Recent activity again
```

An entry has `className`, `name`, `id`, `path`, `properties()`,
`property(key)`, `children()`, `parent()` and `open(type = 0)`. A connection
has:

- `call(selector, { scalars, struct, outputScalars, outputStruct })`, which
  answers `{ result, scalars, struct }`. Scalars are numbers, 64-bit integers
  or strings such as `"0xffffffff00000000"`; a struct is an `ArrayBuffer`, a
  typed array or an array of bytes. Without `outputScalars` and
  `outputStruct` the call makes room for no output, which many methods refuse.
- `probe(first = 0, last = 63)`, which calls each selector with no input and
  groups the results, such as `{ selectors: "6–63", result: "0xe00002c7
  (iokit/common) unsupported function" }`. A method that takes no input runs, so probe only what you are
  willing to have run.
- `map(memoryType)`, which maps the user client's memory of that type and
  answers its address and size.
- `close()`.

`io.replay` makes a call the process made again, on the same connection, with
the same input and room for the same output, which is the quickest way to try
variations of it. It replays only synchronous calls, and only those whose input
struct was kept whole. `_` is the last value, and `var` declarations last for
one input only, so keep things on `globalThis` to use them later. Connections
opened in the explorer are marked so in **Connections**, and are closed when
the instrument is removed or loaded again. What the explorer does is not shown
in the other widgets or as events, apart from the connections it opens.

## Settings

- **Only classes matching**: a regular expression for the user client and
  service classes to watch. It applies to calls, opens, closes and mappings by
  their user client or service class, to property reads by their entry's
  class, and to lookups by their matching dictionary as text.
- **Capture caller backtraces**: adds where each call, open, lookup and read
  came from.
- **Bytes kept per struct or data value**: structs and data longer than this
  keep only their start, and are shown with their full length.
- **Method calls shown per second**: the most calls converted, added to the
  console and to the event stream in a second, 100 by default. Those over it
  are still counted in the tables.

Changing a setting takes effect at once.

## Limits

Luma's value view expands three levels, so containers nested two levels into a
value are shown as a line of text. A container shows at most 256 entries, and
one value at most about 2000.

Each call costs the calling thread time in the hook. In a test on an Apple
Silicon Mac, a burst of 2000 calls took 7 to 30 ms with the instrument loaded,
against 3 to 7 ms without it. Starting the instrument took 27 to 35 ms, most
of it walking the registry to list the services with user clients, 596 of
them. A connection whose user client is not in that list, because it was
created since, has the registry walked again once to find its service.

## What it does not show

- Calls made through `IOConnectTrap…`, `io_connect_method` called directly, or
  Mach messages to a user client's port, which do not go through the functions
  above.
- The completion of an asynchronous call, which arrives on its wake port.
- Property writes, and properties read with the older `IORegistryEntryGetProperty`.

Removing the instrument removes every hook.

It was tested on macOS 27 on Apple Silicon. It has not been tested on iOS.
