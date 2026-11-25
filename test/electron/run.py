import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import frida

here = Path(__file__).resolve().parent
repository = here.parent.parent

SETTLE_SECONDS = 4
FUSES_OF_ASAR_LAYOUT = {"RunAsNode": "off", "EnableEmbeddedAsarIntegrityValidation": "on", "OnlyLoadAppFromAsar": "on",
                        "EnableNodeOptionsEnvironmentVariable": "off", "EnableCookieEncryption": "on"}


def main():
    app = Path(sys.argv[1])
    scenario = sys.argv[2] if len(sys.argv) > 2 else "main"
    layout = re.search(r"-(asar|dir|esm)\.app$", app.name).group(1)
    version = re.search(r"Fixture-([\d.]+)-", app.name).group(1)
    env = {"FIXTURE_STUB_DEVTOOLS": "1"}
    if scenario == "flood":
        env.update({"FIXTURE_FLOOD": "400", "FIXTURE_TICK_MS": "250"})
    if scenario == "spawn":
        spawned(app, env)
        return
    target = Target(app, env)
    check = Check()
    try:
        if scenario == "main":
            main_process(target, version, layout, check)
        elif scenario == "processes":
            other_processes(target, check)
        else:
            flood(target, check)
        check.expect(target.alive(), "the app is still running")
        check.expect(not target.broken(), f"every round of IPC the app checks itself came out right: {target.broken()[:3]}")
    finally:
        target.stop()
    print(f"=== {app.name} {scenario}: {check.summary()}", flush=True)
    sys.exit(0 if check.failures == 0 else 1)


def main_process(target, version, layout, check):
    harness = Harness(target.pid)
    try:
        time.sleep(SETTLE_SECONDS)
        state = harness.state()
        status_and_facts(state, version, layout, check)
        ids = web_contents(state, check)
        ipc_traffic(harness, state, check)
        main_console(harness, layout, check)
        page_consoles(harness, ids, check)
        actions(harness, target, ids, check)
        capture_controls(harness, check)
        archive(harness, target, layout, check)
        lifecycle(harness, ids, check)
        rounds_before_dispose = target.count("round ")
        harness.dispose()
        after = json.loads(harness.target_taps())
        pristine = json.loads(harness.pristine())
        check.expect(not after["shim"] and not after["ipcMainEmit"] and not after["mapSet"], f"dispose removed every tap: {after}")
        check.expect(after["handlers"] == pristine["handlers"], "dispose gave every invoke handler back")
        check.expect(after["senders"] == pristine["senders"], "dispose gave back webContents and frame send and postMessage")
        common = set(after["listeners"]) & set(pristine["listeners"])
        fewer_or_same = all(int(a) <= int(b) for i in common for a, b in zip(after["listeners"][i].split("/"), pristine["listeners"][i].split("/")))
        check.expect(len(common) >= 2 and fewer_or_same,
                     f"dispose removed its web contents listeners: {pristine['listeners']} → {after['listeners']}")
    finally:
        harness.detach()
    check.expect(target.wait_for("round ", count=rounds_before_dispose + 4, timeout=6), "the app keeps doing IPC after the instrument is gone")


