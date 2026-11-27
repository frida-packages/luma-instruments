# Unity test harness

`harness.ts` loads the instrument with a fake `ctx` that keeps every
widget's rows, items, console entries, histogram, disabled actions and view
state, the scene pages, and the files offered, and exposes them, actions,
console input and view messages over RPC. It is checked against the typings
Luma would write; regenerate them when the settings or widgets change:

```sh
python3 test/generate-typings.py ~/src/luma unity test/unity/instrument-typings.d.ts
```

Install the instrument's dependency first, without a lock file:

```sh
(cd unity && npm install --no-package-lock)
```

## Running

`run.py` takes a pid or a process name, attaches, and runs steps:

| Step | Does |
| --- | --- |
| `wait=S` | Waits S seconds |
| `summary` | Prints the status line, every table's first rows, the histogram, the views' states and the pages |
| `state` | Prints everything the fake `ctx` holds, as JSON |
| `act=WIDGET,ACTION[,ITEM[,PAGE]]` | Chooses an action, on a scene's page when `PAGE` (such as `scene--290`) is given |
| `input=TEXT` | Submits console input and prints the reply |
| `view=PAGE,JSON` | Sends a view message from a scene's page, such as `{"inspect":415658}`, and prints the event sent back |
| `viewdata=PAGE,PATH` | Writes a scene's hierarchy to `PATH` and its state to `PATH` with `.json` |
| `offerto=PATH` | Writes the next file offered to `PATH` |
| `configure=JSON` | Changes the settings |
| `dispose` | Disposes of the instance |

Run it with the Python that has the `frida` module:

```sh
python3 test/unity/run.py SonicDreamTeam wait=6 summary \
    'view=scene--290,{"inspect":415658}' \
    'input=unityObject(415658).method("get_transform").invoke().method("get_position").invoke()' \
    offerto=/tmp/dump.cs act=assemblies,dump \
    'configure={"traceMethods":"^UnityEngine\\.(Mathf::Clamp|Matrix4x4::TRS|Vector3::ToString)$","mostTraced":256,"callsPerSecond":100,"charsPerValue":160}' \
    'input=classNamed("UnityEngine.Mathf").method("Clamp",3).invoke(5.5, 1.25, 3.75)' \
    wait=1.5 summary dispose
```

Scene page ids are `scene-` and Unity's scene handle, which is the same from
one run to the next as long as the game is not restarted; `summary` lists
them.

What to look for:

- **Game**: the Unity version, the app, the module, the assembly and class
  counts, and **Frames** saying whether the game is paused.
- **Scenes**: a row and a page per loaded scene with its GameObject count,
  and a view state whose `objects` matches it.
- **Inspection**: components with their fields: floats, strings in quotes,
  enums by name, Unity objects with name and instance id, and a Transform's
  four properties; `components` is `null` for an instance id that names
  nothing.
- **Tracing**: calls with their arguments decoded, floats, structs in
  vector registers, structs on the stack and results through `x8`
  included; methods whose calls the instrument makes itself, such as
  `UnityEngine.Object::get_name` during a **Refresh**, can be traced while
  the game is paused.

## The view

`view/check.sh` builds a Swift program against `../luma` that boots Luma's
Pharo, loads the instrument's `.st` files the way Luma does, and feeds
`SceneView` a hierarchy saved with `viewdata=`, opens a GameObject by name,
answers with an inspection saved from `view=`, and reports what every
`<gtView>` shows and how long each message took:

```sh
python3 test/unity/run.py SonicDreamTeam wait=6 viewdata=scene--290,/tmp/common.tsv
test/unity/view/check.sh /tmp/common.tsv TimeManager /tmp/timemanager.json
```

`state:data:` has to stay well within the 3 seconds Luma gives a view's
message, for the largest scene too.
