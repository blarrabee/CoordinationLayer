/**
 * Agent Instructions Module
 * Generates token-optimized system prompts and daily digest summaries
 * for each team member's AI agent.
 *
 * Design principles:
 *  - No personal information (no phone numbers, emails, addresses, last names)
 *  - Concise structured output to minimize token usage
 *  - Daily digest collapses multiple updates into a single compact summary
 *  - Agents are told exactly what to share and what to omit
 */

const { getDb } = require('./db');

// ─── What to share / what to omit ────────────────────────────────────────────

const SHARE_GUIDELINES = {
  share: [
    'Deal stage and progress (e.g., "in negotiation", "LOI sent", "closed")',
    'Property type and approximate size (e.g., "200-space surface lot")',
    'City or metro area only — no street addresses',
    'Decision-maker role only — no full names (e.g., "property owner", "asset manager")',
    'Deal blockers or open questions that another agent might help resolve',
    'Key tags: market, deal type, asset class (e.g., "houston", "revenue-share", "garage")',
    'Action items that might overlap with another agent\'s pipeline',
    'CRM status changes relevant to the team (e.g., "moved to active pipeline")',
  ],
  omit: [
    'Full names of contacts or prospects',
    'Phone numbers, email addresses, or personal contact info',
    'Street addresses or precise property locations',
    'Confidential financial terms or specific dollar amounts',
    'Internal company names before a deal is confirmed',
    'Personal opinions about contacts',
    'Duplicate updates — only post when something materially changes',
  ],
};

// ─── Update type guidance ─────────────────────────────────────────────────────

const TYPE_GUIDANCE = {
  crm_change: 'A contact or deal moved stages in the CRM. Include: channel, old→new stage, city, deal type.',
  email_insight: 'Key intelligence from an email thread. Include: topic, city, deal type, any shared contacts by role only.',
  deal_update: 'Progress on an active deal. Include: deal stage, city, asset type, blockers, next step.',
  action_item: 'A task that needs doing, especially if another agent might help. Include: what, where, by when.',
  note: 'General market intel, observations, or context. Keep to 1–3 sentences.',
};

// ─── System prompt template ───────────────────────────────────────────────────

/**
 * Generate a compact system prompt for a specific agent channel.
 * This is what gets injected into the agent's context at the start of each session.
 *
 * @param {string} channelName - The agent's channel name (e.g., "Sam")
 * @param {string} apiKey - The agent's API key (shown once in setup, referenced here)
 * @param {string} baseUrl - The server base URL
 * @returns {string} - Token-optimized system prompt
 */
function generateSystemPrompt(channelName, apiKey, baseUrl) {
  const maskedKey = apiKey ? `${apiKey.substring(0, 14)}...` : 'YOUR_API_KEY';
  return `# TruxParking Coordination Layer — ${channelName}

You are ${channelName}'s AI agent on the TruxParking team. At the end of each work session (or when something significant happens), post a structured update to the shared coordination server so the team's alignment engine can detect cross-team opportunities.

## Your API Details
- Channel: ${channelName}
- Key: ${maskedKey}
- Endpoint: ${baseUrl}/api/channels/${channelName}/updates

## POST Format
\`\`\`json
{
  "update_type": "<crm_change|email_insight|deal_update|action_item|note>",
  "title": "<10 words max>",
  "body": "<2-4 sentences, facts only>",
  "location": "<City, ST only>",
  "tags": ["<market>", "<deal-type>", "<asset-class>"],
  "related_contacts": ["<role-only, e.g. property-owner-downtown-houston>"]
}
\`\`\`

## What to Share
${SHARE_GUIDELINES.share.map(s => `- ${s}`).join('\n')}

## What to Omit (Privacy + Token Efficiency)
${SHARE_GUIDELINES.omit.map(s => `- ${s}`).join('\n')}

## Update Types
${Object.entries(TYPE_GUIDANCE).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}

## Frequency
- Post at end of workday OR when a deal stage changes OR when a new lead enters pipeline
- Do NOT post if nothing material changed since last update
- Combine multiple small updates into one \`note\` to save tokens

## Pull Team Context
Before starting outreach in a new market, check what teammates are working on:
\`GET ${baseUrl}/api/updates?keyword=<city>&limit=10\`
\`GET ${baseUrl}/api/alerts?channel=${channelName}&unread_only=true\`

## Daily Digest (token-efficient briefing)
\`GET ${baseUrl}/api/digest/${channelName}\`
Returns a compact summary of: your recent updates, team activity in your markets, and unread opportunity alerts. Use this instead of pulling the full feed.
`.trim();
}

// ─── Daily Digest Generator ───────────────────────────────────────────────────

/**
 * Generate a token-optimized daily digest for a channel.
 * Returns a structured object (not a prose blob) so agents can parse it cheaply.
 *
 * @param {string} channelName
 * @returns {object}
 */
