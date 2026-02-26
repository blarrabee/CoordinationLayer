require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const { getDb, generateKeyParts, validateApiKey } = require('./db');
const { runAlignmentCheck } = require('./alignmentEngine');
const { requireAuth, requireAdmin, requireChannelAccess } = require('./auth');
const { generateSystemPrompt, generateDigest } = require('./agentInstructions');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// ─── Serve React frontend in production ──────────────────────────────────────
const DIST_PATH = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(DIST_PATH));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseArrayField(val) {
  if (!val) return null;
  if (Array.isArray(val)) return JSON.stringify(val);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(Array.isArray(parsed) ? parsed : [parsed]);
    } catch {
      return JSON.stringify(val.split(',').map(s => s.trim()).filter(Boolean));
    }
  }
  return null;
}

const VALID_TYPES = ['crm_change', 'email_insight', 'deal_update', 'action_item', 'note'];

// ─── Public Routes (no auth) ──────────────────────────────────────────────────

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TruxParking Agent Coordination Layer',
    timestamp: new Date().toISOString(),
    auth: 'API key required for all data endpoints',
  });
});

// ─── API Key Management ───────────────────────────────────────────────────────

/**
 * POST /api/keys
 * Create a new API key.
 * Admin: can create any role for any channel.
 * Body: { label, channel_name?, role? }
 */
