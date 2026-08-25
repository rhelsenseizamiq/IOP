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

print("─────────────────────────────────────────");
print("MongoDB initialization complete.");
print("─────────────────────────────────────────");
