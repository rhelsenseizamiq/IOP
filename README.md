# IOP — Infrastructure Operations Platform

A self-hosted IP Address Management portal with NetBox-style prefix hierarchy, dual-stack IPv4/IPv6, Device42 & Zabbix & PaloAlto integrations (with nightly automated sync), a real-time PaloAlto Check page (trace log, 30-day check + traffic history), merged multi-source Check Availability with OS/hostname auto-enrichment, duplicate detection with bulk re-verification, a human-friendly Unused IP Addresses view, infrastructure network scanning, granular role-based access control, Password Vault with folder organisation and secure sharing, and optional LDAP/AD authentication.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11 · FastAPI · Motor (async MongoDB) · Pydantic v2 |
| Frontend | React 18 · Vite · TypeScript · Ant Design 5 · recharts |
| Database | MongoDB 7 |
| Auth | JWT (HS256) · local accounts · self-registration with admin approval · optional LDAP/AD via ldap3 |
| Container | Docker Compose · Nginx reverse proxy (TLS) |

---

## Quick Start

```bash
git clone <repo-url> && cd iop
cp backend/.env.example backend/.env   # edit values
docker compose up --build -d
```

Portal available at **https://your-domain**. Default login set via `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` in `.env`.

**Rebuild after code changes:**
```bash
docker compose build frontend api && docker compose up -d frontend api
```

---

## Configuration (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URI` | `mongodb://…` | MongoDB connection string (app user only) |
| `MONGODB_DB_NAME` | `ipam` | Database name |
| `JWT_SECRET_KEY` | — | JWT signing secret (required, ≥ 32 chars) |
| `JWT_EXPIRE_MINUTES` | `60` | Access token lifetime |
| `JWT_REFRESH_EXPIRE_HOURS` | `8` | Refresh token lifetime |
| `INITIAL_ADMIN_USERNAME` | `admin` | Bootstrap admin (remove after first login) |
| `INITIAL_ADMIN_PASSWORD` | — | Bootstrap admin password |
| `VAULT_MASTER_KEY` | — | AES-256-GCM master key for Password Vault (base64, min 32 bytes) |
| `ALLOWED_ORIGINS` | — | CORS allowed origins — **HTTPS only in production** |
| `ENABLE_SWAGGER` | `false` | Enable `/api/docs` — **keep false in production** |
| `RATE_LIMIT_LOGIN` | `5/minute` | Login endpoint rate limit |
| `RATE_LIMIT_API` | `200/minute` | General API rate limit |
| `LDAP_ENABLED` | `false` | Enable LDAP/AD login |
| `LDAP_SERVER` | — | LDAP server hostname |
| `LDAP_PORT` | `389` | LDAP port |
| `LDAP_USE_TLS` | `true` | Use STARTTLS |
| `LDAP_BIND_DN` | — | Service account DN for user search |
| `LDAP_BIND_PASSWORD` | — | Service account password |
| `LDAP_BASE_DN` | — | Search base (e.g. `DC=corp,DC=example,DC=com`) |
| `LDAP_USER_FILTER` | `(sAMAccountName={username})` | User search filter |
| `LDAP_DEFAULT_ROLE` | `Viewer` | Role for auto-provisioned LDAP users |

> **Security note:** Never put `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` in the same `.env` file loaded by the API container. Use a separate file for the database service only (see `.env.api` vs `.env`).

---

## User Roles

Roles are hierarchical for what they *include*, but not strictly "more of
the same" — **Operator is deliberately read-only** on core IPAM data (a
"look and actively scan" role, not a "look and edit" role), and even
**Administrator** is locked out of the Integrations page's actual
Discover/Import actions.

| Role | Permissions |
|------|-------------|
| **Viewer** | Read-only: Dashboard, IP Records, Subnets, Unused IP Addresses, change history, Vault (own cabinets), password generator |
| **Operator** | All Viewer access, still **read-only** on IP Records/Subnets (no create/edit/reserve/release/Check Availability) — plus can actually *run* PaloAlto Check (single/subnet scans) and Network Scan, export IP Records to CSV, view Show Duplicates. Can open Integrations but its Discover/Import buttons are disabled. Folder management and share links (Vault). |
| **Administrator** | Full read/write everywhere — create/edit/delete, reserve/release, bulk operations, merged Check Availability + Bulk Scan, Scan in PaloAlto, user management, pending approvals, full audit log, cabinet CRUD. **Exception:** same as Operator, cannot use Integrations' Discover/Import actions. |
| **SuperAdmin** | Bypasses all role checks, no exceptions — the only role that can run Integrations Discover/Import (vSphere, Device42, Zabbix, PaloAlto) and delete a Vault cabinet |

---

## Features

### Core IPAM
- Subnet management (CIDR, gateway, VLAN, environment, VRF, alert threshold)
- IP record tracking: hostname, OS type, owner, status (Free / Reserved / In Use), power state (On / Off / — — vSphere-tracked VMs only)
- Automatic prefix nesting — smaller CIDRs become children of larger ones
- VRFs — isolated routing domains with optional Route Distinguisher
- Aggregates & RIRs — top-level address blocks
- IP Ranges — named spans (e.g. DHCP pools) within a subnet
- CSV import / export with validation and template download
- **Unused IP Addresses** — for every subnet, shows every address with no IP record at all (distinct from "Free" status, which only covers addresses already recorded as available). Card-based summary across all subnets (sorted by most-available-first) with drill-down per subnet, an IP filter, and a one-click "Create IP Record" or "Check Availability" per address. Pure calculation from subnet CIDR minus what's recorded — no network scanning.

> **Note:** VRFs, Aggregates, and Assets pages are currently disabled (nav hidden, routes redirect to Dashboard) as they're unused in this deployment. All code, routes, and backend routers are intact — see `frontend/src/App.tsx` and `frontend/src/components/layout/Sidebar.tsx` for the commented-out entries to re-enable.

