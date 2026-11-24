# Certificates test harness

`target.c` holds certificates each way the instrument looks for them, prints
the SHA-256 of each and what holds it, then waits:

| Certificate | Held as | Found by |
| --- | --- | --- |
| `Certificates Test Root` | an X509 built and signed in the process | nothing: see the README |
| `Certificates Test EC CA`, `openssl-rsa-signed.test`, `openssl-ecdsa-signed.test`, `openssl-ed25519.test` | X509s decoded from DER that was then wiped | OpenSSL X509 |
| `security-framework.test` | a SecCertificate (macOS only) | SecCertificate, and DER inside it |
| `raw-der.test` | DER in a heap buffer, with a short TBS length | DER |
| `pem.test` | PEM in a heap buffer | PEM |

`harness.ts` loads the instrument with a fake context that prints every event
and widget call, waits for the first scan, inspects every row, searches the
details console, clears it, rescans with the table's **Rescan**, and disposes
the instrument. It checks that **Rescan** is disabled during each scan and
enabled after it, and takes the memory scope as a parameter. `interrupt.ts`
starts a scan of all readable memory, checks that **Rescan** stays disabled
while it and the scan restarted by changing the scope twice are under way,
disposes mid-scan and reports any widget call made after that, then creates
the instrument again and checks that the new instance's **Rescan** is enabled
once its first scan has finished. `instrument-typings.d.ts` is what Luma
generates for the instrument's settings and widgets; regenerate it when they
change.

Build the target outside the repository, against each OpenSSL to be tried:

```sh
clang -o /tmp/certificates-openssl3 test/certificates/target.c \
    -I/opt/homebrew/opt/openssl@3/include -L/opt/homebrew/opt/openssl@3/lib -lcrypto \
    -framework Security -framework CoreFoundation
```

Use `openssl@4` for OpenSSL 4. For OpenSSL 1.1.1, configure a source release
with `./Configure darwin64-arm64-cc no-shared`, run `make build_libs`, and
link its `libcrypto.a` in place of `-lcrypto`: OpenSSL is then exported from
the target itself.

Run it and attach from the repository root; `-t` keeps the session open
long enough for both scans:

```sh
/tmp/certificates-openssl3 &
frida -p $! -l test/certificates/harness.ts -q -t 15
frida -p $! -l test/certificates/harness.ts -P '{"scope":"readable"}' -q -t 60
frida -p $! -l test/certificates/interrupt.ts -q -t 10
```

Every certificate the target prints should come back with the strategy in the
table above, except the root. Expect more besides: macOS keeps Apple's own
certificates in writable memory. For a larger run, attach to a Python process
that has loaded a CA bundle into OpenSSL:

```sh
python3 -c 'import ssl, sys, time; context = ssl.create_default_context(cafile=sys.argv[1]); time.sleep(600)' \
    /opt/homebrew/etc/openssl@3/cert.pem
```

or to a URLSession client such as `test/tls-plaintext/fetch.swift`, whose
server's chain shows up as SecCertificates.