def status_and_facts(state, version, layout, check):
    status = {item["id"]: item for item in state["widgets"]["status"]["items"]}
    check.expect(status["process"]["title"].startswith("The main process of Fixture-"), f"status names the main process: {status['process']}")
    check.expect(status["javascript"]["title"].startswith(f"Reached the main process's JavaScript: Electron {version}"), f"status says JS is reached: {status['javascript']}")
    facts = {row["id"]: row["value"] for row in state["widgets"]["facts"]["rows"]}
    for fact_id, fact in facts.items():
        print(f"    fact {fact_id}: {fact[:150]}", flush=True)
    check.expect(facts["electron"] == version and re.fullmatch(r"\d+\.\d+\.\d+\.\d+", facts["chrome"]), "Electron and Chromium versions")
    check.expect(facts["app"] == "Luma Electron Fixture 1.2.3", f"app name and version: {facts['app']}")
    entry = "main.mjs (ES module)" if layout == "esm" else "main.js"
    check.expect(facts["entry"].endswith(entry), f"entry script ends with {entry}: {facts['entry']}")
    if layout == "dir":
        check.expect(facts["packaging"].endswith("Contents/Resources/app") and "integrity" not in facts, f"an app folder, no integrity: {facts['packaging']}")
    else:
        check.expect("app.asar (" in facts["packaging"], f"packaged in app.asar: {facts['packaging']}")
        enforcement = "enforced" if layout == "asar" else "not enforced"
        check.expect(facts["integrity"] == f"header hash matches (SHA256), {enforcement}", f"integrity: {facts['integrity']}")
    fuses = {name[len("fuse-"):]: value for name, value in facts.items() if name.startswith("fuse-")}
    expected = FUSES_OF_ASAR_LAYOUT if layout == "asar" else {"RunAsNode": "on", "OnlyLoadAppFromAsar": "off"}
    check.expect(all(fuses.get(name) == value for name, value in expected.items()) and len(fuses) >= 8, f"fuses: {fuses}")
    check.expect(facts["store"] == "no" and facts["addons"] == "none loaded", "not a store build, no native addons")


def web_contents(state, check):
    rows = {row["title"]: row for row in state["widgets"]["contents"]["rows"]}
    check.expect(sorted(rows) == ["Isolated page", "Open page", "Victim page"], f"three web contents: {sorted(rows)}")
    isolated, opened = rows["Isolated page"], rows["Open page"]
    check.expect((isolated["node"], isolated["isolation"], isolated["sandbox"], isolated["webSecurity"]) == ("no", "yes", "yes", "yes")
                 and isolated["preload"].endswith("preload-isolated.js") and "window.open handler" in isolated["guards"]
                 and "1 navigation listener" in isolated["guards"], f"the isolated window's preferences: {isolated}")
    check.expect((opened["node"], opened["isolation"], opened["sandbox"], opened["webSecurity"]) == ("yes", "no", "no", "no")
                 and opened["preload"].endswith("preload-open.js") and opened["guards"] == "none", f"the open window's preferences: {opened}")
    check.expect(all(row["state"] == "ready" and row["pid"].isdigit() for row in rows.values()), "each is ready with a renderer pid")
    pages = {page["title"]: page for page in state["pages"]}
    check.expect(sorted(pages) == sorted(rows) and all(page["badge"] == {"text": "ready", "tone": "active"} for page in pages.values()),
                 f"each has a page badged ready: {list(pages.values())}")
    preferences = {row["id"]: row["value"] for row in state["widgets"][f"contents/{pages['Open page']['id']}/preferences"]["rows"]}
    check.expect(preferences.get("nodeIntegration") == "true" and preferences.get("contextIsolation") == "false"
                 and preferences["preload"].endswith("preload-open.js"), f"the open page's preferences table: {preferences}")
    return {title: row["id"] for title, row in rows.items()}


