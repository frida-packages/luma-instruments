# Unity

Looks inside a Unity game built with IL2CPP: its scenes as trees of
GameObjects whose components you open to read their fields, a `dump.cs` of
every type with its fields' offsets and its methods' addresses, tracing of
the methods you name, with their arguments and results, and a JavaScript
console with [frida-il2cpp-bridge](https://github.com/vfsfitvnm/frida-il2cpp-bridge)'s
`Il2Cpp` in scope.

## Finding IL2CPP

The game's IL2CPP code is `GameAssembly` on Windows, macOS and Linux, and
`UnityFramework` on iOS; on macOS a module exporting `il2cpp_init` is taken
too. When the instrument is added before the game has loaded it, as when the
game is spawned, it waits for the module and for IL2CPP to start, and says
so. A game whose scripts run on Mono, with a `mono-2.0-bdwgc` or
`libmonobdwgc-2.0` module, is said to be one and left alone.

## The main thread

Unity's objects belong to the game's main thread. What the instrument asks of
them, scenes, GameObjects, components and what is typed in the console, runs
there, between two frames, from where Unity runs the work scripts post to
its `SynchronizationContext`. Nothing is hooked there while nothing waits.

A game that is not in front often stops its frames, as most do on macOS when
their window loses focus. Work that has not run after 150 ms, while the
frame count has not moved, then runs at once on the instrument's own thread:
no frame is under way to race with. The **Frames** row of the **Game** table
says how many frames a second the game draws, or that it is paused, and a
scene's page and the console say where their work ran.

## The page

A status line says which Unity and which game this is, how many scenes are
loaded, what is traced, and what was last saved.

**Game** has the Unity version, the app's identifier and version, its data
path, the IL2CPP module with its base and size, the number of assemblies and
classes, and the frame rate.

**Scenes** has a row per loaded scene: its name, its build index, its root
GameObjects, its GameObjects in all, and whether it is the active scene.
**Show** opens its page. Scenes come and go as Unity loads and unloads them:
`SceneManager`'s own notifications are watched.

**Assemblies** has every assembly with its number of classes. **Save .cs** on
a row offers that assembly's classes as a C# file to save, and **Save
dump.cs**, above the table, every assembly's. Each class is written as a C#
declaration with its base class and interfaces, its fields with their
offsets and the values of its constants, and its methods with their RVA, the
address of their code less the module's base. Nothing in the game runs to
write it, and `global-metadata.dat` is not needed: what is written is what
IL2CPP has loaded.

**Calls** and **Calls per method** show what is traced; see below.

**JavaScript** is the console.

## Scenes

Each loaded scene has a page in the sidebar, named after it, with its build
index, root and GameObject counts beside the name and a badge that marks the
active scene. The page shows the scene's hierarchy, taken when the scene is
first seen and again on **Refresh**.

**Hierarchy** has a row per GameObject, in the order Unity keeps them, each
indented under its parent, with whether it is active (`yes`, `no`, or
`parent off` when it is active but a parent is not), its components other
than its Transform, and its instance id. The list can be filtered, which
finds a GameObject at any depth. **Summary** says when the hierarchy was
taken, how long it took, and whether the game was paused.

Opening a GameObject shows, beside the list:

- **Components**: each component, with its number of fields once they have
  been read. They are read when the GameObject is opened, and the column
  updates by itself when they arrive.
- **Children**: the GameObjects under it, which open the same way.
- **Summary**: its path, instance id, activity, layer, tag, how many
  children it has, whether its components were read, and how to reach it
  from the console.

Opening a component shows its **Fields**: every instance field its class and
the classes above it declare, down to `MonoBehaviour`, with its value, its
type and the class that declares it. A Transform shows its `position`,
`localPosition`, `localEulerAngles` and `localScale` instead, read through
its properties. Values are written as text: numbers, strings quoted, enums
by name, vectors and other structs of numbers as `(1, 2, 3)`, other structs
field by field, arrays with their length and first elements, lists and
dictionaries with their count, and references to Unity objects with their
type, name and instance id, or `(destroyed)`. A field whose value cannot be
read says why. Values are read when the GameObject is opened; open it again
for fresh ones. A GameObject destroyed since the hierarchy was taken says it
is gone.

## Tracing

Turn on **Trace methods matching** with a regular expression. It is matched
against `Namespace.Class::Method`, with nested classes as `Outer.Inner` and
generic ones as `List<T>`, so `^PlayerController::` traces every method of
`PlayerController` and `::OnTriggerEnter$` every `OnTriggerEnter`. Up to
**Most methods traced** of those that match are traced, in the order of the
assemblies. Methods with no code of their own, abstract ones and generic
definitions, are left out. Methods that share code, as IL2CPP's generic
sharing and identical code folding make them, are traced once, under the
first name that matched. The status line says how many were traced and why
others were not.

Each call is counted in **Calls per method**, which shows the 100 methods
called most. Up to **Most calls recorded per second** of them are also
recorded in **Calls**: its number, time, thread, method, arguments and
result. A row is added when the call starts, and its result filled in when
it returns; one that ends with an exception keeps `…`. The status line says
how many calls were counted but not recorded. **Pause** stops both, **Resume**
starts them again, **Clear** empties them.

Calls are watched without being redirected, so an exception thrown through a
traced method unwinds as it would without the instrument.

Arguments and results are read where the platform's calling convention puts
them. On arm64 all of them are: integers, pointers, objects and enums from
the general registers, floats and structs of up to four floats or doubles,
such as `Vector3` and `Quaternion`, from the vector registers, other structs
of up to 16 bytes from general registers, larger ones through the pointer
passed for them, those that do not fit in registers from the stack, at
Apple's packing on macOS and iOS, and large struct results through `x8`. On
x86 and x64, arguments of integer, pointer and object kind are read, and
structs on Windows; `?` stands for a float, and on Linux for anything after
a struct.

## The console

JavaScript typed here runs on the game's main thread, as above, with these in
scope:

- `Il2Cpp`, frida-il2cpp-bridge's API: `Il2Cpp.domain.assemblies`,
  `Il2Cpp.gc.choose(klass)` for the live instances of a class, and the rest.
- `classNamed("Namespace.Class")`, a class from any assembly.
- `unityObject(instanceId)`, the Unity object with that instance id, such as
  a GameObject from a scene's page.
- `print(...)`, which adds a line to the reply.
- `_`, the last value.

The value of the last statement is shown, a promise's once it settles. A
class, method or field is shown as its C# declaration; an object or struct as
a value to expand, with its type, its address, for a Unity object its name and
instance id, and its fields as text, as on a component's page; a string as
itself, and an array element by element, up to 64. `var` lasts for one
input; keep what you want later on `globalThis`. `:help` says all this.

## Settings

- **Trace methods matching**: the methods to trace; off, nothing is.
- **Most methods traced**: 256 unless changed, up to 4096.
- **Most calls recorded per second**: 100 unless changed.
- **Characters shown per value**: 160 unless changed; longer values are cut.

## Limits

- Taking a scene's hierarchy took 0.5 s for 27,006 GameObjects, and 20 ms for
  819, on an Apple Silicon Mac. While the game runs, that is a hitch of that
  length on its main thread, once per scene as it loads and on every
  **Refresh**.
- The scene's page reads those 27,006 GameObjects in 0.54 s. Luma gives a
  view 3 seconds for each message, so a scene of more than about 100,000
  GameObjects would stop the view.
- Writing `dump.cs` of 14,661 classes, 13.5 MiB, took about 5 s, during
  which the instrument does not answer. A dump of more than 64 MiB, which
  Luma does not offer, fails with a message in the status line.
- Every call to a traced method enters the instrument, recorded or not. A
  method called thousands of times a frame, such as a component's `Update`,
  slows the game down while traced.
- A component's fields are sent to the view in one message. When they do not
  fit in 200 KiB, the last ones are left out, and the GameObject's summary
  says so.
- Only fields are shown, and a Transform's four properties: a property could
  run any code when read.

## Where it was run

Everything above was run on macOS 27 on Apple Silicon, with Sonic Dream Team
1.10.1 from the Mac App Store, Unity 2022.3.54f1, 95 assemblies.

It is also offered on Windows and Linux, including Android, where it has
never been run. frida-il2cpp-bridge supports them, and so does everything
here but the reading of float and struct arguments when tracing on x86 and
x64.
