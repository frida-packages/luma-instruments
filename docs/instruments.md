# Instruments

An instrument is a folder. Its TypeScript runs inside the target process, as
part of the Frida agent Luma injects; its `package.json` tells Luma what the
instrument is called, where it can run, what settings it has and what widgets
it shows; its `README.md` is its description in the store. This document
describes all of that as Luma 3.0.0 reads it. Widgets that run Smalltalk
inside Luma are described in [views.md](views.md).

## Contents

- [The folder](#the-folder)
- [package.json](#packagejson)
- [The agent module](#the-agent-module)
- [Features](#features)
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
relative, and have no `.` or `..` segments.

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
  "luma": {
    "icon": { "kind": "symbolic", "value": "gauge" },
    "compatibility": { "platforms": ["darwin", "linux"] },
    "features": [],
    "widgets": [
      {
        "id": "calls",
        "name": "Calls",
        "kind": { "kind": "histogram", "config": {} }
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
| `dependencies` | no | npm packages the instrument imports, name to version range. They install into the instrument's own `node_modules` inside Luma's compiler workspace, ahead of the project's packages. |
| `engines.luma` | no | The oldest Luma the instrument runs in, written exactly as `>=MAJOR.MINOR.PATCH`. Anything else makes Luma refuse the `package.json`. |
| `luma.root` | no | A folder above this one that shared code lives under; see above. |
| `luma.icon` | no | See below. |
| `luma.compatibility` | no | See below. Without it, the instrument runs anywhere. |
| `luma.features` | no | The settings; see [Features](#features). |
| `luma.widgets` | no | What it shows; see [Widgets](#widgets). |
| `luma.store` | no | The store listing; see [Publishing](#publishing). |

A `package.json` Luma cannot read is refused with its path and what is wrong,
such as `…/package.json: luma.widgets[0].kind.config.columns is missing`. Keys
this document gives a default for may be left out.

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
  "archs": ["arm64", "x64"]
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
| `onAction({ widget, action, item })` | The user chose an action on a list or table row. |
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
`config.features` holds exactly the declared features. The declarations every
instrument shares are `CustomInstrumentTypings` in Luma's
`Sources/LumaCore/EditorProfile.swift`, for type-checking outside Luma.

## Features

Features are the instrument's settings. Each is shown in Luma and reaches the
agent in `config.features`, under its id, both in `create` and in
`updateConfig`.

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
- `optional` defaults to `false`: the feature always has a value. With
  `"optional": true` the user can switch it off; while it is off, its id is
  absent from `config.features`, and the typings mark it optional.
- `enabledByDefault`, whether an optional feature starts on, defaults to
  `true`.
- A `boolean` feature is never optional: Luma treats `optional: true` on one as
  `false`, and the value is the boolean itself.

Each `schema` has a `kind` and the keys of that kind. Luma refuses a
`package.json` that leaves out a required one, naming it, as in
`luma.features[0].schema.default is missing`.

| `kind` | Required | Optional | Value in `config.features` |
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
`luma.features[0].schema.default: 'verbose' is none of the choices` or
`luma.features[0].schema.fields[0].schema.default: 'verbose' is none of the
choices`.

An `object`'s `fields` are like features: `{ id, name, schema, optional,
enabledByDefault }`, of which `id`, `name` and `schema` are required, and
`optional` and `enabledByDefault` default as a feature's do. A field that is
optional and off is absent from the object.

An `array`'s `item` is `{ "kind": "…" }`, one of `boolean`, `int`, `uint`,
`double`, `string`, `regex`, `combo` (which requires `choices`) and `object`
(which requires `fields`); it takes no `default` of its own. The array's
`default` is required, and written as tagged values, not as plain JSON: each
`{ "kind": "…", "value": … }`, with the item's kind, or `string` for a `combo`
item; an `object` item's `value` is an object of tagged values, one per field.
Luma refuses an element that does not fit the item, naming it, as in
`luma.features[0].schema.default[1]: does not match the item schema`, and an
element of a `combo` item that names none of its choices, as in
`luma.features[0].schema.default[1]: 'verbose' is none of the choices`:

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

`config.features.libraries` is then `["libssl"]`.

## Widgets

Widgets are declared in `luma.widgets` and cannot be created at run time. Each
has an `id`, a `name` and a `kind`, which are required, and a `persistence`,
which defaults to `none`:

```json
{
  "id": "services",
  "name": "Services",
  "kind": {
    "kind": "table",
    "config": {
      "columns": [
        { "id": "service", "name": "Service" },
        { "id": "sent", "name": "Sent", "alignment": "trailing" }
      ]
    }
  },
  "persistence": "session"
}
```

`config` is required too, `{}` when every key in it has a default. Keys without
a default in the table below are required:

| `kind` | `config` | Handle methods |
| --- | --- | --- |
| `counter` | `unit` (optional) | `setCounter({ value, unit?, delta? })` |
| `histogram` | `maxBuckets` (100) | `setHistogram([{ label, count }])`, `incrementBucket(label, by?)` |
| `graph` | `series: [{ id, name }]`, `maxPoints` (5000) | `push({ series, x, y })` |
| `list` | `actions: [{ id, name }]` (none), `maxItems` (1000) | `upsertItem({ id, title, subtitle?, accessory? })`, `removeItem(id)` |
| `table` | `columns: [{ id, name, alignment }]`, `actions: [{ id, name }]` (none), `maxRows` (1000) | `upsertRow({ id, cells })`, `removeRow(id)` |
| `hex` | `maxBytes` (16384) | `setHex({ bytes, baseAddress? })` |
| `console` | `maxEntries` (1000), `prompt`, `placeholder`, `runButtonLabel` (the last three optional) | `appendOutput(text)`, `appendError(text)`, `appendValue(value)`, `appendImage({ bytes, mediaType, width, height, text? })`, `appendConsole({ id?, kind, text })` |
| `view` | `class`, `height` (360) | See [views.md](views.md). |

Every handle also has `clear()`, which empties the widget.

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

A list or table with `actions` shows them on each row. Choosing one calls the
handle's `onAction` with the widget's id, the action's id and the row's id as
`item`. In a lab, an owner of the lab can choose actions too; they run in the
host's agent.

A console widget has a text field. When the user submits, Luma shows the input
and calls `onConsoleInput` with the text and a `respond` object, whose
`output(text)`, `error(text)`, `value(v)` and `image(img)` add entries grouped
with that input. An exception thrown by `onConsoleInput`, or a promise from it
that rejects, is shown as an error entry. To write to the console at other
times, use the widget's own `append…` methods.

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
instrument's menu. The form starts from `luma.store` and `version`, asks for
the release's version and notes, and writes the listing and version back into
`package.json` once the store has taken the release. Publishing needs a store
account that may publish; the item's id is the publisher's handle and the
package `name`, such as `<handle>/open-counter`.

An instrument with a view widget or `.st` files is refused unless it declares
`"engines": { "luma": ">=3.0.0" }`; Luma writes that line when either is added
in its own editor, but not for an edit made on disk. Luma shows an item whose
`engines.luma` names a newer version than itself with that requirement, and does
not install it.

Installing an item puts it in Luma's instrument library, in a folder named
after the item, which projects then link like any other folder. Installing a
newer version updates that folder; Luma asks before replacing a copy that was
edited since it was installed.
