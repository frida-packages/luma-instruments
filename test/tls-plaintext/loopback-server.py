import hashlib
import http.server
import ssl
import sys
from pathlib import Path


def main():
    port = int(sys.argv[1])
    directory = Path(sys.argv[2])
    write_expected(directory)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(directory / "cert.pem", directory / "key.pem")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


def write_expected(directory):
    body = request_body()
    (directory / "request-body").write_bytes(body)
    (directory / "get-response").write_bytes(response(payload(3000)))
    (directory / "post-response").write_bytes(response(hashlib.sha256(body).hexdigest().encode()))


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        size = int(self.path.rsplit("/", 1)[-1]) if self.path.startswith("/payload/") else 64
        self.reply(payload(size))

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.reply(hashlib.sha256(body).hexdigest().encode())

    def reply(self, body):
        self.log_message("%s %s -> %d bytes", self.command, self.path, len(body))
        self.wfile.write(response(body))


def request_body():
    return bytes(i % 251 for i in range(5000))


def payload(size):
    data = bytearray()
    block = 0
    while len(data) < size:
        data += hashlib.sha256(str(block).encode()).digest()
        block += 1
    return bytes(data[:size])


def response(body):
    return b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n" % len(body) + body


main()
