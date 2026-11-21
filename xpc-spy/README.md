# XPC Spy

Shows the XPC messages a process sends and receives on macOS and iOS, grouped
by service.

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
was. The counts survive a reload of the instrument.

The **Recent messages** console has a line per message, each starting with its
number. Type a number to show that message in full; the last 500 can be shown
this way.

## Settings

- **Only services matching**: a regular expression for the service names to
  capture. Messages for other services are not kept or converted, though the
  hooks still run.
- **Capture sender backtraces**: adds where each sent message came from.
- **Bytes kept per data value**: data longer than this keeps only its start,
  and is shown with its full length.

Changing a setting takes effect at once, without removing the hooks.

## Limits

Luma's value view expands three levels, so containers nested two levels into a
message are shown as a line of text. A container shows at most 256 entries,
a string at most 4096 bytes, and one message at most about 2000 values.

Each message costs the sending or receiving thread time in the hook. In a test
on an Apple Silicon Mac, a burst of 2000 sends took 30 to 65 ms with the
instrument loaded, against 2 to 4 ms without it.

## What it does not show

- Messages delivered to an event handler that was set before the instrument
  started. Such a handler is seen only if a connection set up afterwards uses
  the same block code: NSXPC uses one for all its connections, so once the
  process makes any new NSXPC connection, the older ones are seen too. Replies
  to requests sent after the instrument started are always seen.
- Replies to requests sent before the instrument started.
- Messages sent through `xpc_session` (Swift's `XPCSession`): those calls do not
  go through the functions above. A session receives through a connection event
  handler, so what it receives may be shown; this was not tested.
- Handlers set with function pointers rather than blocks.
- Mach messages, MIG and other IPC that does not use XPC connections.

Removing the instrument removes every hook. Handler blocks are never replaced:
libxpc is given a copy of the caller's own block, made a moment earlier than it
would have made it, so nothing of the instrument is left in the process.

It was tested on macOS 27 on Apple Silicon; it has not been tested on iOS.
