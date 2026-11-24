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

Libraries loaded after the instrument starts are hooked as they load, such as
Python's `libssl` when a script first imports `ssl`.

## What it shows

- **Sent** and **Received**: plaintext bytes across all connections. **Clear**
  on either starts its count again from zero.
- **Connections**: one row per TLS session, with the server name the client
  asked for (SNI), the peer address, the protocol version and the
  application protocol (ALPN), the cipher, bytes in each direction, the last
  HTTP/1 request and its status, and when the session was last active. A
  session gets its row when its handshake completes, or with its first data
  when the library runs the handshake inside a read or write. **Clear**
  empties the table; a session that is still open gets its row back, with its
  totals so far, the next time it sends or receives.
- **Latest payload**: a hex view of the most recent run of bytes one
  connection sent or received in a row, so an HTTP/1 response shows up whole
  rather than as its last chunk. It holds up to 64 KiB.

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
- **HTTP/2 requests.** Payloads are HTTP/2 frames, whose headers are
  compressed, so no method, path or status is pulled out of them. The bytes
  are still captured.
- **TLS libraries that do not export these calls**: statically linked
  copies with their symbols hidden, as in Chrome and Flutter apps, and
  libraries with an API of their own, such as GnuTLS, NSS, rustls, Go's
  `crypto/tls` and Apple's SecureTransport.
- **Windows.** Its system TLS is SChannel, so the instrument is offered only
  on Apple platforms and Linux, including Android.
- **OpenSSL's early data calls**, `SSL_write_early_data` and
  `SSL_read_early_data`.

It has been tried on macOS with URLSession (HTTP/2 and HTTP/3) and with
Homebrew's Python and OpenSSL. iOS, Linux and Android have not been tried.
