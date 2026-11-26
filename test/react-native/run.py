import hashlib
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

STRESS_ROUNDS = 100
SETTLE_SECONDS = 1.5


def main():
    mode = sys.argv[1]
    if mode == "host":
        host_scenario(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "plain", sys.argv[5] if len(sys.argv) > 5 else None)
    elif mode == "churn":
        churn_scenario(sys.argv[2], sys.argv[3])
    elif mode == "app":
        app_scenario(sys.argv[2], sys.argv[3])
    elif mode == "pid":
        explore(int(sys.argv[2]), sys.argv[3:])
    elif mode == "summary":
        summarize(int(sys.argv[2]), float(sys.argv[3]))
    else:
        sys.exit(f"unknown mode {mode}")


def host_scenario(host, bundle, flavor, route):
    target = Target([host, bundle, "alpha:timer", "beta:quiet", "gamma:idle"], "loop in", 3)
    check = Check()
    try:
        harness = Harness(target.pid)
        try:
            states = harness.call("wait_for_scan")
            check.expect(states[:2] == [False, True], f"Scan was disabled during the first scan and enabled after: {states}")
            check_slot_routes(harness, check)
            check_stop(harness, check)
            pages = wait_for_pages(harness, 3)
            check.expect(len(pages) == 3 and all(re.fullmatch(r"#\d+ \S+", page["title"]) for page in pages),
                         f"each runtime has a page titled with its number and engine: {[page['title'] for page in pages]}")
            check_route(harness, pages, route, check)
            names = runtime_names(harness, pages, check)
            exercise(harness, target, names, check)
            check_idle_wake(harness, names, check)
            check_promise(harness, names["alpha"], check)
            check_clear(harness, names["alpha"], check)
            check_show(harness, names, check)
            check_bundle(harness, names["alpha"], bundle, flavor, check)
            stress(harness, names, check)
            for line in harness.call("dispose"):
                check.expect(line.endswith("restored"), f"code {line}")
            time.sleep(0.5)
            check.expect(target.alive(), "target still running after dispose")
            check.expect(not target.corrupt(), "target reported no corruption")
            check.expect(not target.faulted(), "no scan or evaluation caused an access fault, which a crash reporter would see")
        finally:
            harness.detach()
    finally:
        target.stop()
    finish(f"{Path(host).name} {flavor}", check)


def churn_scenario(host, bundle):
    target = Target([host, bundle, "alpha:timer", "gamma:churn"], "loop in", 2)
    check = Check()
    try:
        harness = Harness(target.pid)
        try:
            harness.call("wait_for_scan")
            check.expect(target.wait_for(" closed", timeout=10) and target.wait_for("] runtime 0x", count=3, timeout=10),
                         "the host closed and reopened gamma")
            harness.call("action", "runtimes", "scan", None, None)
            time.sleep(1)
            pages = harness.pages()
            for page in pages:
                print("   ", page, flush=True)
            check.expect(any(page["badge"]["text"] == "destroyed" for page in pages),
                         "a destroyed runtime's page is badged destroyed")
            live = [page for page in pages if page["badge"]["text"] != "destroyed"]
            replies = [harness.input(page["id"], "hostName") for page in live]
            answered = [values(reply)[0] for reply in replies if values(reply)]
            check.expect("alpha" in answered and "gamma" in answered,
                         f"the steady runtime and a reopened one both answer: {answered}")
            for line in harness.call("dispose"):
                check.expect(line.endswith("restored"), f"code {line}")
            time.sleep(0.5)
            check.expect(target.alive(), "target still running after dispose")
            check.expect(not target.corrupt(), "target reported no corruption")
            check.expect(not target.faulted(), "no scan or evaluation caused an access fault, which a crash reporter would see")
        finally:
            harness.detach()
    finally:
        target.stop()
    finish(f"{Path(host).name} churn", check)


