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
| `scan_helper.py` | Small always-on service (systemd, see `iop-scan-helper.service`) that lets "Check Availability" ping out through the host's *real* `ens192`/`ens224` interfaces instead of the `iop-api` container's own bridge network. Bound only to the internal Docker bridge gateway, never a real NIC; shared-secret header auth. |
| `iop-scan-helper.service` | systemd unit for `scan_helper.py`. |
| `zabbix_reconcile.py` | One-time cleanup tool (kept for reference) — used once to fix IP records that `zabbix_sync.py` had incorrectly marked "In Use" before the disabled+stale exclusion existed. Dry-run by default; set `APPLY=1` to actually delete/update. Not part of any recurring job. |

`device42_sync.py`, `zabbix_sync.py`, and `paloalto_sync.py` all upsert a
one-document-per-source summary into the `sync_status` collection at the
end of every run (`last_run_at`, `status: "ok"|"error"`, `duration_seconds`,
`counters`, `error`) — even if the run itself throws partway through. The
dashboard's "Data Sync Health" card reads this collection via `GET /stats`
to show freshness/last-run info.

## Nightly schedule (crontab, `ansible` user)

```
0 2 * * *   /opt/IOP/scripts/run_device42_sync.sh   # ~25 min for 72k+ IPs
35 2 * * *  /opt/IOP/scripts/run_zabbix_sync.sh      # ~2-5 sec for ~475 hosts
50 2 * * *  /opt/IOP/scripts/run_paloalto_sync.sh    # ~25-30 sec across 3 firewalls
```

Device42 runs first and sets the baseline status (`In Use`/`Free`) from its
own inventory. Zabbix runs second and **only ever writes `"In Use"`** — it
upgrades a record when it has live positive evidence, or skips entirely
otherwise. PaloAlto runs third, same rule: only ever writes `"In Use"` for
a matched `/32` address object, never touches a `Reserved` record. None of
the three jobs can produce conflicting data even if their run windows ever
grow to overlap.

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
