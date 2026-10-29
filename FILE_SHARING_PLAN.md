# IOP: File Sharing Feature — Implementation Plan

**Status: PLANNED, NOT YET IMPLEMENTED.** This document is the plan to review. Nothing in this
plan has been built yet — no code has been written, no containers touched, no config changed.

---

## Context

This plan adds file sharing to the IOP IPAM portal. While researching it, we found a directly
relevant existing problem: the Vault's "Share Link" feature is **half-built and currently broken
in production**. The frontend (`frontend/src/pages/Vault/ShareModal.tsx`,
`frontend/src/pages/Share/SharePage.tsx`, the public `/share/:token` route in `App.tsx`) is fully
wired and calling backend endpoints that were never implemented. The main `README.md` documents
the intended design (token/expiry/view-count/revoke) but none of the described backend files
exist, and `app/main.py` never registers a `shares` router. **Clicking "Share link" in the Vault
today most likely returns a 404.**

Given that, this plan covers two things that share one backend mechanism:

1. A new standalone **Files** feature — its own page, sidebar entry, and database collection, not
   nested in the existing Vault/Cabinet structure. Upload (encrypted at rest), list, download,
   delete.
2. A generic, reusable **Share Link** backend (token, expiry, max-views, revoke) that both the
   new Files feature and the existing (currently broken) password-sharing UI use — fixing the
   dead buttons as a side effect, instead of building two separate link mechanisms.

### Decisions already made (confirmed with the user)

| Decision | Choice |
|---|---|
| Where files live | Standalone feature, not inside Vault/Cabinets |
| Who can see/download a file | Any Viewer+ (flat RBAC, no per-file ownership) |
| Encryption at rest | Yes — new envelope-encryption scheme |
| Max file size | **250 MB** |
| Share links for external recipients | **Files only — yes. Passwords — no, internal-only.** The two resource types share one endpoint, but external access is a policy decision that only makes sense for files (see the §3/§5 revision below — this is still the single highest-risk decision in this plan, now scoped correctly) |
| Malware scanning on upload | **Yes** — native ClamAV service, scans every file before it's downloadable/shareable (see §2a); scanning is **asynchronous**, not part of the upload request/response cycle |
| Guest access for non-IOP users (e.g. vendors) | **Temporary links only — no guest accounts, no guest passwords, ever.** Works both directions: send a vendor a download link for a file you uploaded (already covered by the base design), or create an upload link that lets a vendor send *you* a file with no login at all, capped at exactly one upload per link (see §3a) |
| File visibility for guest-uploaded files | **Private to the uploading link's owner + Administrators** — a real `visibility` field, not just a stated intent (see §1) |
| File self-destruct after first download | **Yes, optional, per file** — adopted from reviewing Plik's "OneShot" feature (see §1/§3b) |
| File expiry (TTL) with auto-cleanup | **Yes, optional, per file** — adopted from reviewing Plik; resolves what was previously an open "not covered" item (see §3b) |
| Password-protected share links | **Yes, optional, per link** — an extra passphrase on top of the token itself, reusing this app's existing `hash_password`/`verify_password` (see §3c) |
| AI assistant integration for files/shares | **Yes** — new deterministic query capabilities in the existing `assistant.py` (see §3d), not a separate MCP server |
| True end-to-end (client-side) encryption | **Open — not decided.** Stronger than our server-side encryption but adds friction to the zero-login guest flow; see §3e |
| "Stream mode" (pass-through, nothing stored) | **Open — not decided, leaning against.** Conflicts with the mandatory malware-scan-before-release requirement; see §3e |

### Critical constraint that shapes deployment (§7)

The running `iop-api` container's actual code only exists as `docker cp` hot-patches applied
directly onto its running, writable filesystem layer — the *built Docker image* itself is stale
(dated April) and does not contain the many features shipped since then. A plain
`docker restart iop-api` is safe and preserves those patches. Running `docker compose up`,
recreating, or pulling a new image for the `api` service is **not** safe — it reverts the
container to that stale image and silently deletes everything patched in since, unless the full
`backend/app` source tree is immediately copied back in afterward. This feature needs a new
Docker volume mount (for file storage), which forces exactly that kind of recreate — so the
deployment section below is a mandatory, ordered checklist, not optional ceremony.

---

## 1. Data Models

**`backend/app/models/file.py`** — new `FileEntry` model: `id, filename, content_type,
size_bytes, storage_path, wrapped_dek, dek_iv, file_iv, sha256, description, tags[], scan_status,
visibility, delete_after_first_download, expires_at, created_at, updated_at, created_by,
updated_by`. Same shape convention as every other model in this app (see
`app/models/aggregate.py`).
- `scan_status` is one of `pending / clean / infected / scan_failed` — see §2a; download and
  share-link creation are both blocked unless it's `clean`.
