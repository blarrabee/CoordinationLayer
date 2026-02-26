const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'coordination.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS updates (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      update_type TEXT NOT NULL CHECK(update_type IN ('crm_change','email_insight','deal_update','action_item','note')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      location TEXT,
      related_contacts TEXT,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (channel_id) REFERENCES channels(id)
    );

    CREATE TABLE IF NOT EXISTS opportunity_alerts (
      id TEXT PRIMARY KEY,
      update_id_a TEXT NOT NULL,
      update_id_b TEXT NOT NULL,
      channel_a TEXT NOT NULL,
      channel_b TEXT NOT NULL,
      match_reason TEXT NOT NULL,
      match_details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_read INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (update_id_a) REFERENCES updates(id),
      FOREIGN KEY (update_id_b) REFERENCES updates(id)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      label TEXT NOT NULL,
      channel_name TEXT,
      role TEXT NOT NULL DEFAULT 'agent' CHECK(role IN ('admin','agent','readonly')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT 'system'
    );

    CREATE INDEX IF NOT EXISTS idx_updates_channel ON updates(channel_id);
    CREATE INDEX IF NOT EXISTS idx_updates_type ON updates(update_type);
    CREATE INDEX IF NOT EXISTS idx_updates_timestamp ON updates(timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_channel_a ON opportunity_alerts(channel_a);
    CREATE INDEX IF NOT EXISTS idx_alerts_channel_b ON opportunity_alerts(channel_b);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);
  `);

  // Seed default channels
  const channels = ['Blaise', 'Alex', 'Joey', 'Matt', 'Sam', 'Kayla', 'Mia', 'Devon', 'Kinsey'];
  const insertChannel = db.prepare(`
    INSERT OR IGNORE INTO channels (id, name) VALUES (?, ?)
  `);
  for (const name of channels) {
    insertChannel.run(name.toLowerCase(), name);
  }

  // Seed admin key if none exists
  const existingAdmin = db.prepare(`SELECT id FROM api_keys WHERE role = 'admin' AND is_active = 1`).get();
  if (!existingAdmin) {
    const { rawKey, keyHash, keyPrefix } = generateKeyParts('admin');
    db.prepare(`
      INSERT INTO api_keys (id, key_hash, key_prefix, label, channel_name, role, created_by)
      VALUES (?, ?, ?, ?, NULL, 'admin', 'system')
    `).run(crypto.randomUUID(), keyHash, keyPrefix, 'Admin Key');
    // Store plaintext temporarily in a file so it can be read once on first boot
    const fs = require('fs');
    const keyFile = path.join(__dirname, '.admin_key_init');
    if (!fs.existsSync(keyFile)) {
      fs.writeFileSync(keyFile, rawKey, 'utf8');
      console.log('\n╔══════════════════════════════════════════════════════╗');
      console.log('║         ADMIN API KEY (save this — shown once)       ║');
      console.log(`║  ${rawKey}  ║`);
      console.log('╚══════════════════════════════════════════════════════╝\n');
    }
  }
}

/**
 * Generate a new API key: trux_<role_prefix>_<32 random hex chars>
 * Returns { rawKey, keyHash, keyPrefix }
 */
function generateKeyParts(role = 'agent') {
  const prefix = role === 'admin' ? 'adm' : role === 'readonly' ? 'ro' : 'agt';
  const secret = crypto.randomBytes(24).toString('hex');
  const rawKey = `trux_${prefix}_${secret}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 14); // "trux_agt_ab12c" for display
  return { rawKey, keyHash, keyPrefix };
}

/**
 * Validate an API key from a request. Returns the key record or null.
 */
function validateApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;
  const db = getDb();
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const record = db.prepare(`
    SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1
  `).get(keyHash);
  if (record) {
    // Update last_used_at (fire and forget)
    db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(record.id);
  }
  return record || null;
}

module.exports = { getDb, generateKeyParts, validateApiKey };