def app_scenario(app, architecture):
    server = TickServer()
    target = Target([app], None, 0)
    time.sleep(4)
    check = Check()
    try:
        harness = Harness(target.pid)
        try:
            harness.call("wait_for_scan")
            pages = wait_for_pages(harness, 1)
            page = pages[0]["id"]
            facts = wait_for_facts(harness, page)
            print("    facts", json.dumps(facts), flush=True)
            check.expect(facts.get("isReactNative") is True, "the runtime says it is React Native")
            expected_bridgeless = architecture == "new"
            check.expect(facts.get("bridgeless") is expected_bridgeless and facts.get("bridge") is not expected_bridgeless,
                         f"the architecture is the {architecture} one")
            check.expect(facts.get("fabric") is expected_bridgeless, f"Fabric is {'on' if expected_bridgeless else 'off'}")
            check.expect(facts.get("dev") is False, "the bundle is a production one")
            version = facts.get("reactNative") or {}
            check.expect((version.get("major"), version.get("minor")) == (0, 81), f"React Native 0.81: {version}")
            check.expect(str(facts.get("bundleURL", "")).endswith("main.jsbundle"), f"the bundle URL is main.jsbundle: {facts.get('bundleURL')}")
            ticks = values(harness.input(page, "spyAppTicks"))
            check.expect(len(ticks) == 1 and isinstance(ticks[0], int) and ticks[0] > 0, f"the app's own global is readable: {ticks}")
            harness.input(page, "spyAppMarker = 'from-luma'")
            probe = values(harness.input(page, "spyAppProbe()"))
            check.expect(probe and probe[0].get("marker") == "from-luma", f"a global set from the console is the app's own: {probe}")
            printed = harness.input(page, "console.log('hello from', typeof nativeModuleProxy); 7 * 6")
            check.expect(["output", "hello from object"] in printed and values(printed) == [42],
                         f"console.log is captured and the value comes back: {printed}")
            check.expect(any(kind == "error" and "boom" in str(payload) for kind, payload in harness.input(page, "throw new Error('boom')")),
                         "a thrown error comes back as an error")
            check.expect(any(kind == "error" for kind, _ in harness.input(page, "function (")), "a syntax error comes back as an error")
            time.sleep(3)
            rows = harness.rows("traffic")
            modules = {row["call"].split(".")[0] for row in rows}
            print(f"    {len(rows)} traffic rows; modules {sorted(modules)[:20]}", flush=True)
            check.expect(any(row["call"] == "Networking.sendRequest" and "127.0.0.1" in row["arguments"]
                             for row in rows), "fetch shows as a Networking.sendRequest call with its URL")
            check.expect(any(row["direction"] == "event → JS" or (row["direction"] == "native → JS" and row["call"].startswith("RCTDeviceEventEmitter."))
                             for row in rows), "events emitted to JavaScript are shown")
            check.expect(any(row["call"] == "SourceCode.getConstants" and "scriptURL" in row["outcome"]
                             for row in rows), "a synchronous call shows its result")
            check.expect(any(row["outcome"].startswith(("resolved", "called back")) for row in rows),
                         "an asynchronous call shows its result")
            check.expect(server.requests > 0, f"the app reached the test server {server.requests} times")
            module_rows = harness.rows("modules")
            check.expect(len(module_rows) > 20 and any(row["kind"] == "view manager" for row in module_rows),
                         f"the module table lists native modules and view managers: {len(module_rows)} rows")
            shown = harness.call("action", "traffic", "show", rows[-1]["id"], None)
            detail = harness.console("detail")
            check.expect(any(kind == "value" and isinstance(payload, dict) and "arguments" in payload for kind, payload in detail),
                         "Show puts the full call in the Call console")
            offer = harness.call("action", "runtimes", "bundle", page, None)["offer"]
            bundle = Path(app).parent.parent / "Resources" / "main.jsbundle"
            check.expect(offer is not None and offer["name"] == "main.jsbundle" and offer["sha256"] == sha256(bundle),
                         f"Export Bundle offers main.jsbundle byte for byte: {offer}")
            bundles = harness.rows("bundles")
            check.expect(any("Hermes bytecode" in row["format"] and row["loadedBy"] == f"#{page}" for row in bundles),
                         f"the bundle is listed as Hermes bytecode, loaded by runtime #{page}: {bundles}")
            for line in harness.call("dispose"):
                check.expect(line.endswith("restored"), f"code {line}")
            check_cleanup(harness, architecture, check)
            time.sleep(1)
            before = server.requests
            time.sleep(1.5)
            check.expect(target.alive() and server.requests > before, "the app keeps running and fetching after dispose")
        finally:
            harness.detach()
    finally:
        target.stop()
        server.stop()
    finish(f"{Path(app).name} {architecture} architecture", check)