- `visibility` is `"org"` (default for a normal upload — any Viewer+ can see/download it, per the
  flat-RBAC decision) or `"owner_only"` (set automatically whenever the file arrived via a guest
  upload link — see §3a; only `created_by` and Administrators can see/download it). `GET /files`
  and `GET /files/{id}/download` must actually filter on this — a file with `visibility:
  owner_only` is excluded from another user's list results and 403s on a direct download attempt.
  This field is what makes the "guest uploads are private" intent in §3a a real, enforced rule
  instead of just stated behavior.
- `delete_after_first_download: bool` (default `false`) and `expires_at: Optional[datetime]`
  (default `null` — keep forever, same as everything else in this app unless set) — see §3b, both
  adopted after reviewing Plik's OneShot/TTL features.

`backend/app/schemas/file.py` — `FileCreate` (form fields only: `description`, `tags` — the
binary itself arrives as an `UploadFile`, not JSON), `FileUpdate`, `FileResponse` (metadata only —
**never** includes `wrapped_dek`/`dek_iv`/`file_iv`/`storage_path`, those stay server-side only).

**`backend/app/models/share_link.py`** — new `ShareResourceType` enum (`PASSWORD_ENTRY`, `FILE`),
new `ShareLink` model: `id, token, link_type ("download" | "upload"), resource_type, resource_id
(null for an upload link until its one file lands), expires_at (timezone-aware UTC or null),
max_views, view_count, note, is_revoked, password_hash, created_at, updated_at, created_by,
updated_by`.
- `password_hash: Optional[str]` — when set, the link needs this passphrase in addition to the
  token itself before it resolves. Reuses this app's existing `hash_password`/`verify_password`
  (`backend/app/core/password.py`, bcrypt, already used for user accounts) rather than inventing a
  second hashing scheme — see §3c.
- Field names `max_views`/`view_count` are kept as-is (not renamed to something more generic like
  "uses") specifically so the already-built password-sharing frontend contract (`ShareModal.tsx`'s
  `ShareLink` interface) doesn't need to change — for an upload link they just count uploads
  instead of views; same field, same atomic-increment logic either way.
- **Upload-type links are always `max_views: 1`, not configurable.** `resource_id` is a single
  value, so a link that could accept more than one upload has nowhere to record which file is
  "the" result — rather than half-support multi-file links, this plan restricts upload links to
  exactly one file each. A real need for "collect several files from one vendor" can be served by
  creating several single-use upload links instead.
- `created_by` on an upload link is who the uploaded file will belong to — see §3a.

**`mongodb/init.js`** additions (same comment-banner style already used for every other
collection in that file):

```js
db.createCollection("files");
db.files.createIndex({ created_at: -1 });
db.files.createIndex({ created_by: 1 });
db.files.createIndex({ filename: "text", description: "text" });

db.createCollection("share_links");
db.share_links.createIndex({ token: 1 }, { unique: true });
db.share_links.createIndex({ resource_type: 1, resource_id: 1 });
db.share_links.createIndex({ expires_at: 1 });
// Housekeeping purge only — expiry correctness is enforced in application
// code via timezone-aware comparison; this index just stops the collection
// growing forever once a share link is long dead.
db.share_links.createIndex({ created_at: 1 }, { expireAfterSeconds: 7776000 }); // 90 days
```

`init.js` only runs once, on a brand-new empty Mongo volume — these two blocks must **also** be
applied live, by hand, against the already-running database (same as every prior schema change
in this project's history).

**`backend/app/models/audit_log.py`**: add `ResourceType.FILE`, `ResourceType.SHARE_LINK`; add
`AuditAction.UPLOAD`, `.DOWNLOAD`, `.SHARE_CREATE`, `.SHARE_VIEW`, `.SHARE_REVOKE`.

**`backend/app/repositories/audit_log_repository.py`**: extend the existing `_SENSITIVE_KEYS`
stripping set to also include `wrapped_dek`, `dek_iv`, `file_iv`, `token` — these must never be
written into an audit-log record.

---

## 2. Encryption (`backend/app/core/file_vault.py` — new module)

Mirrors the existing `app/core/vault.py`'s primitives (AES-256-GCM, HKDF-SHA256,
`VAULT_MASTER_KEY` as the one root secret already configured for the Password Vault) but uses
**envelope encryption with chunked streaming**, since files can be multiple megabytes and
`vault.py`'s existing approach assumes a short string encrypted in one call, fully in memory.

- **Per-file data key (DEK)**: a fresh random 32-byte key generated on every upload. It's wrapped
  (encrypted) with a key derived from the app's master key via HKDF, using one small `AESGCM`
  call (the DEK itself is tiny — no streaming needed for this step). The wrapped DEK and its IV
  are stored on the file's database record.
