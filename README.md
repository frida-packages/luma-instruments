# Luma instruments

Instruments for [Luma](https://luma.frida.re), published in its store.

| Instrument | Category | What it shows |
| --- | --- | --- |
| [TLS Plaintext](tls-plaintext) | Networking | A process's TLS traffic before encryption and after decryption |
| [XPC Spy](xpc-spy) | IPC | The XPC messages a process sends and receives, per service |
| [Certificates](certificates) | Cryptography | The X.509 certificates a process holds, found as live objects and in memory |
| [Trainer](trainer) | Runtime | Where a game keeps a value such as your health, to change it or lock it |
| [Lua Hunter](lua-hunter) | Runtime | The Lua interpreters embedded in a process, with a console into each |
| [Mesh Finder](mesh-finder) | UI | The 3D meshes a game or app holds in its Direct3D 11, Metal, Vulkan and OpenGL buffers, as OBJ |

Each folder is one instrument: TypeScript sources beside a `package.json`
whose `luma` object carries its icon, compatibility, features, widgets and
store listing. Its `README.md` is its description in the store.

## Writing one

[docs/instruments.md](docs/instruments.md) describes the folder, its
`package.json` and the agent module: settings, widgets, actions, console input
and publishing. [docs/views.md](docs/views.md) describes views, widgets an
instrument draws itself with Smalltalk that runs inside Luma, new in Luma
3.0.0.

## Trying one

In Luma, attach to a process, choose **Add Instrument… → Link Folder…** and
pick the instrument's folder. Edits made in Luma are written back to the
folder; edits made on disk are offered as a reload.

## Publishing

A publisher links the folder, then chooses **Publish to Store…** from the
instrument's menu and gives the release a version and notes.
