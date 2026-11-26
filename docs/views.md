# Views

A view is a widget whose contents an instrument draws itself. The instrument
ships Smalltalk beside its TypeScript: a class in a `.st` file, which runs
inside Luma's embedded Pharo image, not in the target process. Luma makes one
object of that class for the widget, feeds it what the agent sends, and shows
what the object declares: a canvas it draws on with its own shaders, or lists,
text and charts built the way Pharo's inspector builds them.

Views are new in Luma 3.0.0. This document assumes you know how the rest of an
instrument works; [instruments.md](instruments.md) describes it.

Reach for a view when none of the other widget kinds can show what the
instrument found: a mesh to orbit, a memory map to zoom into, a protocol state
machine, a list whose rows are computed from structured state. When a table, a
console or a hex dump will do, use one of those: they need no Smalltalk, no
approval from the user, and work in every version of Luma.

## Contents

- [A first view](#a-first-view)
- [Smalltalk for TypeScript authors](#smalltalk-for-typescript-authors)
- [The Smalltalk files](#the-smalltalk-files)
- [Declaring the widget](#declaring-the-widget)
- [What a view class implements](#what-a-view-class-implements)
- [The context](#the-context)
- [Showing lists, text and charts](#showing-lists-text-and-charts)
- [Drawing on a canvas](#drawing-on-a-canvas)
- [The agent side](#the-agent-side)
- [Binary data](#binary-data)
- [Input](#input)
- [Deadlines and errors](#deadlines-and-errors)
- [Limits](#limits)
- [Labs](#labs)
- [When Luma asks first](#when-luma-asks-first)
- [Older versions of Luma](#older-versions-of-luma)

## A first view

This instrument lists the target's modules in a view with two tabs: a table of
names and sizes, and a line of text that counts them. It is three files in one
folder.

`package.json`:

```json
{
  "name": "module-list",
  "version": "1.0.0",
  "main": "main.ts",
  "engines": { "luma": ">=4.0.0" },
  "luma": {
    "icon": { "kind": "symbolic", "value": "memory" },
    "widgets": [
      {
        "id": "modules",
        "name": "Modules",
        "kind": "view",
        "config": { "class": "ModuleListView" },
        "persistence": "session"
      }
    ]
  }
}
```

`main.ts`:

```ts
export const instrument: CustomInstrument = {
    create(ctx) {
        const modules = Process.enumerateModules()
            .map(m => ({ name: m.name, size: m.size }));
        ctx.widget("modules").setState({ modules });
        return {};
    },
};
```

`ModuleListView.class.st`:

```smalltalk
Class {
	#name : 'ModuleListView',
	#superclass : 'Object',
	#instVars : [
		'context',
		'modules'
	],
	#category : 'ModuleList'
}

{ #category : 'initialization' }
ModuleListView >> initialize [
	modules := #()
]

{ #category : 'opening' }
ModuleListView >> openIn: aContext [
	context := aContext
]

{ #category : 'receiving' }
ModuleListView >> state: aValue data: someBytes [
	modules := aValue
		ifNil: [ #() ]
		ifNotNil: [ :value | value at: 'modules' ifAbsent: [ #() ] ].
	context changed
]

{ #category : 'views' }
ModuleListView >> gtModulesFor: aView [
	<gtView>
	^ aView columnedList
		title: 'Modules';
		priority: 1;
		items: [ modules ];
		column: 'Name' text: [ :each | each at: 'name' ];
		column: 'Size' do: [ :column |
			column
				text: [ :each | (each at: 'size') printString ];
				fitContent ]
]

{ #category : 'views' }
ModuleListView >> gtSummaryFor: aView [
	<gtView>
	^ aView text
		title: 'Summary';
		priority: 2;
		text: [ modules size printString , ' modules' ]
]
```

Link the folder in Luma (**Add Instrument… → Link Folder…**) and add the
instrument to a process. The widget first asks whether the instrument may run
its own code inside Luma, since a folder on disk is not a copy the store has
published; choose **Allow**. Then the agent's state reaches `state:data:`,
which keeps it and calls `changed`, and Luma reads the two `<gtView>` methods
and shows them as tabs.

## Smalltalk for TypeScript authors

Enough Smalltalk to read and write the examples here:

- Everything is a message sent to an object. `modules size` sends `size` to
  `modules`; `a + b` sends `+` to `a`; `value at: 'name' ifAbsent: [ 0 ]` sends
  the one message `at:ifAbsent:` with two arguments. Unary messages bind
  tightest, then binary ones, then keyword ones; use parentheses for anything
  else: `(each at: 'size') printString`.
- `x := 3` assigns. A period separates statements. `^ x` returns `x`; a method
  that returns nothing explicitly returns the receiver, `self`.
- `'text'` is a string (a quote inside is written twice: `'it''s'`), `#name` a
  symbol, `$a` a character, `#(1 2 3)` a literal array, `{ a. b }` an array of
  computed elements, `"this"` a comment.
- `[ :each | each * 2 ]` is a block, a closure. `aBlock value: 3` calls it.
  Conditionals and loops are messages that take blocks: `x > 0 ifTrue: [ … ]
  ifFalse: [ … ]`, `x ifNil: [ … ] ifNotNil: [ :y | … ]`, `items do: [ :each |
  … ]`, `items collect: [ :each | … ]`.
- A semicolon sends another message to the receiver of the previous one: `aView
  list title: 'A'; items: [ … ]` sends `title:` and `items:` to the same list.
  `yourself` answers that receiver, for the end of such a cascade.
- `nil`, `true` and `false` are objects. Arrays and strings are indexed from 1.
- `{ 'mode' -> 'wire' } asDictionary` makes a dictionary; `d at: 'mode'` reads
  it and raises an error when the key is missing, while `d at: 'mode' ifAbsent:
  [ nil ]` does not.

JSON from the agent arrives as Pharo's STON reads it: an object is a
`Dictionary` with `String` keys, an array an `Array`, a number an `Integer` or
a `Float`, a string a `String`, `true` and `false` themselves, and `null`
`nil`.

## The Smalltalk files

The Smalltalk of an instrument is exactly its files whose path ends in `.st`,
in the instrument's folder or below it. Luma reads nothing else in the folder
into the image. From Luma 4.0.0 the instrument editor colors these files the
way the Playground does and completes in method bodies, offering the
instrument's own classes, selectors and instance variables beside the
image's. Luma 3.0.0 has that only in the Playground and shows these files as
plain text, so there an editor of your own, or Pharo, is the better place to
write them.

Each file is [Tonel](https://github.com/pharo-vcs/tonel), the format Pharo
writes packages in: a `Class { … }` header followed by the class's methods,
each preceded by a `{ #category : '…' }` line. One class a file, named
`ClassName.class.st`, is the convention. A class written in a Pharo image and
saved through Iceberg is already in this form.

A file may hold:

- One class definition. Luma uses `#name`, `#superclass`, `#instVars`,
  `#classVars` and `#classInstVars`; other keys, such as `#category`,
  `#package` and `#tag`, are read and ignored.
- Its instance-side methods (`ModuleListView >> state: aValue data: someBytes [
  … ]`) and class-side methods (`ModuleListView class >> named: aString [ …
  ]`).
- Or an `Extension { #name : 'ModuleListView' }` header with methods for a
  class the same instrument defines.

Refused, with a message in the widget naming the file:

- A class that is not a plain one: a trait, or a class whose `#type` is
  anything but `#normal`, such as `#variable`, `#bytes` or `#words` (`… only
  plain classes can be defined, and … is not one`).
- A class defined twice, or one whose superclass is neither a class of the
  same instrument nor a class the image has.
- An extension of a class the instrument does not define, `Object` included
  (`… is not a class of this instrument, so it cannot be extended`).
- A method that does not compile, or that names a variable nothing defines
  (`MeshView.class.st: MeshView>>aim names lense, which nothing defines`).
  This catches a misspelled class or instance variable when the code is
  loaded, not when the method first runs.

When any file is refused, none of the instrument's Smalltalk is loaded.

The class-side `initialize` method is never run. Do setup in the instance-side
`initialize`, which `new` runs, or in `openIn:`.

### How instrument classes are kept apart

An instrument's classes are anonymous: they are not entered in the image's
globals, so two instruments may both define `MeshView` and neither sees the
other's. Inside the instrument's methods, its own class names resolve to its
own classes and every other name to the image's. `Smalltalk at: #MeshView`
does not find an instrument's class; name the class directly.

Classes are made once for each instrument, session and version of its
Smalltalk. The views of one instrument in one session share them, so class
variables and class-side instance variables are shared by all its view widgets
and by every instance of it added to that session, as those instances share the
agent's module. Nothing is shared with another session, another instrument,
even one whose Smalltalk is byte for byte the same, or another version. When
the Smalltalk changes, the views running the old version are closed and fresh
classes are made for the new one. Once no view uses a set of classes, Luma lets
go of them, class-side state included: a view started or restarted after that
gets fresh classes.

Instrument classes are not part of the project's own Smalltalk: they do not
appear among the classes and methods a project keeps.

## Declaring the widget

A view is a widget like any other in `luma.widgets`, of kind `view`:

```json
{
  "id": "plot",
  "name": "Plot",
  "kind": "view",
  "config": { "class": "BytePlotView", "height": 300 },
  "persistence": "session"
}
```

This is the form Luma 4.0.0 reads, with `kind` and `config` side by side; see
[Widgets](instruments.md#widgets) for the nested form Luma 3.0.0 read. The
examples here declare `"engines": { "luma": ">=4.0.0" }` for that reason.

- `class` is the name of a class the instrument's `.st` files define. It is
  not checked when the folder is linked: a missing class shows in the widget as
  `its Smalltalk defines no class BytePlotView` when the view starts, and an
  instrument with no `.st` file at all as `The instrument has no Smalltalk (.st
  files) to show this widget with.`
- `height` is how tall the widget is, in points. It defaults to 360.
- `persistence` is `session` or `none`, as for other widgets. With `session`,
  the latest state, its binary data included, is saved with the session in the
  project and restored when the project is opened again. With `none`, it is
  kept only while the project is open.

Luma makes one object of the class for each instance of the instrument and
each view widget, so two view widgets naming the same class get one object
each.

An instrument with a view widget, or any other widget, must say that it needs
Luma 4.0.0 or newer, or it cannot be published:

```json
"engines": { "luma": ">=4.0.0" }
```

The value has to be exactly `>=` followed by `MAJOR.MINOR.PATCH`, without
spaces; anything else makes Luma refuse the `package.json`. When a view widget
is added in Luma's own editor, Luma writes this line itself, and raises it
when it says less; a `.st` file added or renamed into an instrument with no
widget there raises it to `>=3.0.0`. An edit made on disk is taken as
it is, so a folder edited elsewhere has to say so itself.

## What a view class implements

Luma sends these messages to the view object, one at a time, on a process of
the view's own; two are never in progress at once, though a process the view
starts with `fork:` runs alongside them. Every one is optional: a message the
class does not implement is skipped.

| Message | When |
| --- | --- |
| `new`, so `initialize` | The view starts. |
| `openIn: aLumaViewContext` | Right after `new`, once. |
| `state: aValue data: aLumaBytesOrNil` | Right after `openIn:`, and whenever the agent sets or clears the state. |
| `event: aValue data: aLumaBytesOrNil` | The agent sends an event. |
| `input: aLumaInputEvent` | The pointer, scroll, zoom or a key does something over a canvas the view made through its context. |
| Its `<gtView>` methods | Luma shows the widget, and again after the view sends `changed`. |
| `close` | The view is about to go away, unless it stopped on an error. |

`state:data:` is always sent once after `openIn:`, with `nil` and `nil` when
there is no state yet, and it is sent with `nil` and `nil` again whenever the
agent calls `clear()`. Handle `nil` there. Luma never clears a view on its own;
a view widget that should have a Clear button declares it as one of its
`actions`, and the agent calls `clear()` when it is chosen.

A view starts the first time its widget is shown, not when the instrument
starts. Once started, it keeps running while its widget is out of sight and
keeps receiving states and events. It is closed when the instance is disabled
or removed, when the instrument's Smalltalk or the widget's `class` changes,
and when the project closes; a change to the instrument's TypeScript alone
leaves it running. It does not need the process to be attached: when the
process detaches, the view goes on running and showing the last state it was
given, and hears the agent again once the session is attached again. Reopening
a project starts views from their kept state.

States and events queue up while the view is busy, and in two ways the queue
is not first in, first out:

- A queued state is replaced by a newer one in its place in the queue, so a
  slow view skips states it never had time to see, and a newer state can be
  handled before an event the agent sent ahead of it.
- Consecutive pointer moves, scrolls and zooms are merged; see [Input](#input).

Events that arrive while the view is not running, because it has not started,
is waiting for the user to allow it, or stopped on an error, are held, the
latest 64 of them, and delivered after the state when it starts.

## The context

`openIn:` hands the view a `LumaViewContext`, its way to Luma:

| Message | Answers or does |
| --- | --- |
| `canvas` | A new `LumaCanvas` belonging to the view. `input:` hears what happens over it. It is destroyed when the view stops. |
| `changed` | Has the widget collect the `<gtView>` methods again and redraw what they show. |
| `send: aValue` | Sends `aValue` to the agent's `onViewMessage`. Answers whether it was sent. |
| `send: aValue data: aByteArray` | The same, with binary data, which has to be a `ByteArray`. |
| `canSend` | Whether `send:` reaches the agent right now: false until the instance's `create` has resolved. |
| `spawn: anObject` | Opens `anObject` in the column beside the view, as opening a row opens what its `send:` answers. Answers whether the widget was on screen to open it. Needs Luma 4.0.0; see [Opening what was clicked](#opening-what-was-clicked). |
| `fork: aBlock` | Runs `aBlock` in a new process that stops with the view. An error in it stops the view. It has no deadline. |
| `instanceID` | The instrument instance's id, as a string. |
| `widgetID` | The widget's `id` from `package.json`. |
| `widgetName` | The widget's `name`, or its id when it has none. |

`aValue` for `send:` has to be something STON can write as JSON: a
`Dictionary` with string keys, an `Array`, a `String`, a number, `true`,
`false` or `nil`, nested as deep as needed.

`send:` answers `false` without sending when `canSend` is false: until the
instance's `create` has resolved; while the instance is disabled, after its
load failed or its `create` threw, and while it is being loaded again; and in
a lab, for a member who is not an owner (see [Labs](#labs)). A message over
the [limits](#limits) raises an error instead, which stops the view unless it
is handled.

A view's own drawing and interaction run in Luma and need no agent: it draws,
pans, zooms and opens what is clicked before `create` has resolved, while the
instance is disabled, and with no process attached. Only `send:` waits for the
agent.

Anything the view starts belongs to it and stops with it: canvases,
subscriptions, `LumaSynth` voices, `LumaTune`s, and every process it forks,
whether with `fork:`, `LumaRun fork:` or a plain `[ … ] fork`, and the
processes those fork in turn. What differs is an error: one in a process
started with `context fork:` stops the view, with the error in the widget,
while one in any other process is not caught by the view, which goes on
running. Use `fork:` for work the view cannot do without.

## Showing lists, text and charts

What the widget shows is the view object's `<gtView>` methods, in the style of
Glamorous Toolkit: a method that takes a view builder, marked with the
`<gtView>` pragma, that answers the view it built.

```smalltalk
{ #category : 'views' }
ModuleListView >> gtNamesFor: aView [
	<gtView>
	^ aView list
		title: 'Names';
		priority: 3;
		items: [ modules ];
		itemText: [ :each | each at: 'name' ]
]
```

Several become tabs, ordered by `priority`, lowest first; a view without one
has priority 75. With a single view the widget shows it without a tab bar.
Luma collects the views when the widget is shown and again each time the view
sends `changed`. Nothing else makes it collect them again for the tabs, so a
view that changes what its lists or text show has to send `changed`. Reading a
page of a list, or opening a selected row, runs the `<gtView>` methods again
too, and the list's `items` block with them, so keep both free of side effects.

The builders a view can start from:

| Builder | Shows | Messages it takes |
| --- | --- | --- |
| `aView list` | A list of items | `items:`, `itemText:`, `send:` |
| `aView columnedList` | A table | `items:`, `column:text:`, `column:text:width:`, `column:text:weight:`, `column:icon:`, `column:do:`, `send:` |
| `aView tree` | Its top-level items, as a list | `items:`, `itemText:`, `send:`; `children:` is taken but not shown |
| `aView text` | Text | `text:` |
| `aView canvas` | A scene the view draws | `scene:` |
| `aView explicit` | A chart | `stencil:` |
| `aView mondrian` | A graph of nodes and edges | `painting:` |
| `aView forward` | Another object's view | `object:`, `view:` |

A table's columns share its width evenly unless a column says otherwise.
`column:do:` hands the block the column, which takes `text:` or `icon:` and
then how it is sized: `fitContent` makes it as wide as what it shows, for
short things of one shape such as an address, a count or a kind; `weight:`
gives it that share of what the fitted columns leave, 1 being every column's
share when it says nothing; `width:` fixes it in points, as Glamorous Toolkit
does. When the pane is too narrow for all of them, the columns give way by
`priority:`, highest first and the rightmost of equals first: each shrinks to
its `minimumCharacters:` and is then left out, until the rest fit. A column
sized by weight that names no minimum keeps what its cells show, up to six
characters. A column that names no priority gives way before those that do,
and the columns of the lowest priority are never left out. A cut cell shows
what it holds in a tooltip. Declaring any of this needs Luma 4.0.0.

Every builder takes `title:` and `priority:`. Longer lists, tables and trees
can be filtered in the widget; double-clicking a row opens what `send:`
answers for it, or the item itself, in an inspector. There the object's own
views are collected the way Glamorous Toolkit collects them: one that raises or
answers no view shows its error in its place, and nothing stops.

From Luma 4.0.0 the inspector opens inside the widget, the way the Playground
opens what a snippet produced: the widget becomes a row of columns, its own
views in the first and the object in the one beside it. Double-clicking a row
in a column opens what it holds in the next column, replacing the columns to
its right, and opening a row of the view itself starts the columns over. The
columns share the widget's height and scroll sideways, and each can be
collapsed, maximized over the widget or closed, as in the Playground. While
there are columns, the Playground's overview strip stands above them, making
the widget that much taller: a square for the view, named after the widget,
and one for each column, the one in sight marked, and a click on one brings
its column into sight. Closing the last column takes the strip away and gives
the view the whole widget again. Luma 3.0.0 opens the object in a separate
inspector instead: a sheet on macOS and iOS, a window on Linux.

A `forward` view shows the view that the method `view:` names builds for the
object `object:` gives, or its block answers. When that method raises or
answers no view, the view stops naming both methods: `views: gtForwardFor:
raised Error: gtRaisingFor: raised …`.

A view has nowhere to show an action button of its own, so the twelve
messages Glamorous Toolkit views declare them with are refused: `action:`,
`actionStencil:`, `actionButtonDo:`, `actionButtonIcon:action:`,
`actionButtonIcon:label:action:`, `actionButtonIcon:tooltip:action:`,
`actionButtonLabel:action:`, `actionButtonLabel:tooltip:action:`,
`actionDropdownButtonIcon:tooltip:content:`,
`actionDropdownButtonLabel:content:`, `actionUpdateButton` and
`actionUpdateButtonTooltip:`. Sending one to a builder from the view's process,
from the `<gtView>` method or any method it calls, stops the view naming it:
`views: gtModulesFor: declares an action button with
actionButtonIcon:tooltip:action:, which a view cannot show`. The refusal is
not an `Error`, so an `on: Error do:` around the send does not swallow it. A
button in the widget's header is declared in `package.json` instead, as one
of the widget's `actions`; choosing it calls the agent's `onAction`, as
[instruments.md](instruments.md#actions-and-console-input) describes. The
other messages Glamorous Toolkit views take for updates, `addAutoUpdate:`,
`updateWhen:in:` and `buildContext:`, are accepted and do nothing.

A `<gtView>` method that raises an error stops the view, and the widget names
the method (`views: gtModulesFor: raised …`). So does one that answers
something that is not a view, `nil` included (`views: gtNilFor: answered nil,
which is not a view`), and one whose view was given a `priority:` that is not a
number (`views: gtSizesFor: gave the priority 'high', which is not a number`).
An error in what the view built stops it too. One raised while the views are
collected, by a `text:`, `stencil:` or `painting:` block, is named the same
way; one raised while a page of a list is read, by an `items:`, `itemText:`
or column block, shows as `items raised …`, and one raised by a `send:` block
when a row is opened as `send raised …`. A `<gtView>` method that answers the
builder it was handed, without choosing a view from it, is left out; one that
chose a view and gave it nothing to show, such as a list with no items, gets
its tab all the same.

### Charts

Charts are made with Glamorous Toolkit's plotter classes, which Luma's image
provides under their usual names: `GtPlotter`, `GtPlotterHorizontalBarChart`,
`GtPlotterVerticalBarChart`, `GtPlotterLineChart`, `GtPlotterScatterChart`,
`GtPlotterCompositeChart`, `GtPlotterDataGroup` and
`GtPlotterLogarithmicScale`. An `explicit` view whose
`stencil:` block answers one of them shows it:

```smalltalk
{ #category : 'views' }
ModuleListView >> gtSizesFor: aView [
	<gtView>
	^ aView explicit
		title: 'Sizes';
		priority: 4;
		stencil: [
			GtPlotterHorizontalBarChart new
				with: (GtPlotterDataGroup new
					values: (modules first: (modules size min: 10));
					labelled: [ :each | each at: 'name' ]);
				barWidthData: [ :each | each at: 'size' ];
				yourself ]
]
```

A chart with no values still gets its tab, and shows no bars. A `stencil:`
block that raises stops the view when its views are collected, naming the
method and the block's own error (`views: gtSizesFor: raised …`). So does one
that answers something other than a chart (`views: gtSizesFor: raised Error:
the stencil answered nil, which is not a chart`), a `labelled:` block that
raises, and a value block, such as `barWidthData:`, that answers something
other than a number or a `Duration`, `nil` included. The same goes for a
`mondrian` view's `painting:` block and its nodes' `labelled:` blocks.

## Drawing on a canvas

A canvas is a scene Luma draws with the GPU. The view builds it out of
drawables, each with its own vertex and fragment shaders and its own vertex
layout, and changes it when it likes; Luma redraws it when it changes. The
drawing itself never runs Smalltalk.

This instrument plots 256 bytes of the main module as a line. Clicking the plot
and pressing **r** asks the agent for the next 256.

`package.json`:

```json
{
  "name": "byte-plot",
  "version": "1.0.0",
  "main": "main.ts",
  "engines": { "luma": ">=4.0.0" },
  "luma": {
    "icon": { "kind": "symbolic", "value": "scope" },
    "widgets": [
      {
        "id": "plot",
        "name": "Plot",
        "kind": "view",
        "config": { "class": "BytePlotView", "height": 300 },
        "persistence": "none"
      }
    ]
  }
}
```

`main.ts`:

```ts
const WINDOW = 256;

export const instrument: CustomInstrument = {
    create(ctx) {
        const plot = ctx.widget("plot");
        const module = Process.mainModule;
        let offset = 0;
        const show = () =>
            plot.setState({ offset }, points(module.base.add(offset), WINDOW));
        show();
        return {
            onViewMessage({ value }) {
                const { next } = value as { next?: boolean };
                if (next === true) {
                    offset = (offset + WINDOW) % (module.size - WINDOW);
                    show();
                }
            },
        };
    },
};

function points(address: NativePointer, count: number): Float32Array {
    const bytes = new Uint8Array(address.readByteArray(count)!);
    const xy = new Float32Array(count * 2);
    bytes.forEach((value, i) => {
        xy[i * 2] = (i / (count - 1)) * 2 - 1;
        xy[i * 2 + 1] = (value / 255) * 1.8 - 0.9;
    });
    return xy;
}
```

`BytePlotView.class.st`:

```smalltalk
Class {
	#name : 'BytePlotView',
	#superclass : 'Object',
	#instVars : [
		'context',
		'canvas',
		'line'
	],
	#category : 'BytePlot'
}

{ #category : 'opening' }
BytePlotView >> openIn: aContext [
	context := aContext.
	canvas := aContext canvas.
	line := canvas addDrawable.
	line
		attribute: 'p' components: 2;
		vertexSource: 'void main() { gl_Position = vec4(p, 0.0, 1.0); }'
		fragmentSource: 'void main() { frag_color = vec4(0.2, 0.45, 0.85, 1.0); }'.
	line commit ifFalse: [ self error: LumaCanvas lastError ].
	line hide
]

{ #category : 'receiving' }
BytePlotView >> state: aValue data: someBytes [
	someBytes ifNil: [ ^ line hide ].
	(line vertices: someBytes primitive: #lineStrip)
		ifFalse: [ self error: LumaCanvas lastError ].
	someBytes release.
	line show
]

{ #category : 'receiving' }
BytePlotView >> input: anEvent [
	(anEvent kind = #keyDown and: [ anEvent key = $r asInteger ]) ifTrue: [
		context send: { 'next' -> true } asDictionary ]
]

{ #category : 'views' }
BytePlotView >> gtPlotFor: aView [
	<gtView>
	^ aView canvas
		title: 'Plot';
		scene: [ canvas handle ]
]
```

The agent's `Float32Array` reaches `state:data:` as a `LumaBytes` and goes to
the GPU as it is: `vertices:primitive:` reads it as vertices in the layout the
drawable declared, two floats a vertex here, without the bytes passing through
Smalltalk.

### Drawables

`canvas addDrawable` answers a `LumaDrawable`. Declare its layout and
shaders, `commit` them, then hand it vertices:

| Message | Does |
| --- | --- |
| `attribute: aName components: n` | Declares a per-vertex input of 1 to 4 floats, in vertex layout order. |
| `varying: aName components: n` | Declares a value the vertex shader hands the fragment shader. |
| `uniform: aName value: aNumberOrArray` | Declares or sets a uniform: 1, 2, 3 or 4 floats, or 16 for a `mat4`. Answers false, with the reason in `LumaCanvas lastError`, for any other count. |
| `vertexSource: aString fragmentSource: aString` | The two shader bodies. |
| `commit` | Compiles the shaders against the declarations. Answers false, with the compiler's message in `LumaCanvas lastError`, when they do not compile. |
| `vertices: someBytes primitive: aSymbol` | Float32 vertex data from a `LumaBytes`, kept by reference rather than copied; see below. |
| `vertices: someBytes indices: someIndices primitive: aSymbol` | The same, drawn indexed with uint32 indices from a `LumaBytes`, such as a slice of the same data; see below. |
| `mesh: anArray primitive: aSymbol` | Vertices as a Smalltalk array of numbers, then `commit`. |
| `remesh: anArray primitive: aSymbol` | Vertices as an array, without compiling again. |
| `ramp: aName from: a to: b over: seconds` | Moves a uniform from `a` to `b` once. Answers false, as `uniform:value:` does, for a count it cannot hold. |
| `oscillate: aName between: a and: b period: seconds` | Swings a uniform back and forth for as long as it is drawn. Answers false as `ramp:` does. |
| `buffer: aName values: anArray` | A run of floats the shaders read with `<aName>At(i)`. |
| `transform: anArray` | Sets `u_mvp` from 16 numbers, column by column. |
| `identity` | Sets `u_mvp` back to the identity. |
| `orthographicWidth: w height: h` | Sets `u_mvp` to map `w` by `h` units around the origin onto the canvas, and z from -1, farthest, to 1, nearest, onto depth. |
| `perspective: degrees aspect: a near: n far: f` | Sets `u_mvp` to a perspective projection with a vertical field of view of `degrees`, looking down -z from the origin, showing what lies between `n` and `f` away. |
| `show`, `hide` | Whether it is drawn. |
| `scale` | Physical pixels per point where it is drawn, or 0 before it has been. |

Primitives are `#points`, `#lines`, `#lineStrip`, `#triangles` and
`#triangleStrip`.

With indices, the index data has to be whole triangles, three uint32 indices
each, whatever the primitive, and every index has to name a vertex. With
`#lines`, each triangle is drawn as its three edges, which is how a wireframe
of an indexed mesh is made; with any other primitive, the indexed vertices are
drawn in index order. The vertex methods answer false, with the reason in
`LumaCanvas lastError`, when the primitive is none of these (`#hexagons is not
a primitive`), when the drawable has no attributes declared yet (`declare the
drawable's attributes before handing it vertices`), when the data is not a
whole number of vertices (`1000 bytes are not a whole number of 12-byte
vertices`), when the index data ends partway through an index (`14 bytes are
not a whole number of 4-byte indices`), when the indices are not whole
triangles (`8 indices are not a whole number of triangles`), when an index is
out of range (`index 300 is past the last of 256 vertices`), and when the
vertex or index bytes are not held any more (`those bytes are not held any
more`).

A drawable keeps the bytes it was handed and draws from them where they are:
a slice that starts on a 4-byte boundary costs no copy, one that does not is
copied once. However many drawables draw from the same data, the GPU is given
it once.

The shaders are bodies only: write `void main() { … }` and Luma adds the
version line and the declarations. The vertex shader sets `gl_Position`, the
fragment shader `frag_color`. Both can read the drawable's attributes,
varyings and uniforms by name, and also:

| Name | Is |
| --- | --- |
| `u_resolution` | The canvas's size in pixels. |
| `u_time` | Seconds since the widget began drawing the canvas. |
| `u_scale` | Physical pixels per point. |
| `u_scheme` | 1 while Luma is in light appearance, 0 in dark. |
| `u_mvp` | The drawable's `transform:`, identity unless set. |

Write GLSL that compiles both as `#version 150 core`, which GTK's OpenGL takes
as it is, and as `#version 450`, which Luma translates for Metal on macOS and
iOS. Keep `gl_Position.z` between 0 and 1: OpenGL draws a negative depth and
Metal clips it away. `perspective:aspect:near:far:` and
`orthographicWidth:height:` keep depth within 0 to 1 on every platform, with +z
toward the viewer; a matrix of your own, through `transform:` or a uniform, has
to do the same.

The canvas clears to a light or a dark background as Luma's appearance is, and
follows it when it changes, on every platform; read `u_scheme` to color what
is drawn on it to match.

Declare attributes, varyings, uniforms and buffers before `commit`, which
writes the declarations from them; one declared later needs another `commit`.
Setting a declared uniform's value needs none.

Luma draws a canvas when its scene changes, and continuously only while
something in it moves: a shader that reads `u_time`, or a `ramp:` or
`oscillate:` still under way. Every change counts, a new `transform:` or
uniform value included, so a camera can be carried either way: in `u_mvp`
through `transform:`, or in uniforms of the drawable's own.

`LumaText on: aDrawable pointSize: aSize` letters a drawable with text from a
glyph atlas Luma draws: `show: aString` says something else, `pad: #(x y)
tint: #(r g b)` places and colors it. It takes the drawable over, declaring its
own attributes and shaders. Two messages measure what it would show:
`widthOf: aString` answers the string's width in points, the units `pad:` takes,
which is how text is laid out beside other text; `advanceOf: aCharacter`
answers how far one character moves the pen, in the pixels of the atlas it
letters from. From Luma 4.0.0, `glyphs` answers that atlas, a `LumaGlyphs`
(below), and `widthOf:` is new; Luma 3.0.0 has only `advanceOf:`.

### Lettering a drawable of your own

From Luma 4.0.0, the atlas `LumaText` letters from is a `LumaGlyphs` of its own,
which a drawable with the author's own attributes and shaders can sample too.
That is how many labels are drawn at once, in a space of the author's choosing,
such as a graph that a camera pans and zooms: every letter of every label is
two triangles in one drawable, over one atlas.

The atlas is the printable ASCII range, codes 32 to 126, drawn by Luma in the
platform's monospaced font onto one sheet, a grid of equal cells, each holding
one character's ink in its alpha channel. Every measure it answers is in the
atlas's own pixels.

| Message | Answers or does |
| --- | --- |
| `LumaGlyphs pointSize: aSize for: aDrawable` | A new atlas for text of `aSize` points, drawn at as many pixels as that covers where `aDrawable` is drawn: `aSize` times the drawable's `scale`, rounded, or times 2 before the drawable has been drawn. |
| `LumaGlyphs pixelSize: anInteger` | A new atlas drawn at `anInteger` pixels. |
| `applyTo: aDrawable` | Gives the drawable the atlas's picture, which its shaders sample as `glyphs`. Answers `aDrawable`. |
| `pixelSize` | The size it was drawn at, in pixels. |
| `first`, `last` | 32 and 126, the codes it holds. |
| `columns` | How many cells a row of the sheet holds. |
| `cellWidth`, `cellHeight` | The size of a cell. |
| `sheetWidth`, `sheetHeight` | The size of the sheet. |
| `inkTop`, `inkBottom` | The rows of a cell, from its top, between which ink lies; above and below them a cell is empty. |
| `cellOrigin: aCode` | The top-left corner of a code's cell on the sheet, as a `Point`. |
| `advanceOf: aCharacter` | How far the pen moves after the character. |

The cell of code `c` is at index `c - 32`, row by row: its column is the index
modulo `columns` and its row the index divided by `columns`, so `cellOrigin:`
answers `(index \\ columns * cellWidth) @ (index // columns * cellHeight)`.
In texture coordinates `0 @ 0` is the top-left corner of the sheet, `u` grows to
the right and `v` downwards, so a point `x @ y` on the sheet is `(x /
sheetWidth) @ (y / sheetHeight)` on every platform.

`applyTo:` declares the sampler, so send it before `commit`, as for any picture.
The drawable keeps its own copy of the picture: what it draws does not depend
on the `LumaGlyphs` afterwards, and a drawable can be given the same atlas
again after `clearLayout`, or another one. The atlas itself, which answers the
measures, is held by Luma until the `LumaGlyphs` is garbage collected. It is
drawn once, at the size it was made at: when the drawable moves to a screen of
another density, make a new one to stay sharp.

This view letters three labels at once, in pixels from the top-left corner,
each in a tone of its own:

```smalltalk
{ #category : 'opening' }
LabelsView >> openIn: aContext [
	| canvas labels glyphs |
	canvas := aContext canvas.
	labels := canvas addDrawable.
	glyphs := LumaGlyphs pointSize: 18 for: labels.
	glyphs applyTo: labels.
	labels
		attribute: 'p' components: 2;
		attribute: 'glyph' components: 2;
		attribute: 'shade' components: 1;
		varying: 'uv' components: 2;
		varying: 'tone' components: 1;
		vertexSource: 'void main() {
			uv = glyph;
			tone = shade;
			gl_Position = vec4(p.x / u_resolution.x * 2.0 - 1.0, 1.0 - p.y / u_resolution.y * 2.0, 0.5, 1.0); }'
		fragmentSource: 'void main() {
			float ink = texture(glyphs, uv).a;
			if (ink < 0.02) discard;
			frag_color = vec4(mix(vec3(0.95, 0.55, 0.2), vec3(0.3, 0.8, 0.95), tone) * ink, ink); }'.
	labels commit ifFalse: [ self error: LumaCanvas lastError ].
	self letter: #('videotestsrc0' 'capsfilter0' 'autovideosink0') with: glyphs on: labels
]

{ #category : 'drawing' }
LabelsView >> letter: someLabels with: glyphs on: aDrawable [
	| band bytes at held |
	band := glyphs inkBottom - glyphs inkTop.
	bytes := ByteArray new: (someLabels inject: 0 into: [ :sum :each | sum + each size ]) * 6 * 5 * 4.
	at := 0.
	someLabels doWithIndex: [ :label :row | | pen top |
		pen := 16.
		top := 8 + (row - 1 * (band + 6)).
		label do: [ :each | | origin |
			origin := glyphs cellOrigin: each asInteger.
			#( #( 0 0 ) #( 1 0 ) #( 0 1 ) #( 1 0 ) #( 1 1 ) #( 0 1 ) ) do: [ :corner |
				{ pen + (corner first * glyphs cellWidth).
				  top + (corner last * band).
				  origin x + (corner first * glyphs cellWidth) / glyphs sheetWidth.
				  origin y + glyphs inkTop + (corner last * band) / glyphs sheetHeight.
				  row - 1 / 2 } do: [ :value |
					bytes float32AtOffset: at put: value asFloat.
					at := at + 4 ] ].
			pen := pen + (glyphs advanceOf: each) ] ].
	held := LumaBytes holding: bytes.
	(aDrawable vertices: held primitive: #triangles) ifFalse: [ self error: LumaCanvas lastError ].
	held release
]
```

Each letter covers its cell's ink band, `inkTop` to `inkBottom`, so lines of
labels can be stacked as close as `inkBottom - inkTop`. Here a pixel of the
atlas lands on a pixel of the canvas; to draw a label at another size, scale
the quad and the pen by the size wanted over `pixelSize` and leave the texture
coordinates as they are. A space has no ink and needs no quad, only its
advance. A character outside 32 to 126 has no cell: substitute one, such as
`$?`, before looking it up.

From Luma 4.0.0 the atlas is mipmapped and sampled trilinearly wherever it is
drawn smaller than its own pixels, down to an eighth, so small labels stay
legible; at its own size and larger it is sampled as before. Each cell keeps
at least eight blank pixels after its ink, so a neighbor never bleeds into it
at those sizes.

## The agent side

The widget handle of a view widget has three methods:

```ts
ctx.widget("plot").setState(value, data);   // replaces the state, which is kept
ctx.widget("plot").sendEvent(value, data);  // delivered once, not kept
ctx.widget("plot").clear();                 // drops the state
```

- `value` is anything `JSON.stringify` accepts; `undefined` becomes `null`.
- `data` is optional: an `ArrayBuffer`, a typed array or `DataView` (only the
  bytes it views are sent), or a `number[]`, which is taken as bytes, one
  number each. It travels as binary, never as base64.
- Each call throws when it goes over the [limits](#limits), with the size and
  the limit in the message: `A view state value is 300000 bytes of JSON as
  UTF-8; the most is 262144`.

The instrument's handle may implement `onViewMessage`, which hears what a view
sends:

```ts
return {
    onViewMessage({ widget, value, data, from }) {
        // widget: the view widget's id
        // value:  what the view sent, as JSON
        // data:   an ArrayBuffer, or null
        // from:   { id, name } of the lab member whose view sent it, if any
    },
};
```

Messages go one way: Luma does not wait for an answer and nothing is returned
to the view, so answer through `setState` or `sendEvent`. An exception thrown
by `onViewMessage`, or a promise from it that rejects, is not caught and
surfaces like any other uncaught error in the script. Messages for an
instrument whose handle has no `onViewMessage` are dropped.

With `persistence` set to `session`, `restored` carries the last state's value,
without its data:

```ts
create(ctx, config, restored) {
    const previous = restored.plot.state;   // the value, or null
```

The view itself gets the full state, data included, without the agent doing
anything.

`luma.d.ts`, which Luma writes into the folder when it links it, declares the
view widget as `CustomInstrumentViewWidget` in `CustomInstrumentWidgetMap`,
`onViewMessage`'s argument as `CustomInstrumentViewMessage`, with `widget`
narrowed to the instrument's view widget ids, and the restored state as
`CustomInstrumentViewSnapshot`.

## Binary data

The data of a state or an event reaches the view as a `LumaBytes`: bytes Luma
holds outside the image, the very bytes the widget's state keeps, lent rather
than copied, so megabytes of vertices never become Smalltalk objects. The image
cannot reach them directly: each read below is a call into Luma that copies
out what it reads, while a drawable takes them by reference (see
[Drawables](#drawables)). `data:` is `nil` when the agent sent none.

| Message | Answers |
| --- | --- |
| `size` | The number of bytes. |
| `from: anOffset size: aCount` | A slice, sharing the same bytes. The offset counts from 0. |
| `asByteArray` | A copy of the bytes, as a `ByteArray`, for small data. |
| `float32At: anIndex` | The float at a 1-based element index, counting 4-byte elements. |
| `uint32At: anIndex` | The unsigned 32-bit integer at a 1-based element index. |
| `float32Extent: n` | `{ mins. maxes }`, each an `Array` of `n` floats, over the bytes read as vectors of `n` floats; `nil` when the size is not a whole number of vectors or there are none. |
| `release` | Lets go of the bytes now. |

Elements are read in the byte order of the machine, which is little-endian on
every machine Luma runs on. An index or slice outside the data raises an
error.

Luma lets go of the bytes once nothing holds them: no `LumaBytes` sharing
them, no drawable they were handed to, and no state that still carries them. A
`LumaBytes` lets go when it is garbage collected, when it is sent `release`, or
when the view stops; a slice holds the bytes on its own until it does the same.
With large states, send `release` once the bytes have been handed to a
drawable, so that the previous state's data does not wait for the garbage
collector; the drawable goes on drawing them. After that, or after the view
has stopped, `asByteArray`, `float32At:`, `uint32At:` and `float32Extent:`
raise `those bytes are not held any more`, and the vertex methods answer false
with the same words in `LumaCanvas lastError`.

Data from the view to the agent is a `ByteArray`: `context send: aValue data:
aByteArray`.

From Luma 4.0.0, bytes built in Smalltalk can be handed to a drawable the same
way: `LumaBytes holding: aByteArray` copies the `ByteArray` into Luma, once, and
answers a `LumaBytes` over the copy, which takes every message above and goes
to `vertices:primitive:` and `vertices:indices:primitive:` like the bytes of a
state. This is the way to give a drawable many vertices computed in the view:
`mesh:primitive:` and `remesh:primitive:` take an `Array` and pass it on a
number at a time, which is fine for a few hundred and slow for many thousands.
Write the floats into the `ByteArray` with `float32AtOffset:put:` and the
indices with `uint32AtOffset:put:`, both counting the offset in bytes from 0,
in the machine's byte order. One `ByteArray` can carry the vertices and the
indices after them, handed over as two slices of the same `LumaBytes`.

Changing the `ByteArray` afterwards changes nothing Luma holds; hand over a new
copy instead. A `LumaBytes` made this way is the view's alone, so it is let go
of when it is sent `release` or garbage collected, not when the view stops; a
drawable it was handed to keeps the bytes all the same, so sending `release`
right after `vertices:primitive:` is the usual thing to do.

## Input

A canvas made with `context canvas` sends `input:` a `LumaInputEvent` for
what happens over it:

| Message | Answers |
| --- | --- |
| `kind` | `#down`, `#move`, `#up`, `#scroll`, `#zoom`, `#keyDown`, `#keyUp` or `#leave`. |
| `x`, `y`, `position` | Where, in clip space: -1 to 1 across, -1 at the bottom to 1 at the top. `position` is `x @ y`. |
| `width`, `height` | The canvas's size in points, for turning clip space into points. |
| `buttons` | The buttons held, as bits: 1 primary, 2 secondary, 4 middle. |
| `dx`, `dy` | For `#scroll`: how far the content would move, in points, positive right and down. |
| `factor` | For `#zoom`: the magnification, 1.1 being 10% closer. |
| `key` | For key events: a printable key's lowercase character code (`$r asInteger`), or one of `LumaCanvas keyCodes`: `#left` 1, `#right` 2, `#up` 3, `#down` 4, `#enter` 13, `#escape` 27, `#space` 32. |

What each platform reports:

- A `#down` event's `buttons` includes the button just pressed; an `#up`
  event's no longer includes the one released.
- A touch is the primary button. On iOS a two-finger pan is `#scroll`, and a
  pinch is `#zoom` there and on GTK; a trackpad pinch is `#zoom` on macOS.
- Scrolls and keys reach a canvas only while it is engaged: from a click or
  touch on it until the pointer leaves it, the keyboard focus moves elsewhere or
  its window stops being the active one. The click that engages it arrives as
  `#down` and `#up` like any other, and a drag that starts on it engages it
  too. Before that, and again afterwards, a scroll over the canvas scrolls the
  page it sits in. A key still held when the canvas stops being engaged gets
  its `#keyUp` then. On iOS, where no pointer leaves, a two-finger pan engages
  it as a touch does. `#zoom` reaches a canvas engaged or not. This is new in
  Luma 4.0.0: Luma 3.0.0 gave a canvas every scroll over it, and went on
  giving it keys after the pointer left.
- The position of a key event says nothing on macOS.

While the view is busy, consecutive `#move`, `#scroll` or `#zoom` events of
the same kind are merged into one: the latest position, `dx` and `dy` summed,
`factor` multiplied. A slow view sees fewer, larger steps rather than falling
behind.

A canvas can also be asked instead of told: `canvas pointer` answers an array
of the pointer's `x` and `y`, `canvas hasPointer` whether the pointer is over
it, `canvas buttons` the buttons held, and `canvas isDown: $a` or `canvas
isDown: #left` whether a key is held. These agree with what `input:` is sent:
the pointer and the buttons are answered whether or not the canvas is engaged,
and no key is held while it is not.

### Opening what was clicked

A canvas has no rows to select, so the view opens what was clicked itself,
with `context spawn:`. Luma opens the object exactly as it opens a row of a
list: in the column beside the view, starting the columns over, with its own
`<gtView>` methods collected the same way and a view of it that raises showing
its error in its place. Each `spawn:` replaces what the last one opened, along
with any columns opened from it.

```smalltalk
{ #category : 'receiving' }
MeshView >> input: anEvent [
	anEvent kind = #down ifFalse: [ ^ self ].
	(self vertexNear: anEvent position) ifNotNil: [ :vertex |
		context spawn: vertex ]
]
```

`spawn:` answers `true` when Luma opened the object. When the widget is not on
screen, nothing is opened, now or later, and it answers `false`; a view that
goes on running out of sight, such as one that spawns from a process started
with `fork:`, can therefore never open columns the user did not ask for. Which
object it is and whether it opened stay in your own Luma: in a lab nothing is
sent to the host or to other members, so `spawn:` works for every member and
does not depend on `canSend`.

Luma describes the object, as it does a row, before it opens it: its class
name and `printString`. An error raised there is the view's own, as any other
error in the message it was sent in: from `input:` it stops the view with
`input: raised …`, from a process started with `context fork:` with `a process
it forked: …`, unless the view handles it. `spawn:` takes as long as a
description takes and counts against the deadline of the message it is sent
in.

`spawn:` is new in Luma 4.0.0. In Luma 3.0.0 the context does not understand
it, and sending it stops the view. An instrument that sends it has to say so:

```json
"engines": { "luma": ">=4.0.0" }
```

Since a view is a widget, Luma writes this line itself when the instrument is
edited in its own editor, and refuses to publish one that does not say it.

## Deadlines and errors

Each message Luma sends the view has 3 seconds, and so has each collection of
its `<gtView>` methods and each page of a list. One that has not returned by
then is stopped, and the view with it. The view's process runs at a background
priority, below the image's own work.

The view stops on an error that it does not handle, on a `halt`, on a missed
deadline, on an error in a process it started with `fork:`, when its Smalltalk
does not load, and when Luma refuses a state or an event meant for it. The
widget then says **The view stopped**, shows why, and offers **Restart**. The
reason names what failed:

- `opening …`, for `new`, `initialize` or `openIn:`.
- `state:data: …`, `event:data: …`, `input: …` or `close …` for those messages.
- `views …`, `items …` or `send …` for collecting the `<gtView>` methods,
  reading a page of a list, or selecting a row. When a `<gtView>` method
  raised, answered no view or declared an action button, the reason names it:
  `views: gtModulesFor: raised …`.
- `setState was refused: …` or `sendEvent was refused: …`, for a state or an
  event from the instrument's own agent that Luma would not take; `A state
  from the lab was refused: …` or `An event from the lab was refused: …`,
  for one a lab relayed over the [limits](#limits). One refused while the
  view is not running, because it has not started, waits for **Allow** or has
  stopped, is held, the latest only, and stops the view once it runs; the
  widget asks for **Allow** before it reports one.
- `… did not finish within 3 seconds`, when it ran out of time.
- `a process it forked: …`.
- The load problems, one per line, for Smalltalk that does not load.

**Restart** makes a fresh object and gives it the kept state and the events
held while the view was stopped. Nothing of the old object survives, and
unless another view of the instrument is running in that session, neither does
class-side state: the classes are made afresh. The agent is not involved: it
keeps running whatever the view does.

`close` is not sent to a view that stopped on an error.

## Limits

| What | Most |
| --- | --- |
| The `value` of a state, an event or a message from a view, as JSON | 256 KiB |
| The data of a state | 64 MiB |
| The data of an event | 1 MiB |
| The data of a message from a view | 1 MiB |
| Events held for a view that is not running | the latest 64 |
| Time for each message to the view | 3 seconds |

A value is measured as the UTF-8 bytes of its JSON, by the agent and by Luma
alike: what `JSON.stringify` makes of it from the agent, what STON writes of it
from a view. The agent throws over the limit, a view's `send:` raises `The
message was refused: …`, and a state or event that reaches Luma over it all
the same stops the view with the reason in the widget, once the view runs.

## Labs

In a lab, every member's Luma runs the view, with the same Smalltalk, and
feeds it the states and events the host's instrument produces:

- The latest state, data included, reaches each member. One who joins later
  gets the latest state; one who was there sees each new one. Each change the
  host makes carries a revision, and a member takes only a newer one, so states
  do not go back in time. A project that becomes a lab brings the states its
  widgets already hold, views' included, and when a host rejoins, whichever of
  the host and the lab holds the newer revision of a state gives it to the
  other.
- Events reach the members who are there when they are sent. They are not
  kept, so a member who joins later does not get earlier events.
- What a member does in their view, such as orbiting a mesh or picking a tab,
  stays in their Luma.
- A member's view reaches the host's agent only when the member is an owner of
  the lab; the message then arrives with `from`, the member's id and name. For
  any other member, `canSend` is false and `send:` answers false without
  sending. A message is delivered only once the host's instance has finished
  `create`, and not while it is disabled or being loaded again. One over the
  [limits](#limits) is dropped, with a warning in the host's event log, such as
  `A message from Alice's view was refused: its data is 1048577 bytes; the most
  is 1048576`, and the host's view goes on running.

A view's state is the same for everyone, so keep anything one member should
not see out of it.

## When Luma asks first

A view's Smalltalk runs inside Luma, with the access Luma has, not inside the
target process. So Luma runs it without asking only when it is code the user
already trusts:

- It is byte for byte the Smalltalk of a version published in the store, of
  any instrument, latest or not. Luma asks the store whether the digest of the
  Smalltalk is a published one; nothing else about the instrument is sent.
- It is the Smalltalk of a store item as it was installed, unchanged.
- The user allowed this exact Smalltalk on this machine before.
- The user produced it by editing, in Luma's own editor, Smalltalk that was
  already allowed, or by adding the instrument's first `.st` file there.

Everything else asks: a folder linked from disk that the store does not know,
a change picked up from the folder, an instrument added or changed by a lab
member, one changed by a mission, and one that came with a project from
elsewhere. When the store cannot be reached, Luma asks too.

While it asks, the widget says *This instrument wants to run its own code
inside Luma.*, where the code came from (*It comes from the folder …*, *… added
or changed it in the lab.*, *A mission wrote it.* or *It came with this
project.*), and offers **Allow**. Until then, none of the instrument's
Smalltalk is compiled. The agent runs as usual, and the state and the latest
events are kept, so the view shows the right thing once allowed. Allowing it
starts every view of that instrument that was waiting, and is remembered for
this Smalltalk on this machine, outside the project.

The digest is SHA-256, in lowercase hexadecimal, over the `.st` files sorted
by path (byte-wise on the UTF-8 path, `/` between folders), feeding for each
file its path, a 0 byte, the length of its content in bytes as decimal ASCII
digits, a 0 byte, and the content as UTF-8. Any change to a `.st` file, its
name included, changes the digest; changes to the TypeScript do not.

As an author, this means:

- While you develop from a linked folder, you allow each version once. Edits
  made in Luma's editor keep it allowed; edits made on disk ask again.
- Once published, users who install from the store are not asked, and neither
  is anyone whose copy matches a published version.

## Older versions of Luma

Luma before 3.0.0 does not know the `view` widget kind and refuses a
`package.json` that declares one, so it cannot link the folder. The store and
labs need Luma 3.0.0 as well. In Luma 3.0.0 and later, a store item whose
`engines.luma` names a newer version is shown with that requirement and cannot
be installed until Luma is updated. `spawn:` needs Luma 4.0.0; see
[Opening what was clicked](#opening-what-was-clicked).