app.post('/api/keys', requireAuth, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { label, channel_name, role = 'agent' } = req.body;

    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      return res.status(400).json({ error: 'label is required' });
    }
    if (!['admin', 'agent', 'readonly'].includes(role)) {
      return res.status(400).json({ error: 'role must be: admin, agent, or readonly' });
    }

    // Validate channel if provided
    if (channel_name) {
      const ch = db.prepare('SELECT id FROM channels WHERE lower(name) = lower(?)').get(channel_name);
      if (!ch) {
        return res.status(404).json({ error: `Channel "${channel_name}" not found` });
      }
    }

    const { rawKey, keyHash, keyPrefix } = generateKeyParts(role);
    const id = uuidv4();

    db.prepare(`
      INSERT INTO api_keys (id, key_hash, key_prefix, label, channel_name, role, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, keyHash, keyPrefix, label.trim(), channel_name || null, role, req.apiKey.label);

    res.status(201).json({
      success: true,
      message: 'Save this key — it will not be shown again.',
      key: rawKey,
      key_prefix: keyPrefix,
      id,
      label: label.trim(),
      channel_name: channel_name || null,
      role,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

/**
 * GET /api/keys
 * List all API keys (hashes hidden, prefix shown).
 * Admin only.
 */
app.get('/api/keys', requireAuth, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const keys = db.prepare(`
      SELECT id, key_prefix, label, channel_name, role, created_at, last_used_at, is_active, created_by
      FROM api_keys
      ORDER BY created_at DESC
    `).all();
    res.json({ keys });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list keys' });
  }
});

/**
 * DELETE /api/keys/:id
 * Revoke (deactivate) an API key. Admin only.
 */
app.delete('/api/keys/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare(`UPDATE api_keys SET is_active = 0 WHERE id = ?`).run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Key not found' });
    }
    res.json({ success: true, message: 'Key revoked' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to revoke key' });
  }
});

/**
 * GET /api/keys/me
 * Return info about the current key (any authenticated user).
 */
app.get('/api/keys/me', requireAuth, (req, res) => {
  const { id, key_prefix, label, channel_name, role, created_at, last_used_at } = req.apiKey;
  res.json({ id, key_prefix, label, channel_name, role, created_at, last_used_at });
});

// ─── Agent Instructions ───────────────────────────────────────────────────────

/**
 * GET /api/instructions/:channel
 * Returns the full system prompt for an agent to paste into their AI.
 * The caller must be admin OR own the channel.
 */
app.get('/api/instructions/:channel', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const channelName = req.params.channel;

    const channel = db.prepare('SELECT * FROM channels WHERE lower(name) = lower(?)').get(channelName);
    if (!channel) {
      return res.status(404).json({ error: `Channel "${channelName}" not found` });
    }

    // Auth: admin or own channel
    const callerChannel = (req.apiKey.channel_name || '').toLowerCase();
    if (req.apiKey.role !== 'admin' && callerChannel !== channelName.toLowerCase()) {
      return res.status(403).json({ error: 'You can only fetch instructions for your own channel' });
    }

    const keyDisplay = req.apiKey.role === 'admin'
      ? '[ADMIN KEY — use the agent\'s own key here]'
      : `${req.apiKey.key_prefix}...`;

    const prompt = generateSystemPrompt(channel.name, keyDisplay, BASE_URL);

    res.json({
      channel: channel.name,
      system_prompt: prompt,
      usage_note: 'Paste the system_prompt into your AI agent\'s system instructions. The key shown is masked — replace with the full key when configuring the agent.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate instructions' });
  }
});

/**
 * GET /api/instructions/:channel/text
 * Returns the raw system prompt as plain text (easier to copy).
 */
app.get('/api/instructions/:channel/text', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const channelName = req.params.channel;

    const channel = db.prepare('SELECT * FROM channels WHERE lower(name) = lower(?)').get(channelName);
    if (!channel) {
      return res.status(404).send(`Channel "${channelName}" not found`);
    }

    const callerChannel = (req.apiKey.channel_name || '').toLowerCase();
    if (req.apiKey.role !== 'admin' && callerChannel !== channelName.toLowerCase()) {
      return res.status(403).send('You can only fetch instructions for your own channel');
    }

    const keyDisplay = req.apiKey.role === 'admin'
      ? '[REPLACE WITH AGENT KEY]'
      : `${req.apiKey.key_prefix}...`;

    const prompt = generateSystemPrompt(channel.name, keyDisplay, BASE_URL);
    res.type('text/plain').send(prompt);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to generate instructions');
  }
});

// ─── Daily Digest ─────────────────────────────────────────────────────────────

/**
 * GET /api/digest/:channel
 * Returns a token-optimized digest for an agent:
 * - Their recent updates
 * - Unread opportunity alerts
 * - Team activity in their active markets
 * - Team-wide last 24h summary
 */
app.get('/api/digest/:channel', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const channelName = req.params.channel;

    const channel = db.prepare('SELECT * FROM channels WHERE lower(name) = lower(?)').get(channelName);
    if (!channel) {
      return res.status(404).json({ error: `Channel "${channelName}" not found` });
    }

    // Auth: admin or own channel
    const callerChannel = (req.apiKey.channel_name || '').toLowerCase();
    if (req.apiKey.role !== 'admin' && callerChannel !== channelName.toLowerCase()) {
      return res.status(403).json({ error: 'You can only fetch your own digest' });
    }

    const digest = generateDigest(channel.name);
    res.json(digest);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate digest' });
  }
});

// ─── Channels ─────────────────────────────────────────────────────────────────

/**
 * GET /api/channels
 */
app.get('/api/channels', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const channels = db.prepare('SELECT * FROM channels ORDER BY name').all();
    res.json({ channels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// ─── Updates ─────────────────────────────────────────────────────────────────

/**
 * POST /api/channels/:channel/updates
 */
app.post('/api/channels/:channel/updates', requireAuth, requireChannelAccess, (req, res) => {
  try {
    const db = getDb();
    const channelName = req.params.channel;

    const channel = db.prepare('SELECT * FROM channels WHERE lower(name) = lower(?)').get(channelName);
    if (!channel) {
      return res.status(404).json({ error: `Channel "${channelName}" not found. Valid channels: Blaise, Alex, Joey, Matt, Sam, Kayla, Mia, Devon, Kinsey` });
    }

    const { update_type, title, body, location, related_contacts, tags } = req.body;

    if (!update_type || !title || !body) {
      return res.status(400).json({ error: 'Required fields: update_type, title, body' });
    }
    if (!VALID_TYPES.includes(update_type)) {
      return res.status(400).json({ error: `update_type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const id = uuidv4();
    const timestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO updates (id, channel_id, channel_name, timestamp, update_type, title, body, location, related_contacts, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, channel.id, channel.name, timestamp, update_type,
      title, body, location || null,
      parseArrayField(related_contacts), parseArrayField(tags)
    );

    const newUpdate = db.prepare('SELECT * FROM updates WHERE id = ?').get(id);

    let opportunityAlerts = [];
    try {
      opportunityAlerts = runAlignmentCheck(newUpdate);
    } catch (alignErr) {
      console.error('Alignment engine error:', alignErr);
    }

    res.status(201).json({
      success: true,
      update: formatUpdate(newUpdate),
      opportunity_alerts: opportunityAlerts,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to post update' });
  }
});

/**
 * GET /api/channels/:channel/updates
 */
app.get('/api/channels/:channel/updates', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const channelName = req.params.channel;

    const channel = db.prepare('SELECT * FROM channels WHERE lower(name) = lower(?)').get(channelName);
    if (!channel) {
      return res.status(404).json({ error: `Channel "${channelName}" not found` });
    }

    const { type, since, until, keyword, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM updates WHERE channel_id = ?';
    const params = [channel.id];

    if (type) {
      if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
      query += ' AND update_type = ?'; params.push(type);
    }
    if (since) { query += ' AND datetime(timestamp) >= datetime(?)'; params.push(since); }
    if (until) { query += ' AND datetime(timestamp) <= datetime(?)'; params.push(until); }
    if (keyword) {
      query += ' AND (lower(title) LIKE lower(?) OR lower(body) LIKE lower(?) OR lower(tags) LIKE lower(?))';
      const kw = `%${keyword}%`; params.push(kw, kw, kw);
    }

    let countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const { total } = db.prepare(countQuery).get(...params);

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const updates = db.prepare(query).all(...params);

    res.json({ channel: channel.name, total, limit: parseInt(limit), offset: parseInt(offset), updates: updates.map(formatUpdate) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch updates' });
  }
});

/**
 * GET /api/updates
 * Cross-channel feed
 */
app.get('/api/updates', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { channel, type, since, until, keyword, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM updates WHERE 1=1';
    const params = [];

    if (channel) { query += ' AND lower(channel_name) = lower(?)'; params.push(channel); }
    if (type) {
      if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
      query += ' AND update_type = ?'; params.push(type);
    }
    if (since) { query += ' AND datetime(timestamp) >= datetime(?)'; params.push(since); }
    if (until) { query += ' AND datetime(timestamp) <= datetime(?)'; params.push(until); }
    if (keyword) {
      query += ' AND (lower(title) LIKE lower(?) OR lower(body) LIKE lower(?) OR lower(tags) LIKE lower(?))';
      const kw = `%${keyword}%`; params.push(kw, kw, kw);
    }

    let countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const { total } = db.prepare(countQuery).get(...params);

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const updates = db.prepare(query).all(...params);

    res.json({ total, limit: parseInt(limit), offset: parseInt(offset), updates: updates.map(formatUpdate) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch updates' });
  }
});

/**
 * DELETE /api/updates/:id
 */
app.delete('/api/updates/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM updates WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Update not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete update' });
  }
});