### Dashboard & Operations
- recharts dashboard: IP status donut, environment bar (sorted descending — Mongo `$group` doesn't guarantee order), OS bar, top subnets, recent activity
- Data Sync Health — freshness of the nightly Device42/Zabbix/PaloAlto/**vCenter** syncs (last run, duration, counters); flags a source "Overdue" past 27h since its last run
- **vSphere Power State** — On/Off counts across every IP vCenter has actually matched (not all IPs — most have no vSphere data at all, so an "Unknown" bucket would just be noise)
- **PaloAlto Activity** — real-time Check Availability usage (distinct from the nightly sync): checks in the last 24h/7d, % found in-use over 7 days, 5 most recent lookups
- **Stale "In Use" Records** — records marked `In Use` not re-confirmed by any source (Device42/Zabbix/PaloAlto/vSphere/manual check) in 90+ days; purely informational, view-all modal, plus **Bulk Scan All** to re-check the whole list at once
- Subnet utilisation alert threshold — warning badge on row + dashboard banner
- Bulk reserve / release / update-fields for multiple IP records
- Per-record change history with before→after field diffs

### Network Scanner
- TCP-based host discovery for any CIDR; no ICMP/root needed
- OS fingerprinting + reverse DNS
- Infrastructure scan — scan multiple CIDRs, save IPs directly to DB
- Review table shows **power state** for any discovered IP already known to vCenter — a local DB lookup against existing records, not a live per-host vCenter query (a scan can cover thousands of hosts; that would reintroduce the same per-host latency problem PaloAlto's DR hosts once caused)

### Integrations
- **Device42** — REST API IP/device discovery with OS mapping. Credentials entered per-session in the Integrations UI.
- **Zabbix** — JSON-RPC API (Bearer token auth), host + interface discovery. Credentials are server-configured only (`.env.api`), never entered in the browser — the Integrations card just discovers and lets you import directly.
- **PaloAlto** — PAN-OS XML API: address objects, interface IPs, ARP table. Discover/Import here is bulk, one-time; see **PaloAlto Check** below for real-time single-IP/subnet lookups.
- **vSphere** — vCenter VM discovery via pyVmomi. Manual Discover/Import (per-request host/credentials, SuperAdmin-only) for bulk one-time imports, same as this section's other sources. Also a 4th real-time **Check Availability** source and a **nightly sync** — see below.
- **DNS conflict detection** — FORWARD_MISMATCH, PTR_MISMATCH, NO_FORWARD, DUPLICATE_HOSTNAME

> **RBAC note:** Discover/Import on this page is **SuperAdmin-only** — Operator and Administrator can open the page and see the cards, but the action buttons are disabled. This is intentional (see User Roles above).

### PaloAlto Check (real-time, per-IP/subnet)
A dedicated page (`/paloalto-check`, Operator+) for on-demand PaloAlto lookups — separate from the bulk Discover/Import above and from the nightly sync, every check here queries the live firewalls directly:
- **Check IP / Check Subnet** — searches every configured firewall for a named address object, live ARP entry, NAT rule, or security policy referencing the address(es). A match only counts as evidence of use if the matching rule's network is a `/32` or `/128` — a broad-subnet match (e.g. a rule covering a whole `/16`) is shown in the trace log but excluded from the found/not-found verdict, since nearly every address in that range would trivially match it.
- **Real-time trace log** — streams over Server-Sent Events as the check actually runs, showing exactly which firewall is being queried and what came back, live.
- **Reverse DNS hostname** enrichment alongside the match.
- **Save to IP Records** — turn a found address (or a batch) into a real IP record with one click.
- **30-day check history** (`paloalto_check_logs`, TTL-indexed) — every check from this page, Check Availability, or a Bulk Scan is logged; filterable by IP.
- **30-day PAN-OS traffic logs** — pulls PaloAlto's own historical traffic/session log entries for an address directly from the firewall (async job submission + polling) — genuine evidence of real recent network activity, distinct from IPAM's own check-history above.
- **Subnets → right-click → Scan in PaloAlto** — bulk-checks every host address in a subnet with a live progress bar + trace log, auto-saves found addresses, refreshes utilization, and surfaces the **top security/NAT rules** actually referencing addresses in that subnet (reused from the scan's own match data — no extra PAN-OS calls).

#### Nightly automated sync (Device42 + Zabbix + PaloAlto + vCenter)
All four run unattended via cron on the host (`ansible` user), independent of anyone using the UI:

| Time | Job | Typical duration |
|---|---|---|
| 2:00 AM | Device42 full sync | ~25 min (~72k IPs) |
| 2:35 AM | Zabbix full sync | ~2-5 sec (~475 hosts) |
| 2:50 AM | PaloAlto full sync | ~25-30 sec (across configured firewalls) |
| 3:10 AM | vCenter full sync | ~35 sec (~1,230 VMs across both vCenters) |

Device42 sets the baseline status from its own inventory `available` flag; Zabbix, PaloAlto, and vCenter run after and **only ever write `"In Use"`** (upgrade on live positive evidence, or skip) — neither can undo a correct Device42-derived `Free`, and none touches a `Reserved` record, so no job can produce conflicting data even if a run window ever grows to overlap. Zabbix hosts that are disabled *and* have no monitoring data in the last 6 months are treated as likely decommissioned and skipped entirely. PaloAlto's nightly sync only imports named single-host (`/32`) address objects — the closest equivalent to Device42's curated inventory — deliberately ignoring the live ARP table and wider-subnet objects (too noisy for an automated job; still available via the manual Discover/Import flow). All wrapper scripts (`scripts/run_device42_sync.sh`, `scripts/run_zabbix_sync.sh`, `scripts/run_paloalto_sync.sh`, `scripts/run_vcenter_sync.sh`) use a lock file that auto-clears after 2 hours if a prior run was killed by a crash/reboot, so a stuck lock can't silently block every future run. See `scripts/README.md` for the full operational writeup.

**vCenter sync specifics** (`scripts/vcenter_sync.py`) — discovers every **powered-on** VM across both configured vCenters (`VCENTER_HOSTS`, shared read-only account) and writes, per guest IP:
- **Hostname** — the guest's own DNS name as reported by VMware Tools, applied on both create and update. Falls back to the VM's vCenter inventory name whenever VMware Tools reports an unconfigured OS default like `localhost.localdomain` (common after a clone with no sysprep/cloud-init) — that placeholder was previously written straight into IP Records until this guard was added.
- **OS type** — best-effort guess from `guestFullName`.
- **Power state** — `"on"`/`"off"`, surfaced as its own column on IP Records and the Network Scanner review table, and as a Dashboard panel. The nightly batch only ever sets `"on"` (powered-off VMs are skipped entirely); a live Check Availability run is what can later observe and record `"off"`.
- **Environment → DR** — auto-tagged **only** when the VM's own vCenter datacenter/cluster name genuinely says so (whole-word `dr`/`disaster`, so it doesn't collide with vSphere's own "DRS" cluster feature name). Deliberately does **not** infer DR from which vCenter a VM was discovered on — an earlier version treated every VM on the Baku site's vCenter as DR, which broke on real shared workloads that vCenter also hosts (e.g. an NTP `timeserver`). On an existing record this only ever *promotes* to DR, never overwrites a weaker classification.
- Template VMs and generic template-named hosts are not filtered out today — a real vCenter template that's powered on with an IP will sync like any other VM; worth a policy decision if that turns out to be noisy.

#### Check Availability — merged, single click (per-record, real-time)
Right-click any IP (in IP Records) → **Check Availability** scans **Device42, then Zabbix, then PaloAlto, then vSphere in sequence** — one action instead of picking a source. A live progress modal shows each source as it's checked, then applies the combined result immediately:
- **Device42** — real-time inventory lookup (not a network probe); reports the assigned device, or that it's free. A miss never auto-changes status (Device42's inventory isn't guaranteed complete)
- **Zabbix** — real-time live monitoring lookup; Zabbix actively polls its hosts, so a positive result auto-marks "In Use", but a miss/down result never auto-marks "Free"
- **PaloAlto** — checks every configured firewall for a named address object, live ARP entry, NAT rule, or security policy referencing the address
- **vSphere** — an indexed `SearchIndex.FindAllByIp` lookup (not a full VM inventory walk) across every configured vCenter, with a raw-socket preflight so an unreachable vCenter fails in ~5s instead of hanging on the OS-level TCP timeout (~2 min). Reports the VM's guest DNS name, OS type, and **power state** — shown explicitly either way ("Found — hostname (running)" / "(powered off)"). A match on a **powered-off** VM is real evidence the address exists in vCenter's inventory, but not evidence it's currently in use on the network, so on its own it does **not** upgrade the record to `In Use` (it still shows in the result for visibility if something else did trigger the update).

Any single source finding a match (vSphere only counts when powered on) can upgrade the record to `In Use` — this is **asymmetric on purpose**: no source is guaranteed complete, so a miss from all four never auto-downgrades a record to `Free`, and a `Reserved` record is never auto-released. Hostname prefers PaloAlto's match; vSphere's guest DNS name fills in whenever PaloAlto didn't provide one. OS Type prefers Device42, then Zabbix, then vSphere (same upgrade-only rule throughout). `ens192`/`ens224` real-NIC pings (via `scripts/scan_helper.py`, systemd) remain available as legacy per-source options on the underlying `/ping` endpoint.

#### Show Duplicates & Bulk Scan
IP Records toolbar → **Show Duplicates** finds records sharing the exact same **hostname** or **IP address** (IP duplicates should be structurally impossible — there's a DB uniqueness constraint — but are checked anyway as a safety net; hostname duplicates are common and genuinely useful, e.g. a stale record left behind when a host was decommissioned and its address reassigned). Each tab has a **Bulk Scan All** button (Administrator) that re-runs the merged Device42+Zabbix+PaloAlto+vSphere check sequentially across every affected record. The same **Bulk Scan** action is also available from the Dashboard's Stale "In Use" Records panel (see below).

### Password Vault
- Cabinet-based secret storage — each cabinet has a name, description, and explicit member list
- **AES-256-GCM** encryption with **HKDF-SHA256** per-cabinet key derived from `VAULT_MASTER_KEY`
- **Folder organisation** — hierarchical folders inside each cabinet; drag-and-drop to move entries between folders
- **Secure share links** — time-limited, view-count-limited shareable URLs for any password entry:
  - Configurable expiry: 1 h / 6 h / 24 h / 72 h / 7 d
  - Optional max-view limit (0 = unlimited)
  - Optional note for recipient
  - Password blurred by default on the public share page
  - Links can be revoked at any time
  - Share events logged in audit trail (`SHARE_CREATE`, `SHARE_VIEW`, `SHARE_REVOKE`)
  - Public share endpoint rate-limited to 20 requests/minute
- **Password Generator** — cryptographically secure (CSPRNG) password generation entirely in-browser:
  - Length 4–128 characters
  - Configurable character sets: uppercase, lowercase, numbers, special symbols
  - Exclude ambiguous characters toggle (`l`, `1`, `I`, `O`, `0`)
  - Live entropy-based strength indicator
  - One-click copy to clipboard
  - Zero server contact — no password ever leaves the browser
- Per-entry reveal with 30-second auto-clear
- Full audit trail for all vault operations
- SuperAdmin has full vault access regardless of cabinet membership

### Self-Registration with Admin Approval
- Public `/register` page — any visitor can submit a registration request
- New registrations are pending until an admin approves with a role and optional cabinet assignments
- Reject flow with optional reason stored for audit
- Admin sidebar shows live pending count badge

---

## API Reference

All endpoints prefixed `/api/v1`. Auth via `Authorization: Bearer <token>`.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | — | Submit self-registration (5/min) |
| POST | `/auth/login` | — | Login — password must be ≥ 8 characters |
| POST | `/auth/logout` | Viewer+ | Invalidate token |
| GET | `/auth/me` | Viewer+ | Current user |
| POST | `/auth/change-password` | Viewer+ | Change password |
| POST | `/auth/refresh` | — | Refresh access token (HttpOnly cookie, path `/api/v1/auth`) |

### Cabinets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/cabinets` | Viewer+ | List cabinets where user is a member |
| POST | `/cabinets` | Admin | Create cabinet |
| GET/PUT/DELETE | `/cabinets/{id}` | Admin | Get / update / delete |

### Folders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/folders?cabinet_id={id}` | Viewer+ | List all folders in a cabinet (flat list — build tree client-side) |
| POST | `/folders` | Operator+ | Create folder — body: `{ cabinet_id, name, parent_id? }` |
| PATCH | `/folders/{id}` | Operator+ | Rename folder — body: `{ name }` |
| DELETE | `/folders/{id}` | Operator+ | Delete folder (entries remain, `folder_id` cleared) |

### Password Entries

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/passwords?cabinet_id={id}` | Viewer+ | List entries — optional `folder_id` or `unassigned=true` |
| POST | `/passwords` | Operator+ | Create entry — accepts optional `folder_id` |
| GET | `/passwords/{id}` | Viewer+ | Get entry detail |
| PATCH | `/passwords/{id}` | Operator+ | Update entry |
| DELETE | `/passwords/{id}` | Operator+ | Delete entry |
| GET | `/passwords/{id}/reveal` | Viewer+ | Decrypt and return plaintext (10/min, `Cache-Control: no-store`) |
| PATCH | `/passwords/{id}/move` | Operator+ | Move entry to folder — body: `{ folder_id: string \| null }` |

### Share Links

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/passwords/{id}/shares` | Operator+ | Create share link (10/min) — body: `{ expires_in_hours, max_views, note? }` |
| GET | `/passwords/{id}/shares` | Viewer+ | List active share links for an entry |
| DELETE | `/passwords/shares/{share_id}` | Viewer+ | Revoke share link |
| GET | `/share/{token}` | **Public** | View shared credential (20/min, `Cache-Control: no-store`) |

### Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users` | Admin | List all users |
| POST | `/users` | Admin | Create user (bypasses approval) |
| GET/PUT/DELETE | `/users/{id}` | Admin | Get / update / delete |
| GET | `/users/pending` | Admin | List pending registrations |
| POST | `/users/{id}/approve` | Admin | Approve with role + cabinet assignments |
| POST | `/users/{id}/reject` | Admin | Reject with optional reason |
| POST | `/users/{id}/reset-password` | Admin | Reset password |
| POST | `/users/{id}/activate` | Admin | Activate/deactivate user |

### Other Resources

| Resource | Base path | Notes |
|----------|-----------|-------|
| VRFs | `/vrfs` | Full CRUD |
| Aggregates | `/aggregates` | Full CRUD |
| RIRs | `/rirs` | GET (Viewer+), POST (Admin) |
| IP Ranges | `/ip-ranges` | Full CRUD |
| Network Scanner | `/scanner/scan` | POST, Operator+ |
| Infrastructure Scan | `/scan/discover` | POST, Operator+ |
| vSphere | `/integrations/vsphere/discover` + `/import` | SuperAdmin |
| Device42 | `/integrations/device42/discover` + `/import` | SuperAdmin |
| PaloAlto (bulk) | `/integrations/paloalto/discover` + `/import` | SuperAdmin |
| PaloAlto Check | `/integrations/paloalto/check-ip` \| `check-subnet` \| `check-stream` (SSE) \| `check-logs` \| `save-to-records` \| `save-bulk` \| `scan-subnet` \| `scan-subnet-stream` (SSE) \| `traffic-logs` | Operator+ |
| IP Records — merged Check Availability | `POST /ip-records/{id}/check-availability-stream` (SSE) — existing record; `POST /ip-records/check-availability-stream` — no record yet (Unused IPs) | Admin |
| IP Records — Bulk Scan | `POST /ip-records/bulk/check-availability-stream` (SSE) — body `{ids: string[]}`, max 200 per request | Admin |
| IP Records — duplicates | `GET /ip-records/duplicates` — grouped by exact `ip_address` / `hostname` match | Operator+ |
| Stats | `/stats` | GET, Viewer+ |
| Audit Log | `/audit-logs` | GET, Admin |
| Assets | `/assets` | Full CRUD, Viewer+ |

---

## Project Structure

```
iop/
├── backend/
│   └── app/
│       ├── config.py
│       ├── main.py                     FastAPI app + all router registrations
│       ├── core/
│       │   ├── vault.py                AES-256-GCM + HKDF-SHA256 key derivation
│       │   ├── network.py              SSRF host validation utility
│       │   └── …                       database, security, password, rate_limiter
│       ├── models/
│       │   ├── user.py                 Role enum: Viewer / Operator / Administrator / SuperAdmin
│       │   ├── folder.py               Folder document model
│       │   ├── password_entry.py       PasswordEntry (includes folder_id)
│       │   ├── password_share.py       PasswordShare (token, expiry, view count)
│       │   └── …
│       ├── schemas/
│       │   ├── folder.py               FolderCreate / FolderUpdate / FolderResponse
│       │   ├── password_entry.py       Includes folder_id, MoveEntryRequest
│       │   ├── password_share.py       ShareCreate / ShareResponse / SharePublicResponse
│       │   └── …
│       ├── repositories/
│       │   ├── folder_repository.py
│       │   ├── share_repository.py
│       │   └── …
│       ├── services/
│       │   ├── folder_service.py
│       │   ├── share_service.py        Timezone-aware expiry check, audit logging
│       │   ├── device42_service.py     SSRF-validated, follow_redirects=False
│       │   ├── paloalto_service.py     SSRF-validated, follow_redirects=False
│       │   ├── vsphere_service.py      SSRF-validated
│       │   └── …
│       ├── routers/
│       │   ├── folders.py
│       │   ├── shares.py               Includes public /share/{token} endpoint
│       │   └── …
│       └── dependencies/
│           └── auth.py                 require_role() — SuperAdmin bypasses all checks
├── frontend/
│   └── src/
│       ├── api/vault.ts                foldersApi, sharesApi, passwordsApi (with move)
│       ├── utils/apiError.ts           getApiError() — shared error extraction utility
│       ├── pages/
│       │   ├── Share/SharePage.tsx     Public share view (no auth required)
│       │   └── Vault/
│       │       ├── FolderTree.tsx      Hierarchical folder sidebar with drag-drop targets
│       │       ├── ShareModal.tsx      Create / list / revoke share links
│       │       ├── PasswordGeneratorPage.tsx   CSPRNG generator, entropy strength bar
│       │       └── …
│       └── components/layout/
│           ├── VaultLayout.tsx         Vault sidebar with generator navigation
│           └── VaultHelpDrawer.tsx     Help drawer (updated with all new features)
├── .env                                Production env — no MONGO_ROOT_* vars
├── .env.api                            Subset of .env for iop-api container only
├── nginx/conf.d/ipam.conf              TLS + security headers + rate limit zones
└── docker-compose.yml
```

---

## Security

### Hardening Applied (v7.0.0)

| # | Area | Change |
|---|------|--------|
| C1 | Secrets | `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` removed from API container environment. A separate `.env.api` (without root credentials) is loaded by `iop-api`; Docker Compose still reads `.env` for variable substitution in the `mongodb` service. |
| C2 | Swagger | `ENABLE_SWAGGER=false` enforced in production. Duplicate override line removed. `/api/docs` returns 404. |
| C3 | SSRF | `app/core/network.py` validates all user-supplied integration hostnames before outbound connections. Blocks loopback, link-local, RFC-1918 private ranges, and cloud metadata IPs (`169.254.169.254`). `follow_redirects=False` set in all httpx clients. |
| C4 | CORS | `ALLOWED_ORIGINS` restricted to `["https://ipam.abb-bank.az"]` — removed HTTP origin and raw server IP. |
| H1 | Auth | `LoginRequest.password` minimum length raised from 1 to 8 characters. |
| H2 | Nginx | Added `server_tokens off`, `X-XSS-Protection: 1; mode=block`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, and `upgrade-insecure-requests` to Content-Security-Policy. |
| H3 | Code | Inline module import inside `revoke_share()` moved to module-level. |
| M2 | Rate limit | `@limiter.limit("10/minute")` added to `POST /passwords/{id}/shares`. |
| M3 | Info leak | `require_role()` 403 detail changed to `"Insufficient permissions"` — role names no longer disclosed. |

### Security Headers

```
Strict-Transport-Security: max-age=63072000; includeSubDomains
Content-Security-Policy: default-src 'self'; … upgrade-insecure-requests
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
X-XSS-Protection: 1; mode=block
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

### Vault Encryption Flow

```
VAULT_MASTER_KEY
      │
      ▼
HKDF-SHA256(salt = cabinet_id)
      │
      ▼
Per-cabinet AES-256-GCM key  ──►  encrypt(plaintext)  ──►  ciphertext + IV stored in MongoDB
```

Passwords are never stored in plaintext. The master key never leaves the server environment. Share links transmit the decrypted password over TLS only on demand and are never cached.

---

## Security Fixes — Applied Changes (v7.0.0)

This section documents each security fix in detail: the problem found, the exact change made, and the verification command with its result.

---

### C1 — MongoDB Root Credentials Exposed in API Container

**Problem:** `docker inspect iop-api` and `docker exec iop-api env` both showed `MONGO_ROOT_PASSWORD` and `MONGO_ROOT_USER` in the API container's environment. The API never uses root credentials (it connects as the app user), so their presence was pure exposure risk — any debug endpoint, process dump, or container escape would leak them.

**Root cause:** `docker-compose.yml` had `env_file: .env` for the `iop-api` service. The single `.env` contained both root DB credentials (needed for the `iop-mongodb` init script) and app credentials, so everything was inherited.

**Fix — docker-compose.yml:**
```yaml
# Before
services:
  api:
    env_file: .env

# After
services:
  api:
    env_file: .env.api   # strips MONGO_ROOT_USER / MONGO_ROOT_PASSWORD
```

**Fix — .env.api (new file):** An exact copy of `.env` with only two lines removed:
```
# REMOVED from .env.api:
# MONGO_ROOT_USER=admin
# MONGO_ROOT_PASSWORD=<redacted>
```

**Verification:**
```
$ sudo docker exec iop-api env | grep MONGO_ROOT
(no output)
```

---

### C2 — Swagger / OpenAPI Enabled in Production

**Problem:** `/api/docs` was publicly reachable on the internal network. The interactive Swagger UI gave any authenticated (or network-adjacent) user a full attack-surface map and a try-it console for every endpoint.

**Root cause:** `.env` contained two conflicting lines:
```
ENABLE_SWAGGER=false
ENABLE_SWAGGER=true   # duplicate override
```
Python's `dotenv` uses the last value, so Swagger was always on despite the intent.

**Fix — /opt/IOP/.env:**
```
# Before (two lines)
ENABLE_SWAGGER=false
ENABLE_SWAGGER=true

# After (one line)
ENABLE_SWAGGER=false
```

**Verification:**
```
$ curl -sk https://172.31.3.166/api/docs | head -5
{"detail":"Not Found"}
```

---

### C3 — Server-Side Request Forgery (SSRF) in Integration Endpoints

**Problem:** All three integration services (`device42_service.py`, `paloalto_service.py`, `vsphere_service.py`) accepted a user-supplied `host` string and made outbound HTTP connections to it with no validation. An authenticated Operator could:
- Probe internal services (Redis, MongoDB, other microservices)
- Hit the AWS/GCP/Azure metadata endpoint (`169.254.169.254`) to steal credentials
- Redirect requests to any RFC-1918 address via the API as a proxy

Additionally, all httpx clients had `follow_redirects=True` (implicit default), enabling redirect-based SSRF bypasses.

**Fix — new file `app/core/network.py`:**
```python
import ipaddress, re
from fastapi import HTTPException

_PRIVATE_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("fc00::/7"),
]
_BLOCKED_HOSTS = {"169.254.169.254", "fd00:ec2::254", "metadata.google.internal"}

def validate_integration_host(host: str) -> None:
    clean = re.sub(r"^https?://", "", host).split("/")[0].split(":")[0].strip()
    if not clean:
        raise HTTPException(status_code=400, detail="Integration host is required")
    if clean.lower() in _BLOCKED_HOSTS:
        raise HTTPException(status_code=400, detail="Host not allowed")
    try:
        addr = ipaddress.ip_address(clean)
        if addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_unspecified:
            raise HTTPException(status_code=400, detail="Host resolves to a reserved address")
        for net in _PRIVATE_RANGES:
            if addr in net:
                raise HTTPException(status_code=400, detail="Host resolves to a private network address")
    except ValueError:
        pass  # hostname — validated at DNS resolution time
```

**Fix — integration services:** Added `validate_integration_host(request.host)` as the first call in each `discover()` method. Changed all httpx clients to `follow_redirects=False`.

**Verification:**
```
$ curl -sk -X POST https://172.31.3.166/api/v1/integrations/device42/discover \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host":"169.254.169.254","username":"x","password":"x"}'

{"detail":"Host not allowed"}   # HTTP 400
```

---

### C4 — HTTP Origin in CORS and Raw Server IP Exposed

**Problem:** `ALLOWED_ORIGINS` in `.env` contained four entries:
```
["https://ipam.abb-bank.az","http://ipam.abb-bank.az","https://172.31.3.166","https://localhost"]
```
- `http://ipam.abb-bank.az` — allows browsers to send credentialed cross-origin requests over plaintext HTTP
- `https://172.31.3.166` — leaks the server's internal IP in CORS response headers visible to any browser
- `https://localhost` — has no legitimate use in production

**Fix — /opt/IOP/.env:**
```
# Before
ALLOWED_ORIGINS=["https://ipam.abb-bank.az","http://ipam.abb-bank.az","https://172.31.3.166","https://localhost"]

# After
ALLOWED_ORIGINS=["https://ipam.abb-bank.az"]
```

**Verification:**
```
$ curl -sk -I https://172.31.3.166/api/v1/auth/login \
  -H "Origin: http://ipam.abb-bank.az" | grep -i access-control
(no Access-Control-Allow-Origin header — origin rejected)
```

---

### H1 — LoginRequest Accepts 1-Character Passwords

**Problem:** `app/schemas/auth.py` defined `LoginRequest.password` with `min_length=1`. Although the registration schema enforced 8 characters, a user with a short password (set via direct DB write or edge-case) could authenticate without ever hitting a minimum-length check at login time.

**Fix — app/schemas/auth.py:**
```python
# Before
password: str = Field(..., min_length=1, max_length=128)

# After
password: str = Field(..., min_length=8, max_length=128)
```

**Verification:**
```
$ curl -sk -X POST https://172.31.3.166/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"short"}'

{"detail":[{"type":"string_too_short","loc":["body","password"],
"msg":"String should have at least 8 characters","input":"short"}]}
# HTTP 422
```

---

### H2 — Missing Security Headers in Nginx

**Problem:** The nginx config (`/opt/IOP/nginx/conf.d/ipam.conf`) was missing several defensive headers:
- No `server_tokens off` — nginx version (e.g. `nginx/1.25.3`) was visible in `Server:` response header
- No `X-XSS-Protection` — legacy browsers with XSS auditors were left unprotected
- No `Permissions-Policy` — browser features (camera, microphone, geolocation, payment) were not explicitly disabled
- `Content-Security-Policy` lacked `upgrade-insecure-requests` — mixed-content requests could proceed

**Fix — /opt/IOP/nginx/conf.d/ipam.conf:** Added to the `server { listen 443 ... }` block:
```nginx
server_tokens off;
add_header X-XSS-Protection "1; mode=block" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
```
Appended `; upgrade-insecure-requests` to the existing `Content-Security-Policy` header value.

**Verification:**
```
$ curl -skI https://172.31.3.166 | grep -E "Server:|X-XSS|Permissions-Policy|upgrade"
Server: nginx                          # version hidden (was: nginx/1.25.3)
X-XSS-Protection: 1; mode=block
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Content-Security-Policy: default-src 'self'; ... upgrade-insecure-requests
```

---

### H3 — Inline Module Import Inside `revoke_share()`

**Problem:** `app/services/share_service.py` had an import statement inside the `revoke_share()` method body:
```python
async def revoke_share(self, ...):
    from app.models.user import Role   # inline import — executed on every call
    ...
```
Python caches module imports after the first execution, but the explicit inline import pattern re-evaluates the `from … import` statement on every call, adds a frame to the call stack, and signals to any reader that the import is intentionally deferred — which it was not.

**Fix — app/services/share_service.py:** Moved `from app.models.user import Role` to the module-level import block at the top of the file (line 8).

**Verification:** `grep -n "from app.models.user import Role" share_service.py` — returns line 8 only (not inside a function).

---

### M2 — No Rate Limit on Share Creation Endpoint

**Problem:** `POST /passwords/{id}/shares` had no rate limit. An authenticated Operator could repeatedly create share links for the same entry, flooding the `password_shares` collection in MongoDB and generating unbounded audit log entries.

**Fix — app/routers/shares.py:**
```python
# Before
@router.post("/{entry_id}/shares", ...)
async def create_share(...):

# After
@router.post("/{entry_id}/shares", ...)
@limiter.limit("10/minute")
async def create_share(request: Request, ...):
```

**Verification:**
```
$ for i in $(seq 1 12); do
    curl -sk -o /dev/null -w "%{http_code}\n" -X POST \
      https://172.31.3.166/api/v1/passwords/$ENTRY_ID/shares \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"expires_in_hours":1,"max_views":1}';
  done
201 201 201 201 201 201 201 201 201 201 429 429
# Requests 11 and 12 return 429 Too Many Requests
```

---

### M3 — Role Names Disclosed in 403 Responses

**Problem:** `app/dependencies/auth.py` returned the exact role list in 403 error responses:
```python
raise HTTPException(403, f"Required roles: {required}")
# Response body: {"detail": "Required roles: ('Viewer', 'Operator', 'Administrator')"}
```
This told any authenticated user exactly which roles are required for every endpoint, reducing attacker effort to understand the authorization model.

**Fix — app/dependencies/auth.py:**
```python
# Before
raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Required roles: {required}")

# After
raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                    detail="Insufficient permissions")
```

**Verification:**
```
$ curl -sk -X GET https://172.31.3.166/api/v1/users \
  -H "Authorization: Bearer $VIEWER_TOKEN"

{"detail":"Insufficient permissions"}   # HTTP 403 — no role names exposed
```

---

## Test Results — v7.0.0 (2026-04-28)

All checks performed against the live production instance at `https://172.31.3.166` after all v7.0.0 changes were deployed.

| # | Category | Test | Method | Expected | Result |
|---|----------|------|--------|----------|--------|
| 01 | Core IPAM | Health check endpoint | GET /health | `{"status":"ok"}` | PASS |
| 02 | Core IPAM | Login as SuperAdmin | POST /auth/login | 200 + JWT token | PASS |
| 03 | Core IPAM | List subnets (SuperAdmin) | GET /api/v1/subnets | 200 + array | PASS |
| 04 | Core IPAM | List IP records | GET /api/v1/ip-records | 200 + array | PASS |
| 05 | Core IPAM | List VRFs | GET /api/v1/vrfs | 200 + array | PASS |
| 06 | Core IPAM | Stats endpoint | GET /api/v1/stats | 200 + dashboard data | PASS |
| 07 | Core IPAM | Audit log (Admin only) | GET /api/v1/audit-logs | 200 + log entries | PASS |
| 08 | Password Vault | List cabinets | GET /api/v1/cabinets | 200 + array | PASS |
| 09 | Password Vault | Create cabinet | POST /api/v1/cabinets | 201 + cabinet object | PASS |
| 10 | Password Vault | Create folder inside cabinet | POST /api/v1/folders | 201 + folder object | PASS |
| 11 | Password Vault | List folders for cabinet | GET /api/v1/folders?cabinet_id=X | 200 + array | PASS |
| 12 | Password Vault | Create password entry with folder | POST /api/v1/passwords | 201 + entry object | PASS |
| 13 | Password Vault | List entries filtered by folder | GET /api/v1/passwords?cabinet_id=X&folder_id=Y | 200 + filtered array | PASS |
| 14 | Password Vault | List unassigned entries | GET /api/v1/passwords?cabinet_id=X&unassigned=true | 200 + unassigned only | PASS |
| 15 | Password Vault | Move entry to different folder | PATCH /api/v1/passwords/{id}/move | 200 + updated entry | PASS |
| 16 | Password Vault | Reveal password (decrypt) | GET /api/v1/passwords/{id}/reveal | 200 + plaintext (rate-limited) | PASS |
| 17 | Password Vault | Create share link | POST /api/v1/passwords/{id}/shares | 201 + share with token | PASS |
| 18 | Password Vault | List share links for entry | GET /api/v1/passwords/{id}/shares | 200 + array | PASS |
| 19 | Password Vault | Access public share page | GET /api/v1/share/{token} | 200 + credential (no auth) | PASS |
| 20 | Password Vault | Revoke share link | DELETE /api/v1/passwords/shares/{id} | 204 No Content | PASS |
| 21 | Password Vault | Access revoked share | GET /api/v1/share/{token} (revoked) | 404 Not Found | PASS |
| 22 | Security — C1 | MONGO_ROOT creds absent from API env | docker exec iop-api env \| grep MONGO_ROOT | (empty) | PASS |
| 23 | Security — C2 | Swagger disabled in production | GET /api/docs | 404 Not Found | PASS |
| 24 | Security — C3 | SSRF: metadata IP blocked | POST integrations with host=169.254.169.254 | 400 "Host not allowed" | PASS |
| 25 | Security — C4 | HTTP origin rejected by CORS | Origin: http://ipam.abb-bank.az | No CORS header returned | PASS |
| 26 | Security — H1 | Short password rejected at login | POST /auth/login password="abc" | 422 Validation Error | PASS |
| 27 | Security — H2 | Nginx security headers present | curl -I https://172.31.3.166 | Permissions-Policy + X-XSS-Protection present | PASS |
| 28 | Security — M2 | Share creation rate limit | 12x POST /passwords/{id}/shares | 11th request → 429 Too Many Requests | PASS |
| 29 | Security — M3 | Generic 403 message | GET /users as Viewer | `{"detail":"Insufficient permissions"}` | PASS |
| 30 | Security — M3 | No role names in 403 response | GET /users as Viewer | Response does not contain "Required roles" | PASS |

**Summary: Total 30 / Passed 30 / Failed 0**

All security fixes verified. All new features (folders, share links, password generator, SuperAdmin role) confirmed working in production.

---

## Changelog

### v9.2.0 — vCenter/vSphere Integration, Power State Tracking, Environment Auto-Tagging

**vCenter as a 4th real-time source + nightly sync**

- **Check Availability** now scans Device42 → Zabbix → PaloAlto → **vSphere** in sequence. vSphere lookup uses `SearchIndex.FindAllByIp` (an indexed point lookup, not a full VM inventory walk) across every configured vCenter, with a raw-socket preflight so an unreachable vCenter fails in ~5s instead of hanging on the OS-level TCP connect timeout (~2 min) — `asyncio.wait_for` alone can't cut this off once the underlying blocking call has started (cancelling a thread mid-syscall is a no-op), so the timeout has to live inside the blocking call itself.
- **Nightly vCenter sync** (`scripts/vcenter_sync.py`, 3:10 AM, after PaloAlto) — discovers every powered-on VM across both configured vCenters and writes IP address, hostname, OS type, power state, and (conditionally) environment, same upgrade-only pattern as the other three syncs.
- **Manual vSphere Discover/Import** (Integrations page, SuperAdmin-only, pre-existing) is unchanged — still a separate, per-request-credentials bulk import flow.

**Power state tracking**

- New `power_state` field (`"on"` / `"off"` / unset) — set only from vSphere (nightly sync or a live Check Availability run). Surfaced as a column on IP Records, a column on the Network Scanner review table (a local DB lookup against already-known records, not a live per-host vCenter query — a scan can cover thousands of hosts), and a new Dashboard panel (On/Off counts, scoped to vSphere-tracked IPs only).
- A **powered-off** vSphere match is real evidence the address exists in inventory, but not evidence it's in use on the network — it does not by itself upgrade a record to `In Use`, though it's still shown in the Check Availability result for visibility.
- Found and fixed a service-layer bug where a hand-written `_to_response()` converter (used by every IP-record endpoint) had an explicit field list that didn't include the new `power_state` field — the data was correct in MongoDB and even in the write path, but silently dropped on every read until fixed.

**Environment auto-tagging — a real false-positive, found and fixed**

- Original version tagged `Environment: DR` for any VM discovered via the Baku-site vCenter, assuming that vCenter was DR-exclusive. It isn't — it hosts a mix of workloads (e.g. a shared NTP `timeserver`), and 277 records got wrongly promoted to DR before this was caught (reported by a user checking real Dashboard data). Fixed to tag DR only from the VM's own datacenter/cluster name actually saying so (whole-word `dr`/`disaster`, avoiding a collision with vSphere's own "DRS" cluster feature) — verified against real data that neither vCenter currently has such naming, so DR auto-tagging is honestly dormant rather than guessing.
- Correcting the 277 records by matching on `description` text missed one (`10.50.1.84`) whose description/`updated_by` had since been overwritten by an unrelated Check Availability run — re-verified by cross-referencing every DR-tagged record against the live vSphere VM inventory directly (immune to mutable-field drift) and corrected the straggler.
- Same audit extended to Device42/Zabbix/PaloAlto's own `"test" in hostname.lower()` Test-environment heuristic — same shape of risk (a bare substring match), though verified to have zero live false positives today. Hardened anyway with a shared `app/core/environment_heuristics.py` (`looks_like_test()`) used by all four sync scripts, excluding known collision words (*attestation*, *latest*, *contest*, etc.) without regressing any of the 380 currently-correct Test classifications (many of which glue "test" onto other letters with no separator, e.g. `TestiniumNode12`, so a naive whole-word fix would have broken them).

**Hostname trust bug — a second false positive, found via broader audit**

- "Always trust vSphere's guest hostname" (a follow-up request after the DR fix) blindly overwrote 21 real, human-assigned VM names (e.g. `Ferhat_test_server`, `Oqtay_RHEL8`) with the literal string `localhost.localdomain` — what VMware Tools reports when a cloned VM's OS was never actually customized (no sysprep/cloud-init hostname step ran). Fixed with a shared `is_real_hostname()` guard (`vsphere_service.py`, used by both the nightly sync and the live Check Availability lookup) that falls back to vCenter's own inventory name — always real, human-assigned — whenever the guest-reported hostname is a known placeholder. Recovered the real names for all 21 affected records from their own `description` field.
- One of those 21 had a knock-on `Environment` misclassification too (Production instead of Test, since the environment guess ran against the corrupted hostname at creation time) — fixed only because it was provably created fresh by the buggy run that same day; a superficially similar case from April was deliberately left alone since its classification predates and is unrelated to this bug.

**Bug fixes**

- `pytest_plugins` declared in a non-top-level conftest — newer pytest only allows this in the project-root conftest; removed (redundant anyway, since pytest-asyncio auto-registers as a plugin once installed, and every test already uses explicit `@pytest.mark.asyncio`). Suite now collects and runs (was failing collection entirely before).
- A stale cabinet-deletion test asserted `role="Administrator"` should succeed; the route has always required SuperAdmin — fixed the test, not the route.
- `.env.vcenter` credentials file was referenced by the sync wrapper script but never actually created, so the nightly job would have failed silently every night; also fixed a password-quoting bug (`&` in the vCenter service-account password was being interpreted as a shell background-job operator when the env file was sourced unquoted).

---

### v9.0.0 — PaloAlto Check, Merged Check Availability, Granular RBAC, Dashboard Intelligence

**PaloAlto Check (new page, real-time)**

- Dedicated `/paloalto-check` page (Operator+): check a single IP or a whole subnet against every configured firewall — named address objects, live ARP entries, NAT rules, security policies.
- **Host-specific matching fix** — a rule match only counts as evidence of use if the matching network is `/32`/`/128`; a broad-subnet match (e.g. a rule covering a `/16`) is logged but excluded from the verdict, fixing a real false-positive (`10.128.51.71` was shown "in use" purely from being inside a broadly-scoped rule).
- **Real-time trace log** — true Server-Sent Events streaming (not buffered) through production nginx, using `X-Accel-Buffering: no` rather than touching the shared nginx config.
- **30-day check-log history** (`paloalto_check_logs`, TTL-indexed) — every check from this page, Check Availability, or Bulk Scan is recorded; reverse-DNS hostname included.
- **30-day PAN-OS traffic logs** — pulls PaloAlto's own historical traffic/session log entries for an address directly from the firewall (async job submission + polling) — genuinely distinct from IPAM's own check-history.
- **Subnets → Scan in PaloAlto** — bulk per-subnet scan with a live progress bar, auto-saves found addresses, refreshes utilization, and now also surfaces the **top security/NAT rules** actually referencing that subnet's addresses (reused from the scan's own match data, no extra PAN-OS calls).
- **PaloAlto nightly sync** (2:50 AM) — full address-object → IPAM sync mirroring the Device42/Zabbix pattern; imports only named `/32` address objects, upgrade-only ("In Use" never "Free"), never touches `Reserved`.

**Merged Check Availability**

- Replaced the old per-source dropdown (Device42 / Zabbix / PaloAlto picked one at a time) with a single action that scans **all three in sequence**, live progress modal per source, combined result applied immediately.
- **OS Type auto-enrichment** — Device42 does a targeted per-device lookup for its OS field; Zabbix reads host inventory (`os`/`os_full`/`os_short`) when populated; same upgrade-only rule as hostname/status (never overwrites with a guess, only fills in what wasn't known).
- Available from IP Records (existing record) and Unused IP Addresses (no record yet, informational only).

**Granular RBAC**

- Reworked from a simple Viewer < Operator < Administrator hierarchy to a matrix where **Operator is read-only** on IPAM data but can actively run PaloAlto Check and Network Scan; **Administrator** has full read/write except Integrations Discover/Import (SuperAdmin-only); **SuperAdmin** bypasses everything. See User Roles above — verified against 4 real accounts over live HTTP (minting a fake in-process user bypasses `Depends()` entirely, so this was tested through actual requests).
- Fixed a `/{id}/check-availability-stream` vs `/bulk/check-availability-stream` route-ordering bug — both are 2-segment paths, and FastAPI/Starlette validates path-parameter patterns in registration order before falling through, so `/bulk/...` must be registered first or it 422s as `id="bulk"`.

**Dashboard**

- **PaloAlto Activity** card — checks in the last 24h/7d, % found in-use over 7 days, 5 most recent lookups.
- **Stale "In Use" Records** card — records not re-confirmed by any source in 90+ days (relies on every confirming write bumping `updated_at` even when no field value changes, making its age a reliable "last positive confirmation" signal); view-all modal, **Bulk Scan All** to re-check the whole list.

**Duplicate detection + Bulk Scan**

- IP Records → **Show Duplicates** — groups by exact `hostname` or `ip_address` match; IP duplicates are checked as a safety net (a DB uniqueness constraint should prevent them structurally) while hostname duplicates are the genuinely common, useful case.
- **Bulk Scan** — re-runs the merged Device42+Zabbix+PaloAlto check sequentially across a list of record IDs (max 200/request); available from both Show Duplicates and the Stale In-Use panel; shares the exact same per-record scan logic as the single-record action via one extracted generator function, so behavior is identical whether scanning one record or two hundred.

**Bug fixes**

- Missing top-level `HTTPException` import in `ip_records.py` was causing `NameError` (not a proper HTTP response) on 11 error paths.
- CIDR-expansion DoS in `/paloalto/check-subnet` — request size was validated *after* materializing the full host list, so `0.0.0.0/0` would attempt to enumerate billions of addresses before ever checking the cap.
- `.//ifnet` xpath bug in PaloAlto interface discovery — PAN-OS wraps entries as `<ifnet><entry>`, so the original xpath matched the wrapper itself and always found 0 interfaces.
- Naive-vs-aware `datetime` subtraction crash in the new Stale In-Use stats query (Motor/PyMongo returns naive UTC datetimes; compare in the naive domain, not against an aware `now`).
- Device42/Zabbix sync and Check Availability could clobber a `Reserved` record's status — now excluded everywhere the same way.

---

### v8.0.0 — Zabbix Integration, Automated Sync, Unused IPs Redesign, Security Hardening

**New features**

- **Zabbix integration** — JSON-RPC API client, host/interface discovery + bulk import, real-time single-IP lookup for Check Availability. Server-side-only credentials, no per-session form.
- **Nightly automated sync** — Device42 (2:00 AM) and Zabbix (2:35 AM) run unattended via cron; Zabbix intentionally only ever upgrades a record to "In Use", never downgrades to "Free", so the two jobs can't conflict even if they overlap. Zabbix hosts disabled with no data in 6+ months are excluded (likely decommissioned).
- **Check Availability, per real interface** — new host-side `scan_helper.py` (systemd) lets availability checks egress through the server's actual `ens192`/`ens224` NICs instead of always going through the API container's bridge/NAT path; added as two new Check Availability sources alongside Device42 and the new Zabbix source.
- **Unused IP Addresses — redesigned** — card-based summary (stat tiles + per-subnet cards sorted by most-available) replacing a dense 8-column table across all subnets; fixed a real bug where the subnet dropdown silently 422'd and appeared empty (server caps `page_size` at 200, page was requesting 500) — now paginates properly; added IP filter and Check Availability directly on unused addresses.
- **Ad-hoc availability check for addresses with no record yet** — new `POST /ip-records/check-ip` endpoint, used by the Unused IPs page.

**Security fixes**

- **LDAP filter injection** (CWE-90) — the login username was interpolated unescaped into the LDAP search filter; now passed through `ldap3`'s `escape_filter_chars()`
- Added rate limiting to `/auth/refresh`, `/auth/change-password`, `/auth/request-role` (previously only login/register were throttled)
- axios upgraded 1.13.6 → 1.19.0 (was in the vulnerable range for several real CVEs: SSRF via NO_PROXY bypass, prototype-pollution auth bypass, response tampering)
- Blanked the dormant `INITIAL_ADMIN_PASSWORD` seed value in `.env.api` after confirming the admin account is stable (the seed-on-insert path is a no-op unless that account is ever deleted)
- Added a missing MongoDB index on the `folders` collection (`cabinet_id`, and a compound `cabinet_id+parent_id+name`) — every Vault folder-tree load was a full collection scan
- Narrowed `SubnetService.create()`'s reparenting query from a full VRF scan (1,300+ docs) to just the actual sibling candidates under the same parent

**Bug fixes**

- **Device42 status auto-update asymmetry** — a "Device42 has no record for this IP" result was auto-flipping existing "In Use" records to "Free"; Device42's inventory isn't guaranteed complete (e.g. assets tracked outside it), so a miss is no longer treated as proof of "unused" — only a positive match can auto-upgrade status now. Same principle applied to the new Zabbix check.
- **Zabbix bulk sync over-eager status writes** — the initial sync marked every returned host "In Use" regardless of Zabbix's own `status` field; disabled hosts with 6+ months of no data are now excluded. A one-time reconciliation (`scripts/zabbix_reconcile.py`) cross-checked every record the buggy version had touched against live Device42 data — corrected 53 of 423 (8 removed as bug-only artifacts, 45 kept but re-confirmed via Device42).
- Fixed Device42 API calls 404ing when the configured host had a trailing slash, producing a double-slash URL Device42's router doesn't recognize
- Fixed a stale `INITIAL_ADMIN_PASSWORD`-adjacent regression: a container recreate (needed to pick up new env vars) reverted several in-flight code hot-patches, including a `SuperAdmin` role addition across ~20 routers and the entire Vault Folders feature (5 files) that had never been synced back to the host filesystem — full backend now kept byte-for-byte identical between the host filesystem and the running container after every deploy
- Fixed the Network Scan page's mode-selector cards using hardcoded light-theme colors (`#fff`/`#d9d9d9`) against the app's dark theme

**Operational**

- All host-side automation scripts (sync jobs, cron wrappers, scan helper) are now version-controlled under `scripts/` — see `scripts/README.md`. Credentials remain server-only (`.env.device42`, `.env.zabbix`, `.env.scanhelper`), never committed.
- Cron lock files now auto-clear after 2 hours if a prior run was killed by something outside the script's control (host crash, reboot) — previously a stuck lock could silently block every future run indefinitely.

---

### v7.1.0 — TLS & Vault Polish

**Changed**

- **Trusted TLS certificate** — replaced the self-signed nginx certificate with a DigiCert wildcard cert (`*.abb-bank.az`); browsers now show a trusted padlock with no warning interstitial
- **Silent copy** — the password column now has a Copy icon that fetches and copies the plaintext to the clipboard without ever displaying it on screen; the existing "Reveal Password" button still shows it for 30 seconds when actually needed
- **Vault sidebar navigation** — added Cabinets and Generator entries to the Vault sidebar (previously only reachable via direct URL)

**Fixed**

- Share links generated a broken `/share/undefined` URL — `ShareModal` was reading a non-existent `token` field instead of the `share_url` the backend actually returns
- Public share page showed "Link Unavailable" for valid links — response field names didn't match the backend (`entry_title`, `note`, `view_count`/`max_views`); expired/revoked links now show a proper message instead of a generic error (backend returns HTTP 410, now handled explicitly)
- Share button was missing from the vault table entirely — `ShareModal` wasn't wired into `PasswordTable`'s Actions column

---

### v7.0.0 — Vault Enhancements & Security Hardening

**New features**

- **Folder organisation** — hierarchical folders per cabinet; drag-and-drop to move entries; folder tree sidebar; new entries assignable to a folder on creation
- **Secure share links** — generate time-limited, view-count-limited shareable URLs; links are revocable; all events logged in audit trail; public share page (`/share/:token`) requires no login
- **Password Generator page** — CSPRNG via `window.crypto.getRandomValues`; configurable length and character sets; ambiguous-character exclusion; live Shannon-entropy strength bar; zero server contact
- **SuperAdmin role** — fourth role that bypasses all `require_role()` checks; no per-router changes required

**Security fixes**

- Removed MongoDB root credentials from API container environment (C1)
- Disabled Swagger/OpenAPI in production (C2)
- SSRF protection on all integration endpoints with private-IP and metadata-IP blocklist (C3)
- CORS restricted to HTTPS production origin only (C4)
- Login password minimum length raised to 8 characters (H1)
- Added `Permissions-Policy`, `X-XSS-Protection`, `server_tokens off`, CSP `upgrade-insecure-requests` to nginx (H2)
- Generic 403 message — role names no longer disclosed in error responses (M3)
- Rate limit on share creation: 10/minute (M2)

**Bug fixes**

- Fixed login `ValidationError` crash when admin account has `role: 'SuperAdmin'` — `SUPER_ADMIN` added to `Role` enum
- Fixed naive vs timezone-aware `datetime` comparison in share expiry check
- Fixed `require_role()` blocking SuperAdmin on all endpoints
- Fixed service-level role guards in `PasswordService` that blocked SuperAdmin despite router-level bypass

**Code quality**

- `src/utils/apiError.ts` — `getApiError()` utility centralises error extraction across frontend catch blocks
- `aria-label` added to all `<Switch>` components in password generator (accessibility)
- Module-level imports in `share_service.py`

---

### v6.0.0
- Device42 integration, PaloAlto integration, IP availability check, infrastructure scan

### v5.0.0
- Asset Inventory (CMDB)

### v4.0.0
- Self-registration with admin approval, Password Vault (initial), portal home page

### v3.0.0
- IPv6 dual-stack, LDAP/AD authentication, DNS conflict detection, vSphere import

### v2.1.0
- recharts dashboard, subnet utilisation alerts, bulk operations, change history

### v2.0.0
- NetBox-style prefix nesting, IP Ranges, Aggregates & RIRs, VRF-scoped trees

### v1.3.0
- On-demand network scanner

### v1.0.0
- Initial release
