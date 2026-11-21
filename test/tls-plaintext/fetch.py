import os
import sys
import time

url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com/"
delay = int(sys.argv[2]) if len(sys.argv) > 2 else 10

print(f"pid {os.getpid()}, importing ssl in {delay} s, then fetching {url} every 2 s", flush=True)
time.sleep(delay)

import urllib.request

while True:
    with urllib.request.urlopen(url) as response:
        print(response.status, len(response.read()), "bytes", flush=True)
    time.sleep(2)