def check_cleanup(harness, architecture, check):
    harness.call("create_again", {"captureTraffic": False})
    harness.call("wait_for_scan")
    page = wait_for_pages(harness, 1)[0]["id"]
    probe = ("Object.prototype.hasOwnProperty.call(__fbBatchedBridge, 'enqueueNativeCall')" if architecture == "old"
             else "Object.prototype.hasOwnProperty.call(__rctDeviceEventEmitter, 'emit')")
    replies = harness.input(page, f"[{probe}, String(nativeModuleProxy.Networking.sendRequest).indexOf('begin(') === -1]")
    check.expect(values(replies) == [[False, True]], f"removing the instrument put the wrapped methods back: {replies}")
    harness.call("dispose")


def explore(pid, expressions):
    harness = Harness(pid)
    try:
        harness.call("wait_for_scan")
        time.sleep(SETTLE_SECONDS)
        for widget in ("status", "runtimes", "bundles", "modules"):
            for row in harness.rows(widget):
                print(f"    {widget}:", row, flush=True)
        for entry in harness.console("detail"):
            print("    call console:", entry, flush=True)
        for page in harness.pages():
            for expression in expressions:
                harness.input(page["id"], expression)
        for row in harness.rows("traffic")[-15:]:
            print("    traffic:", row, flush=True)
        for line in harness.call("dispose"):
            print("   ", line, flush=True)
    finally:
        harness.detach()


def summarize(pid, seconds):
    harness = Harness(pid)
    try:
        harness.call("wait_for_scan")
        for page in harness.pages():
            print(f"    #{page['id']} answers typeof globalThis with", values(harness.call("input", page["id"], "typeof globalThis")), flush=True)
            time.sleep(2)
            facts = values(harness.call("input", page["id"], ":facts"))
            fields = ("isReactNative", "bridge", "bridgeless", "turboModules", "fabric", "dev", "reactNative", "globals")
            if facts and isinstance(facts[0], dict):
                print(f"    facts of #{page['id']}:", {key: facts[0].get(key) for key in fields},
                      "bundle", lastPathComponent(str(facts[0].get("bundleURL"))), flush=True)
        time.sleep(seconds)
        status = harness.rows("status")
        print("    status:", status[0]["title"] if status else None, flush=True)
        for row in harness.rows("runtimes"):
            print("    runtime:", {key: row[key] for key in ("number", "engine", "reactNative", "architecture", "build", "status")}, flush=True)
        for row in harness.rows("bundles"):
            print("    bundle:", {key: row[key] for key in ("number", "format", "size", "loadedBy")}, lastPathComponent(row["where"]), flush=True)
        kinds = {}
        for row in harness.rows("modules"):
            kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1
        print("    modules by kind:", kinds, flush=True)
        calls = {}
        for row in harness.rows("traffic"):
            calls[row["direction"]] = calls.get(row["direction"], 0) + 1
        print("    calls by direction:", calls, flush=True)
        for kind, entry in harness.console("detail"):
            print("    call console:", kind, entry, flush=True)
        for page in harness.pages():
            for kind, entry in harness.console(f"runtime/{page['id']}/console"):
                print(f"    #{page['id']} console:", kind, str(entry)[:300], flush=True)
        for line in harness.call("dispose"):
            print("   ", line, flush=True)
    finally:
        harness.detach()


def lastPathComponent(path):
    return path.rsplit("/", 1)[-1]


def check_stop(harness, check):
    scans = harness.call("scan_states").count(True)
    harness.call("scan_and_stop")
    deadline = time.time() + 10
    while time.time() < deadline and harness.call("scan_states").count(True) == scans:
        time.sleep(0.1)
    status = harness.rows("status")
    detail = status[0]["subtitle"] if status else ""
    check.expect("stopped early because Stop Scan was pressed" in detail, f"Stop Scan stops a scan and the status says so: {detail}")


def check_slot_routes(harness, check):
    for route in harness.call("slot_routes"):
        print("    slots", route, flush=True)
        if route["exports"] is not None:
            exported, structural, named = (evaluation_slots(route[key]) for key in ("exports", "structuralFromExportedVtable", "typeNames"))
            check.expect(exported == structural, f"{route['module']}: the symbol-free slot rule agrees with the exported anchors")
            check.expect(named == exported, f"{route['module']}: finding jsi::Runtime by its type name gives the same slots")


def evaluation_slots(slots):
    return {name: slots[name] for name in ("evaluateJavaScript", "global", "utf8", "call")} if slots is not None else None


