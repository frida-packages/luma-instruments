# Instruments

An instrument is a folder. Its TypeScript runs inside the target process, as
part of the Frida agent Luma injects; its `package.json` tells Luma what the
instrument is called, where it can run, what settings it has and what widgets
it shows; its `README.md` is its description in the store. This document
describes all of that as Luma 4.0.0 reads it. Widgets that run Smalltalk
inside Luma are described in [views.md](views.md).

## Contents

- [The folder](#the-folder)
- [package.json](#packagejson)
- [The agent module](#the-agent-module)
- [Settings](#settings)
- [Widgets](#widgets)
- [Actions and console input](#actions-and-console-input)
- [Persistence](#persistence)
- [Publishing](#publishing)

## The folder

```
my-instrument/
├── package.json
├── README.md
├── main.ts
└── helpers.ts
```

Every file in the folder and below it belongs to the instrument, except
`package.json`, `package-lock.json`, `luma.d.ts`, the icon file named in
`package.json`, hidden files, and `node_modules` folders. Paths use `/`, are
relative, and have no `.` or `..` segments. Luma refuses to add a file at one of
those names, or to rename one to it.

`luma.d.ts` is written by Luma when it links the folder and whenever it reloads
it: it declares the types the instrument is checked against, generated from
`package.json`. It does not belong in version control; this repository's
`.gitignore` leaves it out.

Instruments in one repository can share code by setting `luma.root` to a
folder above their own, such as `".."`. TypeScript files the instrument imports
by relative path from under that root then come along with it, wherever they
are. `main` stays relative to the instrument's own folder.

In Luma, choose **Add Instrument… → Link Folder…** on a process and pick the
folder. Edits made in Luma are written back to the folder; edits made on disk
are offered as a reload, since a reload drops what running instances hold.

## package.json

```json
{
  "name": "open-counter",
  "displayName": "Open Counter",
  "version": "1.0.0",
  "main": "main.ts",
  "engines": { "luma": ">=4.0.0" },
  "luma": {
    "icon": { "kind": "symbolic", "value": "gauge" },
    "compatibility": { "platforms": ["darwin", "linux"] },
    "settings": [],
    "widgets": [
      {
        "id": "calls",
        "name": "Calls",
        "kind": "histogram",
        "config": {}
      }
    ],
    "store": {
      "summary": "How often a process calls open.",
      "category": "storage",
      "access": { "kind": "free" }
    }
  }
}
```

| Field | Required | Is |
| --- | --- | --- |
| `name` | yes | The package name. To be published it has to match `[a-z0-9][a-z0-9-]{0,63}`; it becomes the second half of the store item's id. |
| `displayName` | no | The name Luma shows. Without it, `name` is shown. |
| `version` | no | `MAJOR.MINOR.PATCH`. Luma writes it when the instrument is published. |
| `main` | yes | The entry point, a file of the instrument. |
| `engines.luma` | no | The oldest Luma the instrument runs in, written exactly as `>=MAJOR.MINOR.PATCH`. Anything else makes Luma refuse the `package.json`. |
| `dependencies` | no | npm packages the instrument imports, name to version range. They install into the instrument's own `node_modules` inside Luma's compiler workspace, ahead of the project's packages. |
| `luma.root` | no | A folder above this one that shared code lives under; see above. |
| `luma.icon` | no | See below. |
| `luma.compatibility` | no | See below. Without it, the instrument runs anywhere. |
| `luma.settings` | no | The settings; see [Settings](#settings). |
| `luma.widgets` | no | What it shows; see [Widgets](#widgets). |
| `luma.store` | no | The store listing; see [Publishing](#publishing). |

A `package.json` Luma cannot read is refused with its path and what is wrong,
such as `…/package.json: luma.widgets[0].config.columns is missing`. Keys
this document gives a default for may be left out. Inside `luma`, a key this
document does not describe is refused too, naming it, as in
`luma.widgets[0].persistance: unknown key`; keys outside `luma`, such as
`license`, are the package's own and Luma leaves them alone.

Luma writes `package.json` back with its keys in the order this document lists
them, the values of a compatibility key in the order its table below lists
them, and the package's own keys after Luma's in the order they were in. A
widget's keys are written as `id`, `name`, `kind`, `config`, `actions` and
`persistence`; a widget with no name has no `name` key, and one with no
actions no `actions` key.

### Icon

`{ "kind": "symbolic", "value": "<id>" }` names one of Luma's icons:
`wand-stars`, `puzzle`, `bug`, `magnifyingglass`, `gauge`, `antenna`,
`shield`, `bolt`, `key`, `lock`, `network`, `cpu`, `memory`, `doc-search`,
`pin`, `scope`, `cloud` and `branch`. An id Luma does not know, or no icon at
all, shows `wand-stars`.

`{ "kind": "file", "value": "icon.png" }` names a picture in the folder
instead.

### Compatibility

```json
"compatibility": {
  "platforms": ["windows", "darwin", "linux"],
  "archs": ["x64", "arm64"]
}
```

Each key is optional, and a key that is present lists the values the target
may have, as Frida names them:

| Key | Values |
| --- | --- |
| `platforms` | `windows`, `darwin`, `linux`, `freebsd`, `qnx`, `barebone` |
| `osIDs` | `windows`, `macos`, `linux`, `ios`, `watchos`, `tvos`, `visionos`, `android`, `freebsd`, `qnx` |
| `archs` | `ia32`, `x64`, `arm`, `arm64`, `mips` |

An instrument added to a process that does not match is not loaded, and Luma
shows what it requires, such as *Requires platform Darwin; this session is
Windows/x86_64*. The store also lists instruments that fit the process first.

## The agent module

`main` is an ES module that exports `instrument`. This one, the `main.ts` of
the `package.json` above, counts calls to `open` in the `calls` histogram:

```ts
export const instrument: CustomInstrument = {
    create(ctx, config, restored) {
        const calls = ctx.widget("calls");
        const open = Module.getGlobalExportByName("open");
        const listener = Interceptor.attach(open, {
            onEnter() {
                calls.incrementBucket("open");
            },
        });
        return {
            dispose() {
                listener.detach();
            },
        };
    },
};
```

`create` runs when the instrument is added to a process or loaded again, and
returns a handle, or a promise of one. Every method of the handle is optional:

| Method | Called |
| --- | --- |
| `updateConfig(config)` | The user changed a setting. |
| `onAction({ widget, action, item }, respond)` | The user chose one of a widget's actions, or an action on a list or table row. `item` is the row's id, and absent for a widget's own action. `respond.file` offers the user a file to save; see [Actions and console input](#actions-and-console-input). |
| `onConsoleInput({ widget, entryId, text }, respond)` | The user submitted text in a console widget. |
| `onViewMessage({ widget, value, data, from })` | A view sent a message; see [views.md](views.md). |
| `dispose()` | The instance is removed, disabled or about to be loaded again. Undo everything `create` did. |

When the instrument's source changes, its instances are disposed and created
again with the new source.

`ctx` has two methods:

- `ctx.widget(id)` answers the handle of a widget declared in `package.json`.
- `ctx.emit(value)` adds an event to Luma's event stream. `value` can be any
  JavaScript value, `NativePointer`s and `ArrayBuffer`s included; Luma shows it
  as a value the user can expand.

`luma.d.ts` declares `CustomInstrument`, `CustomInstrumentContext` and the
rest, so `ctx.widget("calls")` is typed as the widget `calls` is, and
`config.settings` holds exactly the declared settings. The declarations every
instrument shares are `CustomInstrumentTypings` in Luma's
`Sources/LumaCore/EditorProfile.swift`, for type-checking outside Luma.

## Settings

Settings are what the user can change about an instrument. Each is shown in
Luma and reaches the agent in `config.settings`, under its id, both in
`create` and in `updateConfig`. Luma 3.0.0 called them features, declared in
`luma.features` and read from `config.features`; Luma 4.0.0 reads only
`luma.settings`, and refuses a `package.json` that still says `luma.features`
as `luma.features: unknown key`.

```json
{
  "id": "dataLimit",
  "name": "Bytes kept per data value",
  "schema": { "kind": "uint", "default": 4096, "min": 0, "max": 1048576 }
}
```

`id` and `name` are required. The rest default:

- `schema` defaults to a `boolean` that starts false, so `{ "id": "logStack",
  "name": "Log stacks" }` is a switch that is off.
- `optional` defaults to `false`: the setting always has a value. With
  `"optional": true` the user can switch it off; while it is off, its id is
  absent from `config.settings`, and the typings mark it optional.
- `enabledByDefault`, whether an optional setting starts on, defaults to
  `true`.
- A `boolean` setting is never optional: Luma treats `optional: true` on one as
  `false`, and the value is the boolean itself.

Each `schema` has a `kind` and the keys of that kind. Luma refuses a
`package.json` that leaves out a required one, naming it, as in
`luma.settings[0].schema.default is missing`.

| `kind` | Required | Optional | Value in `config.settings` |
| --- | --- | --- | --- |
| `boolean` | | `default`, `false` when left out | `boolean` |
| `int` | `default` | `min`, `max` | `number` |
| `uint` | `default` | `min`, `max` | `number` |
| `double` | `default` | `min`, `max` | `number` |
| `string` | `default` | | `string` |
| `regex` | `default` | | `string`, the pattern |
| `combo` | `choices` | `default`, the first choice when left out | the chosen choice's `id` |
| `object` | `fields` | | an object with a key per field |
| `array` | `item`, `default` | | an array |

A `combo`'s `choices` are `[{ "id": "…", "name": "…" }]`, both keys required,
and the typings make its value the union of the ids. Its `default` has to be
one of the ids; Luma refuses one that is not, wherever the `combo` is, as in
`luma.settings[0].schema.default: 'verbose' is none of the choices` or
`luma.settings[0].schema.fields[0].schema.default: 'verbose' is none of the
choices`.

An `object`'s `fields` are like settings: `{ id, name, schema, optional,
enabledByDefault }`, of which `id`, `name` and `schema` are required, and
`optional` and `enabledByDefault` default as a setting's do. A field that is
optional and off is absent from the object.

An `array`'s `item` is `{ "kind": "…" }`, one of `boolean`, `int`, `uint`,
`double`, `string`, `regex`, `combo` (which requires `choices`) and `object`
(which requires `fields`); it takes no `default` of its own. The array's
`default` is required, and written as tagged values, not as plain JSON: each
`{ "kind": "…", "value": … }`, with the item's kind, or `string` for a `combo`
item; an `object` item's `value` is an object of tagged values, one per field.
Luma refuses an element that does not fit the item, naming it, as in
`luma.settings[0].schema.default[1]: does not match the item schema`, and an
element of a `combo` item that names none of its choices, as in
`luma.settings[0].schema.default[1]: 'verbose' is none of the choices`:

```json
{
  "id": "libraries",
  "name": "Libraries to watch",
  "schema": {
    "kind": "array",
    "item": { "kind": "string" },
    "default": [{ "kind": "string", "value": "libssl" }]
  }
}
```

`config.settings.libraries` is then `["libssl"]`.

## Widgets

Widgets are declared in `luma.widgets` and cannot be created at run time. Each
has an `id` and a `kind`, which are required, a `name`, its title, which is
optional, `actions`, which defaults to none (see
[Actions and console input](#actions-and-console-input)), and a `persistence`,
which defaults to `none`:

```json
{
  "id": "services",
  "name": "Services",
  "kind": "table",
  "config": {
    "columns": [
      { "id": "service", "name": "Service" },
      { "id": "sent", "name": "Sent", "alignment": "trailing" }
    ]
  },
  "actions": [{ "id": "clear", "name": "Clear" }],
  "persistence": "session"
}
```

`config` is required too, beside `kind`, `{}` when every key in it has a
default. Keys without a default in the table below are required.

A widget without a `name` is shown with no title: with no actions either,
nothing is shown above it, and with actions only their buttons are. Leave the
name out where a title would only repeat the instrument's name or say what is
obvious, such as a single status line. Where Luma has to name the widget in
words, as in its editor's list of widgets, its messages and the comment in the
typings, it uses the id.

This is the form Luma 4.0.0 reads. Luma 3.0.0 read `config` nested inside
`kind`, as `"kind": { "kind": "table", "config": { … } }`, and refuses the form
above, so an instrument written this way declares `"engines": { "luma":
">=4.0.0" }`. Luma 4.0.0 refuses the nested form in turn, as
`luma.widgets[0].kind: Expected to decode String but found a dictionary
instead.`

Luma 4.0.0 is the first to take a widget without a `name`. It refuses an
empty or blank one as `luma.widgets[0].name: must not be empty; leave the key
out for a widget with no title`.

A list's or table's row actions were `actions` inside `config` before Luma
4.0.0. Luma 4.0.0 calls them `rowActions`, and refuses `actions` there as
`luma.widgets[0].config.actions: unknown key (now rowActions)`; `actions` now
belongs to the widget itself.

| `kind` | `config` | Handle methods |
| --- | --- | --- |
| `counter` | `unit` (optional) | `setCounter({ value, unit?, delta? })` |
| `histogram` | `maxBuckets` (100) | `setHistogram([{ label, count }])`, `incrementBucket(label, by?)` |
| `graph` | `series: [{ id, name }]`, `maxPoints` (5000) | `push({ series, x, y })` |
| `list` | `rowActions: [{ id, name }]` (none), `maxItems` (1000) | `upsertItem({ id, title, subtitle?, accessory? })`, `removeItem(id)` |
| `table` | `columns: [{ id, name, alignment }]`, `rowActions: [{ id, name }]` (none), `maxRows` (1000) | `upsertRow({ id, cells })`, `removeRow(id)` |
| `hex` | `maxBytes` (16384) | `setHex({ bytes, baseAddress? })` |
| `console` | `maxEntries` (1000), `prompt`, `placeholder`, `runButtonLabel` (the last three optional) | `appendOutput(text)`, `appendError(text)`, `appendValue(value)`, `appendImage({ bytes, mediaType, width, height, text? })`, `appendConsole({ id?, kind, text })` |
| `view` | `class`, `height` (360) | See [views.md](views.md). |

Every handle also has `clear()`, which empties the widget. Luma itself has no
way to clear a widget; an instrument that wants one declares a Clear action,
as [Actions and console input](#actions-and-console-input) shows. The handle of
a widget that declares `actions` also has `setActionEnabled(action, enabled)`,
described there too.

- A column's `alignment` is `leading`, the default, or `trailing`. A table
  row's `cells` has a string for each column id.
- `upsertItem` and `upsertRow` replace the item or row with the same `id`, or
  add it at the end. `incrementBucket` adds a bucket with that label when there
  is none.
- `setHex` takes the bytes as an `ArrayBuffer` or an array of numbers, and the
  address of the first one as a number, a `"0x…"` string or a decimal string,
  so `ptr.toString()` will do.
- `appendValue` shows any JavaScript value as the REPL does. `appendConsole`
  with `kind: "input"` shows a line as if the user had typed it.

The `max…` keys bound what a widget keeps, and the oldest goes first: a list,
table, console or histogram keeps its last entries, a graph its last points in
each series, and a hex widget its last bytes, with the base address moved up
to match.

## Actions and console input

A widget of any kind can declare `actions`, `[{ id, name }]`, beside its
`config`. Luma shows them as buttons in the widget's header, in the order they
are declared. Choosing one calls the handle's `onAction` with the widget's id
and the action's id, and no `item` key at all.

A list or table can also declare `rowActions` in its `config`, with the same
shape. Luma shows them on each row, and choosing one calls `onAction` with the
row's id as `item` as well.

An action's id is unique within its widget, across `actions` and `rowActions`
together; Luma refuses a repeated one as
`luma.widgets[1].config.rowActions[0].id: "clear" is already the id of another
action of this widget`. In a lab, both kinds are enabled only for the
session's host and for owners of the lab, and they run in the host's agent.
The typings make `item` a `string` for a row action and `undefined` for a
widget's own, so checking `widget` or `action` first tells the compiler which
one it has.

Luma has no Clear of its own: what a widget shows is the agent's to change. An
instrument that wants one declares it as an action, and empties both the
widget and whatever it keeps behind it, so that the two stay in step:

```json
"actions": [{ "id": "clear", "name": "Clear" }]
```

```ts
onAction({ widget }) {
    if (widget === "messages") {
        recent.clear();
        messages.clear();
    }
},
```

Offer Clear where emptying the widget is true to what it shows, such as a
console's scrollback or a log of traffic that only grows. A widget that lists
things that still exist, such as objects found in memory, is better without
one: emptied, it would say they are gone.

A widget's buttons, its row actions and a console's input are available only
once the instance's `create` has resolved, and are off while the instance is
disabled, after its load failed or its `create` threw, and while it is being
loaded again. So `create` should return its handle promptly and start long
work, such as a first scan, without awaiting it; awaited, it keeps every
button gray until it is done.

`setActionEnabled(action, enabled)` turns one of the widget's own actions off
or on; row actions have no such switch. A disabled action's button is shown
disabled, and Luma drops a choice of it, including one already on its way when
it was disabled, before `onAction`. Luma enables every action right before it
calls `create`, so each run starts with all of them enabled whatever an earlier
run left; `clear()` leaves them as they are, and which are enabled is never
saved with the session. An instrument that scans uses it to keep Rescan from
being chosen while a scan is under way, and enables it again however the scan
ends:

```ts
startScan() {
    table.setActionEnabled("rescan", false);
    scan().finally(() => table.setActionEnabled("rescan", true));
},
```

A console widget has a text field, available in the Luma that hosts the
session once the instance's `create` has resolved, and off whenever the
instance's buttons are. When the user submits, Luma shows the input and calls
`onConsoleInput` with the text and a `respond` object, whose
`output(text)`, `error(text)`, `value(v)` and `image(img)` add entries grouped
with that input. An exception thrown by `onConsoleInput`, or a promise from it
that rejects, is shown as an error entry. To write to the console at other
times, use the widget's own `append…` methods.

`onAction` gets a `respond` object too. It and the console's have `file`,
which offers one file to the user who chose the action or submitted the input;
Luma asks them where to save it. `name` is a plain file name, such as `cube.obj`, with no path,
and `mediaType` a media type such as `model/obj`. Given `bytes`, an
`ArrayBuffer`, a typed array or an array of numbers, `file` offers them as they
are:

```ts
respond.file({ name: "server.der", mediaType: "application/pkix-cert", bytes: der });
```

Without `bytes`, it returns a Node `Writable` to write or pipe the file into,
and end; it can still be written after the handler has returned. Mesh Finder's
**Export OBJ** writes its OBJ this way, in the pieces it builds it in, rather
than joining them into one buffer first:

```ts
const file = respond.file({ name: "#3 Cube vertices.obj", mediaType: "model/obj" });
for (const piece of obj.pieces) {
    file.write(piece);
}
file.end();
```

Call `file` while the handler runs, before it returns or its promise settles,
and at most once per call. A name that is not a plain file name, or a media
type that is not one, throws a `TypeError`. A file is at most 64 MiB: more
`bytes` than that throw a `RangeError`, and the write that takes a stream past
it fails with one, so check the size before offering, as Mesh Finder does,
when the user should hear why in the instrument's own words. The agent never
learns where the file was saved, or whether it was; to say what was offered,
write to the console. When a mission chose the action, the file is dropped.

## Persistence

A widget's `persistence` is `session` or `none`. With `session`, what the
widget shows is saved with the session in the project, shown again when the
project is reopened, and handed back to `create` in `restored`, under the
widget's id:

| `kind` | `restored[id]` |
| --- | --- |
| `counter` | `{ counter: { value, unit?, delta? } \| null }` |
| `histogram` | `{ buckets: [{ label, count }] }` |
| `graph` | `{ points: [{ series, x, y }] }` |
| `list` | `{ items: [{ id, title, subtitle?, accessory? }] }` |
| `table` | `{ rows: [{ id, cells }] }` |
| `hex` | `{ hex: { bytes, base_address } \| null }`, `bytes` in base64 |
| `console` | `{ entries: [{ id, kind, text }] }` |
| `view` | `{ state }`, the state's value or `null` |

Widgets left at `none` are absent from `restored`, and what they show is gone
when the project closes.

## Publishing

`luma.store` is the listing:

- `summary`: one or two sentences for the store's list.
- `category`: one of `networking`, `cryptography`, `storage`, `ipc`,
  `runtime`, `ui`, `security-checks` and `performance`.
- `access`: `{ "kind": "free" }`, or `{ "kind": "sponsor", "minMonthlyCents":
  500 }` for an instrument only sponsors giving at least that much a month may
  install.

`README.md` is the description, in Markdown.

A publisher links the folder, then chooses **Publish to Store…** from the
instrument's menu, which opens from its row under Custom Instruments in the
sidebar and from the menu button beside its name above the editor; the item is
there only while the instrument is linked to a folder. The form starts from
`luma.store` and `version`, asks for the release's version and notes, and
writes the listing and version back into `package.json` once the store has
taken the release. Publishing needs a store account that may publish; the
item's id is the publisher's handle and the package `name`, such as
`<handle>/open-counter`.

An instrument with any widget or setting is refused unless it declares
`"engines": { "luma": ">=4.0.0" }`, since Luma 3.0.0 cannot read the form this
document describes, and one with `.st` files but neither is refused unless it
declares at least `">=3.0.0"`. Luma writes or raises that line when an edit in
its own editor brings the instrument to need it, and never lowers it; an edit
made on disk is taken as it is, and a folder linked with less than it needs
still links and runs, but cannot be published until it says so. Luma shows an
item whose `engines.luma` names a newer version than itself with that
requirement, and does not install it.

Installing an item puts it in Luma's instrument library, in a folder named
after the item, which projects then link like any other folder. Installing a
newer version updates that folder; Luma asks before replacing a copy that was
edited since it was installed.
