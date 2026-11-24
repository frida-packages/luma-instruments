import json
import re
import sys
from pathlib import Path

luma_checkout, instrument_folder, output = (Path(argument) for argument in sys.argv[1:4])

editor_profile = (luma_checkout / "Sources/LumaCore/EditorProfile.swift").read_text()
ambient_body = re.search(r'ambientDeclarations = #"""\n(.*?)\n\s*"""#', editor_profile, re.S).group(1)
ambient = "\n".join(line[8:] for line in ambient_body.split("\n"))

manifest = json.loads((instrument_folder / "package.json").read_text())["luma"]


def setting_type(setting):
    schema = setting["schema"]
    kind = schema["kind"]
    if kind == "boolean":
        return "boolean"
    if kind in ("int", "uint", "double"):
        return "number"
    if kind == "combo":
        return union(choice["id"] for choice in schema["choices"])
    return "string"


def widget_type(widget):
    kind_type = kind_type_of(widget)
    if "actions" not in widget:
        return kind_type
    return f"{kind_type} & CustomInstrumentWidgetActions<{union(a['id'] for a in widget['actions'])}>"


def kind_type_of(widget):
    config = widget["config"]
    return {
        "table": lambda: f"CustomInstrumentTableWidget<{union(c['id'] for c in config['columns'])}>",
        "console": lambda: "CustomInstrumentConsoleWidget",
        "counter": lambda: "CustomInstrumentCounterWidget",
        "hex": lambda: "CustomInstrumentHexWidget",
    }[widget["kind"]]()


def action_variants(widget):
    variants = []
    if "actions" in widget:
        variants.append(action_variant(widget["id"], widget["actions"], "item?: undefined"))
    row_actions = widget["config"].get("rowActions", [])
    if row_actions:
        variants.append(action_variant(widget["id"], row_actions, "item: string"))
    return variants


def action_variant(widget_id, actions, item):
    return f'{{ widget: "{widget_id}"; action: {union(a["id"] for a in actions)}; {item} }}'


def snapshot_type(widget):
    config = widget["config"]
    return {
        "table": lambda: f"CustomInstrumentTableSnapshot<{union(c['id'] for c in config['columns'])}>",
        "console": lambda: "CustomInstrumentConsoleSnapshot",
        "counter": lambda: "CustomInstrumentCounterSnapshot",
        "hex": lambda: "CustomInstrumentHexSnapshot",
    }[widget["kind"]]()


def union(ids):
    return " | ".join(f'"{i}"' for i in ids) or "never"


settings = ["declare interface CustomInstrumentSettingMap {"]
for setting in manifest["settings"]:
    optional = setting["optional"] and setting["schema"]["kind"] != "boolean"
    settings.append(f"    {setting['id']}{'?' if optional else ''}: {setting_type(setting)};")
settings.append("}")

widgets = ["declare interface CustomInstrumentWidgetMap {"]
widgets += [f"    {w['id']}: {widget_type(w)};" for w in manifest["widgets"]]
widgets.append("}")

actions = ["declare interface CustomInstrumentActionMap {"]
actions += [f"    {w['id']}: {' | '.join(variants)};" for w in manifest["widgets"] if (variants := action_variants(w))]
actions.append("}")

restored = ["declare interface CustomInstrumentRestoredState {"]
restored += [f"    {w['id']}: {snapshot_type(w)};" for w in manifest["widgets"] if w["persistence"] == "session"]
restored.append("}")

output.write_text("\n\n".join([ambient, "\n".join(settings), "\n".join(widgets), "\n".join(actions), "\n".join(restored)]) + "\n")