- **Chunked body encryption**: the file body is encrypted in fixed 1 MiB chunks, each
  independently authenticated (AEAD-framed with a per-chunk nonce), so that decryption can stream
  one chunk at a time on download without ever loading the whole file into memory — this matters
  at a 250MB cap.
- The plaintext's SHA-256 checksum is computed incrementally while streaming the upload (each
  chunk is hashed before it's encrypted) and stored on the record — this is what the verification
  step (§8) uses to prove a downloaded file is byte-identical to what was uploaded.
- **On-disk layout**: files are stored under a new `FILE_STORAGE_ROOT` setting
  (`/app/file_storage` inside the container), in a date-sharded path (`YYYY/MM/<random-id>.bin`)
  — the original filename never touches disk, only the database record, which avoids path-
  traversal risk and avoids leaking filenames if the storage mount were ever briefly exposed.

**Upload flow — revised to fix a real ordering problem**: the original draft of this plan had the
file encrypted on the way in, then scanned afterward — but ClamAV cannot scan an encrypted blob,
so that ordering doesn't actually work. Corrected flow:
1. The incoming file is streamed in 1 MiB reads straight to a **temporary plaintext file** (never
   held whole in memory), hashing each chunk as it goes; the 250MB cap is enforced by counting
   bytes as they arrive, aborting and cleaning up if exceeded.
2. On success, a `FileEntry` record is inserted immediately with `scan_status: pending` — this is
   what makes the file show up right away in the owner's list as "processing," without the HTTP
   upload request waiting around for a scan to finish (see §2a — scanning is asynchronous).
3. A background task hands the temp plaintext file to `clamd`.
4. **Clean** → encrypt the plaintext into its final storage location now (the envelope-encryption
   scheme described above), delete the temp plaintext file, fill in `wrapped_dek`/`dek_iv`/
   `file_iv`/`storage_path`, flip `scan_status: clean`. Only now is it downloadable or shareable.
5. **Infected** → delete the temp plaintext file, nothing is ever encrypted or placed into
   permanent storage, `scan_status: infected`, audit-logged (§2a).

**Download flow**: `GET /files/{id}/download` streams the file back to the client chunk by chunk,
decrypting as it goes — same `StreamingResponse` mechanism this app already uses for CSV exports,
just with a true streaming generator instead of a one-shot in-memory buffer. Memory use stays
bounded to about one chunk regardless of file size. Blocked with a clear error unless
`scan_status == clean`.

File deletion (Administrator-only — see §3) removes the database record first, then deletes the
on-disk encrypted file — never the other order, so a failed database delete can never leave an
orphaned, undeleted blob with no trace of it anywhere.

---

## 2a. Malware Scanning (ClamAV)

