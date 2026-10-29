// mongodb/init.js
// Runs once on first container start when the data volume is empty.
// Creates the application user and all required indexes.

// Switch to the ipam database
const db = db.getSiblingDB("ipam");

// ── Create application user (least privilege: readWrite only) ─────────────────
db.createUser({
  user: process.env.MONGO_APP_USER || "ipam_app",
  pwd: process.env.MONGO_APP_PASSWORD || "changeme",
  roles: [{ role: "readWrite", db: "ipam" }],
});

print("✓ Application user created");

// ── users collection ──────────────────────────────────────────────────────────
db.createCollection("users");
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ role: 1 });
db.users.createIndex({ is_active: 1 });
db.users.createIndex({ approval_status: 1 });

print("✓ users indexes created");

// ── subnets collection ────────────────────────────────────────────────────────
db.createCollection("subnets");
// VRF-scoped CIDR uniqueness (null vrf_id = global; two nulls with same cidr = conflict)
db.subnets.createIndex({ vrf_id: 1, cidr: 1 }, { unique: true });
db.subnets.createIndex({ environment: 1 });
db.subnets.createIndex({ parent_id: 1 });
db.subnets.createIndex({ prefix_len: 1 });
db.subnets.createIndex({ vrf_id: 1 });

print("✓ subnets indexes created");

// ── ip_records collection ─────────────────────────────────────────────────────
db.createCollection("ip_records");
// VRF-scoped IP uniqueness (null vrf_id = global)
db.ip_records.createIndex({ vrf_id: 1, ip_address: 1 }, { unique: true });
db.ip_records.createIndex({ subnet_id: 1 });
db.ip_records.createIndex({ status: 1 });
db.ip_records.createIndex({ environment: 1 });
db.ip_records.createIndex({ os_type: 1 });
db.ip_records.createIndex({ status: 1, environment: 1 });
db.ip_records.createIndex({ vrf_id: 1 });
db.ip_records.createIndex({
  hostname: "text",
  description: "text",
  owner: "text",
});

print("✓ ip_records indexes created");

// ── audit_logs collection (append-only, TTL 365 days) ─────────────────────────
db.createCollection("audit_logs");
db.audit_logs.createIndex({ timestamp: -1 });
db.audit_logs.createIndex({ username: 1, timestamp: -1 });
db.audit_logs.createIndex({ resource_type: 1, resource_id: 1 });
db.audit_logs.createIndex({ action: 1 });
// TTL: auto-delete entries older than 365 days
db.audit_logs.createIndex({ timestamp: 1 }, { expireAfterSeconds: 31536000 });

print("✓ audit_logs indexes created (TTL: 365 days)");

// ── token_blocklist collection (TTL: auto-purge expired tokens) ───────────────
db.createCollection("token_blocklist");
db.token_blocklist.createIndex({ jti: 1 }, { unique: true });
// expireAfterSeconds: 0 means delete at the datetime stored in the 'exp' field
db.token_blocklist.createIndex({ exp: 1 }, { expireAfterSeconds: 0 });

print("✓ token_blocklist indexes created");

// ── paloalto_check_logs collection (append-only, TTL 30 days) ─────────────────
db.createCollection("paloalto_check_logs");
db.paloalto_check_logs.createIndex({ checked_at: -1 });
db.paloalto_check_logs.createIndex({ ip_address: 1, checked_at: -1 });
db.paloalto_check_logs.createIndex({ checked_by: 1, checked_at: -1 });
// TTL: auto-delete entries older than 30 days
db.paloalto_check_logs.createIndex(
  { checked_at: 1 },
  { expireAfterSeconds: 2592000 },
);

print("✓ paloalto_check_logs indexes created (TTL: 30 days)");

// ── vrfs collection ───────────────────────────────────────────────────────────
db.createCollection("vrfs");
db.vrfs.createIndex({ name: 1 }, { unique: true });

print("✓ vrfs indexes created");

