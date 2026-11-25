import json
import struct
import sys
from pathlib import Path

import frida

here = Path(__file__).resolve().parent
repository = here.parent.parent

fat_magic = 0xcafebabe


def main():
    arguments = sys.argv[1:]
    verbose = "--verbose" in arguments
    expected_path = next((a.split("=", 1)[1] for a in arguments if a.startswith("--expect=")), None)
    targets = [a for a in arguments if not a.startswith("--")]
    expected = json.loads(Path(expected_path).read_text()) if expected_path is not None else None

    compiler = frida.Compiler()
    compiler.on("diagnostics", lambda diagnostics: print("diagnostics", diagnostics, flush=True))
    bundle = compiler.build(str(here / "static-recognition.ts"), project_root=str(repository), type_check="full")

    session = frida.attach(0)
    script = session.create_script(bundle)
    script.on("message", lambda message, data: print(message, flush=True))
    script.load()
    failures = 0
    for target in targets:
        label, _, path = target.partition("=")
        for offset, size in slices(Path(path)):
            result = script.exports_sync.recognize(path, offset, size)
            name = f"{label}.{result['architecture']}"
            print(f"{name}: {json.dumps(result['location'])} in {result['elapsed']} ms", flush=True)
            if verbose:
                for f in sorted(result["errorFunctions"], key=lambda f: int(f["start"], 16)):
                    print(f"    {f['start']} {sorted(f['reasons'])} via {f['reporters']}")
            if expected is not None:
                want = expected.get(name)
                if want != result["location"]:
                    print(f"    MISMATCH, expected {json.dumps(want)}", flush=True)
                    failures += 1
    script.unload()
    session.detach()
    if expected is not None:
        print("all as expected" if failures == 0 else f"{failures} mismatched", flush=True)
        sys.exit(1 if failures != 0 else 0)


def slices(path):
    with path.open("rb") as f:
        header = f.read(8)
        magic, count = struct.unpack(">II", header)
        if magic != fat_magic:
            return [(0, path.stat().st_size)]
        result = []
        for _ in range(count):
            _, _, offset, size, _ = struct.unpack(">iiIII", f.read(20))
            result.append((offset, size))
        return result


main()