Reusing a pattern this project already relies on for a different reason: **Ollama (the AI
assistant's LLM) runs natively on the host instead of in Docker, specifically because this host
cannot pull Docker images from any registry** — confirmed directly, not assumed, when rebuilding
the `iop-api` image hit the same wall. A container-based scanner (e.g. the official ClamAV Docker
image) would almost certainly hit that identical wall. Native install sidesteps it entirely.

- **Install ClamAV as an OS package** (`dnf install clamav clamav-update clamd` — this host is
  RHEL-family) rather than as a container. Package-manager traffic goes through a different HTTP
  client than Docker's registry puller, so it's plausibly not blocked by the same firewall rule —
  the same reasoning that let the CA-trust fix restore normal `curl`/`dnf` traffic even while
  Docker pulls stayed blocked. **Verify this directly before relying on it**, the same way the
  registry block itself had to be confirmed with real tests rather than assumed.
- Run `clamd` as a systemd service, network-isolated the same way Ollama already is: bound only to
  the Docker bridge gateway address, reachable from `iop-api` but not from the public interface.
- **Scanning is asynchronous** — the upload HTTP request returns as soon as the file is fully
  written to a temp location and the `pending` record exists; the actual scan runs as a background
  task afterward (see the revised upload flow in §2). This matters concretely: scanning a 250MB
  file takes real time on this host's hardware, and tying that to the HTTP request/response cycle
  would risk the request itself timing out (nginx's upload-path timeout, §5, only needs to cover
  the transfer, not the scan). A `scan_failed` result (e.g. `clamd` unreachable) leaves the file
  blocked rather than failing open — a down scanner must never silently skip scanning.
- **What the uploader sees**: for a guest upload specifically, the vendor gets a simple "received"
  confirmation on submit — not a live scan result. Deliberately: scanning may not even be complete
  yet at that point (point above), and not echoing scan-engine signals back to an anonymous,
  unauthenticated submitter avoids giving a real attacker a free oracle for testing whether their
  payload was detected. The actual `scan_status` is only ever visible to the file's owner, in their
  own authenticated Files list.
- **Content-type policy — open decision, not yet made**: ClamAV catches known malware signatures,
  it is not a file-type policy engine. Worth deciding before this ships whether to also outright
  block certain file types regardless of scan result (e.g. `.exe`, `.bat`, `.ps1`, macro-enabled
  Office documents) as defense in depth, particularly for guest uploads. Not decided in this plan —
  flag your preference when ready.
- **Surfacing detections**: an infected-upload audit-log entry on its own just sits there until
  someone queries it. This app already has a nightly "Anomaly Digest" job
  (`scripts/anomaly_digest.py`) that surfaces data-quality signals on the Dashboard — add
  "N infected files blocked in the last 24h" as a new signal there, so a pattern of malicious
  uploads (e.g. from one compromised account) actually gets noticed instead of requiring someone
  to go looking.
- **Definition updates (`freshclam`)**: ClamAV's virus definitions need regular updates from
  ClamAV's own update servers, which is a *different* reachability question from the Docker
  registry block or the general CA-trust fix — **must be tested directly at deployment time**,
  not assumed to work just because other HTTPS traffic now does. If `freshclam` can't reach its
  update servers, scanning still functions but against a stale definition set, which needs its
  own monitoring (e.g. folded into the existing Docker-status-style staleness pattern already used
  elsewhere in this app).

---

## 3. Backend Endpoints

### `backend/app/routers/files.py` (new)

| Method | Path | Who can call it | What it does |
|---|---|---|---|
| GET | `/files` | Viewer+ | List files, searchable by filename/description/tags; excludes other users' `owner_only` files |
| GET | `/files/{id}` | Viewer+ | File metadata only; 403 if `owner_only` and caller isn't the owner/Administrator |
| POST | `/files` | Operator+ | Upload a file |
| GET | `/files/{id}/download` | Viewer+ | Download (decrypted); same `owner_only` check as above |
| PATCH | `/files/{id}` | Operator+ | Edit description/tags |
| DELETE | `/files/{id}` | **Administrator only** | Irreversible, no backup — same risk tier as this app's CSV bulk-import feature |
| GET / POST | `/files/{id}/shares` | Viewer+ / Operator+ | List / create **download** links for an existing file |
| POST | `/files/upload-requests` | Operator+ | Create an **upload** link — see §3a. Does not reference an existing file; nothing has been uploaded yet. |

### `backend/app/routers/shares.py` (new — this is the piece that was documented but never built)

| Method | Path | Who can call it | Notes |
|---|---|---|---|
| POST / GET | `/passwords/{id}/shares` | Operator+ / Viewer+ | Same paths the existing Vault UI already calls — no frontend change needed here |
| DELETE | `/passwords/shares/{id}` | Operator+ | Tightened from what the old docs described (Viewer+), which looked like a mistake — a Viewer shouldn't be able to revoke someone else's share link |
| POST / GET / DELETE | `/files/{id}/shares`, `/files/shares/{id}` | same tiers as above | Same mechanism, for files |
| **GET** | **`/share/{token}`** | **Nobody needs to log in — fully public, BUT internal-network-only for passwords** | Recipient opens this to view/download a shared file or password. See the resource-type-dependent origin check below — this is the fix for the password/external-access mismatch. |
| **POST** | **`/share/{token}/upload`** | **Nobody needs to log in — fully public, reachable from outside the bank's network** | The new piece, see §3a — recipient opens this link and uploads a file *to* the LDAP user who created it. Tighter rate limit than the view endpoint — see §5. |

**Resource-type-dependent access, resolved inside `resolve_public()` itself** (nginx can't tell
link types apart without a database lookup, so it carves out `/share/` generally and the app
enforces the real distinction):
- `resource_type == FILE` → resolvable from anywhere, internal or external.
- `resource_type == PASSWORD_ENTRY` → resolvable **only** if the request's origin, read from the
  same `X-Real-IP`/`X-Forwarded-For` headers nginx already sets, is within the bank's internal
  ranges. An external request for a password-share token gets the same 404 as a token that simply
  doesn't exist — never a distinct "you're not allowed" response, which would otherwise confirm to
  an outside party that a valid-but-restricted token exists at all.

The public endpoints' behavior (matched exactly to what the existing, already-built frontend page
expects, for the download case):
- Returns **404** if the link doesn't exist, OR (per above) if it's a password link accessed from
  outside the internal network.
- Returns **410** if it's expired, been revoked, or hit its use limit.
- Returns **429** if someone's hammering it too fast (rate-limited).
- Using a link safely increments its use counter exactly once per use even under concurrent
  access (no race condition that could let a "one-time" link be used twice).

