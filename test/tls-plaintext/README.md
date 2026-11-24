# TLS Plaintext test fixtures

`harness.ts` loads the instrument with a fake context that prints every
`emit` and widget call. `instrument-typings.d.ts` is what Luma generates for
the instrument's settings and widgets; regenerate it when they change.

Targets, built outside the repository:

```sh
swiftc -o /tmp/fetch test/tls-plaintext/fetch.swift
/tmp/fetch https://api.github.com/zen       # URLSession over HTTP/2
/tmp/fetch https://example.com/             # URLSession over HTTP/3
/opt/homebrew/bin/python3 test/tls-plaintext/fetch.py https://example.com/ 10
```

The Python target imports `ssl` only after the delay, so attaching before it
shows a library being hooked as it loads.

From the repository root, either attach with the CLI:

```sh
frida -p <pid> -l test/tls-plaintext/harness.ts
```

or drive a scenario with `run.py`, which takes a pid or a command line to
spawn, then steps:

```sh
python3 test/tls-plaintext/run.py <pid> wait=5 \
    'configure={"capturePayloads":false,"chunkLimit":4096}' wait=5 \
    'configure={"capturePayloads":true,"hostPattern":"example","chunkLimit":64}' wait=5 \
    dispose wait=5
```

`clear=sent`, `clear=received` and `clear=connections` choose that widget's
**Clear**. `dispose` reports whether every hooked prologue is back to its
original bytes.
