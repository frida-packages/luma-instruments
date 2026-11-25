# Electron test harness

`fixture/` is a small Electron app with three windows, all created hidden:

- **isolated**: `contextIsolation`, the sandbox, no Node, the
  `preload-isolated.js` preload exposing an API through `contextBridge`, a
  `window.open` handler and a `will-navigate` listener;
- **open**: `nodeIntegration`, no context isolation, no sandbox, no web
  security, and the `preload-open.js` preload;
- **victim**: default preferences, there to be crashed and destroyed.

Every second the main process sends `tick` to the first two. On each tick
they use every kind of IPC: `send` (answered with `event.reply`), `sendSync`,
`invoke` that resolves, one that throws, one that is slow and returns a
`Buffer` and a `Date`, a handler on `webContents.ipc`, and `postMessage` with
a `MessagePort` that the main process echoes on. On its second tick the main
process hands each page a port through `webContents.postMessage`. Each page
checks what came back and reports, and the main process prints
`FIXTURE round <page> ok`, or `BROKEN` with what was wrong. With
`FIXTURE_FLOOD=n` the open page also sends `n` messages a tick;
`FIXTURE_TICK_MS` changes the tick. With `FIXTURE_STUB_DEVTOOLS`, each web
contents' `openDevTools` prints what it was asked instead of opening a window.
The app hides its Dock icon and never shows a window or takes focus.

`build-targets.sh` downloads Electron for this Mac's architecture (35.7.5,
40.10.6 and 45.5.0 unless given versions, such as 33.4.11 and 34.5.8), and
packages the fixture three ways for each:

- `Fixture-<version>-asar.app`: in `app.asar`, with `unpacked/notes.txt` in
  `app.asar.unpacked`, the archive's header hash in `Info.plist` as
  `ElectronAsarIntegrity`, and the fuses flipped: `RunAsNode`,
  `EnableNodeOptionsEnvironmentVariable` off, `EnableCookieEncryption`,
  `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar` on;
- `Fixture-<version>-dir.app`: in an `app` folder, with the default fuses;
- `Fixture-<version>-esm.app`: in `app.asar`, with an ES module entry
  (`main.mjs`), so that `process.mainModule` is not the app's.

Each is ad-hoc signed and set to `LSUIElement`. It needs `curl`, `node` and
`npm`, and puts `@electron/asar` and `@electron/fuses` in a `tools` folder of
its own. Build outside the repository:

```sh
test/electron/build-targets.sh /tmp/electron-targets
test/electron/build-targets.sh /tmp/electron-targets 33.4.11 34.5.8
```

`harness.ts` loads the instrument with a fake `ctx` that keeps every
widget's rows, items, console entries and disabled actions, the pages, and the
files offered, and exposes them, console input and actions over RPC. Before
it creates the instrument it records the state of what the instrument taps in
the target, through the bridge, so that `run.py` can check that disposing put
it all back. It is checked against the typings Luma would write into the
instrument's folder:

```sh
python3 test/generate-typings.py ~/src/luma electron electron/luma.d.ts
cp electron/luma.d.ts test/electron/luma.d.ts
```

The instrument imports `frida-electron-bridge`, which Luma installs from npm.
For the harness, install it into the instrument's own `node_modules`, which
is not part of the instrument and is not checked in:

```sh
npm install --prefix electron --no-save --no-package-lock frida-electron-bridge@^1.0.1
```

`run.py` launches a fixture with a throwaway user data folder, attaches to the
pid it launched, and runs a scenario. Run it from the repository root with the
Python that has the `frida` module:

```sh
python3 test/electron/run.py /tmp/electron-targets/apps/Fixture-45.5.0-asar.app main
```

- `main` checks the main process. The status names it, and the facts give the
  versions, app, entry script, packaging, integrity and every fuse. The three
  web contents each have their preferences, preload, guards and a page badged
  ready. Every kind of IPC is in the table with its arguments, sums, errors,
  return values and times, and Inspect and the Message console show it whole.
  It runs some fifteen inputs in the main console and twelve in the page
  consoles (the page world, the preload world, the DOM, promises, `var`s,
  errors). It checks Show, DevTools (stubbed), Clear, Pause, Resume, the
  channel filter, the rate cap, the file table, Export, Export app.asar,
  `:save` and the archive path filter. It crashes and destroys the victim and
  checks its badges, opens a late window whose CSP forbids `eval`, and checks
  the console there. Then it disposes the instrument, checks that every tap is
  gone from the target, and checks that the app still passes its own IPC
  checks and keeps going.
- `processes` attaches to the open page's renderer (its console runs in the
  page's Node), the isolated page's sandboxed renderer (it says no Node
  environment came by), and the GPU process (no JavaScript, but fuses and
  integrity).
- `flood` has the open page send 1600 messages a second, and checks that the
  table stays at 1000 rows, that what goes over the cap is counted, and that
  the console still answers at once.
- `spawn` launches the app suspended through Frida, loads the instrument, and
  resumes. It checks that IPC is recorded from the first tick, including the
  port handed over at the second.

`run-all.sh` runs every fixture the way it should behave and writes a log per
fixture and scenario to the current directory. It leaves out Electron 34's
`asar` fixture: Electron 34 does not get as far as its ready event with that
fuse and integrity setup, with or without Frida, while 33 and 35 do.

```sh
PYTHON=python3 test/electron/run-all.sh /tmp/electron-targets
```

Each run leaves the fixture's preferences domain
(`re.frida.luma.electron-fixture.<layout>`) removed again; its user data
lives in a temporary folder that is deleted afterwards.
