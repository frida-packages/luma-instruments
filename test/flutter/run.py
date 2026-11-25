import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import frida

here = Path(__file__).resolve().parent
repository = here.parent.parent


def main():
    if sys.argv[1] == "--codecs":
        check_codecs()
    target = sys.argv[1]
    steps = sys.argv[2:]
    bundle = build("harness.ts")

    opened = target.endswith(".app")
    spawned = not target.isdigit() and not opened
    pid = launch_hidden(target) if opened else frida.spawn(target.split()) if spawned else int(target)
    session = frida.attach(pid)
    if spawned:
        frida.resume(pid)
        time.sleep(2)
    script = session.create_script(bundle)
    script.on("message", on_message)
    script.load()

    for step in steps:
        run(step, script)

    script.unload()
    session.detach()
    if spawned or opened:
        frida.kill(pid)


def check_codecs():
    session = frida.attach(0)
    script = session.create_script(build("codec-check.ts"))
    script.on("message", on_message)
    script.load()
    failures = script.exports_sync.failures()
    script.unload()
    session.detach()
    sys.exit(1 if failures else 0)


def build(entry):
    compiler = frida.Compiler()
    compiler.on("diagnostics", lambda diagnostics: print("diagnostics", diagnostics, flush=True))
    return compiler.build(str(here / entry), project_root=str(repository), type_check="full")


def launch_hidden(bundle):
    executable = f"{bundle}/Contents/MacOS/"
    before = running(executable)
    subprocess.run(["open", "-g", "-j", "-n", bundle], check=True)
    while True:
        started = running(executable) - before
        if started:
            return started.pop()
        time.sleep(0.02)


def running(executable):
    listing = subprocess.run(["pgrep", "-f", executable], capture_output=True, text=True).stdout
    return {int(pid) for pid in listing.split()}


def run(step, script):
    action, _, argument = step.partition("=")
    print(f"--- {step}", flush=True)
    if action == "wait":
        time.sleep(float(argument))
    elif action == "state":
        print(json.dumps(script.exports_sync.state(), indent=1, ensure_ascii=False), flush=True)
    elif action == "act":
        script.exports_sync.act(*argument.split(","))
    elif action == "input":
        child, _, text = argument.rpartition("|")
        print("\n".join(script.exports_sync.input(text, *([child] if child else []))), flush=True)
    elif action == "configure":
        script.exports_sync.configure(json.loads(argument))
    elif action == "dispose":
        print("\n".join(script.exports_sync.dispose()), flush=True)


def on_message(message, data):
    if message["type"] == "send" and message["payload"].get("type") == "offer":
        print(f"offer {message['payload']['name']} {len(data)} bytes sha256 {hashlib.sha256(data).hexdigest()}", flush=True)
    elif message["type"] == "log":
        print(message["payload"], flush=True)
    else:
        print(message, flush=True)


main()
