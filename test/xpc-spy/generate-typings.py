import json
import re
import sys
from pathlib import Path

luma_checkout, instrument_folder, output = (Path(argument) for argument in sys.argv[1:4])

editor_profile = (luma_checkout / "Sources/LumaCore/EditorProfile.swift").read_text()
ambient_body = re.search(r'ambientDeclarations = #"""\n(.*?)\n\s*"""#', editor_profile, re.S).group(1)
ambient = "\n".join(line[8:] for line in ambient_body.split("\n"))

manifest = json.loads((instrument_folder / "package.json").read_text())["luma"]


def union(ids):
    return " | ".join(f'"{i}"' for i in ids) or "never"


def feature_type(feature):
    kind = feature["schema"]["kind"]
    if kind == "boolean":
        return "boolean"
    if kind in ("int", "uint", "double"):
        return "number"
    return "string"


def widget_type(kind):
    config = kind["config"]
    return {
        "table": lambda: "CustomInstrumentTableWidget<"
        + f"{union(c['id'] for c in config['columns'])}, {union(a['id'] for a in config['actions'])}>",
        "console": lambda: "CustomInstrumentConsoleWidget",
        "view": lambda: "CustomInstrumentViewWidget",
    }[kind["kind"]]()


def snapshot_type(kind):
    config = kind["config"]
    return {
        "table": lambda: f"CustomInstrumentTableSnapshot<{union(c['id'] for c in config['columns'])}>",
        "console": lambda: "CustomInstrumentConsoleSnapshot",
        "view": lambda: "CustomInstrumentViewSnapshot",
    }[kind["kind"]]()


features = ["declare interface CustomInstrumentFeatureMap {"]
for feature in manifest["features"]:
    optional = feature["optional"] and feature["schema"]["kind"] != "boolean"
    features.append(f"    {feature['id']}{'?' if optional else ''}: {feature_type(feature)};")
features.append("}")

widgets = ["declare interface CustomInstrumentWidgetMap {"]
widgets += [f"    {w['id']}: {widget_type(w['kind'])};" for w in manifest["widgets"]]
widgets.append("}")

restored = ["declare interface CustomInstrumentRestoredState {"]
restored += [f"    {w['id']}: {snapshot_type(w['kind'])};" for w in manifest["widgets"] if w["persistence"] == "session"]
restored.append("}")

output.write_text("\n\n".join([ambient, "\n".join(features), "\n".join(widgets), "\n".join(restored)]) + "\n")