def ipc_traffic(harness, state, check):
    rows = state["widgets"]["ipc"]["rows"]
    kinds = {(row["kind"], row["direction"]) for row in rows}
    expected = {("send", "→ main"), ("sendSync", "→ main"), ("invoke", "→ main"), ("postMessage (1 port)", "→ main"),
                ("webContents.send", "main →"), ("sendToFrame", "main →")}
    check.expect(expected <= kinds, f"every kind of IPC is seen: missing {expected - kinds}")
    adds = [row for row in rows if row["channel"] == "math:add" and row["result"] != "…"]
    sums_right = all(int(row["result"]) == sum(int(part) for part in row["args"].split(", ")) for row in adds)
    check.expect(len(adds) >= 2 and sums_right, f"math:add rows carry their arguments and sum: {[(row['args'], row['result']) for row in adds[:3]]}")
    fails = [row for row in rows if row["channel"] == "math:fail" and row["result"] != "…"]
    check.expect(fails and all(row["result"].startswith("✕ Error: refused on purpose") for row in fails), "math:fail rows carry the error")
    syncs = [row for row in rows if row["kind"] == "sendSync" and row["result"] != "…"]
    check.expect(syncs and all('counter' in row["result"] and 'platform: "darwin"' in row["result"] for row in syncs), "sendSync rows carry the return value")
    slow = next(row for row in rows if row["channel"] == "data:slow" and row["result"] != "…")
    check.expect("Buffer(4) 010203fa" in slow["result"] and int(slow["duration"]) >= 25, f"data:slow's result and time: {slow}")
    harness.action("ipc", "inspect", slow["seq"])
    entries = harness.state()["widgets"]["message"]["entries"]
    value = entries[-1][1]
    check.expect(entries[-2][0] == "output" and "data:slow" in entries[-2][1] and value["result"]["bytes"] == {"bytes": "010203fa", "length": 4}
                 and value["result"]["nested"]["when"] == "1970-01-01T00:00:00.000Z", f"Inspect shows the whole message: {entries[-2:]}")
    replies = harness.input("message", None, f"#{slow['seq']}")
    check.expect(replies[-1][0] == "value" and replies[-1][1]["milliseconds"] >= 25, "typing a message number inspects it")
    replies = harness.input("message", None, "nonsense")
    check.expect(replies[0][0] == "error", "anything else is refused")


def main_console(harness, layout, check):
    expectations = [
        ("app.getName()", lambda r: r == [["value", "Luma Electron Fixture"]]),
        ("webContents.getAllWebContents().length", lambda r: r == [["value", 3]]),
        ("Promise.resolve(41).then(x => x + 1)", lambda r: r == [["value", 42]]),
        ("_ + 1", lambda r: r == [["value", 43]]),
        ("{ a: 1, b: [1, 'two'] }", lambda r: r == [["value", {"a": 1, "b": [1, "two"]}]]),
        ("require('./package.json').version", lambda r: r == [["value", "1.2.3"]]),
        ("BrowserWindow.getAllWindows()[0]", lambda r: r[0][0] == "value" and r[0][1]["[[Class]]"] == "BrowserWindow"),
        ("process.versions", lambda r: r[0][0] == "value" and "electron" in r[0][1]),
        ("globalThis.kept = 5", lambda r: r == [["value", 5]]),
        ("kept * 2", lambda r: r == [["value", 10]]),
        ("throw new Error('boom')", lambda r: r[0][0] == "error" and "boom" in r[0][1]),
        ("Promise.reject(new TypeError('late'))", lambda r: r[0][0] == "error" and "TypeError: late" in r[0][1]),
        ("({ n: 1n, u: undefined, f: function named() {}, s: new Set([1]), m: new Map([['k', 2]]), d: new Uint8Array([9]) })",
         lambda r: r[0][1] == {"n": "1n", "u": "<undefined>", "f": "<function named>", "s": {"set": [1]}, "m": {"map": [["k", 2]]}, "d": {"bytes": "09", "length": 1}}),
        (":nonsense", lambda r: r[0][0] == "error"),
        (":help", lambda r: len(r) >= 4 and all(kind == "output" for kind, _ in r)),
    ]
    for source, accept in expectations:
        replies = harness.input("console", None, source)
        check.expect(accept(replies), f"main console: {source} → {replies}"[:300])


def page_consoles(harness, ids, check):
    isolated, opened = ids["Isolated page"][1:], ids["Open page"][1:]
    expectations = [
        (isolated, "document.title", lambda r: r == [["value", "Isolated page"]]),
        (isolated, "window.fixture.role", lambda r: r == [["value", "isolated"]]),
        (isolated, "typeof require", lambda r: r == [["value", "undefined"]]),
        (isolated, ":preload preloadMarker", lambda r: r == [["value", "isolated preload"]]),
        (isolated, "typeof preloadMarker", lambda r: r == [["value", "undefined"]]),
        (isolated, "document.querySelector('h1')", lambda r: r[0][1]["[[Class]]"] == "HTMLHeadingElement" and "Isolated" in r[0][1]["outerHTML"]),
        (isolated, "new Promise(resolve => setTimeout(() => resolve(7), 20))", lambda r: r == [["value", 7]]),
        (isolated, "var pageCounter = 3", lambda r: r[0][0] == "value"),
        (isolated, "pageCounter + 1", lambda r: r == [["value", 4]]),
        (isolated, "window.missing.deeper", lambda r: r[0][0] == "error" and "TypeError" in r[0][1]),
        (opened, "typeof require", lambda r: r == [["value", "function"]]),
        (opened, "window.fixtureOpen.role", lambda r: r == [["value", "open"]]),
        (opened, "window", lambda r: r[0][0] == "value" and r[0][1]["[[Class]]"] == "Window"),
    ]
    for page, source, accept in expectations:
        replies = harness.input("console", page, source)
        check.expect(accept(replies), f"page #{page} console: {source} → {replies}"[:300])


