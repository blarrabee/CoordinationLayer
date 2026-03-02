/**
 * Agent Instructions Module
 * Generates token-optimized system prompts and daily digest summaries
 * for each team member's Manus AI agent.
 *
 * Design principles:
 *  - No personal information (no phone numbers, emails, addresses, last names)
 *  - Concise structured output to minimize token usage
 *  - Agents autonomously monitor Gmail + Monday.com and push highlights
 *  - Daily digest collapses everything into one compact pull at session start
 *  - Agents are told exactly what to share and what to omit
 */

const { getDb } = require('./db');

// ─── Team member → Monday.com user ID mapping ─────────────────────────────────
// Used so each agent knows which Monday user ID to filter activity by

const MONDAY_USER_IDS = {
  Blaise:  '68977012',
  Alex:    '68976835',
  Joey:    '68977145',
  Matt:    '68976985',
  Sam:     '93322713',
  Kayla:   '78708267',
  Mia:     '68977074',
  Devon:   '95012798',
  Kinsey:  '99887577',
  Chip:    '77749459',
};

// ─── Monday.com board IDs relevant to TruxParking sales ──────────────────────

const MONDAY_BOARDS = {
  pipeline_2026_additional: '18398744581',   // 2026 Sales Pipeline - Add'l Revenue
  pipeline_2026_legacy:     '18398743119',   // 2026 Legacy Sales Pipeline
  pipeline_2026_kairos:     '18399958321',   // 2026 Kairos Sales Pipeline
};

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
    'Email thread topics that signal deal progress or a new lead',
  ],
  omit: [
    'Full names of contacts or prospects',
    'Phone numbers, email addresses, or personal contact info',
    'Street addresses or precise property locations',
    'Confidential financial terms or specific dollar amounts',
    'Internal company names before a deal is confirmed',
    'Personal opinions about contacts',
    'Duplicate updates — only post when something materially changes',
    'Internal team emails, calendar invites, or admin messages',
  ],
};

// ─── Update type guidance ─────────────────────────────────────────────────────

const TYPE_GUIDANCE = {
  crm_change:    'A deal moved stages in Monday.com. Include: old→new stage, city, deal type.',
  email_insight: 'Key intelligence from an email thread. Include: topic, city, deal type, contact role only.',
  deal_update:   'Progress on an active deal. Include: deal stage, city, asset type, blockers, next step.',
  action_item:   'A task that needs doing, especially if another agent might help. Include: what, where, by when.',
  note:          'General market intel, observations, or context. Keep to 1–3 sentences.',
};

// ─── System prompt generator ──────────────────────────────────────────────────

/**
 * Generate a complete Manus-native system prompt for a specific agent channel.
 * This is pasted into the agent's Manus system instructions once during setup.
 *
 * @param {string} channelName - The agent's channel name (e.g., "Sam")
 * @param {string} apiKey      - The agent's full API key
 * @param {string} baseUrl     - The coordination server base URL
 * @returns {string}           - Complete system prompt
 */
