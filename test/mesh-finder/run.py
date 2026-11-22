import sys
from pathlib import Path

import frida

here = Path(__file__).resolve().parent
repository = here.parent.parent


def main():
    pid, out = int(sys.argv[1]), sys.argv[2]
    exploring = len(sys.argv) > 3
    bundle = build("explore.ts" if exploring else "harness.ts")

    session = frida.attach(pid)
    script = session.create_script(bundle)
    script.on("message", print_message)
    script.load()
    if exploring:
        script.exports_sync.explore(out, float(sys.argv[3]))
        failures = 0
    else:
        failures = script.exports_sync.run(out)
    script.unload()
    session.detach()
    sys.exit(1 if failures else 0)


def build(entry):
    compiler = frida.Compiler()
    compiler.on("diagnostics", lambda diagnostics: print("diagnostics", diagnostics, flush=True))
    return compiler.build(str(here / entry), project_root=str(repository), type_check="full")


def print_message(message, data):
    if message["type"] == "log":
        print(message["payload"], flush=True)
    elif message["type"] == "send" and message["payload"]["type"] == "obj":
        path = Path(message["payload"]["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(message["payload"]["text"])
    else:
        print(message, flush=True)


main()