def actions(harness, target, ids, check):
    page = ids["Open page"][1:]
    shown = harness.action("contents", "show", page)["shown"]
    check.expect(shown == page, f"Show on a row shows its page: {shown}")
    harness.action("contents", "devtools", page)
    check.expect(target.wait_for(f"devtools {page} {{\"mode\":\"detach\",\"activate\":false}}"), "DevTools opens detached, without taking focus")
    harness.action("console", "clear", None, page)
    state = harness.state()
    check.expect(state["widgets"][f"contents/{page}/console"]["entries"] == [], "Clear on a page's console empties it")


def capture_controls(harness, check):
    harness.action("ipc", "clear")
    check.expect(harness.state()["widgets"]["ipc"]["rows"] == [], "Clear empties the IPC table")
    harness.action("ipc", "pause")
    time.sleep(0.6)
    before = len(harness.state()["widgets"]["ipc"]["rows"])
    time.sleep(2.2)
    state = harness.state()
    check.expect(len(state["widgets"]["ipc"]["rows"]) == before and state["widgets"]["ipc"]["disabled"] == ["pause"], "Pause stops recording")
    harness.action("ipc", "resume")
    time.sleep(2.2)
    state = harness.state()
    check.expect(len(state["widgets"]["ipc"]["rows"]) > before and state["widgets"]["ipc"]["disabled"] == ["resume"], "Resume records again")
    harness.configure({"channels": "^math:"})
    time.sleep(0.5)
    harness.action("ipc", "clear")
    time.sleep(2.2)
    channels = {row["channel"] for row in harness.state()["widgets"]["ipc"]["rows"]}
    check.expect(channels == {"math:add", "math:fail"}, f"the channel filter keeps only what matches: {channels}")
    harness.configure({"ratePerSecond": 3})
    time.sleep(2.5)
    status = {item["id"]: item for item in harness.state()["widgets"]["status"]["items"]}
    check.expect("ipc" in status and "not recorded, over the cap of 3 a second" in status["ipc"]["title"], f"the rate cap drops and says so: {status.get('ipc')}")
    harness.configure({})
    harness.action("ipc", "clear")


