#!/bin/bash
# Docker container status + real host disk usage snapshot, for the AI
# assistant's "docker status"/"server status" capabilities and the
# Dashboard's System Health card (both read it through
# app/services/system_health.py — see that module's docstring). Runs on
# the HOST only, as the ansible user (existing passwordless sudo docker
# access) — deliberately never inside a container, since the whole
# point is avoiding docker.sock exposure to iop-api (equivalent to
# giving that container root on the host; the standard mitigation, a
# docker-socket-proxy sidecar, needs an image this air-gapped host
# can't pull). Disk usage specifically can ONLY come from here, not from
# inside iop-api: a container's own "/" is just its writable overlay
# layer, unrelated to the host's real disk layout (/, /data, /opt are
# separate LVs) — reading it from inside the container would be a
# confidently wrong number, not a merely approximate one. Writes a plain
# JSON file, bind-mounted READ-ONLY into iop-api (see docker-compose.yml).
#
# Runs via cron every 2 minutes (see README) — much lighter than the
# nightly sync jobs (a handful of `docker inspect`/`df` calls, sub-
# second), so this deliberately skips their lock-file/logdir machinery;
# brief overlap between runs is harmless since each run's output fully
# replaces the last via atomic mv.
set -euo pipefail

OUTDIR=/opt/IOP/status
OUT="$OUTDIR/docker_status.json"
mkdir -p "$OUTDIR"
TMP=$(mktemp)

{
  echo "{"
  printf '  "generated_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo '  "containers": ['
  first=true
  for name in $(sudo docker ps -a --format '{{.Names}}'); do
    state=$(sudo docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo "unknown")
    health=$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$name" 2>/dev/null || echo "unknown")
    started=$(sudo docker inspect -f '{{.State.StartedAt}}' "$name" 2>/dev/null || echo "unknown")
    if [ "$first" = false ]; then echo ","; fi
    first=false
    printf '    {"name": "%s", "status": "%s", "health": "%s", "started_at": "%s"}' \
      "$name" "$state" "$health" "$started"
  done
  echo ""
  echo "  ],"
  echo '  "disk": ['
  first=true
  for mnt in / /data /opt; do
    read -r size_bytes used_bytes avail_bytes used_pct < <(
      df -B1 --output=size,used,avail,pcent "$mnt" | tail -1 | tr -d '%'
    )
    if [ "$first" = false ]; then echo ","; fi
    first=false
    printf '    {"mount": "%s", "size_bytes": %s, "used_bytes": %s, "avail_bytes": %s, "used_pct": %s}' \
      "$mnt" "$size_bytes" "$used_bytes" "$avail_bytes" "$used_pct"
  done
  echo ""
  echo "  ]"
  echo "}"
} > "$TMP"

sudo mv "$TMP" "$OUT"
sudo chown ansible:ansible "$OUT"
