# Flutter test harness

`harness.ts` loads the instrument with a fake `ctx` that records what each
widget and child page is given, and exposes `state`, `act`, `input`,
`configure` and `dispose` to `run.py`. `dispose` reports whether the hooked
`FlutterEngine` methods are back to their original bytes.
`codec-check.ts` decodes hand-made messages: standard calls and values with
aligned floats, two-byte sizes, Pigeon's custom types, success and error
envelopes, events, JSON, text and bytes.

`instrument-typings.d.ts` is what Luma generates for the instrument's
settings and widgets; regenerate it when they change, or when Luma's typings
do, with
`python3 test/generate-typings.py ~/src/luma flutter test/flutter/instrument-typings.d.ts`.

## The target

`channel_target` is a small Flutter app with these channels, each exercised
every second, both ways where the kind allows:

| Channel | Kind | Codec | Carries |
| --- | --- | --- | --- |
| `luma.test/methods` | method | standard | Dart calls `echo` with every standard type, `fail` (a `FlutterError`) and `missing` (not implemented); the host calls `fromHost` |
| `luma.test/json` | method | JSON | Dart calls `lookup` |
| `luma.test/events` | event | standard | the host's ticks, and an error event every fifth |
| `luma.test/strings` | basic | string | both ways |
| `luma.test/json-messages` | basic | JSON | Dart to host |
| `luma.test/standard-messages` | basic | standard | Dart to host, the reply with a `Uint8List` |
| `luma.test/binary` | basic | binary | Dart to host, the reply reversed |

It also spawns an isolate named `channel-worker`. Its window is never shown,
and it has no Dock icon: `LSUIElement` is set, the window's ordering methods
do nothing, and the engine is started with `runWithEntrypoint:` instead of by
the window appearing.

To build it, with analytics off and every cache inside one scratch folder
(`$SCRATCH` below):

```sh
export HOME=$SCRATCH/home PUB_CACHE=$SCRATCH/pub-cache
export FLUTTER_SUPPRESS_ANALYTICS=true DART_SUPPRESS_ANALYTICS=true
export PATH=$SCRATCH/flutter/bin:$PATH
flutter --disable-analytics && dart --disable-analytics
flutter create --platforms=macos --project-name channel_target --org re.frida.luma channel_target
```

then replace `lib/main.dart` and `macos/Runner/MainFlutterWindow.swift` with
the ones in `target/`, add `LSUIElement` to `macos/Runner/Info.plist`, add
`com.apple.security.network.client` to `macos/Runner/DebugProfile.entitlements`
so the debug build can be asked over its VM service, and build each mode:

```sh
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" macos/Runner/Info.plist
/usr/libexec/PlistBuddy -c "Add :com.apple.security.network.client bool true" macos/Runner/DebugProfile.entitlements
flutter build macos --release
flutter build macos --profile
flutter build macos --debug
```

Run `run.py` with the Python that has the `frida` module, from a shell whose
`HOME` is your own (Frida's Python package lives under it).

## Running

From the repository root, `run.py` takes a pid, a command line to spawn, or
an `.app` bundle to open hidden with `open -g -j -n`, then steps:

```sh
T=channel_target/build/macos/Build/Products/Release/channel_target.app/Contents/MacOS/channel_target
python3 test/flutter/run.py $T wait=5 state \
    act=messages,inspect,4 act=files,save,app act=channels,show,c2 \
    'act=messages,inspect,5,c2' 'input=channels' 'input=strings luma\.' \
    'input=save NOTICES.Z' state dispose
python3 test/flutter/run.py $T wait=2 \
    'configure={"bytesKept":256,"messagesPerSecond":3,"hideChannels":"^luma\\.test/(binary|json)$","emitMessages":true,"askVmService":false}' \
    wait=4 state dispose
python3 test/flutter/run.py --codecs
```

`act=WIDGET,ACTION[,ITEM[,CHANNEL]]` chooses an action, on a channel's page
when `CHANNEL` (such as `c2`) is given; `input=[CHANNEL|]TEXT` submits console
input; `state` prints every widget's rows, items and console output, the
pages and the files offered. A saved file is printed with its size and
SHA-256, to compare with the file on disk.

What to look for, per build:

- **Release**: `AOT, a release build`, the engine revision and Dart version,
  the snapshot hash matching the engine's, 7 packages, 23 channel names in the
  snapshot, all seven test channels with the kinds and codecs above, and
  `fail` answered with `error E_TEST`, `missing` with `(empty: no handler)`.
- **Profile**: `AOT, a profile build` and the VM service found but, without
  the network client entitlement, not reachable from inside the sandbox.
- **Debug**: `JIT, a debug build`, `kernel_blob.bin` and
  `isolate_snapshot_data` among the files, the VM service answering with the
  isolates `main`, `channel-worker` and `vm-service`, and their libraries.