// ── rirs collection ───────────────────────────────────────────────────────────
db.createCollection("rirs");
db.rirs.createIndex({ name: 1 }, { unique: true });
db.rirs.createIndex({ slug: 1 }, { unique: true });

print("✓ rirs indexes created");

// ── aggregates collection ─────────────────────────────────────────────────────
db.createCollection("aggregates");
db.aggregates.createIndex({ prefix: 1 }, { unique: true });
db.aggregates.createIndex({ rir_id: 1 });
db.aggregates.createIndex({ prefix_len: 1 });

print("✓ aggregates indexes created");

// ── ip_ranges collection ──────────────────────────────────────────────────────
db.createCollection("ip_ranges");
db.ip_ranges.createIndex({ subnet_id: 1 });
db.ip_ranges.createIndex({ subnet_id: 1, start_int: 1, end_int: 1 });
db.ip_ranges.createIndex({ vrf_id: 1 });

print("✓ ip_ranges indexes created");

// ── cabinets collection ───────────────────────────────────────────────────────
db.createCollection("cabinets");
db.cabinets.createIndex({ name: 1 }, { unique: true });
db.cabinets.createIndex({ member_usernames: 1 });

print("✓ cabinets indexes created");

// ── password_entries collection ───────────────────────────────────────────────
db.createCollection("password_entries");
db.password_entries.createIndex({ cabinet_id: 1, created_at: -1 });
db.password_entries.createIndex({ tags: 1 });

// ── folders collection ──────────────────────────────────────────────────────
db.createCollection("folders");
db.folders.createIndex({ cabinet_id: 1 });
db.folders.createIndex({ cabinet_id: 1, parent_id: 1, name: 1 });

print("✓ folders indexes created");

print("✓ password_entries indexes created");

// ── assets collection ─────────────────────────────────────────────────────────
db.createCollection("assets");
db.assets.createIndex({ name: 1 });
db.assets.createIndex({ asset_type: 1 });
db.assets.createIndex({ status: 1 });
db.assets.createIndex({ ip_record_id: 1 });
db.assets.createIndex({ data_center: 1 });
db.assets.createIndex({
  name: "text",
  hostname: "text",
  serial_number: "text",
});

print("✓ assets indexes created");

// ── record_embeddings collection (offline AI assistant search index) ──────────
db.createCollection("record_embeddings");
db.record_embeddings.createIndex(
  { source_collection: 1, source_id: 1 },
  { unique: true },
);

print("✓ record_embeddings indexes created");

// ── assistant_messages collection (per-user AI chat history, append-only) ─────
db.createCollection("assistant_messages");
db.assistant_messages.createIndex({
  username: 1,
  session_id: 1,
  created_at: -1,
});

print("✓ assistant_messages indexes created");

// ── assistant_sessions collection (per-user "current conversation" pointer) ───
// _id is the username itself — default _id index already enforces
// one document per user, no extra index needed.
db.createCollection("assistant_sessions");

print("✓ assistant_sessions collection created");

// ── files collection (encrypted file sharing) ──────────────────────────────
db.createCollection("files");
db.files.createIndex({ created_at: -1 });
db.files.createIndex({ created_by: 1 });
db.files.createIndex({ filename: "text", description: "text" });
db.files.createIndex({ expires_at: 1 });

print("✓ files indexes created");

// ── share_links collection (generic — password entries AND files) ─────────
db.createCollection("share_links");
db.share_links.createIndex({ token: 1 }, { unique: true });
db.share_links.createIndex({ resource_type: 1, resource_id: 1 });
db.share_links.createIndex({ created_by: 1 });
db.share_links.createIndex({ expires_at: 1 });
// Housekeeping purge only — expiry correctness is enforced in application
// code via timezone-aware comparison; this index just stops the collection
// growing forever once a share link is long dead.
db.share_links.createIndex({ created_at: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

print("✓ share_links indexes created");

print("─────────────────────────────────────────");
print("MongoDB initialization complete.");
print("─────────────────────────────────────────");
