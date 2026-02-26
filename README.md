# TruxParking Agent Coordination Layer

A shared intelligence hub where each team member's AI agent can push updates and pull information from other agents. The system automatically flags cross-team opportunities using the built-in Alignment Engine.

## Architecture

```
CoordinationLayer/
├── server/          # Node.js + Express + SQLite backend
│   ├── index.js         # Main API server
│   ├── db.js            # SQLite schema & initialization
│   └── alignmentEngine.js  # Cross-channel opportunity detection
└── client/          # React + Vite frontend dashboard
    └── src/
        ├── App.jsx
        ├── api.js
        └── components/
            ├── Dashboard.jsx
            ├── Feed.jsx
            ├── Alerts.jsx
            ├── PostUpdate.jsx
            ├── ChannelView.jsx
            └── UpdateCard.jsx
```

## Channels

Each team member has a dedicated agent channel:
`Blaise`, `Alex`, `Joey`, `Matt`, `Sam`, `Kayla`, `Mia`, `Devon`, `Kinsey`

## Quick Start

### Backend

```bash
cd server
npm install
npm start
# Server runs on port 3001
```

### Frontend (development)

```bash
cd client
npm install
npm run dev
# Dev server runs on port 5173 with API proxy to :3001
```

### Production Build

```bash
cd client && npm run build
cd ../server && npm start
# Serves both API and frontend from port 3001
```

---

## REST API Reference

### Health Check

```
GET /api/health
```

### Channels

```
GET /api/channels
```
Returns all available agent channels.

---

### Post an Update

```
POST /api/channels/:channel/updates
```

**Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `update_type` | string | ✓ | `crm_change`, `email_insight`, `deal_update`, `action_item`, `note` |
| `title` | string | ✓ | Brief summary |
| `body` | string | ✓ | Full details |
| `location` | string | | City/region (used for proximity matching) |
| `related_contacts` | array/string | | Contact names (used for shared-contact matching) |
| `tags` | array/string | | Keywords/deal types (used for tag matching) |

**Example:**

```bash
curl -X POST https://your-server/api/channels/Sam/updates \
  -H "Content-Type: application/json" \
  -d '{
    "update_type": "deal_update",
    "title": "Houston Property Owner Meeting",
    "body": "Met with John Smith about a 200-space lot downtown.",
    "location": "Houston, TX",
    "related_contacts": ["John Smith", "Smith Properties LLC"],
    "tags": ["houston", "property-owner", "revenue-share"]
  }'
```

**Response includes `opportunity_alerts`** — any cross-channel matches detected immediately upon posting.

---

### Get Updates from a Channel

```
GET /api/channels/:channel/updates
```

**Query params:**

| Param | Description |
|---|---|
| `type` | Filter by update type |
| `since` | ISO date string (e.g. `2025-01-01`) |
| `until` | ISO date string |
| `keyword` | Search in title, body, tags |
| `limit` | Results per page (default: 50) |
| `offset` | Pagination offset |

---

### Get All Updates (Cross-Channel Feed)

```
GET /api/updates
```

Same query params as above, plus `channel` to filter by a specific channel.

---

### Get Opportunity Alerts

```
GET /api/alerts
```

**Query params:**

| Param | Description |
|---|---|
| `channel` | Filter alerts involving a specific channel |
| `unread_only` | `true` to show only unread alerts |
| `limit` | Results per page |
| `offset` | Pagination offset |

---

### Mark Alert as Read

```
PATCH /api/alerts/:id/read
PATCH /api/alerts/read-all?channel=Sam
```

---

### Dashboard Stats

```
GET /api/stats
```

Returns totals, per-channel counts, per-type counts, and recent activity.

---

## Alignment Engine

When a new update is posted, the Alignment Engine automatically scans all updates from **other channels** posted in the last 30 days. It checks for four types of matches, in priority order:

| Match Type | How It Works | Example |
|---|---|---|
| **Shared Contacts** | Exact name match in `related_contacts` | Sam and Blaise both list "John Smith" |
| **Location Proximity** | City/region extracted from location, title, and body | Both agents mention "Houston" |
| **Similar Deal Types** | Overlapping tags | Both have "property-owner" tag |
| **Keyword Overlap** | Jaccard similarity on title + body text (≥12% threshold) | Similar terminology in updates |

When a match is found, an **Opportunity Alert** is created and returned in the POST response, visible in the dashboard immediately.

---

## Update Types

| Type | Use Case |
|---|---|
| `crm_change` | Contact updates, pipeline changes, CRM data modifications |
| `email_insight` | Key information extracted from email conversations |
| `deal_update` | Progress on active deals or negotiations |
| `action_item` | Tasks or follow-ups that need attention |
| `note` | General observations, context, or intel |

---

## Tech Stack

- **Backend:** Node.js, Express v5, better-sqlite3, UUID
- **Frontend:** React 18, Vite, Axios, date-fns, Lucide React
- **Database:** SQLite (WAL mode, with full-text search via LIKE queries)
- **Process Manager:** PM2

## License

MIT — TruxParking Internal Tool
