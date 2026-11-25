import json
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

import frida

here = Path(__file__).resolve().parent
repository = here.parent.parent

INTERPRETERS = [("alpha", "c"), ("beta", "lua")]
STRESS_ROUNDS = 300
SETTLE_SECONDS = 2


def main():
    if sys.argv[1].isdigit():
        explore(int(sys.argv[1]), sys.argv[2:])
        return
    host = sys.argv[1]
    expectation = sys.argv[2] if len(sys.argv) > 2 else "runs"
    rounds = int(sys.argv[3]) if len(sys.argv) > 3 else STRESS_ROUNDS
    if expectation == "lifecycle":
        lifecycle(host)
        return
    target = Target([host] + [f"{name}:{loop}" for name, loop in INTERPRETERS])
    try:
        harness = Harness(target.pid)
        try:
            check = Check()
            numbers = interpreter_numbers(harness, check, len(INTERPRETERS))
            scan_button(harness, check)
            show_button(harness, numbers, check)
            if expectation == "runs":
                names = interpreter_names(harness, numbers, check)
                exercise(harness, target, names, check)
                number = numbers[0]
                calls = harness.clear(number)
                check.expect(calls == [f"interpreter/{number}/console.clear"],
                             f"Clear empties that interpreter's console and nothing else: {calls}")
                stress(harness, names, rounds, check)
            else:
                refusal(harness, numbers, check)
            for line in harness.dispose():
                check.expect(line.endswith("restored"), f"prologue {line}")
            time.sleep(0.5)
            check.expect(target.alive(), "target still running after dispose")
            check.expect(not target.corrupt(), "target reported no corruption")
        finally:
            harness.detach()
    finally:
        target.stop()
    print(f"=== {Path(host).name}: {check.summary()}", flush=True)
    sys.exit(0 if check.failures == 0 else 1)


def explore(pid, chunks):
    harness = Harness(pid)
    time.sleep(SETTLE_SECONDS)
    try:
        for number in interpreter_numbers(harness, Check()):
            for chunk in chunks:
                harness.input(number, chunk)
        for line in harness.dispose():
            print("   ", line, flush=True)
    finally:
        harness.detach()


def lifecycle(host):
    target = Target([host, "alpha:c", "gamma:churn"])
    check = Check()
    try:
        harness = Harness(target.pid)
        try:
            check.expect(target.wait_for("] closed ", count=2, timeout=10), "the host closed and reopened gamma twice")
            pages = harness.pages()
            for page in pages:
                print("   ", page, flush=True)
            check.expect(any(page["badge"]["text"] == "closed" and page["badge"]["tone"] == "ended" for page in pages),
                         "closed interpreters' pages are badged closed")
            check.expect(len(pages) >= 4, f"reopened interpreters get a page as they are created: {len(pages)} pages")
            newest = max(int(page["id"]) for page in pages)
            listing = [payload for kind, payload in harness.input(newest, ":list") if kind == "output"]
            check.expect(any("closed" in line for line in listing), "closed interpreters are listed as closed")
            replies = harness.input(newest, "host_name")
            check.expect(any(kind == "value" and payload == "gamma" for kind, payload in replies)
                         or any(kind == "error" and "closed" in payload for kind, payload in replies),
                         f"the newest one runs code, or says it closed first: {replies}")
            for line in harness.dispose():
                check.expect(line.endswith("restored"), f"prologue {line}")
        finally:
            harness.detach()
        time.sleep(0.5)
        check.expect(target.alive(), "target still running after dispose")
        check.expect(not target.corrupt(), "target reported no corruption")
    finally:
        target.stop()
    print(f"=== {Path(host).name} lifecycle: {check.summary()}", flush=True)
    sys.exit(0 if check.failures == 0 else 1)


def interpreter_numbers(harness, check, expected=None):
    pages = harness.pages()
    for page in pages:
        print("   ", page, flush=True)
    numbers = [int(page["id"]) for page in pages]
    if expected is not None:
        check.expect(len(numbers) == expected, f"{expected} interpreters have a page, got {len(numbers)}")
        check.expect(all(re.fullmatch(rf"#{page['id']} \S.*", page["title"]) and "state 0x" in page["subtitle"] for page in pages),
                     "each page is titled with its interpreter and says its state")
    return numbers


def scan_button(harness, check):
    at_start = harness.scan_states()
    check.expect(at_start[:2] == [False, True], f"the sweep create ran disabled Scan and enabled it again: {at_start}")
    during = harness.scan()
    check.expect(during[-1] is False, f"Scan is disabled while its sweep runs: {during}")
    deadline = time.time() + 10
    while harness.scan_states()[-1] is False and time.time() < deadline:
        time.sleep(0.1)
    after = harness.scan_states()
    check.expect(after[-1] is True, f"Scan is enabled again once the sweep ends: {after}")


def show_button(harness, numbers, check):
    shown = [harness.show(number) for number in numbers]
    check.expect(shown == [str(number) for number in numbers], f"Show on each row shows that interpreter's page: {shown}")


def interpreter_names(harness, numbers, check):
    names = {}
    for number in numbers:
        replies = harness.input(number, "host_name")
        values = [payload for kind, payload in replies if kind == "value"]
        if values:
            names[values[0]] = number
    check.expect(sorted(names) == sorted(name for name, _ in INTERPRETERS), f"host_name read from each: {sorted(names)}")
    return names


