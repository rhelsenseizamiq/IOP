"""Unit tests for app/services/system_health.py — the shared data source
behind both the AI assistant's "server status"/"docker status" answers
and the Dashboard's System Health card (GET /stats/system-health).

Mocks the filesystem reads (/proc/meminfo, /proc/loadavg, the Docker
status snapshot file) rather than depending on the real host — these
functions are pure "read a file, return structured data", so the
interesting behavior to verify is the parsing/math/staleness logic,
not any real /proc content.
"""
import builtins
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import mock_open, patch

from app.services import system_health

MEMINFO_SAMPLE = (
    "MemTotal:       32614400 kB\n"
    "MemFree:        20000000 kB\n"
    "MemAvailable:   28311552 kB\n"
    "Buffers:          200000 kB\n"
    "Cached:          4000000 kB\n"
)
LOADAVG_SAMPLE = "0.50 0.25 0.10 2/543 12345\n"


def _open_side_effect(meminfo=MEMINFO_SAMPLE, loadavg=LOADAVG_SAMPLE):
    """Routes open() calls to canned /proc content by path, leaving
    everything else to the real builtins.open (pytest/coverage machinery
    opens plenty of files of its own during a test run)."""
    real_open = builtins.open

    def _opener(path, *args, **kwargs):
        if path == "/proc/meminfo":
            return mock_open(read_data=meminfo)()
        if path == "/proc/loadavg":
            return mock_open(read_data=loadavg)()
        return real_open(path, *args, **kwargs)

    return _opener


def test_get_server_resources_parses_meminfo_and_loadavg():
    with patch("builtins.open", side_effect=_open_side_effect()):
        result = system_health.get_server_resources()

    assert "error" not in result
    # 32614400 kB total -> ~31.1 GB
    assert result["ram_total_gb"] == 31.1
    # used = total - available = 32614400 - 28311552 kB -> ~4.1 GB
    assert result["ram_used_gb"] == 4.1
    assert result["ram_available_gb"] == 27.0
    assert result["ram_used_pct"] == 13.2
    assert result["load_1m"] == 0.50
    assert result["load_5m"] == 0.25
    assert result["load_15m"] == 0.10
    assert result["cpu_count"] >= 1


def test_get_server_resources_missing_proc_returns_error():
    def _raise(path, *args, **kwargs):
        raise OSError(f"no such file: {path}")

    with patch("builtins.open", side_effect=_raise):
        result = system_health.get_server_resources()

    assert "error" in result
    assert "ram_total_gb" not in result


def test_get_server_resources_zero_total_avoids_division_by_zero():
    with patch(
        "builtins.open",
        side_effect=_open_side_effect(meminfo="MemTotal: 0 kB\nMemAvailable: 0 kB\n"),
    ):
        result = system_health.get_server_resources()

    assert result["ram_total_gb"] == 0
    assert result["ram_used_pct"] is None


def _docker_status_open(payload: dict):
    def _opener(path, *args, **kwargs):
        if path == system_health._DOCKER_STATUS_PATH:
            return mock_open(read_data=json.dumps(payload))()
        raise AssertionError(f"unexpected open() call: {path}")

    return _opener


def test_get_docker_status_fresh_snapshot_not_stale():
    fresh = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "generated_at": fresh,
        "containers": [{"name": "iop-api", "status": "running", "health": "healthy", "started_at": fresh}],
        "disk": [{"mount": "/", "size_bytes": 100, "used_bytes": 50, "avail_bytes": 50, "used_pct": 50}],
    }
    with patch("builtins.open", side_effect=_docker_status_open(payload)):
        result = system_health.get_docker_status()

    assert result["is_stale"] is False
    assert result["error"] is None
    assert len(result["containers"]) == 1
    assert result["containers"][0]["name"] == "iop-api"
    assert len(result["disk"]) == 1


def test_get_docker_status_old_snapshot_is_stale():
    stale_time = (
        datetime.now(timezone.utc)
        - timedelta(seconds=system_health.DOCKER_STATUS_STALE_SECONDS + 60)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {"generated_at": stale_time, "containers": [], "disk": []}
    with patch("builtins.open", side_effect=_docker_status_open(payload)):
        result = system_health.get_docker_status()

    assert result["is_stale"] is True


def test_get_docker_status_missing_file():
    def _raise(path, *args, **kwargs):
        raise FileNotFoundError(path)

    with patch("builtins.open", side_effect=_raise):
        result = system_health.get_docker_status()

    assert result["is_stale"] is True
    assert result["containers"] == []
    assert result["disk"] == []
    assert result["error"] is not None


def test_get_docker_status_invalid_json():
    def _opener(path, *args, **kwargs):
        return mock_open(read_data="not valid json{{{")()

    with patch("builtins.open", side_effect=_opener):
        result = system_health.get_docker_status()

    assert result["is_stale"] is True
    assert result["error"] is not None
