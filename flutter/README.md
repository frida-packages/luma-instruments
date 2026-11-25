# Flutter

Takes a Flutter app apart while it runs: which engine and Dart it ships, what
kind of build it is, the files that hold its compiled Dart, the packages and
channel names its snapshot holds, and every platform-channel message that
passes between its Dart code and the host, decoded, with its reply.

Platform channels are how a Flutter app talks to everything that is not Dart:
plugins for storage, the camera, payments, sign-in, the keychain, and the
app's own native code. Watching them shows what the app asks of the host and
what it gets back, often the shortest way into what it does.

It needs Luma 4.0.0 or later, and runs on macOS: desktop Flutter apps, debug,
profile and release.

## How it finds the engine and the app

The engine is the library Flutter ships it as, `FlutterMacOS` on macOS. The
app's compiled Dart is `App.framework`, whose snapshot the instrument finds by
the symbol the engine itself loads it by (`kDartSnapshotData` in current
releases, `kDartIsolateSnapshotData` in older ones). Nothing needs symbols
beyond those: a stripped release engine, as every shipped app has, is enough.

- **Engine revision and Dart version** are the strings the engine carries for
  its own `--version`: the 40-digit revision of the engine's commit, and the
  Dart version line, `3.14.0 (stable) (…) on "macos_arm64"`.
- **The snapshot's header** gives its hash, the one tools such as reFlutter
  and Blutter look an engine version up by, and its features, which say
  whether it is a release (`product`) or profile build. A debug build has no
  compiled Dart; its kernel and JIT snapshot are files in `flutter_assets`.
  The engine expects a snapshot hash too, and a mismatch is shown.
- **Packages** are counted from the library URIs the snapshot names, such as
  `package:http/http.dart`, so even a release build shows which packages the
  app is made of, its own among them.
- **Channel names in the snapshot** are its strings that read as channel
  names: `flutter/…`, reverse-domain names such as
  `plugins.flutter.io/url_launcher`, and Pigeon's
  `dev.flutter.pigeon.…`. They are channels the app can use, before any of
  them carries a message. A debug build's kernel runs its strings together,
  so there only the packages are found.
- **The VM service**, which debug and profile builds run, is found as a
  listening loopback socket whose URL is in memory, then asked for its
  isolates and their libraries. A sandboxed app without the network client
  entitlement refuses the instrument's connection from inside it; the URL is
  shown all the same, for DevTools. Release builds have no VM service, and
  their isolates cannot be listed.

## How it watches channels

Every message goes through two places in the macOS engine, and those are
what is hooked:

- **Dart to host:** `-[FlutterEngine engineCallbackOnPlatformMessage:]`,
  which the engine calls with the embedder API's `FlutterPlatformMessage`:
  the channel, the bytes and a handle for the reply. It is found through the
  Objective-C runtime, so a stripped engine is no obstacle.
- **Host to Dart, and replies both ways:** the embedder API's own functions,
  `SendPlatformMessage`, `PlatformMessageCreateResponseHandle` with the reply
  callback it registers, and `SendPlatformMessageResponse`. They are not
  exported, so the instrument reads their addresses from the table the
  engine keeps in its `_embedderAPI` instance variable, the first time a
  `FlutterEngine` sends or receives a message.

Each engine is numbered as it is first seen, and channels are told apart by
engine as well as name: an app with several windows runs an engine per
window.

Every message is decoded by the codecs Flutter ships, tried in turn: the
standard method codec (a method name and its arguments, or a success or error
envelope), the JSON method codec, the standard message codec, JSON, UTF-8
text, and raw bytes. A reply is decoded the way its request was. The standard
codec's types are all read, typed lists included; a type an app's own codec
adds, such as those Pigeon generates, stops decoding there and the rest is
kept as bytes, so a Pigeon call still shows its method and the values before
it.

## What it shows

- A status line: the platform, the Dart version and the kind of build, then
  how many messages have passed, and how many were only counted.
- **Flutter**: what the instrument knows about the engine and the app, a row
  each. **Refresh** looks for files and the VM service again.
- **Files**: the files an analyst wants next: the `App` binary, which holds
  the AOT snapshots, the engine, and what `flutter_assets` holds, among it
  `kernel_blob.bin` in a debug build, the asset manifests and the licenses.
  **Save** offers one for saving, streamed from disk; a file is at most
  64 MiB.
- **Channels**: a row per channel, with its kind (method, event or basic
  message channel, learned from its traffic), its codec, the messages each
  way, the bytes, the last method called and when it was last active.
  **Show** gives the channel a page of its own, under the instrument in the
  sidebar, with only its messages, from the last 2000 on.
- **Messages**: a row per message, newest last, with its direction, channel,
  kind (call, event, event error or message), a summary of what it carries
  and of its reply, its size and how long the reply took. **Inspect** decodes
  it in full in the console, as values to expand. **Clear** empties the
  table.
- **Console**: `inspect N`, `packages`, `channels` (the names in the
  snapshot), `strings REGEX` (the snapshot's strings), `libraries [REGEX]`
  (from the VM service), `save FILE`, and `help`.

On a wide window the facts and the files share a row, the channels sit under
them, and the messages and the console share the rest. On a laptop the same
holds; narrower, the rows fold and the page scrolls.

## Settings

- **Bytes kept per message**: how much of each message and reply is kept and
  decoded, 64 KiB by default. A message cut short is marked so.
- **Messages shown per second**: the most messages added to the table in a
  second, 100 by default. Those over it are still counted, in their channel's
  row and the status line, but not shown, so a chatty app does not flood
  Luma.
- **Hide channels matching**: a regular expression of channels to leave out
  altogether, off by default; `^flutter/` hides the engine's own.
- **Add each message and reply to the event stream**, off by default, with
  its channel, direction, kind, codec and bytes.
- **Ask the Dart VM service**, on by default.

## What it does not do

- **Recover classes, functions or the object pool** from a release build. The
  AOT snapshot's layout changes with every Dart version; tools made for that,
  such as Blutter, take the `App` binary this instrument saves and the Dart
  version it names.
- **Send or replay messages.**
- **Show Flutter's HTTPS traffic.** `dart:io` uses the BoringSSL built into
  the engine, whose functions are not exported, so TLS Plaintext does not see
  it yet either. Apps that use the platform's HTTP stack, through plugins such
  as `cupertino_http`, are seen by TLS Plaintext.
- **See an engine before it runs.** A macOS Flutter app starts its engine when
  its window first appears; until then there are no messages.
- **iOS, Android, Linux and Windows.** The instrument knows their engine
  libraries, but watches channels only on macOS, and is offered only there.

It has been tried with Flutter 3.50.1 (Dart 3.14) in debug, profile and
release builds, and with shipped release apps built with Dart 3.1, 3.5 and
3.11.