def wait_for_pages(harness, count, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        pages = harness.pages()
        if len(pages) >= count:
            for page in pages:
                print("   ", page, flush=True)
            return pages
        time.sleep(0.2)
    return harness.pages()


def wait_for_facts(harness, page, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        facts = values(harness.input(page, ":facts"))
        if facts and isinstance(facts[0], dict):
            return facts[0]
        time.sleep(0.3)
    return {}


def check_route(harness, pages, route, check):
    found = [entry for kind, entry in harness.console(f"runtime/{pages[0]['id']}/console") if kind == "output" and " found: " in entry]
    print(f"    {found[0] if found else 'no discovery note'}", flush=True)
    if route is not None:
        check.expect(bool(found) and found[0].endswith(f"found through {route}."), f"the JSI entry points were found through {route}")


def runtime_names(harness, pages, check):
    names = {}
    for page in pages:
        found = values(harness.input(page["id"], "hostName"))
        if found:
            names[found[0]] = page["id"]
    check.expect(sorted(names) == ["alpha", "beta", "gamma"], f"hostName read from each runtime: {names}")
    return names


def exercise(harness, target, names, check):
    alpha = names["alpha"]
    harness.input(alpha, "globalThis.marker = 'from-luma'")
    check.expect(target.wait_for("[alpha] observed marker = from-luma"), "the host's own tick saw the marker set from the console")
    replies = harness.input(alpha, "config")
    check.expect(values(replies) == [{"speed": 3, "name": "alpha", "tags": ["red", "green"], "nested": {"deeper": {"deepest": [1, 2]}}}],
                 f"config comes back as an object: {replies}")
    replies = harness.input(alpha, "console.log('hello', 1, {a: 2}); nativeAdd(40, 2)")
    check.expect(["output", 'hello 1 {"a":2}'] in replies and values(replies) == [42],
                 f"console.log is captured and a host function answers: {replies}")
    check.expect(any(kind == "error" and "boom" in str(payload) for kind, payload in harness.input(alpha, "throw new Error('boom')")),
                 "a thrown error comes back as an error")
    check.expect(any(kind == "error" and "SyntaxError" in str(payload) for kind, payload in harness.input(alpha, "function (")),
                 "a syntax error comes back as an error")
    replies = harness.input(alpha, "[undefined, null, NaN, 10n, Symbol('s'), function named() {}, new Uint8Array(4)]")
    check.expect(values(replies) == [["[undefined]", None, "NaN", "10n", "[Symbol(s)]", "[Function named]", "[Uint8Array 4 bytes]"]],
                 f"values that JSON cannot carry are described: {replies}")
    replies = harness.input(alpha, "'été ☃ ' + 'x'.repeat(30)")
    check.expect(values(replies) == ["été ☃ " + "x" * 30], f"non-ASCII input and long strings survive: {replies}")
    facts = values(harness.input(alpha, ":facts"))
    hermes = (facts[0] or {}).get("hermes") if facts else None
    print("    facts", facts, flush=True)
    check.expect(isinstance(facts[0], dict) and facts[0].get("isReactNative") is False, "a bare host is not React Native")


def check_idle_wake(harness, names, check):
    for name, thread in (("beta", "js-beta"), ("gamma", "com.facebook.react.JavaScript (presumed)")):
        started = time.time()
        replies = harness.input(names[name], "hostName + ' ' + typeof tick")
        elapsed = time.time() - started
        check.expect(values(replies) == [f"{name} function"], f"{name} answers again: {replies}")
        check.expect(elapsed < 1, f"{name}, between its rare or absent ticks, is woken through its run loop ({elapsed:.2f} s)")
        pages = {page["id"]: page for page in harness.pages()}
        check.expect(f"thread {thread}" in pages[names[name]]["subtitle"], f"{name}'s page names its thread: {pages[names[name]]['subtitle']}")


def check_promise(harness, page, check):
    replies = harness.input(page, "new Promise(resolve => resolve({ answer: 42 }))")
    check.expect(any(kind == "output" and "promise" in payload for kind, payload in replies), f"a promise is announced: {replies}")
    deadline = time.time() + 3
    console = []
    while time.time() < deadline:
        console = harness.console(f"runtime/{page}/console")
        if any(kind == "value" and payload == {"answer": 42} for kind, payload in console):
            break
        time.sleep(0.2)
    check.expect(any(kind == "value" and payload == {"answer": 42} for kind, payload in console),
                 f"the promise's value is shown when it settles: {console[-3:]}")


def check_clear(harness, page, check):
    harness.call("log_widgets", True)
    calls = harness.call("action", "console", "clear", None, page)
    harness.call("log_widgets", False)
    check.expect(harness.console(f"runtime/{page}/console") == [], f"Clear empties that runtime's console: {calls}")


def check_show(harness, names, check):
    for name, page in names.items():
        shown = harness.call("action", "runtimes", "show", page, None)["shown"]
        check.expect(shown == page, f"Show on {name}'s row shows its page: {shown}")


def check_bundle(harness, page, bundle, flavor, check):
    reply = harness.call("action", "runtimes", "bundle", page, None)
    rows = harness.rows("bundles")
    print("    bundles", rows, flush=True)
    if flavor == "bytecode":
        offers = [harness.call("action", "bundles", "export", row["id"], None)["offer"] for row in rows]
        check.expect(any(offer is not None and offer["sha256"] == sha256(Path(bundle)) for offer in offers),
                     f"the Hermes bytecode found in memory is offered byte for byte: {offers}")
    else:
        detail = harness.console("detail")
        check.expect(reply["offer"] is None and any(kind == "error" for kind, _ in detail),
                     f"a bundle that is in no file and is not bytecode is refused with a reason: {detail[-1:]}")


def stress(harness, names, check):
    started = time.time()
    failures = 0
    for round in range(STRESS_ROUNDS):
        for name, page in names.items():
            got = values(harness.input(page, f"[hostName, {round} * 2]", quiet=True))
            if got != [[name, round * 2]]:
                failures += 1
                print("    unexpected", round, name, got, flush=True)
    count = STRESS_ROUNDS * len(names)
    print(f"    {count} evaluations in {time.time() - started:.1f} s", flush=True)
    check.expect(failures == 0, f"{count} evaluations returned what they should")


def values(replies):
    return [payload for kind, payload in replies if kind == "value"]


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def finish(name, check):
    print(f"=== {name}: {check.summary()}", flush=True)
    sys.exit(0 if check.failures == 0 else 1)


class Harness:
    def __init__(self, pid):
        compiler = frida.Compiler()
        compiler.on("diagnostics", lambda diagnostics: print("diagnostics", diagnostics, flush=True))
        bundle = compiler.build(str(here / "harness.ts"), project_root=str(repository), type_check="full")
        self.session = frida.attach(pid)
        self.script = self.session.create_script(bundle)
        self.script.on("message", self.on_message)
        self.script.load()

    def call(self, name, *args):
        result = getattr(self.script.exports_sync, name)(*args)
        return json.loads(result) if isinstance(result, str) else result

    def input(self, page, text, quiet=False):
        if not quiet:
            print(f"  #{page}> {text}", flush=True)
        replies = self.call("input", page, text)
        if not quiet:
            for kind, payload in replies:
                print(f"    {kind}: {json.dumps(payload, ensure_ascii=False) if kind == 'value' else payload}", flush=True)
        return replies

    def pages(self):
        return self.call("pages")

    def rows(self, widget):
        return self.call("rows", widget)

    def console(self, widget):
        return self.call("console_of", widget)

    def detach(self):
        self.script.unload()
        self.session.detach()

    def on_message(self, message, data):
        print("   ", message["payload"] if message["type"] == "log" else message, flush=True)


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
    def __init__(self, argv, ready, count):
        self.process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.lines = []
        self.changed = threading.Condition()
        threading.Thread(target=self.read, daemon=True).start()
        self.pid = self.process.pid
        if ready is not None:
            self.wait_for(ready, count=count)

    def read(self):
        for line in self.process.stdout:
            with self.changed:
                self.lines.append(line.rstrip("\n"))
                self.changed.notify_all()

    def wait_for(self, text, count=1, timeout=5):
        with self.changed:
            return self.changed.wait_for(lambda: sum(text in line for line in self.lines) >= count, timeout)

    def faulted(self):
        return any(line.startswith("FAULT ") for line in self.lines)

    def corrupt(self):
        return any("CORRUPT" in line for line in self.lines)

    def alive(self):
        return self.process.poll() is None

    def stop(self):
        self.process.kill()
        self.process.wait()


class TickServer:
    def __init__(self):
        import http.server

        server = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                server.requests += 1
                body = b"tock"
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.requests = 0
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()


main()
