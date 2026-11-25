# TLS Plaintext

Shows a process's TLS traffic as the application sees it: what it hands the
TLS library to encrypt, and what the library hands back after decrypting. It
hooks `SSL_read` and `SSL_write` (and `SSL_read_ex` and `SSL_write_ex` where
they exist) in every loaded module that exports them, the API that OpenSSL,
BoringSSL and LibreSSL share:

- Apple's `libboringssl.dylib`, which URLSession and Network.framework use
  for TLS over TCP on macOS and iOS
- `libssl` on Linux and Android
- any copy bundled with an application, as long as it exports those calls
- BoringSSL linked statically into an application with its symbols stripped,
  as in Flutter's engine, which `dart:io`'s `HttpClient` and `HttpServer` use

A stripped BoringSSL has no names to look up, so the instrument recognizes
its functions instead. Its error reports name the source file they come from,
`ssl/ssl_lib.cc`, and give a reason code that BoringSSL never renumbers. The
instrument finds the code that reports errors from that file, groups the
reports by function, and tells `SSL_read`, `SSL_write`, `SSL_do_handshake`,
`SSL_new` and `SSL_set_tlsext_host_name` apart by the reasons each one reports
and by which of them calls which. When any of this is not clear, such as two
functions that look like `SSL_read`, it hooks nothing in that module and says
why. It looks only in modules that come with the application, not in the
operating system's own, and it takes about 25 ms for a Flutter engine.

Libraries loaded after the instrument starts are hooked as they load, such as
Python's `libssl` when a script first imports `ssl`.

## What it shows

- **Sent** and **Received**: plaintext bytes across all connections. **Clear**
  on either starts its count again from zero.
- **Libraries**: each module with a TLS library in it, how it was found
  (exported calls, or a static BoringSSL), and what was hooked in it, or why
  nothing was.
- **Connections**: one row per TLS session, with the server name the client
  asked for (SNI), the peer address, the module whose TLS library carries it,
  the protocol version and the
  application protocol (ALPN), the cipher, bytes in each direction, the last
  HTTP/1 request and its status, and when the session was last active. A
  session gets its row when its handshake completes, or with its first data
  when the library runs the handshake inside a read or write. **Clear**
  empties the table; a session that is still open gets its row back, with its
  totals so far, the next time it sends or receives.
- **Latest payload**: a hex view of the most recent run of bytes one
  connection sent or received in a row, so an HTTP/1 response shows up whole
  rather than as its last chunk. It holds up to 64 KiB.

The two counters sit side by side at the top, even on a phone, and the
connections and the latest payload share the rest of the page, the table
above the hex view.

Each captured chunk is also an event, carrying `direction` (`sent` or
`received`), `host`, `peer` when known, `length` and `data`, which Luma shows
as a hex dump and can decode with a pattern. When a write begins with an
HTTP/1 request line the event carries its `method` and `path`, and when a
read begins with a status line it carries the `status`.

## Settings

- **Capture payloads**: turn off to stop the events and the hex view while
  the connection table and the totals keep updating.
- **Only capture hosts matching**: a regular expression, matched without
  regard to case against the server name, or the peer address when there is
  no server name. Connections that do not match still appear in the table.
- **Bytes kept per chunk**: how much of each chunk an event and the hex view
  keep, from 16 bytes to 64 KiB, 4 KiB by default. An event's `length` is
  always the full size of the chunk.

Changing a setting takes effect at once, without hooking anything again.

## What it does not cover

- **HTTP/3 and other QUIC traffic** where the QUIC stack protects its own
  packets and borrows the TLS library only for the handshake, as Apple's
  does. Such a connection shows up in the table, with `h3` as its protocol,
  but its byte counts stay at zero and no payloads are captured. URLSession
  moves to HTTP/3 when a server offers it, as `https://example.com/` does.
- **The peer address with Apple's `libboringssl`.** Apple's build does not
  export `SSL_get_fd`, so that column stays empty there.
- **The peer, protocol and cipher with a static BoringSSL.** The functions
  that answer them are not exported, and Dart hands BoringSSL memory buffers
  rather than a socket, so a connection there shows its server name and
  module only. Where the build has folded `SSL_set_tlsext_host_name` into its
  caller, as Flutter's Android engine does, the server name is missing too.
- **HTTP/2 requests.** Payloads are HTTP/2 frames, whose headers are
  compressed, so no method, path or status is pulled out of them. The bytes
  are still captured.
- **A static BoringSSL in 32-bit code**, or in a binary that does not list
  where its functions start (Mach-O function starts, ELF `.eh_frame_hdr`).
- **Chromium and Electron.** Their BoringSSL is static too, but it runs in
  the network service, a helper process of its own, and has not been tried.
- **Other TLS libraries that do not export these calls**: a static OpenSSL
  or LibreSSL with its symbols hidden, and libraries with an API of their
  own, such as GnuTLS, NSS, rustls, Go's `crypto/tls` and Apple's
  SecureTransport.
- **Windows.** Its system TLS is SChannel, so the instrument is offered only
  on Apple platforms and Linux, including Android.
- **OpenSSL's early data calls**, `SSL_write_early_data` and
  `SSL_read_early_data`.

It has been tried on macOS with URLSession (HTTP/2 and HTTP/3), with
Homebrew's Python and OpenSSL, and with Flutter apps on Apple silicon, in
release and debug builds. Flutter engines from 2023 to 2026, for macOS on
arm64 and x86-64 and for Android on arm64 and x86-64, are recognized, but only
macOS on arm64 has been tried live. iOS, Linux and Android have not been
tried.