### `backend/app/services/share_service.py` (new)

One shared service used by password-sharing, file-sharing, and file-upload-requests — create a
link, list links for a resource/owner, revoke a link, resolve a public download token into the
thing it points to, and (new) accept an anonymous upload against an upload-type token.

---

## 3a. Guest Access — Temporary Links, No Accounts

This covers the real-world case the user described: an LDAP-authenticated IOP user needs to
exchange a file with someone who has no IOP account at all (a vendor, typically) — in both
directions.

**Important design decision**: there is **no guest user account, no guest login, no guest
password, anywhere**. A "guest" is nothing more than whoever is holding a valid, unexpired link —
the same mechanism already designed for sharing, just extended to also work in the *upload*
direction, not only download. This was a deliberate choice over a real lightweight guest-account
system: a link is something that can only be *used*, not phished, brute-forced, or reused outside
its intended expiry/use-limit — a username+password pair is all of those things. It also means
there's nothing new to add to LDAP at all, and a "guest" structurally cannot reach anything in IOP
beyond the exact one action its link permits (there's no session, no broader API surface, nothing
else for it to even attempt to reach).

**Vendor → LDAP user (vendor uploads a file for you)**:
1. You (an LDAP-authenticated Operator+ user) create an **upload link** — no file is attached yet,
   since nothing exists to share. You give it a label for your own records (e.g. "VendorX invoice
   request") and an expiry. It always accepts **exactly one** upload, not configurable (§1 — this
   is what keeps the data model unambiguous; need several files from one vendor, create several
   links).
2. You send the link to the vendor by whatever channel you'd normally use (email, etc.) — this app
   never sends it for you.
3. The vendor opens the link in a browser and uploads a file — no username, no password, nothing
   IOP-specific required on their end. They get a simple "received" confirmation, not a live scan
   result (§2a).
4. The upload goes through **exactly the same pipeline as any other upload**: streamed, size-
   capped, scanned by ClamAV asynchronously, then encrypted at rest only once confirmed clean (see
   the revised flow in §2/§2a) — this is the one path in the whole feature where that scan matters
   most, since it's the only way a fully anonymous, unauthenticated party can put bytes into this
   system at all.
5. The resulting file is owned by you, marked `visibility: owner_only` (§1), and shows up in your
   Files list once scanning finishes — not visible to other Viewer+ users, since it's unreviewed
   content from outside the organization.
6. The link is consumed after that one upload (or expires on its time limit, whichever comes
   first) and stops working either way.

**LDAP user → Vendor (you send them a file)**: this direction needed no new design — it's exactly
the already-planned download share link. You upload the file normally, create a download-type
share link for it, send the link. The vendor opens it, no login, downloads it. Same mechanism,
already covered in §3 — and, per the fix above, file-type share links are the ones allowed to work
from outside the bank's network at all; password-type share links are not.

**The one piece of this that deserves the most scrutiny before going live**: the anonymous upload
endpoint is a genuinely new kind of exposure — not just "someone outside the bank can read
something," but "someone outside the bank, with zero credentials, can write data into bank
infrastructure." The existing mitigations (streamed size cap, mandatory malware scan before the
file is ever decrypted/usable, one-use-only links, a tighter upload-specific rate limit than the
view endpoint — see §5, 256-bit token) are the right ones, but I'd treat this specific endpoint as
the one piece of the whole feature that most warrants a second pair of eyes — code review at
minimum — before it's reachable from outside the bank's network.

---

## 3b. File Self-Destruct and Expiry (adopted from reviewing Plik)

Two independent, optional, per-file settings — set at upload time, both default off/never (a file
sticks around forever unless the uploader says otherwise, matching how every other record in this
app already behaves):

- **`delete_after_first_download`**: once the file has been downloaded exactly once by anyone
  with access to it, both the Mongo record and the on-disk encrypted blob are deleted immediately
  (same order already established — database first, then the disk blob). Particularly useful for
  the guest-upload flow: the LDAP owner downloads the vendor's file once, and it's gone — shrinks
  how long externally-sourced content sits on the server at all. This is file-level, distinct from
  a share link's own `max_views: 1` — the link and the underlying file have independent lifetimes
  unless this flag ties them together.
- **`expires_at`**: a new nightly job, `scripts/file_cleanup.sh` (same wrapper-script shape as
  every other nightly job in this project — lock file, log directory, `docker cp` the Python
  script in, `docker exec` it), finds files past their `expires_at` and deletes them (database
  record first, then disk blob, same safe ordering as every other delete path in this plan).
  Scheduled alongside the existing sync jobs in cron.

Both settings are exposed as optional fields in the upload form and the "Request a file" modal —
neither is required, so the default experience is unchanged from everything else already planned.

