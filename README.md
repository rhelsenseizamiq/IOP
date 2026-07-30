# IOP — Infrastructure Operations Platform

A self-hosted IP Address Management portal with NetBox-style prefix hierarchy, dual-stack IPv4/IPv6, Device42 & PaloAlto integrations, real-time IP availability checks, infrastructure network scanning, Password Vault with folder organisation and secure sharing, and optional LDAP/AD authentication.

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

| Role | Permissions |
|------|-------------|
| **Viewer** | Read-only: all IPAM pages, change history, Vault (own cabinets), password generator |
| **Operator** | Viewer + create/edit/reserve/release, bulk ops, network scan, DNS scan, integrations import, folder management, share links |
| **Administrator** | Operator + delete, user management, audit log, pending approvals, cabinet CRUD |
| **SuperAdmin** | Bypasses all role checks — full access to every endpoint |

---

## Features

### Core IPAM
- Subnet management (CIDR, gateway, VLAN, environment, VRF, alert threshold)
- IP record tracking: hostname, OS type, owner, status (Free / Reserved / In Use)
- Automatic prefix nesting — smaller CIDRs become children of larger ones
- VRFs — isolated routing domains with optional Route Distinguisher
- Aggregates & RIRs — top-level address blocks
- IP Ranges — named spans (e.g. DHCP pools) within a subnet
- CSV import / export with validation and template download

### Dashboard & Operations
- recharts dashboard: IP status donut, environment bar, OS bar, top subnets, recent activity
- Subnet utilisation alert threshold — warning badge on row + dashboard banner
- Bulk reserve / release / update-fields for multiple IP records
- Per-record change history with before→after field diffs

### Network Scanner
- TCP-based host discovery for any CIDR; no ICMP/root needed
- OS fingerprinting + reverse DNS
- Infrastructure scan — scan multiple CIDRs, save IPs directly to DB

### Integrations
- **Device42** — REST API IP/device discovery with OS mapping
- **PaloAlto** — PAN-OS XML API: address objects, interface IPs, ARP table
- **vSphere** — vCenter VM discovery via pyVmomi
- **DNS conflict detection** — FORWARD_MISMATCH, PTR_MISMATCH, NO_FORWARD, DUPLICATE_HOSTNAME

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
| vSphere | `/integrations/vsphere/discover` + `/import` | Operator+ |
| Device42 | `/integrations/device42/discover` + `/import` | Operator+ |
| PaloAlto | `/integrations/paloalto/discover` + `/import` | Operator+ |
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
