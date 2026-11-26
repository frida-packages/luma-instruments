# XPC Spy

Shows the XPC messages a process sends and receives on macOS and iOS, grouped
by service, on the connections it made before Luma attached as well as on
those it makes after.

## What it shows

Sent messages are taken from `xpc_connection_send_message`,
`xpc_connection_send_message_with_reply` and
`xpc_connection_send_message_with_reply_sync`. The last two are shown as
requests, and their replies are shown when they arrive, whether through the
reply handler or as the return value, together with the request they answer
and how long it took.

Received messages, errors such as `Connection invalid`, and new peer
connections on a listener are taken from the event handlers set with
`xpc_connection_set_event_handler`.

Connections that already exist when the instrument starts are found in the
process's memory, and their event handlers are watched from then on like the
ones set later. A peer connection that a listener accepted before then is
shown under the listener's service. Requests that are still waiting for their
reply at that moment have the reply shown when it arrives, without the request
it answers. To learn where libxpc keeps these handlers, the instrument sets up
a listener, a client and a peer connection of its own, with a request pending
between them, and removes them again before it starts to capture. It does this
once, when it is first loaded into the process.

To read what it found without another thread freeing it meanwhile, the
instrument stops the process's threads for a moment, each where it is not
inside the memory allocator, and lets them run again as soon as it has taken a
reference to each connection. The **Recent messages** console then says how
many connections and requests it found and how long the process was stopped.
When the instrument cannot learn libxpc's layout, when what it learns does not
add up, or when it cannot stop the process at such a point in time, it says
why there instead, and watches only the connections set up from then on.
Existing connections are looked for only in arm64 processes.

Each message becomes an event in Luma's event stream:

| Field | Meaning |
| --- | --- |
| `direction` | `sent` or `received` |
| `kind` | `message`, `request`, `reply`, `error` or `peer` |
| `service` | `xpc_connection_get_name`, or `(anonymous)` for connections made from an endpoint or an anonymous listener |
| `pid` | The peer's pid, once the connection has one |
| `seq` | A number that orders the messages; replies carry `inReplyTo` and `latencyMs` |
| `selector` | For NSXPC requests and their replies, the method invoked |
| `message` | The message as a value you can expand |
| `backtrace` | Where it was sent from, when backtraces are switched on |

In `message`, dictionaries become objects, arrays become arrays, and strings,
integers, booleans, doubles and null keep their type. Integers too large for
a JavaScript number stay 64-bit. Dates become dates, UUIDs become strings and
data becomes bytes. File descriptors, shared memory, endpoints and the other
types that carry no plain value show their type name, such as `<fd>`.

NSXPC carries each invocation as an encoded blob under `root`. The instrument
reads the selector from the start of that blob and leaves the blob itself as
bytes; the arguments are not decoded.

The **Services** table has a row per service with the last peer pid, how many
messages were sent and received, and when the last one was seen and what it
was. The counts survive a reload of the instrument. **Clear**, in the
table's header, empties it and starts the counts again.

The **Recent messages** console starts with the line about the connections
found when the instrument started, and then has a line per message, each
starting with its number. Type a number to show that message in full; the last
500 can be shown this way. **Clear** empties the console and forgets those
messages, so a number from before it can no longer be shown. Messages over the
**Messages shown per second** are counted in their service's row and not
shown, and a line says how many there were.

## Settings

- **Only services matching**: a regular expression for the service names to
  capture. Messages for other services are not kept or converted, though the
  hooks still run.
- **Capture sender backtraces**: adds where each sent message came from.
- **Bytes kept per data value**: data longer than this keeps only its start,
  and is shown with its full length.
- **Messages shown per second**: the most messages converted, added to the
  console and to the event stream in a second, 100 by default. Those over it
  are still counted, in their service's row, but not shown, so a chatty
  process does not flood Luma.

Changing a setting takes effect at once, without removing the hooks.

## Limits

Luma's value view expands three levels, so containers nested two levels into a
message are shown as a line of text. A container shows at most 256 entries,
a string at most 4096 bytes, and one message at most about 2000 values.

Each message costs the sending or receiving thread time in the hook. In a test
on an Apple Silicon Mac, a burst of 2000 sends took 15 to 80 ms with the
instrument loaded, against 1 to 4 ms without it.

Starting the instrument took 80 to 200 ms the first time and 35 to 70 ms after
that, in a test process with 11 connections and in a copy of TextEdit with 28.
The process was stopped for 0.04 to 0.22 ms of that. In a process creating and
tearing down connections on four threads it was stopped for 0.3 to 2.8 ms on
average, and with 3900 connections and requests for 6 to 9 ms on average. The
longest stop in a run was under 20 ms in most runs, and up to 110 ms while the
machine's load average was between 10 and 25. The instrument gives up once the
threads have not all left the allocator after 10 ms, as it did in 2 of 100
searches in a process churning connections on 16 threads at that load. It
reads at most 4096 connections and requests, 2 to 3 µs each, while they are
stopped; in a process with more, it watches only the connections set up from
then on.

## What it does not show

- The reply to an `xpc_connection_send_message_with_reply_sync` call made
  before the instrument started, which arrives as the call's return value.
- A reply that is an error, such as `Connection invalid`, to an asynchronous
  request made before the instrument started, as it does not say which
  connection it came from.
- Messages sent through `xpc_session` (Swift's `XPCSession`): those calls do not
  go through the functions above. A session receives through a connection event
  handler, so what it receives may be shown; this was not tested.
- Event handlers set with `_xpc_connection_set_event_handler_f`, which takes a
  function pointer rather than a block. None of the libraries loaded in TextEdit
  use it.
- Mach messages, MIG and other IPC that does not use XPC connections.

Removing the instrument removes every hook. Handler blocks are never replaced:
libxpc is given a copy of the caller's own block, made a moment earlier than it
would have made it, and the connections the instrument sets up when it starts
are gone before it captures anything, so nothing of the instrument is left in
the process.

It was tested on macOS 27 on Apple Silicon, in arm64 and arm64e processes. A
peer connection was shown under its listener's service only with anonymous
listeners, as no named listener was available to test with. It has not been
tested on iOS.