---

## 3c. Password-Protected Share Links (adopted from reviewing Plik)

An optional extra passphrase on a share link, on top of the token itself — a second factor against
the one real weakness inherent to any link-based sharing model ("whoever holds the link has
access"). Reuses `hash_password`/`verify_password` from `backend/app/core/password.py` (bcrypt,
already used for user accounts) rather than a new hashing scheme.

- When creating a link (download or upload type), the creator can optionally set a passphrase.
  Only the hash is stored (`ShareLink.password_hash`), same as every credential in this app.
- `GET /share/{token}` on a password-protected link returns a minimal "password required"
  response with no content — the recipient submits the passphrase (a new `POST
  /share/{token}/unlock` or equivalent, the exact shape is an implementation detail) before the
  real content/upload-form is returned.
- **This is the one feature in this plan that genuinely requires changing the already-built
  `SharePage.tsx`** — unlike everything else so far, which was deliberately designed to match the
  existing frontend contract with zero changes. Worth being explicit about that trade: this
  specific feature is opt-in (a link without a password set works exactly as already designed,
  no UI change needed for that case), so it only touches `SharePage.tsx` for the specific case a
  link actually has a password — not a regression for every other link.
- Password attempts get their own, separate, tight rate limit (independent of the view/upload
  limits in §5) — brute-forcing a passphrase layered on top of an already-256-bit token is a low
  realistic risk, but a cheap one to close off anyway.

---

## 3d. AI Assistant Integration (adopted from reviewing Plik — built our way, not theirs)

Plik ships a generic MCP server for AI-tool integration. IOP already has something better-fitted
for this: its own purpose-built AI assistant (`backend/app/routers/assistant.py`), with months of
established, working design — real deterministic intent-routing against this app's actual
database, never an LLM asked to state a number or fact it could get wrong (see the assistant's own
extensive design history — fleet-wide stats, own-record IP/hostname lookup, server/Docker status,
all answered from real queries, never guessed). The right move is extending that existing pattern,
not standing up a second, disconnected AI integration path.

New deterministic capabilities to add to `assistant.py`, same shape as everything already there:
- "Do I have any pending upload requests" / "has \<vendor\> uploaded their file yet" — a direct
  query against `share_links` for the caller's own upload-type links and their `view_count`.
- "List my files" / "what files have I uploaded" — direct query against `files`, scoped to the
  caller (respecting `visibility`, same as the real `GET /files` endpoint would).
- "Show me my active share links" — direct query against `share_links` for the caller's own,
  non-revoked, non-expired links.

**Explicitly out of scope**: the assistant does not *perform* uploads or *create* share links via
chat — a text interface has no sensible way to attach a binary file, and creating a share link is
exactly the kind of write action this project's own established principle ("let the LLM narrate,
never let it compute or act") argues against handing to a chat interface. This is a read/query
capability only, matching everything else the assistant already does.

---

## 3e. Open — Not Decided (flagged after reviewing Plik, deliberately left for you)

Two more Plik features that would be real, substantive changes to this plan rather than
straightforward additions — not decided here on purpose:

- **True end-to-end (client-side) encryption**, à la Plik's Age integration. Genuinely stronger
  than this plan's server-side envelope encryption — the server would never hold the decryption
  key at all, versus today's design where it generates and holds every file's key. The real
  tension: it adds friction exactly where this plan went out of its way to remove it (the
  zero-login guest flow) — the recipient needs the passphrase through some separate channel to
  decrypt, which is the opposite of "just click the link." Might make sense for LDAP-user-to-
  LDAP-user sharing specifically, where both sides already have an account and a channel to
  exchange a passphrase; less obviously for the vendor-upload case this plan was built around.
- **"Stream mode"** (uploader and downloader connected directly, nothing ever persisted). I'd
  actively recommend against this one rather than stay neutral: it's incompatible with the
  mandatory malware-scan-before-release requirement already locked into this plan, since there's
  no file left to scan if nothing is ever stored. Adopting it would mean carving out a scan-exempt
  fast path, which doesn't fit a bank's risk posture.

---

## 4. Frontend

**New Files feature**: a new `/files` page (table of uploaded files, upload button, download/
delete actions) reachable from the sidebar, built the same way every other page in this app is
built — same API-client pattern, same table/modal conventions already used for IP Records. The
upload form gets two new optional fields (§3b): "delete after first download" (checkbox) and
"expires after" (optional date). Add a **"Request a file"** button alongside the existing
"Upload" button, which creates an upload link instead of uploading directly — opens a small modal
(label, expiry, optional passphrase — §3c) and returns the link to copy/send, same UX shape as
the existing `ShareModal.tsx` for download links. A new, minimal public page (e.g.
`/upload/:token`, lazy-loaded outside `AppLayout`, same pattern as the existing `SharePage.tsx`)
is what the vendor actually sees — just a drag-and-drop upload box, no app chrome, no login
prompt, and a plain "received" confirmation after submit (not a live scan result — §2a).

