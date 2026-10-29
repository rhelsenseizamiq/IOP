#!/bin/bash
# Docker container status snapshot for the AI assistant's "docker
# status" capability (assistant.py's _docker_status()). Runs on the
# HOST only, as the ansible user (existing passwordless sudo docker
# access) — deliberately never inside a container, since the whole
# point is avoiding docker.sock exposure to iop-api (equivalent to
# giving that container root on the host; the standard mitigation, a
# docker-socket-proxy sidecar, needs an image this air-gapped host
# can't pull). Writes a plain JSON file instead, which is bind-mounted
# READ-ONLY into iop-api (see docker-compose.yml).
#
# Runs via cron every 2 minutes (see README) — much lighter than the
# nightly sync jobs (a handful of `docker inspect` calls, sub-second),
# so this deliberately skips their lock-file/logdir machinery; brief
# overlap between runs is harmless since each run's output fully
# replaces the last via atomic mv.
set -euo pipefail

OUT=/opt/IOP/docker_status.json
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
  echo "  ]"
  echo "}"
} > "$TMP"

sudo mv "$TMP" "$OUT"
sudo chown ansible:ansible "$OUT"
