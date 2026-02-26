require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const { getDb } = require('./db');
const { runAlignmentCheck } = require('./alignmentEngine');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// ─── Serve React frontend in production ──────────────────────────────────────
const DIST_PATH = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(DIST_PATH));

// ─── Helper: parse array field (JSON array or comma-separated string) ─────────
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

// ─── Validation ───────────────────────────────────────────────────────────────
const VALID_TYPES = ['crm_change', 'email_insight', 'deal_update', 'action_item', 'note'];

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'TruxParking Agent Coordination Layer', timestamp: new Date().toISOString() });
});

/**
 * GET /api/channels
 * List all available channels
 */
app.get('/api/channels', (req, res) => {
  try {
    const db = getDb();
    const channels = db.prepare('SELECT * FROM channels ORDER BY name').all();
    res.json({ channels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

/**
 * POST /api/channels/:channel/updates
 * Push a new update to a channel
 * Body: { update_type, title, body, location?, related_contacts?, tags? }
 */
app.post('/api/channels/:channel/updates', (req, res) => {
  try {
    const db = getDb();
    const channelName = req.params.channel;

    // Find channel (case-insensitive)
    const channel = db.prepare('SELECT * FROM channels WHERE lower(name) = lower(?)').get(channelName);
    if (!channel) {
      return res.status(404).json({ error: `Channel "${channelName}" not found. Valid channels: Blaise, Alex, Joey, Matt, Sam, Kayla, Mia, Devon, Kinsey` });
    }

    const { update_type, title, body, location, related_contacts, tags } = req.body;

    // Validate required fields
    if (!update_type || !title || !body) {
      return res.status(400).json({ error: 'Required fields: update_type, title, body' });
    }
    if (!VALID_TYPES.includes(update_type)) {
      return res.status(400).json({ error: `update_type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const id = uuidv4();
    const timestamp = new Date().toISOString();

    const insert = db.prepare(`
      INSERT INTO updates (id, channel_id, channel_name, timestamp, update_type, title, body, location, related_contacts, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      id,
      channel.id,
      channel.name,
      timestamp,
      update_type,
      title,
      body,
      location || null,
      parseArrayField(related_contacts),
      parseArrayField(tags)
    );

    const newUpdate = db.prepare('SELECT * FROM updates WHERE id = ?').get(id);

    // Run alignment engine asynchronously (don't block response)
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
 * Pull updates from a specific channel
 * Query params: type, since, until, keyword, limit, offset
 */
app.get('/api/channels/:channel/updates', (req, res) => {
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
      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
      }
      query += ' AND update_type = ?';
      params.push(type);
    }
    if (since) {
      query += ' AND datetime(timestamp) >= datetime(?)';
      params.push(since);
    }
    if (until) {
      query += ' AND datetime(timestamp) <= datetime(?)';
      params.push(until);
    }
    if (keyword) {
      query += ' AND (lower(title) LIKE lower(?) OR lower(body) LIKE lower(?) OR lower(tags) LIKE lower(?))';
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const updates = db.prepare(query).all(...params);

    // Count total for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM updates WHERE channel_id = ?';
    const countParams = [channel.id];
    if (type) { countQuery += ' AND update_type = ?'; countParams.push(type); }
    if (since) { countQuery += ' AND datetime(timestamp) >= datetime(?)'; countParams.push(since); }
    if (until) { countQuery += ' AND datetime(timestamp) <= datetime(?)'; countParams.push(until); }
    if (keyword) {
      countQuery += ' AND (lower(title) LIKE lower(?) OR lower(body) LIKE lower(?) OR lower(tags) LIKE lower(?))';
      const kw = `%${keyword}%`;
      countParams.push(kw, kw, kw);
    }
    const { total } = db.prepare(countQuery).get(...countParams);

    res.json({
      channel: channel.name,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      updates: updates.map(formatUpdate),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch updates' });
  }
});

/**
 * GET /api/updates
 * Pull updates from ALL channels with optional filters
 * Query params: channel, type, since, until, keyword, limit, offset
 */
app.get('/api/updates', (req, res) => {
  try {
    const db = getDb();
    const { channel, type, since, until, keyword, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM updates WHERE 1=1';
    const params = [];

    if (channel) {
      query += ' AND lower(channel_name) = lower(?)';
      params.push(channel);
    }
    if (type) {
      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
      }
      query += ' AND update_type = ?';
      params.push(type);
    }
    if (since) {
      query += ' AND datetime(timestamp) >= datetime(?)';
      params.push(since);
    }
    if (until) {
      query += ' AND datetime(timestamp) <= datetime(?)';
      params.push(until);
    }
    if (keyword) {
      query += ' AND (lower(title) LIKE lower(?) OR lower(body) LIKE lower(?) OR lower(tags) LIKE lower(?))';
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw);
    }

    let countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const { total } = db.prepare(countQuery).get(...params);

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const updates = db.prepare(query).all(...params);

    res.json({
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      updates: updates.map(formatUpdate),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch updates' });
  }
});

/**
 * GET /api/alerts
 * Get opportunity alerts, optionally filtered by channel
 * Query params: channel, unread_only, limit, offset
 */
app.get('/api/alerts', (req, res) => {
  try {
    const db = getDb();
    const { channel, unread_only, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM opportunity_alerts WHERE 1=1';
    const params = [];

    if (channel) {
      query += ' AND (lower(channel_a) = lower(?) OR lower(channel_b) = lower(?))';
      params.push(channel, channel);
    }
    if (unread_only === 'true') {
      query += ' AND is_read = 0';
    }

    let countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const { total } = db.prepare(countQuery).get(...params);

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const alerts = db.prepare(query).all(...params);

    res.json({
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      alerts: alerts.map(formatAlert),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

/**
 * PATCH /api/alerts/:id/read
 * Mark an alert as read
 */
app.patch('/api/alerts/:id/read', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('UPDATE opportunity_alerts SET is_read = 1 WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark alert as read' });
  }
});

/**
 * PATCH /api/alerts/read-all
 * Mark all alerts as read (optionally for a specific channel)
 */
app.patch('/api/alerts/read-all', (req, res) => {
  try {
    const db = getDb();
    const { channel } = req.query;
    let query = 'UPDATE opportunity_alerts SET is_read = 1 WHERE is_read = 0';
    const params = [];
    if (channel) {
      query += ' AND (lower(channel_a) = lower(?) OR lower(channel_b) = lower(?))';
      params.push(channel, channel);
    }
    const result = db.prepare(query).run(...params);
    res.json({ success: true, marked_read: result.changes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark alerts as read' });
  }
});

/**
 * GET /api/stats
 * Summary statistics for the dashboard
 */
app.get('/api/stats', (req, res) => {
  try {
    const db = getDb();

    const totalUpdates = db.prepare('SELECT COUNT(*) as count FROM updates').get().count;
    const totalAlerts = db.prepare('SELECT COUNT(*) as count FROM opportunity_alerts').get().count;
    const unreadAlerts = db.prepare('SELECT COUNT(*) as count FROM opportunity_alerts WHERE is_read = 0').get().count;

    const updatesByChannel = db.prepare(`
      SELECT channel_name, COUNT(*) as count
      FROM updates
      GROUP BY channel_name
      ORDER BY count DESC
    `).all();

    const updatesByType = db.prepare(`
      SELECT update_type, COUNT(*) as count
      FROM updates
      GROUP BY update_type
      ORDER BY count DESC
    `).all();

    const recentActivity = db.prepare(`
      SELECT channel_name, MAX(timestamp) as last_active
      FROM updates
      GROUP BY channel_name
      ORDER BY last_active DESC
    `).all();

    res.json({
      total_updates: totalUpdates,
      total_alerts: totalAlerts,
      unread_alerts: unreadAlerts,
      updates_by_channel: updatesByChannel,
      updates_by_type: updatesByType,
      recent_activity: recentActivity,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * DELETE /api/updates/:id
 * Delete a specific update
 */
app.delete('/api/updates/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM updates WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Update not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete update' });
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
  try { return JSON.parse(val); } catch { return []; }
}

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`TruxParking Agent Coordination Layer running on port ${PORT}`);
  getDb(); // Initialize DB on startup
});

module.exports = app;
