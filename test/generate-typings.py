import json
import re
import sys
from pathlib import Path

IDENTIFIER = re.compile(r"(?:[^\W\d]|\$)[\w$]*")


def main():
    luma_checkout, instrument_folder, output = (Path(argument) for argument in sys.argv[1:4])
    manifest = json.loads((instrument_folder / "package.json").read_text())["luma"]
    output.write_text("\n\n".join([ambient_declarations(luma_checkout)] + scoped_declarations(manifest)))


def ambient_declarations(luma_checkout):
    editor_profile = (luma_checkout / "Sources/LumaCore/EditorProfile.swift").read_text()
    body = re.search(r'ambientDeclarations = #"""\n(.*?)\n\s*"""#', editor_profile, re.S).group(1)
    return "\n".join(line[8:] for line in body.split("\n"))


def scoped_declarations(manifest):
    settings = manifest.get("settings", [])
    widgets = manifest.get("widgets", [])
    templates = manifest.get("children", [])
    sections = []
    if settings:
        sections.append(setting_map(settings))
    if widgets:
        sections.append(widget_map(widgets))
    acting = [widget for widget in widgets if widget.get("actions") or widget["config"].get("rowActions")]
    if acting:
        sections.append(action_map(acting))
    persistent = [widget for widget in widgets if widget.get("persistence") == "session"]
    persisting_templates = [template for template in templates if persists(template)]
    if persistent or persisting_templates:
        sections.append(restored_state(persistent, persisting_templates))
    if templates:
        sections.append(child_maps(templates))
    return sections


def setting_map(settings):
    lines = ["declare interface CustomInstrumentSettingMap {"]
    for setting in settings:
        schema = setting.get("schema", {"kind": "boolean"})
        optional = setting.get("optional", False) and schema["kind"] != "boolean"
        lines.append(f"    /** {doc(setting['name'])} */")
        lines.append(f"    {key(setting['id'])}{'?' if optional else ''}: {setting_type(schema, optional)};")
    lines.append("}")
    return "\n".join(lines)


def widget_map(widgets):
    lines = ["declare interface CustomInstrumentWidgetMap {"]
    for widget in widgets:
        lines.append(f"    /** {doc(widget.get('name', widget['id']))} */")
        lines.append(f"    {key(widget['id'])}: {widget_type(widget)};")
    lines.append("}")
    return "\n".join(lines)


def action_map(widgets):
    lines = ["declare interface CustomInstrumentActionMap {"]
    for widget in widgets:
        target = f"widget: {literal(widget['id'])}"
        lines.append(f"    {key(widget['id'])}: {' | '.join(action_variants(widget, target, '; child?: undefined'))};")
    lines.append("}")
    return "\n".join(lines)


def restored_state(widgets, templates):
    lines = ["declare interface CustomInstrumentRestoredState {"]
    for widget in widgets:
        lines.append(f"    /** {doc(widget.get('name', widget['id']))} */")
        lines.append(f"    {key(widget['id'])}: {snapshot_type(widget)};")
    if templates:
        lines.append("    children?: {")
        for template in templates:
            saved = "; ".join(f"{key(widget['id'])}: {snapshot_type(widget)}"
                              for widget in template["widgets"] if widget.get("persistence") == "session")
            lines.append(f"        {key(template['id'])}?: {{ [id: string]: CustomInstrumentChildRow & {{ widgets: {{ {saved} }} }} }};")
        lines.append("    };")
    lines.append("}")
    return "\n".join(lines)


def child_maps(templates):
    lines = ["declare interface CustomInstrumentChildMap {"]
    for template in templates:
        lines.append(f"    /** {doc(template['name'])} */")
        lines.append(f"    {key(template['id'])}: {{")
        for widget in template["widgets"]:
            lines.append(f"        {key(widget['id'])}: {widget_type(widget)};")
        lines.append("    };")
    lines += ["}", "", "declare interface CustomInstrumentChildActionMap {"]
    for template in templates:
        for widget in template["widgets"]:
            if widget.get("actions") or widget["config"].get("rowActions"):
                target = f"child: {{ template: {literal(template['id'])}; id: string }}; widget: {literal(widget['id'])}"
                variants = " | ".join(action_variants(widget, target, ""))
                lines.append(f"    {literal(template['id'] + '/' + widget['id'])}: {variants};")
    lines.append("}")
    return "\n".join(lines)


def persists(template):
    return any(widget.get("persistence") == "session" for widget in template["widgets"])


def setting_type(schema, optional):
    kind = schema["kind"]
    if kind == "boolean":
        return "true" if optional else "boolean"
    if kind in ("int", "uint", "double"):
        return "number"
    if kind in ("string", "regex"):
        return "string"
    if kind == "combo":
        return combo_type(schema["choices"])
    if kind == "object":
        return object_type(schema["fields"])
    return f"({array_item_type(schema['item'])})[]"


def array_item_type(item):
    kind = item["kind"]
    if kind == "boolean":
        return "boolean"
    if kind in ("int", "uint", "double"):
        return "number"
    if kind in ("string", "regex"):
        return "string"
    if kind == "combo":
        return combo_type(item["choices"])
    return object_type(item["fields"])


def object_type(fields):
    if not fields:
        return "{}"
    entries = []
    for field in fields:
        optional = field.get("optional", False) and field["schema"]["kind"] != "boolean"
        entries.append(f"/** {doc(field['name'])} */ {key(field['id'])}{'?' if optional else ''}: {setting_type(field['schema'], optional)}")
    return "{ " + "; ".join(entries) + " }"


def combo_type(choices):
    return " | ".join(literal(choice["id"]) for choice in choices) or "string"


def widget_type(widget):
    kind_type = kind_type_of(widget)
    if not widget.get("actions"):
        return kind_type
    return f"{kind_type} & CustomInstrumentWidgetActions<{union(a['id'] for a in widget['actions'])}>"


def kind_type_of(widget):
    config = widget["config"]
    return {
        "counter": lambda: "CustomInstrumentCounterWidget",
        "histogram": lambda: "CustomInstrumentHistogramWidget",
        "graph": lambda: f"CustomInstrumentGraphWidget<{union(s['id'] for s in config['series'])}>",
        "list": lambda: "CustomInstrumentListWidget",
        "table": lambda: f"CustomInstrumentTableWidget<{union(c['id'] for c in config['columns'])}>",
        "hex": lambda: "CustomInstrumentHexWidget",
        "console": lambda: "CustomInstrumentConsoleWidget",
        "view": lambda: "CustomInstrumentViewWidget",
    }[widget["kind"]]()


def snapshot_type(widget):
    config = widget["config"]
    return {
        "counter": lambda: "CustomInstrumentCounterSnapshot",
        "histogram": lambda: "CustomInstrumentHistogramSnapshot",
        "graph": lambda: f"CustomInstrumentGraphSnapshot<{union(s['id'] for s in config['series'])}>",
        "list": lambda: "CustomInstrumentListSnapshot",
        "table": lambda: f"CustomInstrumentTableSnapshot<{union(c['id'] for c in config['columns'])}>",
        "hex": lambda: "CustomInstrumentHexSnapshot",
        "console": lambda: "CustomInstrumentConsoleSnapshot",
        "view": lambda: "CustomInstrumentViewSnapshot",
    }[widget["kind"]]()


def action_variants(widget, target, unchilded):
    variants = []
    if widget.get("actions"):
        variants.append(f"{{ {target}; action: {union(a['id'] for a in widget['actions'])}; item?: undefined{unchilded} }}")
    row_actions = widget["config"].get("rowActions", [])
    if row_actions:
        variants.append(f"{{ {target}; action: {union(a['id'] for a in row_actions)}; item: string{unchilded} }}")
    return variants


def union(ids):
    return " | ".join(literal(i) for i in ids) or "never"


def key(identifier):
    return identifier if IDENTIFIER.fullmatch(identifier) else literal(identifier)


def literal(text):
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def doc(text):
    return text.replace("*/", "*\\/")


main()