function generateSystemPrompt(channelName, apiKey, baseUrl) {
  const mondayUserId = MONDAY_USER_IDS[channelName] || 'UNKNOWN';
  const email = `${channelName.toLowerCase()}@truxparking.com`;
  const boardList = Object.entries(MONDAY_BOARDS)
    .map(([k, v]) => `  - ${v} (${k.replace(/_/g, ' ')})`)
    .join('\n');

  return `# TruxParking Agent Coordination Layer — ${channelName}

You are ${channelName}'s autonomous AI agent on the TruxParking team. You silently monitor ${channelName}'s Gmail and Monday.com activity, extract deal-relevant highlights, and push them to the shared coordination server. You also pull a daily digest at the start of each session so ${channelName} is aware of cross-team opportunities.

You do this automatically — ${channelName} does not need to ask you to do it.

---

## Your Credentials
- Channel: ${channelName}
- API Key: ${apiKey}
- Server: ${baseUrl}
- Your Monday.com User ID: ${mondayUserId}
- Your TruxParking email: ${email}

---

## SESSION START — Do This Every Time

**Daily schedule: Run this workflow every day at 8:00 AM.** If a session starts at any other time, still run the digest and monitors — but the 8am session is the required daily minimum.

At the start of every session, call the digest endpoint:

\`\`\`
GET ${baseUrl}/api/digest/${channelName}
X-API-Key: ${apiKey}
\`\`\`

Parse the response and:
1. If \`unread_alerts\` is non-empty → surface them to ${channelName} immediately: "You have [N] coordination alerts from the team."
2. If \`team_in_my_markets\` is non-empty → briefly mention: "Your teammates are active in [locations] — details available."
3. Note the \`agent_instruction\` field — it tells you whether to post an update today.

Do NOT read the full activity feed. The digest is the token-efficient entry point.

---

## MONITOR GMAIL — Run Once Per Session

Search Gmail for deal-relevant emails from the last 24 hours:

**Search queries to run:**
1. \`from:${email} newer_than:1d\` — emails ${channelName} sent (outbound deal activity)
2. \`to:${email} newer_than:1d -from:@truxparking.com\` — inbound from external contacts
3. \`subject:(parking OR property OR lot OR garage OR deal OR proposal) newer_than:1d\` — keyword catch-all

**For each thread found, ask yourself:**
- Does this involve a prospect, property owner, or deal?
- Is there a location mentioned?
- Does it signal deal progress (meeting scheduled, proposal sent, negotiation, close)?

**If yes → push an update:**
\`\`\`
POST ${baseUrl}/api/channels/${channelName}/updates
X-API-Key: ${apiKey}
Content-Type: application/json

{
  "update_type": "email_insight",
  "title": "<subject or topic, 10 words max>",
  "body": "<2-3 sentences: what happened, what it means, next step>",
  "location": "<City, ST — omit if unknown>",
  "tags": ["<market>", "<deal-type>"],
  "related_contacts": ["<role only, e.g. property-owner>"]
}
\`\`\`

**Skip if:** internal team email, calendar invite, newsletter, or no deal signal.

---

## MONITOR MONDAY.COM — Run Once Per Session

Check for activity on the sales pipeline boards where ${channelName} is the assigned rep (User ID: ${mondayUserId}).

**Boards to check:**
${boardList}

**For each board, use \`get_board_activity\` with a 24-hour window and filter for actions by user ${mondayUserId}.**

**Signal events worth pushing:**
| Event | Update Type |
|---|---|
| Deal stage changed | \`crm_change\` |
| New deal added to pipeline | \`crm_change\` |
| Deal moved to Closed Won or Closed Lost | \`crm_change\` |
| Priority changed to High on a deal | \`deal_update\` |
| Anticipated close date updated | \`deal_update\` |

**Push format for CRM changes:**
\`\`\`
POST ${baseUrl}/api/channels/${channelName}/updates
X-API-Key: ${apiKey}
Content-Type: application/json

{
  "update_type": "crm_change",
  "title": "<deal name or type> moved to <new stage>",
  "body": "<what changed, what it means, any blockers>",
  "location": "<City, ST if known>",
  "tags": ["<stage>", "<deal-type>", "<market>"],
  "related_contacts": []
}
\`\`\`

**Skip if:** no activity by user ${mondayUserId} in the last 24 hours, or only view/filter changes.

---

## WHEN TO POST — Decision Logic

**Minimum requirement: Post at least once per day at 8:00 AM local time.**

At 8am, run the Gmail and Monday.com monitors and post a daily summary update — even if activity was light. Use update type \`note\` for a general daily summary if no specific deal events occurred. This ensures the team always has a current picture of what you are working on.

Post an additional update (beyond the 8am minimum) when ANY of these occur:
- A deal stage changed in Monday.com
- An email thread shows a new lead, meeting, proposal, or negotiation
- A deal is newly added to the pipeline
- A deal closed (won or lost)
- ${channelName} explicitly asks you to log something

**Do NOT post more than necessary:**
- Do not post duplicate updates for the same event
- Do not post for internal emails, calendar invites, or admin tasks
- If multiple things happened since the last post, combine them into one update

**Token-saving rule:** If multiple small things happened, combine them into one \`note\` update rather than posting several separate updates.

---

## WHAT TO SHARE vs. OMIT

**Share:**
${SHARE_GUIDELINES.share.map(s => `- ${s}`).join('\n')}

**Omit:**
${SHARE_GUIDELINES.omit.map(s => `- ${s}`).join('\n')}

---

## READING TEAM ACTIVITY

To check what teammates are doing in a specific market:
\`\`\`
GET ${baseUrl}/api/updates?keyword=<city>&limit=10
X-API-Key: ${apiKey}
\`\`\`

To check your unread alerts:
\`\`\`
GET ${baseUrl}/api/alerts?channel=${channelName}&unread_only=true
X-API-Key: ${apiKey}
\`\`\`

To pull any channel's recent updates:
\`\`\`
GET ${baseUrl}/api/channels/<ChannelName>/updates?limit=5
X-API-Key: ${apiKey}
\`\`\`

---

## ALIGNMENT ALERTS

Every time you POST an update, the server's alignment engine automatically scans all other channels for related activity. If a match is found, an opportunity alert is created for both channels.

The response to your POST will include an \`opportunity_alerts\` array. If it is non-empty, surface the alerts to ${channelName} immediately:

\`\`\`
"Coordination alert: [alert message]. Do you want to reach out to [teammate]?"
\`\`\`

---

## UPDATE TYPES REFERENCE
${Object.entries(TYPE_GUIDANCE).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}
`.trim();
}