// ─── Alerts ───────────────────────────────────────────────────────────────────

/**
 * GET /api/alerts
 */
app.get('/api/alerts', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { channel, unread_only, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM opportunity_alerts WHERE 1=1';
    const params = [];

    if (channel) { query += ' AND (lower(channel_a) = lower(?) OR lower(channel_b) = lower(?))'; params.push(channel, channel); }
    if (unread_only === 'true') { query += ' AND is_read = 0'; }

    let countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const { total } = db.prepare(countQuery).get(...params);

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const alerts = db.prepare(query).all(...params);

    res.json({ total, limit: parseInt(limit), offset: parseInt(offset), alerts: alerts.map(formatAlert) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

/**
 * PATCH /api/alerts/:id/read
 */
app.patch('/api/alerts/:id/read', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('UPDATE opportunity_alerts SET is_read = 1 WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Alert not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark alert as read' });
  }
});

/**
 * PATCH /api/alerts/read-all
 */
app.patch('/api/alerts/read-all', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { channel } = req.query;
    let query = 'UPDATE opportunity_alerts SET is_read = 1 WHERE 1=1';
    const params = [];
    if (channel) { query += ' AND (lower(channel_a) = lower(?) OR lower(channel_b) = lower(?))'; params.push(channel, channel); }
    const result = db.prepare(query).run(...params);
    res.json({ success: true, marked_read: result.changes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark alerts as read' });
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * GET /api/stats
 */
app.get('/api/stats', requireAuth, (req, res) => {
  try {
    const db = getDb();

    const totalUpdates = db.prepare('SELECT COUNT(*) as count FROM updates').get().count;
    const totalAlerts = db.prepare('SELECT COUNT(*) as count FROM opportunity_alerts').get().count;
    const unreadAlerts = db.prepare('SELECT COUNT(*) as count FROM opportunity_alerts WHERE is_read = 0').get().count;

    const updatesByChannel = db.prepare(`
      SELECT channel_name, COUNT(*) as count FROM updates GROUP BY channel_name ORDER BY count DESC
    `).all();

    const updatesByType = db.prepare(`
      SELECT update_type, COUNT(*) as count FROM updates GROUP BY update_type ORDER BY count DESC
    `).all();

    const recentActivity = db.prepare(`
      SELECT channel_name, MAX(timestamp) as last_active FROM updates GROUP BY channel_name ORDER BY last_active DESC
    `).all();

    res.json({ total_updates: totalUpdates, total_alerts: totalAlerts, unread_alerts: unreadAlerts, updates_by_channel: updatesByChannel, updates_by_type: updatesByType, recent_activity: recentActivity });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});

// ─── Format helpers ───────────────────────────────────────────────────────────
function formatUpdate(u) {
  return {
    id: u.id,
    channel: u.channel_name,
    timestamp: u.timestamp,
    update_type: u.update_type,
    title: u.title,
    body: u.body,
    location: u.location || null,
    related_contacts: safeParseArray(u.related_contacts),
    tags: safeParseArray(u.tags),
    created_at: u.created_at,
  };
}

function formatAlert(a) {
  let details = {};
  try { details = JSON.parse(a.match_details); } catch {}
  return {
    id: a.id,
    update_id_a: a.update_id_a,
    update_id_b: a.update_id_b,
    channel_a: a.channel_a,
    channel_b: a.channel_b,
    match_reason: a.match_reason,
    message: details.message || '',
    detail: details.detail || '',
    score: details.score || 0,
    update_a_title: details.update_a_title || '',
    update_b_title: details.update_b_title || '',
    created_at: a.created_at,
    is_read: Boolean(a.is_read),
  };
}

function safeParseArray(val) {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return val.split(',').map(s => s.trim()).filter(Boolean);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`TruxParking Agent Coordination Layer running on port ${PORT}`);
});