def archive(harness, target, layout, check):
    state = harness.state()
    files = {row["path"]: row for row in state["widgets"]["files"]["rows"]}
    if layout == "dir":
        check.expect(files == {} and state["widgets"]["files"]["disabled"] == ["archive"], "no archive, no files, Export app.asar off")
        return
    check.expect({"package.json", "main.js", "preload-isolated.js", "unpacked/notes.txt"} <= set(files), f"the archive's files are listed: {sorted(files)}")
    check.expect(files["unpacked/notes.txt"]["where"] == "app.asar.unpacked" and files["main.js"]["where"] == "packed", "where each file is kept")
    asar_path = target.app / "Contents/Resources/app.asar"
    harness.action("files", "export", "package.json")
    harness.action("files", "export", "unpacked/notes.txt")
    harness.action("files", "archive")
    time.sleep(0.5)
    offered = harness.state()["offered"]
    by_name = {offer["name"]: offer for offer in offered}
    package = (here / "fixture/package.json").read_bytes()
    exported = by_name.get("package.json", {})
    same = (exported.get("sha256") == hashlib.sha256(package).hexdigest()) if layout == "asar" else exported.get("size", 0) > 0
    check.expect(exported.get("mediaType") == "application/json" and same, f"package.json is exported from the archive: {exported}")
    notes = (here / "fixture/unpacked/notes.txt").read_bytes()
    check.expect(by_name["notes.txt"]["sha256"] == hashlib.sha256(notes).hexdigest(), "an unpacked file is exported from app.asar.unpacked")
    whole = asar_path.read_bytes()
    check.expect(by_name["app.asar"]["size"] == len(whole) and by_name["app.asar"]["sha256"] == hashlib.sha256(whole).hexdigest(),
                 "Export app.asar streams the whole archive")
    replies = harness.input("console", None, ":save main.js")
    check.expect(replies and replies[0][0] == "output" and harness.state()["offered"][-1]["name"] == "main.js", f":save offers a file: {replies}")
    replies = harness.input("console", None, ":save nowhere.js")
    check.expect(replies[0][0] == "error", ":save of a missing file says so")
    harness.configure({"archivePaths": "^preload-"})
    rows = harness.state()["widgets"]["files"]["rows"]
    check.expect(sorted(row["path"] for row in rows) == ["preload-isolated.js", "preload-open.js"], "the archive path filter narrows the table")
    harness.configure({})


def lifecycle(harness, ids, check):
    victim = ids["Victim page"][1:]
    harness.input("console", None, f"webContents.fromId({victim}).forcefullyCrashRenderer()")
    page = wait_for_page(harness, victim, lambda page: page["badge"]["tone"] == "failed")
    check.expect(page is not None and page["badge"]["text"].startswith("crashed ("), f"a crashed renderer's page says so: {page}")
    harness.input("console", None, f"BrowserWindow.fromWebContents(webContents.fromId({victim})).destroy()")
    page = wait_for_page(harness, victim, lambda page: page["badge"]["tone"] == "ended")
    check.expect(page is not None and page["badge"]["text"] == "destroyed", f"a destroyed one's page says so: {page}")
    replies = harness.input("console", victim, "1 + 1")
    check.expect(replies[0][0] == "error" and "destroyed" in replies[0][1], f"its console refuses: {replies}")
    csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src \\'self\\'\">"
    harness.input("console", None, f"new BrowserWindow({{ show: false, title: 'Late' }}).loadURL('data:text/html,{csp}<title>Late page</title><p>strict</p>')")
    late = wait_for_page(harness, None, lambda page: page["title"] == "Late page")
    check.expect(late is not None and late["badge"]["text"] == "ready", f"a window opened later gets a page: {late}")
    replies = harness.input("console", late["id"], "document.title")
    check.expect(replies[0][0] == "output" and "Content Security Policy" in replies[0][1] and replies[1:] == [["value", "Late page"]],
                 f"a page whose CSP forbids eval still runs what is typed, and says so: {replies}")
    replies = harness.input("console", late["id"], "var strictCount = 2; strictCount * 3")
    check.expect(replies == [["value", 6]], f"the note is given once, and the script runs: {replies}")
    replies = harness.input("console", late["id"], "document.body")
    check.expect(replies == [["value", {}]], f"a DOM node comes back empty, as the note says: {replies}")


def wait_for_page(harness, page_id, accept, timeout=6):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for page in harness.state()["pages"]:
            if (page_id is None or page["id"] == page_id) and accept(page):
                return page
        time.sleep(0.25)
    return None


