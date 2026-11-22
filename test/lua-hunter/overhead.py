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

WINDOW_SECONDS = 4


def main():
    host = Host(sys.argv[1])
    try:
        time.sleep(2)
        print(f"before loading: {host.rate()} ticks/s", flush=True)
        script = load_harness(host.pid)
        print(f"after loading, watching for a while and then not at all: {host.rate()} ticks/s", flush=True)
        idle = idle_interpreter(script)
        script.exports_sync.use(idle)
        replies = []
        waiting = threading.Thread(target=lambda: replies.append(script.exports_sync.input("host_name")), daemon=True)
        waiting.start()
        print(f"while a chunk waits for the idle interpreter #{idle}: {host.rate()} ticks/s", flush=True)
        script.exports_sync.input(":cancel")
        waiting.join()
        print(f"after canceling it: {host.rate()} ticks/s; the chunk got {replies[0]}", flush=True)
        script.exports_sync.dispose()
        script.unload()
        print(f"after unloading: {host.rate()} ticks/s", flush=True)
    finally:
        host.stop()


def load_harness(pid):
    bundle = frida.Compiler().build(str(here / "harness.ts"), project_root=str(repository), type_check="none")
    script = frida.attach(pid).create_script(bundle)
    script.on("message", lambda message, data: None)
    script.load()
    script.exports_sync.log_widgets(False)
    return script


def idle_interpreter(script):
    listing = json.loads(script.exports_sync.input(":list"))
    return next(int(re.search(r"#(\d+) ", text).group(1)) for kind, text in listing if "not seen running yet" in text)


class Host:
    def __init__(self, path):
        self.process = subprocess.Popen([path, "fast:busy", "sleepy:idle"], stdout=subprocess.PIPE, text=True, bufsize=1)
        self.pid = self.process.pid
        self.samples = []
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        for line in self.process.stdout:
            match = re.search(r"\[fast\] (\d+) ticks/s", line)
            if match is not None:
                self.samples.append((time.time(), int(match.group(1))))

    def rate(self):
        started = time.time()
        time.sleep(WINDOW_SECONDS)
        window = [rate for at, rate in self.samples if at > started]
        return round(sum(window) / max(len(window), 1))

    def stop(self):
        self.process.kill()
        self.process.wait()


main()
