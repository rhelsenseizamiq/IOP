"""Host system health — server resources (RAM/CPU) and Docker container
status, as structured data. Two different callers need this: the AI
assistant (assistant.py's _server_status()/_docker_status(), which narrate
it into a sentence or two for chat) and the Dashboard's System Health card
(GET /stats/system-health, which wants the raw numbers as JSON). Both read
through these same functions rather than each parsing /proc or the Docker
snapshot file a second, slightly different way.

RAM/CPU come straight from /proc inside this container — verified
empirically that these specific files are NOT namespaced per-container
(unlike cgroup memory limits) and reflect the real host's numbers almost
exactly (checked side-by-side against `free -h`/`/proc/loadavg` run
directly on the host). Disk usage is deliberately NOT read from inside
this container: its own "/" is just its writable overlay layer, unrelated
to the host's actual disk layout (/, /data, /opt are separate LVs) —
reporting that would be a confidently wrong number, not a merely
approximate one. Real disk numbers instead come from the same host-side
snapshot as the container list (scripts/docker_status_snapshot.sh, cron
every 2 min, bind-mounted read-only — never docker.sock, see that
script's own docstring for why).

The snapshot is read from a DIRECTORY mount (docker-compose.yml mounts
/opt/IOP/status, not the file itself) — the snapshot script atomically
replaces the file on every run via `mv`, which rotates its inode; a
single-FILE bind mount would stay pinned to whatever inode existed when
this container started and silently stop seeing updates after that
(same bug class already hit once with cert rotation — see
feedback_docker_single_file_bind_mount_cert_rotation.md in project
memory). Directory mounts resolve entries by name on every access, so
they don't have this problem.
"""
import json
import os
from datetime import datetime, timezone

_DOCKER_STATUS_PATH = "/app/status/docker_status.json"
# If the snapshot is older than this, the cron job itself is probably
# broken (or was never deployed) — callers should say so explicitly
# rather than quietly serving stale status as if it were live.
DOCKER_STATUS_STALE_SECONDS = 600


def get_server_resources() -> dict:
    mem: dict[str, int] = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, rest = line.partition(":")
                try:
                    mem[key] = int(rest.strip().split()[0])
                except (ValueError, IndexError):
                    continue
        with open("/proc/loadavg") as f:
            load1, load5, load15 = f.read().split()[:3]
    except OSError as exc:
        return {"error": str(exc)}

    total_kb = mem.get("MemTotal", 0)
    available_kb = mem.get("MemAvailable", 0)
    used_kb = max(total_kb - available_kb, 0)

    return {
        "ram_total_gb": round(total_kb / 1024 / 1024, 1),
        "ram_used_gb": round(used_kb / 1024 / 1024, 1),
        "ram_available_gb": round(available_kb / 1024 / 1024, 1),
        "ram_used_pct": round(used_kb / total_kb * 100, 1) if total_kb else None,
        "cpu_count": os.cpu_count() or 1,
        "load_1m": float(load1),
        "load_5m": float(load5),
        "load_15m": float(load15),
    }


def get_docker_status() -> dict:
    try:
        with open(_DOCKER_STATUS_PATH) as f:
            data = json.load(f)
    except FileNotFoundError:
        return {
            "generated_at": None,
            "is_stale": True,
            "containers": [],
            "disk": [],
            "error": "No snapshot yet — scripts/docker_status_snapshot.sh may not be deployed or hasn't run.",
        }
    except (OSError, json.JSONDecodeError) as exc:
        return {"generated_at": None, "is_stale": True, "containers": [], "disk": [], "error": str(exc)}

    generated_at = data.get("generated_at")
    is_stale = True
    if generated_at:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(generated_at)).total_seconds()
            is_stale = age > DOCKER_STATUS_STALE_SECONDS
        except ValueError:
            pass

    return {
        "generated_at": generated_at,
        "is_stale": is_stale,
        "containers": data.get("containers", []),
        "disk": data.get("disk", []),
        "error": None,
    }
