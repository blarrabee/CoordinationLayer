const Database = require('better-sqlite3');
const path = require('path');

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

    CREATE INDEX IF NOT EXISTS idx_updates_channel ON updates(channel_id);
    CREATE INDEX IF NOT EXISTS idx_updates_type ON updates(update_type);
    CREATE INDEX IF NOT EXISTS idx_updates_timestamp ON updates(timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_channel_a ON opportunity_alerts(channel_a);
    CREATE INDEX IF NOT EXISTS idx_alerts_channel_b ON opportunity_alerts(channel_b);
  `);

  // Seed default channels
  const channels = ['Blaise', 'Alex', 'Joey', 'Matt', 'Sam', 'Kayla', 'Mia', 'Devon', 'Kinsey'];
  const insertChannel = db.prepare(`
    INSERT OR IGNORE INTO channels (id, name) VALUES (?, ?)
  `);
  for (const name of channels) {
    insertChannel.run(name.toLowerCase(), name);
  }
}

module.exports = { getDb };
