import signal
import subprocess
import sys
from pathlib import Path

import frida

here = Path(__file__).resolve().parent
repository = here.parent.parent


def main():
    if sys.argv[1] == "--pid":
        pid, out = int(sys.argv[2]), sys.argv[3]
        seconds = float(sys.argv[4]) if len(sys.argv) > 4 else 2
        failures = attached(pid, lambda script: script.exports_sync.explore(out, seconds))
        sys.exit(1 if failures else 0)

    target, out = sys.argv[1], sys.argv[2]
    process = subprocess.Popen([target], stdout=subprocess.PIPE, text=True)
    ready = process.stdout.readline()
    print(f"target: {ready.strip()}", flush=True)
    try:
        failures = attached(process.pid, lambda script: script.exports_sync.test(out))
    finally:
        process.send_signal(signal.SIGUSR2)
    remaining, _ = process.communicate(timeout=30)
    print(f"target: {remaining.strip()}", flush=True)
    print(f"target exited with {process.returncode}", flush=True)
    sys.exit(1 if failures or process.returncode != 0 else 0)


def attached(pid, exercise):
    session = frida.attach(pid)
    script = session.create_script(build("harness.ts"))
    script.on("message", on_message)
    script.load()
    failures = exercise(script)
    script.unload()
    session.detach()
    return failures


def build(entry):
    compiler = frida.Compiler()
    compiler.on("diagnostics", lambda diagnostics: print("diagnostics", diagnostics, flush=True))
    return compiler.build(str(here / entry), project_root=str(repository), type_check="full")


def on_message(message, data):
    if message["type"] == "log":
        print(message["payload"], flush=True)
    elif message["type"] == "send" and message["payload"]["type"] == "dot":
        path = Path(message["payload"]["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    else:
        print(message, flush=True)


main()
