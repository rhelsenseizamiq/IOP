# Operational Scripts

Host-side automation that runs on the production server (`172.31.3.166`),
outside the Docker images. These are version-controlled here for
disaster-recovery, but **credentials are never checked in** — each wrapper
sources a `.env.*` file from `/opt/IOP/` on the server (`.env.device42`,
`.env.zabbix`, `.env.paloalto`), created manually and `chmod 600`.

## What's here

| File | Purpose |
|---|---|
| `device42_sync.py` | Full Device42 → IPAM sync (subnets, hostnames, OS, environment). Idempotent — safe to re-run. |
| `zabbix_sync.py` | Full Zabbix → IPAM sync. Matches hosts to existing subnets by IP-in-CIDR (Zabbix has no subnet concept of its own). Skips hosts that are disabled in Zabbix with no data in the last 6 months (`STALE_MONTHS`) — treated as likely decommissioned, never auto-marked "In Use". |
| `paloalto_sync.py` | Full PaloAlto → IPAM sync across every host in `PALOALTO_HOSTS`. Only imports named `/32` (single-host) address objects — the closest PaloAlto equivalent to Device42's curated inventory. Deliberately ignores ip-range/fqdn/wider-subnet address objects and the live ARP table (too noisy — transient client devices, not curated inventory); that raw data stays available through the manual discover/import UI flow instead. |
| `run_device42_sync.sh` | Cron wrapper for the Device42 sync — lock file (auto-clears if stale >2h, e.g. after a host crash/reboot), logging to `/opt/IOP/logs/device42_sync/`, 30-day log retention. |
| `run_zabbix_sync.sh` | Same wrapper pattern for the Zabbix sync. |
| `run_paloalto_sync.sh` | Same wrapper pattern for the PaloAlto sync. |
| `vcenter_sync.py` | Full vCenter → IPAM sync across every host in `VCENTER_HOSTS`. Discovers every **powered-on** VM and writes IP/hostname/OS type/power state, and (conditionally, see main README) environment. |
| `run_vcenter_sync.sh` | Same wrapper pattern, logs to `/opt/IOP/logs/vcenter_sync/`. |
| `build_embeddings.py` | Builds/refreshes the offline AI assistant's search index (`record_embeddings` collection) via the local Ollama models — see "Offline AI Assistant" below. **Subnets only today**, not IP records (too slow on this host's CPU at fleet scale — see that section). Never touches Vault password entries. |
| `run_build_embeddings.sh` | Same wrapper pattern, logs to `/opt/IOP/logs/build_embeddings/`. |
| `anomaly_digest.py` | Writes a single `dashboard_digests` document read by the Dashboard's "Daily Anomaly Digest" card. Every number in it comes from the same queries `stats.py` already uses (Stale "In Use", duplicate hostnames) plus one new one (DR-tagged records vCenter has never confirmed) — the LLM's only job is turning already-correct counts into one short paragraph, never computing them itself. Skips the LLM call entirely if every count is zero. |
| `run_anomaly_digest.sh` | Same wrapper pattern, logs to `/opt/IOP/logs/anomaly_digest/`, shorter 30-min stale-lock window (this job is quick — no data to enumerate, at most one short LLM call). |
| `scan_helper.py` | Small always-on service (systemd, see `iop-scan-helper.service`) that lets "Check Availability" ping out through the host's *real* `ens192`/`ens224` interfaces instead of the `iop-api` container's own bridge network. Bound only to the internal Docker bridge gateway, never a real NIC; shared-secret header auth. |
| `iop-scan-helper.service` | systemd unit for `scan_helper.py`. |
| `zabbix_reconcile.py` | One-time cleanup tool (kept for reference) — used once to fix IP records that `zabbix_sync.py` had incorrectly marked "In Use" before the disabled+stale exclusion existed. Dry-run by default; set `APPLY=1` to actually delete/update. Not part of any recurring job. |

`device42_sync.py`, `zabbix_sync.py`, `paloalto_sync.py`, `vcenter_sync.py`,
and `build_embeddings.py` all upsert a one-document-per-source summary into
the `sync_status` collection at the end of every run (`last_run_at`,
`status: "ok"|"error"`, `duration_seconds`, `counters`, `error`) — even if
the run itself throws partway through. The dashboard's "Data Sync Health"
card reads this collection via `GET /stats` to show freshness/last-run info.

`anomaly_digest.py` writes to a separate single-document collection,
`dashboard_digests` (`_id: "latest"`) — same shape (`generated_at`,
`status`, `counters`, `error`) plus a `summary` string — read via
`GET /stats/anomaly-digest` by the Dashboard's own card, kept apart from
`sync_status` since it isn't a data-source sync, it's a summary derived
from data other syncs already wrote.