def spawned(app, env):
    check = Check()
    device = frida.get_local_device()
    lines = []
    device.on("output", lambda pid, fd, data: lines.extend(data.decode().splitlines()))
    user_data = tempfile.mkdtemp(prefix="luma-electron-")
    pid = device.spawn([str(app / "Contents/MacOS/Electron"), f"--user-data-dir={user_data}"], env={**os.environ, **env}, stdio="pipe")
    try:
        harness = Harness(pid)
        try:
            device.resume(pid)
            time.sleep(SETTLE_SECONDS + 1)
            state = harness.state()
            status = {item["id"]: item for item in state["widgets"]["status"]["items"]}
            check.expect(status["javascript"]["title"].startswith("Reached the main process's JavaScript"), f"reached at launch: {status['javascript']}")
            rows = state["widgets"]["ipc"]["rows"]
            ticks = sorted(int(row["args"].split(",")[0]) for row in rows if row["channel"] == "tick")
            check.expect(ticks[:1] == [1], f"IPC is recorded from the app's first tick: {ticks[:4]}")
            check.expect(any(row["channel"] == "port:gift" and row["kind"] == "webContents.postMessage (1 port)" for row in rows),
                         "the port the app hands over once at its second tick is seen")
            check.expect(len(state["pages"]) == 3 and all(page["badge"]["text"] == "ready" for page in state["pages"]), "each window has a page")
            check.expect(any("round isolated ok" in line for line in lines) and not any("BROKEN" in line for line in lines),
                         "the app's own IPC checks pass when instrumented from launch")
            harness.dispose()
        finally:
            harness.detach()
    finally:
        device.kill(pid)
        shutil.rmtree(user_data, ignore_errors=True)
    print(f"=== {app.name} spawn: {check.summary()}", flush=True)
    sys.exit(0 if check.failures == 0 else 1)


def other_processes(target, check):
    main = Harness(target.pid)
    try:
        time.sleep(SETTLE_SECONDS)
        rows = {row["title"]: row for row in main.state()["widgets"]["contents"]["rows"]}
        metrics = main.input("console", None, "JSON.stringify(app.getAppMetrics().map(m => [m.pid, m.type]))")
        gpu = next(pid for pid, kind in json.loads(metrics[0][1]) if kind == "GPU")
    finally:
        main.detach()
    renderer(target, int(rows["Open page"]["pid"]), check)
    sandboxed_renderer(target, int(rows["Isolated page"]["pid"]), check)
    gpu_process(target, gpu, check)


def renderer(target, pid, check):
    harness = Harness(pid)
    try:
        time.sleep(SETTLE_SECONDS)
        state = harness.state()
        status = {item["id"]: item for item in state["widgets"]["status"]["items"]}
        check.expect(status["process"]["title"].startswith("The renderer process of") and f"pid {target.pid}" in status["process"]["subtitle"],
                     f"a renderer says so and points to the main process: {status['process']}")
        check.expect(status["javascript"]["title"].startswith("Reached this renderer process's Node environment"), f"its Node is reached: {status['javascript']}")
        replies = harness.input("console", None, "[process.type, document.title]")
        check.expect(replies == [["value", ["renderer", "Open page"]]], f"its console runs in the page: {replies}")
        facts = {row["id"]: row["value"] for row in state["widgets"]["facts"]["rows"]}
        check.expect(facts["chrome"] != "—" and "Open page" in facts["location"], f"its facts: {facts.get('location')}")
        check.expect(state["widgets"]["contents"]["rows"] == [] and state["widgets"]["ipc"]["rows"] == [], "no web contents or IPC outside the main process")
        harness.dispose()
    finally:
        harness.detach()


def sandboxed_renderer(target, pid, check):
    harness = Harness(pid)
    try:
        status = {item["id"]: item for item in harness.state()["widgets"]["status"]["items"]}
        check.expect(status["javascript"]["title"] == "No JavaScript of the app's runs in this process" and "sandboxed" in status["javascript"]["subtitle"]
                     and f"pid {target.pid}" in status["javascript"]["subtitle"], f"a sandboxed renderer says so at once: {status['javascript']}")
        replies = harness.input("console", None, "1 + 1")
        check.expect(replies[0][0] == "error", f"its console says it cannot run: {replies}")
        harness.dispose()
    finally:
        harness.detach()


def gpu_process(target, pid, check):
    harness = Harness(pid)
    try:
        state = harness.state()
        status = {item["id"]: item for item in state["widgets"]["status"]["items"]}
        check.expect(status["process"]["title"].startswith("The GPU process of"), f"the GPU process says so: {status['process']}")
        replies = harness.input("console", None, "1 + 1")
        check.expect(replies[0][0] == "error" and "No Node environment runs in the GPU process" in replies[0][1], f"its console explains: {replies}")
        facts = {row["id"]: row["value"] for row in state["widgets"]["facts"]["rows"]}
        check.expect("fuse-RunAsNode" in facts and "integrity" in facts, "fuses and integrity are read from any process")
        harness.dispose()
    finally:
        harness.detach()