**Fixing the existing broken Share Links** — deliberately minimal changes here, because the
*existing* frontend code (`ShareModal.tsx`, `SharePage.tsx`) already expects a specific shape;
the new backend is built to match what's already there rather than changing working frontend
code:
- The password-sharing modal needs **no changes at all** for its existing functionality — it
  already calls exactly the right paths with exactly the right payload shape. It gains one new
  optional field (an "add a passphrase" toggle, §3c) when creating a link.
- The public share-viewing page needs a small addition to also handle the *file* case (today it
  only knows how to render a shared password), and a second small addition for the
  password-protected case (§3c) — a passphrase prompt shown only when a link actually has one set,
  no change to the experience for every other link.

---

## 5. Nginx Changes

- Raise the global upload size limit from 5MB to 250MB.
- Add a dedicated routing block for file upload/download traffic with a longer timeout (large
  transfers take longer than a typical API call).
- **The one genuinely risky change**: today, this entire app is only reachable from inside the
  bank's network — an IP allowlist blocks everything else with a 403. Share links need to work for
  people *outside* that network, so the two public share-link paths get carved out of that
  allowlist at the nginx level (nothing else changes) — **but nginx can't tell a password-share
  token from a file-share token apart without a database lookup, so the carve-out is necessarily
  path-based, not type-based.** The actual password-vs-file distinction is enforced one layer up,
  inside the application (§3) — nginx's job here is just to let the request through to the app at
  all; the app then decides whether this particular token is even allowed to be resolved from an
  external origin.
- **Two separate rate-limit zones for the carved-out paths, not one**: a tighter zone for
  `/share/{token}` (viewing/downloading something that already exists) and a *tighter still* zone
  for `/share/{token}/upload` specifically (e.g. ~5/minute vs. ~20/minute) — uploads cost real
  storage, bandwidth, and a ClamAV scan per request, so the same limit that's reasonable for a
  cheap read is too loose for a write. Both sit on top of the app-level `slowapi` limits as a
  second, independent layer of defense.
- Needs confirming, before going live, that the hostname used in a share link is actually
  resolvable by someone outside the bank's network at all (an internal-only DNS entry would
  quietly defeat the whole point even if the nginx rule is correct).

---

## 6. Docker Compose Changes

A new storage location needs to be mounted into the API container. Important: it must **not** go
on `/opt` (where this app's deployment currently lives) — that disk volume is only 500MB. It
needs to go on `/data`, the same large disk already used for this server's AI model files, which
has plenty of room.

---

## 7. Deployment Sequence (do not skip or reorder any step)

1. All code changes land in the repo first.
2. On the server, install and start ClamAV natively (§2a) — **before** anything else, so the
   scan step actually has something to call once uploads start working. Confirm `clamd` is
   reachable from inside the `iop-api` container over the internal bridge, and separately confirm
   whether `freshclam` can reach ClamAV's update servers (test directly, don't assume).
3. On the server, create the new file-storage directory with restrictive permissions.
4. Apply the Docker Compose change — this **recreates** the API container, which, due to the
   constraint explained above, reverts it to the stale April image and wipes out every feature
   patched in since.
5. **Immediately** copy the *entire* current backend source tree back into the freshly recreated
   container (not just the new files from this plan) to restore everything that only ever lived
   in the old container's writable layer.
6. Spot-check a handful of files inside the container against the local repo to make sure that
   copy actually succeeded in full.
7. A plain restart (not another recreate) to start clean under the new storage mount with the
   restored code.
8. Run the backend's automated test suite.
9. Confirm the app is healthy and spot-check one already-working feature, to make sure nothing
   was silently lost in the restore.
10. Apply the new database collections/indexes by hand (since the init script only runs once, on
    a brand-new empty database).
11. Reload nginx to pick up its config changes (no rebuild needed).
12. Install the new `scripts/file_cleanup.sh` nightly cron job (§3b) alongside the existing sync
    jobs — same wrapper-script/lock-file/log-directory pattern as everything else already in cron.
13. Run the full verification plan below.

---

## 8. Verification Plan

1. Upload a file as an Operator-role user; confirm no encryption keys leak into the API response.
2. On the server, look at the stored file directly — confirm it is genuinely unreadable, not
   plaintext.
3. Download it back and confirm it's byte-for-byte identical to the original (checksum match).
4. Upload the standard **EICAR test file** (a harmless, industry-standard string every antivirus
   recognizes as "virus" for testing purposes — not real malware) and confirm: `scan_status`
   flips to `infected`, the file is deleted automatically, it cannot be downloaded or shared, and
   an audit-log entry records the detection.
