"""ClamAV integration — talks to clamd running NATIVELY on the host, not in
Docker (this host cannot pull Docker images from any registry at all,
confirmed directly when rebuilding iop-api's own image hit the same wall —
the same reason Ollama runs natively here too). Reached over the Docker
bridge gateway address, same isolation pattern as Ollama.

Scans by FILESYSTEM PATH, not by streaming bytes over the socket: the
file-storage directory is a host BIND mount (not a Docker-internal volume),
so the exact same underlying file is visible to clamd on the host and to
iop-api inside the container, just under two different path prefixes —
to_host_path() translates between them.

Return-value parsing below is based on the actual installed `clamd` package
source (python-clamd), verified directly rather than assumed: `scan(path)`
returns `{path: (status, reason)}` where status is one of "OK" (clean),
"FOUND" (infected, reason = signature name), or "ERROR". It raises
clamd.ConnectionError for a socket-level failure and clamd.ResponseError for
a malformed reply — both treated here as SCAN_FAILED, never as clean. A scan
that can't be completed must never be treated as "no threat found".
"""
import logging
from enum import Enum

import clamd

from app.config import get_settings

logger = logging.getLogger(__name__)


class ScanVerdict(str, Enum):
    CLEAN = "clean"
    INFECTED = "infected"
    SCAN_FAILED = "scan_failed"


def to_host_path(container_path: str) -> str:
    """Translates a path under FILE_STORAGE_ROOT (this container's view) to
    the equivalent path under FILE_STORAGE_HOST_ROOT (the host's view of the
    same bind-mounted file) — clamd runs on the host and needs the host's
    own path to open it."""
    settings = get_settings()
    root = settings.FILE_STORAGE_ROOT.rstrip("/")
    if not container_path.startswith(root + "/"):
        raise ValueError(f"Path {container_path!r} is not under FILE_STORAGE_ROOT {root!r}")
    relative = container_path[len(root):]
    return settings.FILE_STORAGE_HOST_ROOT.rstrip("/") + relative


def scan_file(container_path: str) -> tuple[ScanVerdict, str | None]:
    """Scans a file already written to disk, by path.

    Returns:
        (verdict, signature_name_or_none) — signature_name is only set for
        ScanVerdict.INFECTED.

    Never raises for a detected infection or a connectivity failure — both
    are returned as a verdict so the caller's fail-closed logic is a single
    code path, not scattered exception handling.
    """
    settings = get_settings()
    host_path = to_host_path(container_path)
    try:
        client = clamd.ClamdNetworkSocket(
            host=settings.CLAMD_HOST, port=settings.CLAMD_PORT, timeout=settings.CLAMD_TIMEOUT_SECONDS,
        )
        result = client.scan(host_path)
    except (clamd.ConnectionError, clamd.ResponseError, OSError) as exc:
        logger.error("ClamAV scan failed for %s: %s: %s", host_path, type(exc).__name__, exc)
        return ScanVerdict.SCAN_FAILED, None

    verdict = result.get(host_path)
    if verdict is None:
        logger.error("ClamAV scan returned no result for %s (raw: %r)", host_path, result)
        return ScanVerdict.SCAN_FAILED, None

    status, reason = verdict
    if status == "OK":
        return ScanVerdict.CLEAN, None
    if status == "FOUND":
        return ScanVerdict.INFECTED, reason
    logger.error("ClamAV scan returned unexpected status %r for %s", status, host_path)
    return ScanVerdict.SCAN_FAILED, None