def flood(target, check):
    harness = Harness(target.pid)
    try:
        time.sleep(SETTLE_SECONDS + 2)
        state = harness.state()
        status = {item["id"]: item for item in state["widgets"]["status"]["items"]}
        dropped = int(re.match(r"(\d+)", status["ipc"]["title"]).group(1)) if "ipc" in status else 0
        rows = len(state["widgets"]["ipc"]["rows"])
        print(f"    {rows} rows kept, {dropped} dropped", flush=True)
        check.expect(dropped > 1000 and rows <= 1000, f"a flood is capped and counted: {rows} rows, {dropped} dropped")
        started = time.time()
        replies = harness.input("console", None, "1 + 1")
        check.expect(replies == [["value", 2]] and time.time() - started < 2, f"the console still answers under a flood in {time.time() - started:.2f} s")
        harness.dispose()
    finally:
        harness.detach()


class Harness:
    def __init__(self, pid):
        compiler = frida.Compiler()
        compiler.on("diagnostics", lambda diagnostics: print("diagnostics", diagnostics, flush=True))
        bundle = compiler.build(str(here / "harness.ts"), project_root=str(repository), type_check="full", compression="terser")
        self.session = frida.attach(pid)
        self.script = self.session.create_script(bundle)
        self.script.on("message", self.on_message)
        self.script.load()

    def state(self):
        return json.loads(self.script.exports_sync.state())

    def input(self, widget, child, text):
        print(f"  {widget}{'/' + child if child else ''}> {text}", flush=True)
        replies = json.loads(self.script.exports_sync.input(widget, child, text))
        for kind, payload in replies:
            print(f"    {kind}: {json.dumps(payload)[:200]}", flush=True)
        return replies

    def action(self, widget, action, item=None, child=None):
        return json.loads(self.script.exports_sync.action(widget, action, item, child))

    def configure(self, settings):
        self.script.exports_sync.configure(settings)

    def dispose(self):
        self.script.exports_sync.dispose()

    def pristine(self):
        return self.script.exports_sync.pristine()

    def target_taps(self):
        return self.script.exports_sync.target_taps()

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
    def __init__(self, app, env):
        self.app = app
        self.user_data = tempfile.mkdtemp(prefix="luma-electron-")
        executable = app / "Contents/MacOS/Electron"
        self.process = subprocess.Popen([str(executable), f"--user-data-dir={self.user_data}"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1,
                                        env={**os.environ, **env})
        self.lines = []
        self.changed = threading.Condition()
        threading.Thread(target=self.read, daemon=True).start()
        self.pid = self.process.pid
        if not self.wait_for("FIXTURE ready", timeout=20):
            self.stop()
            raise RuntimeError(f"{app.name} did not start")

    def read(self):
        for line in self.process.stdout:
            with self.changed:
                self.lines.append(line.rstrip("\n"))
                self.changed.notify_all()

    def count(self, text):
        with self.changed:
            return sum(text in line for line in self.lines)

    def wait_for(self, text, count=1, timeout=5):
        with self.changed:
            return self.changed.wait_for(lambda: sum(text in line for line in self.lines) >= count, timeout)

    def broken(self):
        return [line for line in self.lines if "BROKEN" in line]

    def alive(self):
        return self.process.poll() is None

    def stop(self):
        self.process.terminate()
        try:
            self.process.wait(5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        shutil.rmtree(self.user_data, ignore_errors=True)
        domain = f"re.frida.luma.electron-fixture.{re.search(r'-(asar|dir|esm)[.]app$', self.app.name).group(1)}"
        subprocess.run(["defaults", "delete", domain], capture_output=True)
        Path.home().joinpath(f"Library/Preferences/{domain}.plist").unlink(missing_ok=True)


main()
