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

    compiler = frida.Compiler()
    compiler.on("diagnostics", lambda diagnostics: print("diagnostics", diagnostics, flush=True))
    bundle = compiler.build(str(here / "harness.ts"), project_root=str(repository), type_check="full")

    spawned = not target.isdigit()
    pid = frida.spawn(target.split()) if spawned else int(target)
    session = frida.attach(pid)
    script = session.create_script(bundle)
    script.on("message", print_message)
    script.load()
    if spawned:
        frida.resume(pid)

    for step in steps:
        run(step, script)

    script.unload()
    session.detach()
    if spawned:
        frida.kill(pid)


def run(step, script):
    action, _, argument = step.partition("=")
    print(f"--- {step}", flush=True)
    if action == "wait":
        time.sleep(float(argument))
    elif action == "configure":
        script.exports_sync.configure(json.loads(argument))
    elif action == "dispose":
        script.exports_sync.dispose()


def print_message(message, data):
    if message["type"] == "log":
        print(message["payload"], flush=True)
    else:
        print(message, flush=True)


main()