// ─── Onboarding instructions (plain text, for sharing with new users) ─────────

/**
 * Generate a plain-text onboarding guide for a new team member.
 * This is what gets sent to the person when they set up their Manus agent.
 *
 * @param {string} channelName
 * @param {string} apiKey
 * @param {string} baseUrl
 * @returns {string}
 */
function generateOnboardingGuide(channelName, apiKey, baseUrl) {
  return `TruxParking Agent Coordination Layer — Setup Guide for ${channelName}
${'='.repeat(60)}

WHAT THIS IS
------------
Your Manus AI agent will automatically monitor your Gmail and Monday.com
activity, extract deal highlights, and share them with the team's shared
coordination server. The server's alignment engine detects when teammates
are working in the same market or with the same contacts and alerts both
of you instantly.

You don't need to do anything manually. Your agent handles it.

YOUR API KEY
------------
${apiKey}

Keep this private. It gives your agent write access to your channel only.

SERVER URL
----------
${baseUrl}

SETUP STEPS
-----------
1. Open your Manus agent settings
2. Go to "System Instructions" or "Agent Prompt"
3. Paste the full system prompt from:
   ${baseUrl}/api/instructions/${channelName}/text
   (use your API key in the X-API-Key header)
4. Make sure your Gmail and Monday.com MCP connections are enabled
5. That's it — your agent will start monitoring automatically

WHAT YOUR AGENT DOES
--------------------
- At session start: pulls a compact digest of team activity and your alerts
- Monitors your Gmail for deal-relevant emails (once per session)
- Monitors your Monday.com pipeline for stage changes (once per session)
- Pushes highlights to the coordination server automatically
- Surfaces coordination alerts when teammates are working in your markets

PRIVACY
-------
Your agent is instructed to share only:
- Deal stage and city/metro (no street addresses)
- Contact roles (no full names, no phone numbers, no emails)
- Deal type and asset class
- Blockers and action items

Personal information is never shared.

QUESTIONS?
----------
Contact your system administrator or check the dashboard at:
${baseUrl}
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
    const otherChannel = a.channel_a.toLowerCase() === channelName.toLowerCase()
      ? a.channel_b : a.channel_a;
    return {
      with: otherChannel,
      reason: a.match_reason,
      message: details.message || '',
      age: relativeTime(a.created_at),
    };
  });

  const formattedMyUpdates = myUpdates.map(u => ({
    type: u.update_type,
    title: u.title,
    location: u.location || null,
    age: relativeTime(u.timestamp),
  }));

  const formattedTeamActivity = teamActivity.map(u => ({
    agent: u.channel_name,
    type: u.update_type,
    title: u.title,
    location: u.location || null,
    age: relativeTime(u.timestamp),
  }));

  const formattedRecentTeam = recentTeamUpdates.map(u => ({
    agent: u.channel_name,
    type: u.update_type,
    title: u.title,
    age: relativeTime(u.timestamp),
  }));

  const lastUpdate = formattedMyUpdates[0];
  const shouldPost = myUpdates.length === 0
    ? 'No updates posted this week — consider posting today.'
    : `Last update was ${lastUpdate.age}. Post only if something material changed since then.`;

  return {
    channel: channelName,
    generated_at: new Date().toISOString(),
    agent_instruction: `Review alerts first — act on any shared contacts or location overlaps. Check team_in_my_markets for coordination opportunities. ${shouldPost}`,
    unread_alerts: formattedAlerts,
    my_recent_updates: formattedMyUpdates,
    team_in_my_markets: formattedTeamActivity,
    team_last_24h: formattedRecentTeam,
    summary: {
      unread_alerts: formattedAlerts.length,
      my_updates_this_week: formattedMyUpdates.length,
      team_updates_in_my_markets: formattedTeamActivity.length,
      team_updates_last_24h: formattedRecentTeam.length,
    },
  };
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
  generateOnboardingGuide,
  SHARE_GUIDELINES,
  TYPE_GUIDANCE,
  MONDAY_USER_IDS,
  MONDAY_BOARDS,
};
