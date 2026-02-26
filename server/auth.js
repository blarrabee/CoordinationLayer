const { validateApiKey } = require('./db');

/**
 * Extract raw API key from request.
 * Accepts: Authorization: Bearer <key>  OR  X-API-Key: <key>  OR  ?api_key=<key>
 */
function extractKey(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.headers['x-api-key']) {
    return req.headers['x-api-key'].trim();
  }
  if (req.query.api_key) {
    return req.query.api_key.trim();
  }
  return null;
}

/**
 * Middleware: require a valid API key.
 * Attaches req.apiKey (the key record) to the request.
 */
function requireAuth(req, res, next) {
  const rawKey = extractKey(req);
  if (!rawKey) {
    return res.status(401).json({
      error: 'API key required',
      hint: 'Pass your key via: Authorization: Bearer <key>  or  X-API-Key: <key>',
    });
  }
  const keyRecord = validateApiKey(rawKey);
  if (!keyRecord) {
    return res.status(403).json({ error: 'Invalid or revoked API key' });
  }
  req.apiKey = keyRecord;
  next();
}

/**
 * Middleware: require admin role.
 * Must be used AFTER requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.apiKey || req.apiKey.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required for this endpoint' });
  }
  next();
}

/**
 * Middleware: require that the caller's channel_name matches the target channel,
 * OR that the caller is an admin.
 * Used for write operations (POST to a channel).
 */
function requireChannelAccess(req, res, next) {
  if (!req.apiKey) return res.status(401).json({ error: 'Not authenticated' });
  if (req.apiKey.role === 'admin') return next(); // admins can write to any channel
  if (req.apiKey.role === 'readonly') {
    return res.status(403).json({ error: 'Read-only key cannot post updates' });
  }
  // Agent: must own the target channel
  const targetChannel = (req.params.channel || '').toLowerCase();
  const keyChannel = (req.apiKey.channel_name || '').toLowerCase();
  if (keyChannel !== targetChannel) {
    return res.status(403).json({
      error: `This key is scoped to channel "${req.apiKey.channel_name}" — cannot post to "${req.params.channel}"`,
    });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireChannelAccess };
