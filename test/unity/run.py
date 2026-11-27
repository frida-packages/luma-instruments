import hashlib
import json
import sys
import time
from pathlib import Path

import frida

here = Path(__file__).resolve().parent
repository = here.parent.parent


def main():
    target = sys.argv[1]
    steps = sys.argv[2:]
    session = frida.attach(int(target) if target.isdigit() else target)
    script = session.create_script(build("harness.ts"))
    script.on("message", on_message)
    script.load()

    for step in steps:
        run(step, script)

    script.unload()
    session.detach()


def build(entry):
    compiler = frida.Compiler()
    compiler.on("diagnostics", lambda diagnostics: [print_diagnostic(each) for each in diagnostics])
    return compiler.build(str(here / entry), project_root=str(repository), type_check="full")


def print_diagnostic(diagnostic):
    where = diagnostic.get("file")
    place = f"{where['path']}:{where['line'] + 1}: " if where else ""
    print(f"{place}{diagnostic['text']}", flush=True)


def run(step, script):
    action, _, argument = step.partition("=")
    print(f"--- {step}", flush=True)
    started = time.time()
    if action == "wait":
        time.sleep(float(argument))
    elif action == "state":
        print(json.dumps(script.exports_sync.state(), indent=1, ensure_ascii=False), flush=True)
    elif action == "summary":
        print_summary(script.exports_sync.state())
    elif action == "act":
        script.exports_sync.act(*argument.split(","))
    elif action == "input":
        print("\n".join(script.exports_sync.input(argument)), flush=True)
    elif action == "view":
        child, _, value = argument.partition(",")
        print(json.dumps(script.exports_sync.view(child, json.loads(value)), indent=1, ensure_ascii=False), flush=True)
    elif action == "viewdata":
        child, _, path = argument.partition(",")
        saved[child] = path
        script.exports_sync.view_data(child)
    elif action == "offerto":
        saved["offer"] = argument
    elif action == "configure":
        script.exports_sync.configure(json.loads(argument))
    elif action == "dispose":
        script.exports_sync.dispose()
    print(f"--- took {time.time() - started:.2f} s", flush=True)


def print_summary(state):
    for item in state["widgets"]["status"]["items"]:
        print(f"status {item['id']}: {item['title']} | {item.get('subtitle', '')}")
    for widget, contents in state["widgets"].items():
        if widget == "status":
            continue
        rows = contents["rows"]
        print(f"{widget}: {len(rows)} rows, disabled {contents['disabled']}, events {contents['events']}, data {contents['dataBytes']}")
        for row in rows[:int(limit(widget))]:
            print("   ", " | ".join(row["cells"].values()))
        for line in contents["console"][-6:]:
            print("    console:", line)
        for bucket in contents["histogram"]:
            print(f"    hits {bucket['count']} {bucket['label']}")
        if contents["state"] is not None:
            print("    state", json.dumps(contents["state"]))
    for page, child in state["children"].items():
        print(f"page {page}: {child['row']}")
    print(f"offers {state['offers']} shown {state['shown']}", flush=True)


def limit(widget):
    return {"calls": 12, "assemblies": 3}.get(widget, 8)


saved = {}


def on_message(message, data):
    payload = message.get("payload") if message["type"] == "send" else None
    if payload is not None and payload.get("type") == "offer":
        print(f"offer {payload['name']} {len(data)} bytes sha256 {hashlib.sha256(data).hexdigest()}", flush=True)
        Path(saved.get("offer", "/dev/null")).write_bytes(data)
    elif payload is not None and payload.get("type") == "view-data":
        path = Path(saved[payload["child"]])
        path.write_bytes(data)
        path.with_suffix(".json").write_text(json.dumps(payload["state"]))
        print(f"view data of {payload['child']}: {len(data)} bytes to {path}", flush=True)
    elif message["type"] == "log":
        print(message["payload"], flush=True)
    else:
        print(message, flush=True)


main()
