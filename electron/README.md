# Electron

Takes an Electron app apart from inside its main process. It shows what the
app is built from and how it is locked down, every window and web contents
with its security preferences, the IPC between pages and the main process
with arguments and results, and a JavaScript console in the main process and
in each page.

## Which process to add it to

An Electron app runs as several processes, and the instrument works out from
the command line which one it is in.

- **The main process** (no `--type=` switch) is where everything is. Add it
  there.
- **A renderer** shows one page at a time. When the page has Node in it
  (`nodeIntegration`, or a preload without the sandbox), the console runs in
  that Node environment. A sandboxed renderer has none; the instrument says so
  and gives the main process's pid.
- **A utility process** with Node, such as one from `utilityProcess.fork`,
  gets a console too.
- **The GPU process, the network service and the other helpers** run no
  JavaScript. They still show the app's facts, its fuses and its app.asar.

## The app

The **App** table lists:

- the Electron, Chromium, Node and V8 versions;
- the app's name and version, where it is installed, its entry script (and
  whether that is an ES module), its user data folder, and whether it is a
  Mac App Store or Windows Store build;
- its command line, the Node options it was given, and switches worth
  knowing about, such as `--remote-debugging-port`, `--inspect`,
  `--no-sandbox`, `--disable-web-security` and `--ignore-certificate-errors`;
- how its code is shipped: in `app.asar` (with its size and file count), in an
  `app` folder, or not at all;
- whether **app.asar's integrity** holds. The SHA-256 of the archive's header
  is compared with the hash the app declares (`ElectronAsarIntegrity` in its
  `Info.plist`), and the table says whether Electron enforces it;
- each **fuse**, read from the fuse wire in Electron's own binary as it sits
  in memory: `RunAsNode`, `EnableCookieEncryption`,
  `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`,
  `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`,
  `LoadBrowserProcessSpecificV8Snapshot`, `GrantFileProtocolExtraPrivileges`
  and `WasmTrapHandlers`, each on, off or removed;
- the native addons (`.node` files) the process has loaded.

## Web contents

The **Web contents** table has one row per window, `BrowserView`,
`<webview>` and other web contents, kept up to date. Each row shows its type,
title, URL and renderer pid, whether it is loading, ready, unresponsive,
crashed or destroyed, and its `nodeIntegration`, `contextIsolation`, `sandbox`
and `webSecurity`. It also shows the preload script, and the guards it has: a
`window.open` handler, and `will-navigate` listeners.

Each web contents also gets a page of its own under the instrument, badged
with its state. The page has:

- every web preference it was created with, its session and session preloads,
  and its window;
- a **JavaScript** console that runs in the page's main world, as its own
  scripts do, through `executeJavaScript`. A promise an input evaluates to is
  awaited, and `var`s stay for later inputs; `await` itself works only inside
  an async function, as in `(async () => await fetch(location.href))()`.
  `:preload <js>` runs in the isolated world that a context-isolated preload
  runs in. When the page's Content Security Policy forbids `eval`, the input
  runs as a script of its own, and its value is copied out the way Electron
  copies it, so a DOM node comes back empty.

Double-clicking a row, or selecting it and pressing Return, opens the page.
**DevTools** opens DevTools for it in a window of its own, without taking focus.
A destroyed page's page stays for a minute.

## IPC

The **IPC** table records the messages between pages and the main process as
they happen:

- `send`, `sendSync` with its return value, and `invoke` with its result or
  error and how long it took, all from `ipcRenderer`;
- `postMessage` with the number of ports it transferred;
- `webContents.send`, `sendToFrame` (which `event.reply` uses) and
  `postMessage`, and the same on a `WebFrameMain`, going the other way.

Each row says which web contents and frame the message came from or went to,
with its arguments and result in short form. Selecting a row puts the whole
message, decoded, in the **Message** console, and so does typing its number
there. Bytes, dates, maps, sets, errors and class instances keep their shape.

`invoke` handlers are found on `ipcMain`, on each `webContents.ipc`, and on
each frame's `ipc` once the app has made it. **Pause** and **Resume** stop and
restart recording, and **Clear** empties the table. A chatty app is held back
by **Most IPC messages recorded per second**: what goes over that cap is
counted, not recorded. **Only IPC channels matching** narrows the table to the
channels you care about. Arguments and results are cut to **Characters kept
per message's arguments and per result**.

The taps are plain JavaScript in the main process. They only listen, and wrap
what they look at without changing what it returns. They come off again when
the instrument is removed. An `invoke` on a channel with no handler is not
shown.

## The console

The page's **JavaScript** console runs in the main process, on its event
loop, with Node and Electron in reach. `require` is the app's own, and
`electron`, `app`, `BrowserWindow`, `webContents`, `webFrameMain`, `ipcMain`,
`session`, `protocol`, `dialog` and `shell` are in scope. A promise an input
evaluates to is awaited, and `_` is the last value; `await` itself works only
inside an async function, as in `(async () => await app.whenReady())()`. A
`var` lasts for one input, so keep things on `globalThis` to use them later.
`:save <path>` offers a file from app.asar for saving.

## app.asar

The **app.asar** table lists the files in the archive, packed or unpacked
beside it in `app.asar.unpacked`. By default it leaves out `node_modules`;
change **Only list app.asar files matching** to see other files.
**Export** on a row offers that file for saving. **Export app.asar** offers
the whole archive, read straight from disk, when it is no larger than the 64
MiB a file offered for saving can be. A larger archive is refused with a
message saying so; export its files one by one instead.

## Requirements

Electron 33 or later, on macOS or Linux. The JavaScript is reached through
[frida-electron-bridge](https://github.com/frida-packages/frida-electron-bridge),
which goes in through Node's N-API. It reaches an app that sits idle as well
as a busy one, whether the instrument is added to a running app or to one
Luma spawns.