function generateDigest(channelName) {
  const db = getDb();

  // My recent updates (last 7 days, max 5)
  const myUpdates = db.prepare(`
    SELECT update_type, title, location, tags, timestamp
    FROM updates
    WHERE lower(channel_name) = lower(?)
      AND datetime(timestamp) >= datetime('now', '-7 days')
    ORDER BY timestamp DESC
    LIMIT 5
  `).all(channelName);

  // Unread alerts for this channel
  const myAlerts = db.prepare(`
    SELECT channel_a, channel_b, match_reason, match_details, created_at
    FROM opportunity_alerts
    WHERE (lower(channel_a) = lower(?) OR lower(channel_b) = lower(?))
      AND is_read = 0
    ORDER BY created_at DESC
    LIMIT 10
  `).all(channelName, channelName);

  // Extract my active locations/tags from recent updates
  const myLocations = new Set();
  const myTags = new Set();
  for (const u of myUpdates) {
    if (u.location) myLocations.add(u.location.split(',')[0].trim());
    if (u.tags) {
      try {
        const tags = JSON.parse(u.tags);
        if (Array.isArray(tags)) tags.forEach(t => myTags.add(t));
      } catch {
        u.tags.split(',').forEach(t => myTags.add(t.trim()));
      }
    }
  }

  // Team activity in my markets (last 3 days, other channels)
  let teamActivity = [];
  if (myLocations.size > 0 || myTags.size > 0) {
    const locationList = [...myLocations];
    const tagList = [...myTags];

    // Build a query that checks location or tags overlap
    const conditions = [];
    const params = [channelName];

    for (const loc of locationList.slice(0, 3)) {
      conditions.push(`(lower(location) LIKE lower(?) OR lower(title) LIKE lower(?) OR lower(body) LIKE lower(?))`);
      const l = `%${loc}%`;
      params.push(l, l, l);
    }
    for (const tag of tagList.slice(0, 3)) {
      conditions.push(`lower(tags) LIKE lower(?)`);
      params.push(`%${tag}%`);
    }

    if (conditions.length > 0) {
      teamActivity = db.prepare(`
        SELECT channel_name, update_type, title, location, timestamp
        FROM updates
        WHERE lower(channel_name) != lower(?)
          AND datetime(timestamp) >= datetime('now', '-3 days')
          AND (${conditions.join(' OR ')})
        ORDER BY timestamp DESC
        LIMIT 8
      `).all(...params);
    }
  }

  // Team-wide summary (last 24h)
  const recentTeamUpdates = db.prepare(`
    SELECT channel_name, update_type, title, location, timestamp
    FROM updates
    WHERE lower(channel_name) != lower(?)
      AND datetime(timestamp) >= datetime('now', '-1 day')
    ORDER BY timestamp DESC
    LIMIT 10
  `).all(channelName);

  // Format alerts compactly
  const formattedAlerts = myAlerts.map(a => {
    let details = {};
    try { details = JSON.parse(a.match_details); } catch {}
    const otherChannel = a.channel_a.toLowerCase() === channelName.toLowerCase() ? a.channel_b : a.channel_a;
    return {
      with: otherChannel,
      reason: a.match_reason,
      message: details.message || '',
      age: relativeTime(a.created_at),
    };
  });

  // Format my updates compactly
  const formattedMyUpdates = myUpdates.map(u => ({
    type: u.update_type,
    title: u.title,
    location: u.location || null,
    age: relativeTime(u.timestamp),
  }));

  // Format team activity compactly
  const formattedTeamActivity = teamActivity.map(u => ({
    agent: u.channel_name,
    type: u.update_type,
    title: u.title,
    location: u.location || null,
    age: relativeTime(u.timestamp),
  }));

  // Format recent team updates
  const formattedRecentTeam = recentTeamUpdates.map(u => ({
    agent: u.channel_name,
    type: u.update_type,
    title: u.title,
    age: relativeTime(u.timestamp),
  }));

  const digest = {
    channel: channelName,
    generated_at: new Date().toISOString(),
    // Instruction for the agent on how to use this digest
    agent_instruction: `Review alerts first — act on any shared contacts or location overlaps. Check team_in_my_markets for coordination opportunities. Only post a new update if something material changed since your last entry (${formattedMyUpdates[0]?.age || 'no recent updates'}).`,
    unread_alerts: formattedAlerts,
    my_recent_updates: formattedMyUpdates,
    team_in_my_markets: formattedTeamActivity,
    team_last_24h: formattedRecentTeam,
    // Token-saving summary counts
    summary: {
      unread_alerts: formattedAlerts.length,
      my_updates_this_week: formattedMyUpdates.length,
      team_updates_in_my_markets: formattedTeamActivity.length,
      team_updates_last_24h: formattedRecentTeam.length,
    },
  };

  return digest;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoString) {
  if (!isoString) return 'unknown';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

module.exports = {
  generateSystemPrompt,
  generateDigest,
  SHARE_GUIDELINES,
  TYPE_GUIDANCE,
};