def exercise(harness, target, names, check):
    for name, number in names.items():
        marker = f"marker-{name}-{number}"
        harness.input(number, f"marker = {json.dumps(marker)}")
        check.expect(target.wait_for(f"[{name}] observed marker = {marker}"), f"{name}'s script saw the marker it was given")

        replies = harness.input(number, "error('boom')")
        check.expect(any(kind == "error" and "boom" in payload for kind, payload in replies), f"{name}: error comes back: {replies}")

        replies = harness.input(number, "local t = nil; return t.field")
        check.expect(any(kind == "error" and "attempt to index" in payload for kind, payload in replies),
                     f"{name}: runtime error comes back: {replies}")

        replies = harness.input(number, "return (")
        check.expect(any(kind == "error" for kind, _ in replies), f"{name}: syntax error comes back: {replies}")

        replies = harness.input(number, "config")
        table = next((payload for kind, payload in replies if kind == "value"), None)
        check.expect(isinstance(table, dict) and table.get("speed") == 3 and table.get("tags") == ["red", "green"],
                     f"{name}: config comes back as a table: {table}")

        replies = harness.input(number, "print('hello', 1, nil, true) return 1, 'two', {3}")
        outputs = [payload for kind, payload in replies if kind == "output"]
        values = [payload for kind, payload in replies if kind == "value"]
        check.expect("hello\t1\tnil\ttrue" in outputs, f"{name}: print is captured: {outputs}")
        check.expect(values == [1, "two", [3]], f"{name}: several values come back: {values}")

        replies = harness.input(number, "_G.print")
        values = [payload for kind, payload in replies if kind == "value"]
        check.expect(len(values) == 1 and "builtin" in values[0], f"{name}: print is the host's own afterwards: {values}")


def stress(harness, names, rounds, check):
    harness.log_widgets(False)
    started = time.time()
    failures = 0
    previous = {}
    for round in range(rounds):
        for name, number in names.items():
            replies = harness.input(number, f"return counter, {round} * 2, host_name")
            values = [payload for kind, payload in replies if kind == "value"]
            ok = len(values) == 3 and values[1] == round * 2 and values[2] == name and values[0] >= previous.get(name, 0)
            if not ok:
                failures += 1
                print("    unexpected", round, name, replies, flush=True)
            else:
                previous[name] = values[0]
    elapsed = time.time() - started
    count = rounds * len(names)
    print(f"    {count} evaluations in {elapsed:.1f} s", flush=True)
    check.expect(failures == 0, f"{count} evaluations returned what they should")
    harness.log_widgets(True)


def refusal(harness, numbers, check):
    for number in numbers:
        replies = harness.input(number, "return 1")
        check.expect(any(kind == "error" and "no code can be run" in payload for kind, payload in replies),
                     f"#{number}: code is refused: {replies}")


class Harness:
    def __init__(self, pid):
        compiler = frida.Compiler()
        compiler.on("diagnostics", lambda diagnostics: print("diagnostics", diagnostics, flush=True))
        bundle = compiler.build(str(here / "harness.ts"), project_root=str(repository), type_check="full")
        self.session = frida.attach(pid)
        self.script = self.session.create_script(bundle)
        self.script.on("message", self.on_message)
        self.script.load()

    def input(self, number, text):
        print(f"  #{number}> {text}", flush=True)
        replies = json.loads(self.script.exports_sync.input(number, text))
        for kind, payload in replies:
            print(f"    {kind}: {json.dumps(payload) if kind == 'value' else payload}", flush=True)
        return replies

    def scan_states(self):
        return self.script.exports_sync.scan_states()

    def scan(self):
        return self.script.exports_sync.scan()

    def pages(self):
        return json.loads(self.script.exports_sync.pages())

    def show(self, number):
        return self.script.exports_sync.show(number)

    def clear(self, number):
        return self.script.exports_sync.clear(number)

    def log_widgets(self, enabled):
        self.script.exports_sync.log_widgets(enabled)

    def dispose(self):
        return self.script.exports_sync.dispose()

    def detach(self):
        self.script.unload()
        self.session.detach()

    def on_message(self, message, data):
        if message["type"] == "log":
            print("   ", message["payload"], flush=True)
        else:
            print("   ", message, flush=True)


class Check:
    def __init__(self):
        self.passed = 0
        self.failures = 0

    def expect(self, condition, description):
        if condition:
            self.passed += 1
        else:
            self.failures += 1
        print(f"  {'ok' if condition else 'FAIL'}: {description}", flush=True)

    def summary(self):
        return f"{self.passed} passed, {self.failures} failed"


class Target:
    def __init__(self, argv):
        self.process = subprocess.Popen(argv, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.lines = []
        self.changed = threading.Condition()
        threading.Thread(target=self.read, daemon=True).start()
        self.pid = self.process.pid
        self.wait_for("loop in", count=len(argv) - 1)

    def read(self):
        for line in self.process.stdout:
            with self.changed:
                self.lines.append(line.rstrip("\n"))
                self.changed.notify_all()

    def wait_for(self, text, count=1, timeout=5):
        with self.changed:
            return self.changed.wait_for(lambda: sum(text in line for line in self.lines) >= count, timeout)

    def corrupt(self):
        return any("CORRUPT" in line for line in self.lines)

    def alive(self):
        return self.process.poll() is None

    def stop(self):
        self.process.kill()
        self.process.wait()

main()
