# IPAM Portal

A fully Dockerized, self-contained **IP Address Management** web portal. Centralized visibility and controlled reservation of IP addresses across AIX, Linux, and Windows infrastructure — secured with local authentication, role-based access control, and full audit logging.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Docker Infrastructure](#docker-infrastructure)
- [Usage Guide](#usage-guide)
- [API Reference](#api-reference)
- [Role-Based Access Control](#role-based-access-control)
- [Security](#security)
- [Development Mode](#development-mode)
- [Daily Operations](#daily-operations)
- [Backup & Restore](#backup--restore)
- [Project Structure](#project-structure)
- [Changelog](#changelog)
- [Roadmap](#roadmap)
- [Troubleshooting](#troubleshooting)

---

## Overview

IPAM Portal is an internal web application that provides:

- **Centralized IP visibility** — view all allocated IPs and hostnames across your infrastructure
- **Controlled reservation** — reserve IPs within defined subnets with duplicate and conflict prevention
- **OS categorization** — organize records by AIX, Linux, or Windows
- **CSV import / export** — bulk-load IP records from a spreadsheet or export any filtered view to CSV
- **Full audit trail** — every create, update, delete, reserve, import, and login action is logged with before/after snapshots
- **Local user management** — administrators create and manage user accounts directly in the portal, no external directory required

The entire stack runs as Docker containers behind an Nginx reverse proxy — one command to set up, one command to run.

---

## Features

### Core (Phase 1 — MVP)

| Feature | Description |
|---------|-------------|
| Local authentication | Username + bcrypt-hashed password stored in MongoDB |
| Role-based access | Viewer, Operator, Administrator with enforced permissions |
| Subnet management | Define subnets in CIDR notation with environment tagging |
| IP record management | Full CRUD with IPv4 validation and CIDR membership check |
| IP reservation | Reserve/release workflow with conflict prevention |
| OS categorization | AIX, Linux, Windows per record |
| Environment tagging | Production, Test, Development per record |
| Advanced filtering | Filter by subnet, status, OS type, environment, owner, full-text search |
| **CSV export** | Export any filtered view to CSV — filter by OS, status, environment, subnet |
| **CSV import** | Bulk import IP records from CSV; per-row validation with error report |
| **Import template** | Download a pre-filled template showing the exact expected format |
| Audit logging | Append-only log with 365-day retention, before/after snapshots |
| Dashboard | Real-time stats: total/free/reserved/in-use + OS breakdown + subnet utilization |
| User management | Admin creates, edits, deactivates, and resets passwords for users |
| HTTPS | TLS termination at Nginx, HTTP auto-redirects to HTTPS |
| Rate limiting | Login: 5 req/min/IP · API: 200 req/min/IP |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11 + FastAPI + Uvicorn |
| Database driver | Motor 3.7 (async MongoDB) |
| Password hashing | bcrypt (cost factor 12, direct library — no passlib wrapper) |
| Auth tokens | python-jose HS256 JWT (access 60 min + HttpOnly refresh 8 h) |
| Frontend | React 18 + TypeScript + Vite |
| UI components | Ant Design 5 |
| HTTP client | Axios (with silent token refresh interceptor) |
| Database | MongoDB 7.0 |
| Reverse proxy | Nginx 1.25 |
| Deployment | Docker Compose |

---

## Prerequisites

| Requirement | Minimum version | Check |
|-------------|----------------|-------|
| Docker Engine | 24+ | `docker --version` |
| Docker Compose v2 | 2.20+ | `docker compose version` |
| OpenSSL | any | `openssl version` |

> **Note:** You do **not** need Python, Node.js, or npm installed on the host. Everything runs inside containers.

---

## Quick Start

### 1. Clone or copy the project

```bash
cd ~/Desktop/ipam-portal
```

### 2. Run the setup wizard

```bash
bash setup.sh
```

The wizard will:

1. Verify Docker is running
2. Generate strong random secrets (MongoDB passwords, 256-bit JWT key)
3. Prompt you to set the initial administrator username and password
4. Generate a self-signed TLS certificate (or let you provide your own)
5. Build all Docker images (~3–5 minutes on first run)
6. Start the full stack
7. Wait for all health checks to pass
8. Print the access URL and next steps

### 3. Open the portal

```
https://localhost
```

> Your browser will show a security warning for the self-signed certificate — click **Advanced → Proceed** (this is normal for self-signed certs; replace with a real certificate for production).

### 4. Log in

Use the administrator credentials you set during setup.

### 5. Post-setup checklist

- [ ] Log in and immediately change your password: **Header → Change Password**
- [ ] Remove `INITIAL_ADMIN_PASSWORD` from `.env` after your first login
- [ ] Create at least one **Subnet** before adding IP records
- [ ] Create additional user accounts for your team: **Users → Create User**

---

## Configuration

All configuration lives in `.env` (generated by `setup.sh` from `.env.example`).

```bash
# ── MongoDB ───────────────────────────────────────────
MONGO_ROOT_USER=admin
MONGO_ROOT_PASSWORD=<generated>
MONGO_APP_USER=ipam_app
MONGO_APP_PASSWORD=<generated>
MONGODB_URI=mongodb://ipam_app:<password>@mongodb:27017/ipam?authSource=ipam
MONGODB_DB_NAME=ipam

# ── JWT ───────────────────────────────────────────────
JWT_SECRET_KEY=<generated-256-bit-hex>
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=60         # Access token lifetime
JWT_REFRESH_EXPIRE_HOURS=8    # Refresh token lifetime (one work shift)

# ── Initial Admin (remove after first login!) ─────────
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=<your-chosen-password>

# ── App ───────────────────────────────────────────────
APP_ENV=production
ALLOWED_ORIGINS=["https://ipam-portal.com","https://localhost"]
ENABLE_SWAGGER=false           # Set to true to expose /api/docs

# ── Rate Limiting ─────────────────────────────────────
RATE_LIMIT_LOGIN=5/minute
RATE_LIMIT_API=200/minute
```

> **Note:** `ALLOWED_ORIGINS` must be a JSON array string (e.g. `["https://ipam-portal.com","https://localhost"]`).

### Using a real TLS certificate

Replace the self-signed certificate with your organization's certificate:

```bash
cp /path/to/your/cert.pem nginx/ssl/cert.pem
cp /path/to/your/private.key nginx/ssl/key.pem
chmod 600 nginx/ssl/key.pem
make restart
```

---

## Docker Infrastructure

```
Host machine (ports 80, 443)
│
└── nginx  ←── TLS termination, rate limiting, reverse proxy
     │
     ├── /api/*  ──────────── api (FastAPI, port 8000, internal only)
     │                             │
     │                             └── mongodb (port 27017, internal only)
     │
     └── /*  ──────────────── frontend (nginx:alpine, port 80, internal only)
```

### Services

| Service | Image | Exposed | Purpose |
|---------|-------|---------|---------|
| `nginx` | `nginx:1.25-alpine` | 80, 443 | TLS termination + reverse proxy |
| `api` | Custom (Python 3.11) | Internal only | FastAPI backend |
| `frontend` | Custom (nginx:alpine) | Internal only | React SPA static files |
| `mongodb` | `mongo:7.0` | Internal only | Database |

### Networks

| Network | Type | Used by |
|---------|------|---------|
| `ipam-internal` | `internal: true` | api, mongodb, frontend, nginx |
| `ipam-external` | bridge | nginx (exposes 80/443 to host) |

MongoDB and the API are **never reachable from outside** the Docker host — only Nginx is exposed.

---

## Usage Guide

### Adding your first subnet

1. Go to **Subnets** in the sidebar
2. Click **Create Subnet**
3. Enter the CIDR (e.g. `10.10.1.0/24`), name, environment, and optionally gateway + VLAN
4. Click **Save**

### Adding IP records

1. Go to **IP Records**
2. Click **Add IP**
3. Fill in: IP address (must be within an existing subnet's CIDR), hostname (optional), OS type, environment, owner (optional), description (optional)
4. The system validates the IP is within the selected subnet and not already allocated
5. Click **Save**

### Reserving an IP

An IP with status **Free** can be reserved by an Operator or Administrator:

1. Find the IP in the IP Records table
2. Click the **Reserve** button (lock icon)
3. The status changes to **Reserved** and the record shows who reserved it and when

### Releasing an IP

A **Reserved** IP can be released back to **Free**:

1. Find the reserved IP
2. Click the **Release** button (unlock icon)

### Exporting IP records to CSV

Available to all roles (Viewer, Operator, Administrator):

1. Go to **IP Records**
2. Click **Export**
3. In the Export modal, optionally select filters: OS Type, Status, Environment, or Subnet
4. Click **Download CSV** — the file `ipam_export.csv` downloads immediately
5. Leave all filters blank to export every record

**CSV columns exported:** `ip_address`, `hostname`, `os_type`, `subnet_cidr`, `status`, `environment`, `owner`, `description`

### Importing IP records from CSV

Available to Operator and Administrator roles:

1. Go to **IP Records**
2. Click **Import**
3. **Step 1** — Click **ipam_import_template.csv** to download the template
4. Fill in the template (see format below) and save it as a `.csv` file
5. **Step 2** — Drag the file into the upload area (or click to browse)
6. Click **Import**
7. The result shows how many records were imported and a table of any rows that failed with their error reasons

**CSV import format:**

| Column | Required | Allowed values | Example |
|--------|----------|----------------|---------|
| `ip_address` | Yes | Valid IPv4 | `10.10.1.42` |
| `hostname` | No | Any string | `db01.example.com` |
| `os_type` | Yes | `AIX` \| `Linux` \| `Windows` | `Linux` |
| `subnet_cidr` | Yes | Existing subnet CIDR | `10.10.1.0/24` |
| `status` | No | `Free` \| `Reserved` \| `In Use` (default: `Free`) | `In Use` |
| `environment` | Yes | `Production` \| `Test` \| `Development` | `Production` |
| `owner` | No | Any string | `team-infra` |
| `description` | No | Any string | `Web server` |

**Import rules:**
- Each row is validated independently — failed rows are reported but do not stop the rest of the import
- `subnet_cidr` must match an existing subnet in the database
- The IP address must be within the specified subnet's CIDR range
- Duplicate IP addresses are rejected with an error per row
- Every successfully imported record creates an audit log entry

### Managing users (Administrator only)

1. Go to **Users** in the sidebar
2. Click **Create User** — set username, password, full name, and role
3. To change a user's role: click **Edit**
4. To disable a user without deleting their audit history: click **Deactivate**
5. To reset a forgotten password: click **Reset Password**

---

## API Reference

The REST API is available at `/api/v1/`. In development mode (`ENABLE_SWAGGER=true`), interactive docs are at `/api/docs`.

### Authentication

```
POST /api/v1/auth/login           Login → returns access token + sets refresh cookie
POST /api/v1/auth/logout          Logout → invalidates token
GET  /api/v1/auth/me              Current user info
POST /api/v1/auth/refresh         Silent token renewal (uses HttpOnly cookie)
POST /api/v1/auth/change-password Change own password
```

### Users (Administrator only)

```
GET    /api/v1/users                    List all users
POST   /api/v1/users                    Create user
GET    /api/v1/users/{id}               Get user
PUT    /api/v1/users/{id}               Update user
DELETE /api/v1/users/{id}               Deactivate user
POST   /api/v1/users/{id}/reset-password Reset password
POST   /api/v1/users/{id}/activate      Re-activate user
```

### IP Records

```
GET    /api/v1/ip-records                      List (filterable, paginated)
POST   /api/v1/ip-records                      Create single record
GET    /api/v1/ip-records/export/template      Download CSV import template
GET    /api/v1/ip-records/export               Export filtered records to CSV
POST   /api/v1/ip-records/import               Bulk import from CSV file
GET    /api/v1/ip-records/by-ip/{ip}           Lookup by exact IP address
GET    /api/v1/ip-records/{id}                 Get by ID
PUT    /api/v1/ip-records/{id}                 Update
PATCH  /api/v1/ip-records/{id}                 Partial update
DELETE /api/v1/ip-records/{id}                 Delete (Admin only)
POST   /api/v1/ip-records/{id}/reserve         Reserve
POST   /api/v1/ip-records/{id}/release         Release
```

**Filter params for `GET /ip-records` and `GET /ip-records/export`:**
`subnet_id`, `status`, `os_type`, `environment`, `owner`, `search`, `page`, `page_size`

**Export endpoint** returns `text/csv` with `Content-Disposition: attachment; filename=ipam_export.csv`.

**Import endpoint** accepts `multipart/form-data` with a `file` field (`.csv` only) and returns:
```json
{
  "imported": 42,
  "errors": [
    { "row": 5, "ip": "10.0.0.99", "error": "Subnet '10.0.0.0/24' not found in the database" }
  ]
}
```

### Subnets

```
GET    /api/v1/subnets                   List
POST   /api/v1/subnets                   Create (Admin only)
GET    /api/v1/subnets/{id}              Detail + utilization stats
PUT    /api/v1/subnets/{id}              Update (Admin only)
DELETE /api/v1/subnets/{id}             Delete (Admin only, no IPs allocated)
GET    /api/v1/subnets/{id}/ip-records  All IPs in subnet
GET    /api/v1/subnets/{id}/available-ips Unallocated IPs
```

### Audit Logs (Administrator only)

```
GET /api/v1/audit-logs                          List (filterable)
GET /api/v1/audit-logs/{id}                     Single entry
GET /api/v1/audit-logs/resource/{type}/{id}     All events for a resource
```

**Filter params:** `username`, `action`, `resource_type`, `resource_id`, `date_from`, `date_to`, `page`, `page_size`

### All API responses use a consistent envelope

```json
// Single item
{ "id": "...", "field": "value", ... }

// Paginated list
{
  "items": [...],
  "total": 150,
  "page": 1,
  "page_size": 50,
  "pages": 3
}

// Error
{ "detail": "Human-readable error message" }
```

---

## Role-Based Access Control

| Action | Viewer | Operator | Administrator |
|--------|:------:|:--------:|:-------------:|
| View IP records | ✓ | ✓ | ✓ |
| View subnets | ✓ | ✓ | ✓ |
| View dashboard | ✓ | ✓ | ✓ |
| **Export IP records to CSV** | ✓ | ✓ | ✓ |
| Create / edit IP records | | ✓ | ✓ |
| Reserve / release IPs | | ✓ | ✓ |
| **Import IP records from CSV** | | ✓ | ✓ |
| **Download import template** | | ✓ | ✓ |
| Delete IP records | | | ✓ |
| Create / edit subnets | | | ✓ |
| Delete subnets | | | ✓ |
| Manage users | | | ✓ |
| View audit log | | | ✓ |

Role is assigned when the user account is created and can be changed by an Administrator at any time. Changes take effect at the user's next login.

**Guards:**
- An Administrator cannot deactivate their own account
- The last active Administrator account cannot be deactivated
- At least one active admin must always exist

---

## Security

### Authentication & sessions

| Concern | Implementation |
|---------|---------------|
| Password storage | bcrypt with cost factor 12, explicit 72-byte truncation — no plaintext ever stored |
| Access token | HS256 JWT, 60-minute lifetime, stored in **React memory only** (never localStorage) |
| Refresh token | HttpOnly + Secure + **SameSite=Strict** cookie — inaccessible to JavaScript |
| Token validation | Every request verifies the token, checks the JTI blocklist, **and confirms the user still exists and is active** |
| Logout | Token JTI added to MongoDB blocklist with auto-expiring TTL index |
| Login brute force | Rate-limited to 5 requests/minute per IP at Nginx level |
| Error messages | Generic "Invalid credentials" for both wrong username and wrong password (no enumeration) |
| password_hash | Never returned in any API response or audit log snapshot |
| Silent refresh loop | Axios interceptor skips `/auth/refresh` 401s to prevent recursive refresh calls |

### Network & TLS

| Concern | Implementation |
|---------|---------------|
| Encryption | TLS 1.2 minimum, TLS 1.3 preferred |
| HSTS | `max-age=63072000; includeSubDomains` enforced |
| HTTP redirect | All HTTP traffic auto-redirected to HTTPS |
| IP allowlist | Nginx `geo` block — only RFC-1918 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) are permitted; all other IPs receive 403 |
| Database exposure | MongoDB port never published to host; internal Docker network only |
| API exposure | FastAPI never directly reachable from outside the container network |
| Security headers | Set at both **Nginx** and **FastAPI middleware** layers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy`, `Referrer-Policy` |
| CSP | `script-src 'self'` (no `unsafe-inline`); `style-src 'self' 'unsafe-inline'` (required for Ant Design CSS-in-JS) |

### Input & data safety

| Concern | Implementation |
|---------|---------------|
| CSV formula injection | All user-controlled cells in CSV exports are sanitised — values starting with `=`, `+`, `-`, `@` are prefixed with `'` |
| MongoDB regex injection / ReDoS | All user-supplied filter strings are passed through `re.escape()` before embedding in `$regex` queries |
| ObjectId validation | All `/{id}` path parameters are validated against `^[0-9a-f]{24}$` at the schema level — invalid IDs never reach the database |
| CSV import limits | Max 10 MB file size, max 10,000 rows per import |
| Export access | Export endpoint restricted to Operator+ role; hard cap of 5,000 records per export |
| JWT secret guard | Startup fails immediately if `JWT_SECRET_KEY` is the known default value |
| Atomic IP reservation | Reserve/release operations use `find_one_and_update` with a conditional filter — no race conditions under concurrent requests |
| Audit log fault tolerance | Audit log write failures are caught, logged as errors, and never propagate to the user-facing operation |

### Audit integrity

- The `audit_logs` collection is **append-only** — no update or delete operations are permitted at the repository layer
- Every state-changing action records a full before/after snapshot
- CSV imports create an individual audit log entry per successfully imported record
- Failed login attempts are logged with username and client IP
- Audit logs are automatically purged after 365 days via MongoDB TTL index

### Secrets management

- All secrets are stored in `.env` with `600` permissions and excluded from git via `.gitignore`
- Secrets are never hardcoded in source files or `docker-compose.yml`
- JWT key is a minimum 256-bit random hex string generated by `setup.sh`
- Application refuses to start if `JWT_SECRET_KEY` is set to the known placeholder value
- `INITIAL_ADMIN_PASSWORD` should be removed from `.env` after the first login

---

## Development Mode

For local development you can run the API and frontend separately with hot reload:

### Backend (hot reload)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start MongoDB only
docker compose up -d mongodb

# Run API with hot reload
uvicorn app.main:app --reload --port 8000
```

### Frontend (Vite dev server)

```bash
cd frontend
npm install
npm run dev
# Opens http://localhost:5173
# API requests proxied to http://localhost:8000
```

### Dev stack via Docker Compose override

```bash
# Runs MongoDB + API with hot reload + exposes ports for debugging
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Access:
#   API:          http://localhost:8000
#   API docs:     http://localhost:8000/api/docs  (ENABLE_SWAGGER=true)
#   MongoDB:      localhost:27017
```

---

## Daily Operations

All commands are available via `make`. Run `make help` to see them all.

```bash
make setup        # First-time setup wizard
make up           # Start all services
make down         # Stop all services
make restart      # Restart all services
make logs         # Tail logs from all containers
make logs-api     # Tail API logs only
make logs-nginx   # Tail Nginx access/error logs
make rebuild      # Rebuild images after code changes + restart
make shell-api    # Open a shell inside the API container
make shell-mongo  # Open mongosh (MongoDB shell)
make test         # Run backend test suite
make backup       # Dump MongoDB to ./backups/
make clean        # Remove all containers, volumes, and images (destructive!)
```

### Checking service health

```bash
docker compose ps                   # Show status of all containers
curl -k https://localhost/health    # API health check endpoint
```

### Restarting a single service

```bash
docker compose restart api
docker compose restart nginx
```

### Viewing logs for a specific service

```bash
docker compose logs -f api --tail=100
docker compose logs -f mongodb --tail=50
```

---

## Backup & Restore

### Create a backup

```bash
make backup
# Saves to ./backups/ipam_backup_YYYYMMDD_HHMMSS.tar.gz
```

### Restore a backup

```bash
# Extract the archive
tar xzf backups/ipam_backup_20260301_120000.tar.gz -C /tmp/

# Restore into running MongoDB container
docker compose exec -T mongodb mongorestore \
  --uri="mongodb://ipam_app:$(grep MONGO_APP_PASSWORD .env | cut -d= -f2)@localhost:27017/ipam?authSource=ipam" \
  --drop \
  /tmp/backup_20260301_120000/ipam/
```

### Automated daily backups (cron)

```bash
# Add to crontab: crontab -e
0 2 * * * cd /path/to/ipam-portal && make backup >> /var/log/ipam-backup.log 2>&1
```

---

## Project Structure

```
ipam-portal/
├── setup.sh                      Automated setup wizard
├── Makefile                      Day-to-day operations
├── docker-compose.yml            Production stack
├── docker-compose.dev.yml        Development overrides
├── .env.example                  Environment variable template
│
├── nginx/
│   ├── nginx.conf                Global Nginx settings + security headers
│   ├── conf.d/ipam.conf          Virtual host: TLS, rate limits, proxy rules
│   └── ssl/                      TLS certificate and private key (gitignored)
│
├── mongodb/
│   └── init.js                   Creates app user + all collection indexes on first start
│
├── backend/                      Python FastAPI application
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py               App factory, lifespan hooks, admin seeding
│       ├── config.py             Settings (pydantic-settings, from .env)
│       ├── core/
│       │   ├── database.py       Motor client + collection helpers
│       │   ├── security.py       JWT create/decode + token blocklist
│       │   ├── password.py       bcrypt hash + verify (direct bcrypt library)
│       │   ├── rate_limiter.py   SlowAPI setup
│       │   └── logging_config.py Structured logging (redacts secrets)
│       ├── dependencies/
│       │   ├── auth.py           get_current_user + require_role() factory
│       │   └── pagination.py     Shared page/page_size params
│       ├── models/               Internal domain models + enums
│       ├── schemas/              API request/response Pydantic schemas
│       ├── repositories/         Data access layer (Repository pattern)
│       ├── services/
│       │   ├── ip_record_service.py  CRUD + reserve/release + export/import logic
│       │   ├── subnet_service.py
│       │   └── auth_service.py
│       ├── routers/
│       │   ├── ip_records.py     Includes /export/template, /export, /import endpoints
│       │   ├── subnets.py
│       │   ├── auth.py
│       │   ├── users.py
│       │   └── audit_logs.py
│       └── tests/                pytest test suite
│
└── frontend/                     React TypeScript application
    ├── Dockerfile                Multi-stage: node build → nginx serve
    ├── nginx.conf                SPA serving config (inside container)
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── api/
        │   ├── client.ts         Axios instance + silent refresh interceptor
        │   ├── ipRecords.ts      Includes exportRecords, importRecords, downloadTemplate
        │   ├── auth.ts
        │   ├── subnets.ts
        │   └── auditLogs.ts
        ├── types/                TypeScript interfaces
        ├── context/              AuthContext (in-memory token + role)
        ├── components/
        │   ├── layout/           AppLayout, Sidebar, Header
        │   └── common/           ProtectedRoute, StatusBadge, OSIcon
        └── pages/
            ├── Login/
            ├── Dashboard/
            ├── IPRecords/
            │   ├── IPRecordsPage.tsx   Main table + filter bar + action buttons
            │   ├── ExportModal.tsx     Filter selection + CSV download
            │   └── ImportModal.tsx     Template download + file upload + result view
            ├── Subnets/
            ├── Users/
            └── AuditLog/
```

---

## MongoDB Collections

| Collection | Purpose | TTL |
|------------|---------|-----|
| `users` | User accounts (bcrypt passwords) | — |
| `subnets` | Subnet definitions | — |
| `ip_records` | IP address records | — |
| `audit_logs` | Immutable action history (includes import events) | 365 days |
| `token_blocklist` | Invalidated JWT IDs | Auto-expires with token |

---

## Changelog

### v1.2.0 — Bug Fixes

- **Fix: create user 422 on blank email** — Leaving the Email field empty sent `""` which Pydantic's `EmailStr` rejected. A `field_validator` now converts blank strings to `None` on both `UserCreate` and `UserUpdate`; the frontend also strips empty email from the payload before sending.
- **Fix: deactivate user 404** — The frontend called `POST /users/{id}/deactivate` but only `DELETE /users/{id}` existed. Added the missing `POST /{id}/deactivate` endpoint to match the existing `POST /{id}/activate` pattern.
- **Feat: permanent user delete** — Administrators can now hard-delete a user account via a new red trash-icon button in the Users table. Safety guards prevent deleting your own account or the last active Administrator. A full audit log entry with before-snapshot is written on every deletion.

---

### v1.1.0 — Security Hardening Release

**Security fixes (backend)**

- **JWT secret guard** — application now refuses to start if `JWT_SECRET_KEY` is the known default placeholder value
- **IP allowlist** — Nginx `geo` block restricts access to RFC-1918 ranges only; all other source IPs receive 403
- **User active check** — every authenticated request now verifies the user still exists and is active in the database (deactivated users with valid tokens are immediately rejected)
- **Atomic reserve/release** — replaced read-check-write with `find_one_and_update` to prevent race conditions under concurrent requests
- **SameSite=Strict** — refresh token cookie changed from Lax to Strict
- **MongoDB regex sanitisation** — all user-supplied filter strings now go through `re.escape()` before use in `$regex` queries, preventing ReDoS and pattern-enumeration attacks
- **CSV formula injection prevention** — cells starting with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'` in all CSV exports
- **Import limits** — CSV import now rejects files over 10 MB and imports with more than 10,000 rows
- **Export scope** — export endpoint restricted to Operator+ role; hard cap of 5,000 records per request
- **ObjectId path validation** — all `/{id}` path parameters validated at schema level (`^[0-9a-f]{24}$`); invalid IDs never reach the database
- **Security headers middleware** — `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` are now also set by the FastAPI layer (not only Nginx), so direct API access is also protected
- **CSP hardened** — `script-src 'unsafe-inline'` removed; health endpoint no longer exposes version information
- **Audit fault tolerance** — audit log write failures no longer propagate to the user-facing operation

**UX improvements (frontend)**

- **CIDR-aware IP validator** — the Add IP form validates the entered IP address against the selected subnet's CIDR range client-side, showing an inline error before submission
- **Subnet hint** — the IP Address field displays a helper text (`Must be within 10.x.x.x/24`) once a subnet is selected
- **Subnet dependency** — changing the subnet selection automatically re-validates the IP address field

---

## Roadmap

### Completed

- [x] Local username/password authentication with bcrypt
- [x] Role-based access control (Viewer / Operator / Administrator)
- [x] Subnet management with CIDR validation
- [x] IP record CRUD with duplicate prevention and conflict detection
- [x] IP reservation / release workflow
- [x] Full audit logging with before/after snapshots
- [x] Dashboard with utilization stats
- [x] User management (admin creates/deactivates/resets users)
- [x] **CSV export** with per-column filters (OS, status, environment, subnet)
- [x] **CSV import** with per-row validation and error report
- [x] Import template download

### Phase 2 (Planned)

- [ ] IP reservation approval workflow (Operator requests → Administrator approves)
- [ ] Email notifications on reserve/release events
- [ ] LDAP/Active Directory as optional login method (alongside local auth)
- [ ] Enhanced change-history diff view per IP record
- [ ] Automated import from vSphere / DNS / CMDB

### Phase 3 (Future)

- [ ] REST API for automation pipelines (Ansible, Terraform)
- [ ] DHCP/DNS conflict detection
- [ ] Excel (.xlsx) export in addition to CSV
- [ ] Grafana-style utilization dashboards
- [ ] Multi-tenant support (separate IPAM spaces per team)

---

## Troubleshooting

### Setup fails at image build

```bash
# Check Docker has enough disk space
docker system df

# Clean up unused images and retry
docker system prune -f
bash setup.sh
```

### "Connection refused" after startup

```bash
# Check all containers are healthy
docker compose ps

# View logs for the failing service
docker compose logs api --tail=50
docker compose logs mongodb --tail=50
```

### Cannot log in after setup

```bash
# Verify the admin user was seeded
make shell-mongo
> db.users.find({}, {username:1, role:1, is_active:1})
```

### Reset admin password manually

```bash
# Generate a new bcrypt hash (Python)
docker compose exec api python3 -c \
  "from app.core.password import hash_password; print(hash_password('NewPassword123'))"

# Update the admin user in MongoDB
make shell-mongo
> db.users.updateOne(
    { username: "admin" },
    { $set: { password_hash: "<hash-from-above>" } }
  )
```

### CSV import rows are failing

| Error message | Cause | Fix |
|---|---|---|
| `Subnet 'x.x.x.x/yy' not found` | The CIDR in `subnet_cidr` doesn't match any subnet in the portal | Create the subnet first, or correct the CIDR spelling |
| `IP x.x.x.x is not within subnet x.x.x.x/yy` | IP address is outside the subnet range | Use the correct subnet for that IP, or correct the IP |
| `IP address x.x.x.x already exists` | The IP is already allocated | Remove the row or delete the existing record first |
| `os_type must be one of …` | Typo in the OS column | Use exactly `AIX`, `Linux`, or `Windows` (case-sensitive) |
| `environment must be one of …` | Typo in the environment column | Use exactly `Production`, `Test`, or `Development` |
| `Only CSV files are accepted` | Wrong file type uploaded | Save the spreadsheet as `.csv` before importing |

### MongoDB data is lost after `docker compose down`

```bash
# Use 'down' without -v to preserve volumes
docker compose down        # keeps data ✓
docker compose down -v     # deletes data ✗
```

---
