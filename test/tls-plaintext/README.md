# TLS Plaintext test fixtures

`harness.ts` loads the instrument with a fake context that prints every
`emit` and widget call. `instrument-typings.d.ts` is what Luma generates for
the instrument's settings and widgets; regenerate it when they change, or when
Luma's typings do, with
`python3 test/generate-typings.py ~/src/luma tls-plaintext test/tls-plaintext/instrument-typings.d.ts`.

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

## Static BoringSSL

`dispose` also reports on the functions the static BoringSSL backend hooks,
as `FlutterMacOS!static read` and so on, and `count=DIRECTION,FILE` says how
many times the bytes of `FILE` appear in everything captured in that
direction, so a known payload can be checked byte for byte. Capture whole
chunks for that, with `"chunkLimit":65536`.

### Recognition, offline

`recognize.py` maps engine binaries into Frida's own process, as a loader
would, and runs the instrument's recognition on each slice, with no app
running. Each argument is `LABEL=PATH`; a fat Mach-O is tried slice by slice.
`--verbose` lists every function found reporting errors from `ssl_lib.cc`,
with its reasons. `--expect=static-boringssl-expected.json` compares each
result with what was found when the binaries below were checked by hand, the
Flutter SDK's ones against its symbols, and fails on any difference:

```sh
python3 test/tls-plaintext/recognize.py \
    --expect=test/tls-plaintext/static-boringssl-expected.json \
    flutter-3.50.1-release=…/FlutterMacOS \
    flutter-3.50.1-android=…/arm64-v8a/libflutter.so \
    rustdesk-1.4.6=…/FlutterMacOS …
```

| Label | Binary |
| --- | --- |
| `flutter-3.50.1-release`, `-profile`, `-debug` | `FlutterMacOS` from the SDK's `bin/cache/artifacts/engine/darwin-x64{-release,-profile,}/FlutterMacOS.xcframework/macos-arm64_x86_64/` |
| `flutter-3.50.1-android` | `libflutter.so` from `arm64_v8a_release` and `x86_64_release`, `1.0.0-4d35714800b9266b6693a58e1225ecd7e9e45ed7`, on `download.flutter.io` |
| `rustdesk-1.4.6`, `wonderous-2.0.16`, `localsend-1.19.0` | `Contents/Frameworks/FlutterMacOS.framework/Versions/A/FlutterMacOS` of each app |

These engines span Dart 3.1 (2023) to 3.14 (2026). Android's is built for
size: everything `SSL_read` needs is inlined into it, error reports pass
through outlined helpers, and `ERR_put_error` has lost its unused parameter.

### Live, with a Flutter app

`flutter-target/` holds a small app that, every 2 s, fetches 3000 known
bytes from `https://localhost:47443/payload/3000` and posts 5000 known bytes
to `/digest` over `dart:io`'s `HttpClient`, accepting the server's
self-signed certificate for `localhost` only. It starts a new client every
third round, so new sessions appear. `loopback-server.py` serves it on
127.0.0.1 and writes the expected bytes, `request-body`, `get-response` and
`post-response`, next to its certificate:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout $DIR/key.pem -out $DIR/cert.pem \
    -days 30 -subj /CN=localhost -addext subjectAltName=DNS:localhost
python3 test/tls-plaintext/loopback-server.py 47443 $DIR &
```

Build the app as `test/flutter/README.md` describes for its target, with
`flutter create --platforms=macos --project-name tls_target --org re.frida.luma tls_target`,
this folder's `main.dart` and `MainFlutterWindow.swift`, `LSUIElement`, and
`com.apple.security.network.client` added to both `Release.entitlements` and
`DebugProfile.entitlements`. Then, for each build:

```sh
A=tls_target/build/macos/Build/Products/Release/tls_target.app/Contents/MacOS/tls_target
python3 test/tls-plaintext/run.py $A 'configure={"capturePayloads":true,"chunkLimit":65536}' wait=13 \
    count=sent,$DIR/request-body count=received,$DIR/get-response count=received,$DIR/post-response \
    'configure={"capturePayloads":true,"hostPattern":"^nomatch$","chunkLimit":65536}' \
    clear=connections wait=4 dispose
```

Look for the `Libraries` row of `FlutterMacOS` saying all five functions are
hooked, `Connections` rows with `localhost` and `FlutterMacOS`, each count
equal to the number of rounds captured, no events once the pattern matches
nothing, and every prologue restored.