5. Upload a normal, clean file and confirm `scan_status` flips to `clean` and only then becomes
   downloadable/shareable — confirm it's genuinely blocked (not just "not yet shown in the UI")
   while `scan_status` is still `pending`.
6. Stop the `clamd` service, upload a file, confirm it lands in `scan_failed` (blocked) rather
   than silently skipping the scan and becoming available anyway — a down scanner must fail
   closed, not open. Restart `clamd` afterward.
7. Create share links for both a file and an existing password entry.
8. Open the **file** share link with no login at all, from a connection outside the bank's
   network if at all possible — to actually prove the external-access change works for files, not
   just that the logic is correct.
8a. **Password link stays internal-only**: open the **password** share link's token from a
    connection outside the bank's network → must get the same 404 a nonexistent token would get,
    never a distinct "forbidden" response. Then open the same token from inside the network → 200,
    works normally. This is the fix for the password/external-access mismatch — verify it
    explicitly, since getting this wrong means either passwords leak externally or the password
    feature silently breaks for everyone.
8b. **Guest upload flow**: as an LDAP user, create an upload link (always exactly one use). From
    an anonymous session with no auth header at all, upload a file through it — confirm it
    succeeds, returns a plain "received" response with no scan result, the resulting file is owned
    by the LDAP user who created the link with `visibility: owner_only`, is genuinely invisible to
    a different Viewer+ user's file list, and only becomes downloadable once the background scan
    finishes and reports clean. Confirm the link rejects a second upload attempt. Confirm `POST
    /share/{token}/upload` against a *download*-type token (or vice versa) is correctly rejected.
9. Confirm an expired link returns a clean "expired" response, not a server error.
10. Confirm revoking a link immediately breaks it.
11. Confirm a "view once" link can't be opened twice, even by two simultaneous requests.
12. Confirm rate limiting kicks in under rapid repeated requests — separately verify the upload
    endpoint's tighter limit kicks in sooner than the view endpoint's looser one.
13. Check the audit log for upload/download/share-create/share-view/share-revoke/delete/malware-
    detected entries, and confirm none of them ever contain raw encryption keys or share tokens.
14. Confirm role permissions are enforced correctly (a Viewer can download but not upload or
    delete; only an Administrator can delete).
15. Upload a large (~200MB) file through the real public web address (not directly to the
    backend) to confirm the new size limit actually took effect end-to-end, and confirm the
    upload request returns promptly rather than blocking until the scan completes (proves scanning
    is genuinely asynchronous, not just described that way).
16. Confirm the nightly Anomaly Digest picks up a deliberately-triggered infected-upload count
    from step 4.
17. **Self-destruct**: upload a file with `delete_after_first_download` set, download it once,
    confirm both the Mongo record and the on-disk blob are gone immediately afterward, and that a
    second download attempt gets a clean "not found," not an error.
18. **TTL cleanup**: upload a file with `expires_at` in the near future, wait (or manually run
    `file_cleanup.sh`), confirm it's deleted on schedule — and confirm a file with no `expires_at`
    set is *not* touched by the same run (default-forever must stay the default).
19. **Password-protected link**: create a download link with a passphrase set, confirm the public
    endpoint refuses content without it, confirm it works with the correct passphrase, confirm
    repeated wrong guesses get rate-limited, and confirm a link created *without* a passphrase is
    completely unaffected (no prompt, no behavior change).
20. **Assistant queries**: as the LDAP user who created an upload link, ask the assistant "has
    \<vendor label\> uploaded their file yet" and confirm it answers correctly and only from real
    data (no answer before the upload, correct answer after) — and confirm it never attempts to
    create a link or accept an upload itself, only answers questions.
21. Full automated test suite passes, including new tests for the encryption logic itself.

---

## What this plan does *not* cover (open for a later conversation)

- **Content-type policy on top of antivirus scanning** — whether to outright block certain file
  types (executables, scripts, macro-enabled Office documents) regardless of what ClamAV says,
  especially for guest uploads. Not decided here; flag your preference when ready (§2a).
- A later decision to tighten file visibility further (e.g. per-uploader or per-group access for
  *normal* uploads too) if "any Viewer+ sees any normally-uploaded file" turns out to be too broad
  in practice — guest-uploaded files are already private by default (§1/§3a), this is only about
  the normal upload path.
- **True end-to-end (client-side) encryption and "stream mode"** — see §3e; both deliberately left
  as open decisions rather than adopted or rejected outright.
- Actually rebuilding the stale Docker image properly, which remains a separate, already-known,
  unresolved issue in this project.
