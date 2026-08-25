#!/usr/bin/env python3
"""
Internal-only helper for IOP's "Check Availability" feature.

iop-api runs in a Docker bridge network and can't bind to the host's real
NICs directly. This tiny service runs on the host itself (systemd-managed)
and performs the actual ping using the host's genuine, already-owned
interface addresses (ens192/ens224) — so results reflect what's really
reachable from each real network segment, without needing macvlan or any
vSwitch security policy change.

Bound only to the Docker bridge gateway address (never a real host NIC),
plus a shared-secret header check.
"""
import http.server
import json
import os
import subprocess
import time

BIND_HOST = os.environ.get("SCAN_HELPER_BIND", "172.19.0.1")
BIND_PORT = int(os.environ.get("SCAN_HELPER_PORT", "8901"))
AUTH_TOKEN = os.environ.get("SCAN_HELPER_TOKEN", "")

# Maps the UI's chosen scan source to the host's real interface address.
SOURCES = {
    "ens192": "172.31.3.166",
    "ens224": "10.160.30.22",
}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        pass  # keep the journal quiet; this gets called on every check

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/check":
            self._send(404, {"error": "not found"})
            return
        if AUTH_TOKEN and self.headers.get("X-Scan-Token") != AUTH_TOKEN:
            self._send(403, {"error": "forbidden"})
            return

        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json"})
            return

        source = data.get("source")
        target = data.get("target")
        source_ip = SOURCES.get(source)
        if not source_ip or not target:
            self._send(400, {"error": "invalid source or target"})
            return

        reachable = False
        latency_ms = None
        try:
            start = time.monotonic()
            result = subprocess.run(
                ["ping", "-c", "1", "-W", "2", "-I", source_ip, target],
                capture_output=True,
                timeout=5,
            )
            if result.returncode == 0:
                reachable = True
                latency_ms = round((time.monotonic() - start) * 1000, 1)
        except Exception:
            pass

        self._send(200, {
            "reachable": reachable,
            "latency_ms": latency_ms,
            "method": "icmp",
            "source": source,
            "source_ip": source_ip,
        })


def main() -> None:
    server = http.server.ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