## Nightly schedule (crontab, `ansible` user)

```
0 2 * * *   /opt/IOP/scripts/run_device42_sync.sh      # ~25 min for 72k+ IPs
35 2 * * *  /opt/IOP/scripts/run_zabbix_sync.sh         # ~2-5 sec for ~475 hosts
50 2 * * *  /opt/IOP/scripts/run_paloalto_sync.sh       # ~25-30 sec across 3 firewalls
10 3 * * *  /opt/IOP/scripts/run_vcenter_sync.sh        # ~35 sec for ~1,230 VMs
30 3 * * *  /opt/IOP/scripts/run_build_embeddings.sh    # see "Offline AI Assistant" below
40 3 * * *  /opt/IOP/scripts/run_anomaly_digest.sh      # ~1-3 min, Dashboard's Daily Anomaly Digest
```

Device42 runs first and sets the baseline status (`In Use`/`Free`) from its
own inventory. Zabbix, PaloAlto, and vCenter run after, all under the same
rule: **only ever write `"In Use"`** — upgrade a record on live positive
evidence, or skip entirely otherwise; none touches a `Reserved` record.
None of the four jobs can produce conflicting data even if their run
windows ever grow to overlap.

### Offline AI Assistant (`build_embeddings.py`) — CPU hardware constraint

This host's CPU is an **Intel Xeon E5-2670 (~2012, no AVX2/FMA)** — LLM
inference is genuinely slow here, not merely un-tuned: chat generation
measured **~0.18 tokens/second**, and a single embedding call measured
anywhere from ~350ms to ~19s depending on load/contention with a
concurrent chat request (Ollama is configured `OLLAMA_NUM_PARALLEL=1` on
this box — parallel requests don't add real throughput on a CPU that's
already the bottleneck, they just queue behind each other).

Because of this, `build_embeddings.py` indexes **subnets only** (~1,400
records) — full IP-record indexing (tens of thousands of records) would
take many hours and isn't scheduled. Vault password entries are **never**
indexed, regardless of scope — secrets must not enter the embedding/LLM
pipeline, even offline. Re-embedding is skipped for any record whose
`updated_at` hasn't changed since the last run, so the first backfill is
the slow one; nightly runs after that are fast (only genuinely-changed
subnets get re-embedded). See `ai_service.py`'s module docstring and the
main README's Changelog for the full investigation.

Ollama itself runs as a **native systemd service on the host** (not in
Docker — the server has no outbound internet, so pulling the `ollama/ollama`
image there isn't possible; the binary was transferred and installed
directly instead), bound only to `172.18.0.1:11434` — the `iop-external`
Docker bridge's own gateway address. Reachable from `iop-api`, unreachable
from `ens192`/`ens224` or anywhere outside the host. Model files live on
`/data/iop-ai-models/` (a separate 150GB disk — `/opt` itself is far too
small, 500MB total).

`PALOALTO_HOSTS` in `.env.paloalto` is a comma-separated list — currently
`ipa1.abb-bank.az,mgmt-pa2.abb-bank.az,ipatest2.abb-bank.az`, the 3 of 8
Palo Alto management hosts reachable from this server's `10.160.30.22`
(`ens224`) interface as of 2026-09-01. The other 5 (`ipa2`, `epa1`, `epa2`,
`mgmt-pa1`, `ipatest1`) need a broader firewall rule before they can be
added. Reaching `10.140.0.0/24` at all also depends on a persistent route
(`10.140.0.0/24 via 10.160.30.1 dev ens224`, `nmcli connection modify
ens224 +ipv4.routes ...`) with `ipv4.route-metric` deliberately set to
`200` on `ens224` — higher than `ens192`'s default — so `ens224` only wins
routing for that one specific subnet and never hijacks the box's normal
default route.

## Deploying a change to one of these scripts

The server has no outbound internet access, so `docker` images can't be
rebuilt there — everything here runs as plain host-side Python/bash, copied
into the `iop-api` container fresh on every invocation by the wrapper
script's `docker cp` step. To update:

```bash
scp scripts/zabbix_sync.py ansible@172.31.3.166:/home/ansible/
ssh ansible@172.31.3.166 'sudo cp /home/ansible/zabbix_sync.py /opt/IOP/scripts/zabbix_sync.py && sudo chown ansible:ansible /opt/IOP/scripts/zabbix_sync.py'
```

No container restart needed — the next cron run (or a manual
`/opt/IOP/scripts/run_zabbix_sync.sh`) picks it up automatically.
