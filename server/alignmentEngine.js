const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');

/**
 * Normalize a string for comparison: lowercase, strip punctuation, split into tokens
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

/**
 * Common stop words to exclude from keyword matching
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'have', 'from',
  'are', 'was', 'were', 'will', 'been', 'has', 'had', 'not',
  'but', 'they', 'their', 'about', 'out', 'can', 'all', 'get',
  'our', 'its', 'also', 'into', 'just', 'more', 'some', 'than',
  'then', 'when', 'who', 'what', 'how', 'any', 'each', 'both',
  'new', 'use', 'may', 'per', 'via', 'let', 'set', 'see', 'now',
  'one', 'two', 'very', 'still', 'back', 'well', 'way', 'even',
  'need', 'want', 'make', 'take', 'over', 'such', 'does', 'did',
  'too', 'own', 'off', 'day', 'got', 'put', 'end', 'try', 'big',
  'him', 'her', 'she', 'his', 'him', 'they', 'them', 'these',
]);

function getKeywords(text) {
  return tokenize(text).filter(t => !STOP_WORDS.has(t));
}

/**
 * Calculate Jaccard similarity between two sets of keywords
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Extract US city/state names from text for location matching
 */
function extractLocations(text) {
  if (!text) return [];
  const locations = [];
  // Match common city patterns (capitalized words, optionally followed by state abbreviation)
  const cityPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*([A-Z]{2})?\b/g;
  let match;
  while ((match = cityPattern.exec(text)) !== null) {
    locations.push(match[1].toLowerCase());
  }
  return locations;
}

/**
 * Parse contacts from a JSON string or comma-separated string
 */
function parseContacts(contactsStr) {
  if (!contactsStr) return [];
  try {
    const parsed = JSON.parse(contactsStr);
    return Array.isArray(parsed) ? parsed.map(c => c.toLowerCase().trim()) : [];
  } catch {
    return contactsStr.split(',').map(c => c.toLowerCase().trim()).filter(Boolean);
  }
}

/**
 * Parse tags from a JSON string or comma-separated string
 */
function parseTags(tagsStr) {
  if (!tagsStr) return [];
  try {
    const parsed = JSON.parse(tagsStr);
    return Array.isArray(parsed) ? parsed.map(t => t.toLowerCase().trim()) : [];
  } catch {
    return tagsStr.split(',').map(t => t.toLowerCase().trim()).filter(Boolean);
  }
}

/**
 * Check if two updates share location overlap
 */
function checkLocationMatch(updateA, updateB) {
  const locsA = [
    ...extractLocations(updateA.location || ''),
    ...extractLocations(updateA.title || ''),
    ...extractLocations(updateA.body || ''),
  ];
  const locsB = [
    ...extractLocations(updateB.location || ''),
    ...extractLocations(updateB.title || ''),
    ...extractLocations(updateB.body || ''),
  ];
  if (locsA.length === 0 || locsB.length === 0) return null;

  const setA = new Set(locsA);
  const setB = new Set(locsB);
  const shared = [...setA].filter(l => setB.has(l));
  if (shared.length > 0) {
    return {
      reason: 'location_proximity',
      details: `Both agents are active in: ${shared.map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(', ')}`,
      score: 0.9,
    };
  }
  return null;
}

/**
 * Check if two updates share contacts
 */
function checkContactMatch(updateA, updateB) {
  const contactsA = parseContacts(updateA.related_contacts);
  const contactsB = parseContacts(updateB.related_contacts);
  if (contactsA.length === 0 || contactsB.length === 0) return null;

  const setA = new Set(contactsA);
  const setB = new Set(contactsB);
  const shared = [...setA].filter(c => setB.has(c));
  if (shared.length > 0) {
    return {
      reason: 'shared_contacts',
      details: `Both agents are working with: ${shared.join(', ')}`,
      score: 0.95,
    };
  }
  return null;
}

/**
 * Check if two updates have similar deal types via tags
 */
function checkTagMatch(updateA, updateB) {
  const tagsA = parseTags(updateA.tags);
  const tagsB = parseTags(updateB.tags);
  if (tagsA.length === 0 || tagsB.length === 0) return null;

  const setA = new Set(tagsA);
  const setB = new Set(tagsB);
  const shared = [...setA].filter(t => setB.has(t));
  if (shared.length >= 1) {
    return {
      reason: 'similar_deal_types',
      details: `Both agents share tags: ${shared.join(', ')}`,
      score: 0.7,
    };
  }
  return null;
}

/**
 * Check keyword overlap between two updates
 */
function checkKeywordMatch(updateA, updateB) {
  const textA = `${updateA.title} ${updateA.body} ${updateA.tags || ''}`;
  const textB = `${updateB.title} ${updateB.body} ${updateB.tags || ''}`;

  const kwA = new Set(getKeywords(textA));
  const kwB = new Set(getKeywords(textB));

  const similarity = jaccardSimilarity(kwA, kwB);
  if (similarity >= 0.12) {
    const shared = [...kwA].filter(k => kwB.has(k));
    return {
      reason: 'keyword_overlap',
      details: `Updates share related keywords: ${shared.slice(0, 6).join(', ')}`,
      score: similarity,
    };
  }
  return null;
}

/**
 * Generate a human-readable opportunity alert message
 */
function generateAlertMessage(updateA, updateB, matchResult) {
  const nameA = updateA.channel_name;
  const nameB = updateB.channel_name;

  switch (matchResult.reason) {
    case 'location_proximity': {
      const loc = matchResult.details.replace('Both agents are active in: ', '');
      return `${nameA} and ${nameB} are both active in ${loc} — potential collaboration opportunity`;
    }
    case 'shared_contacts': {
      const contacts = matchResult.details.replace('Both agents are working with: ', '');
      return `${nameA} and ${nameB} are both engaging with ${contacts} — coordinate outreach`;
    }
    case 'similar_deal_types': {
      const tags = matchResult.details.replace('Both agents share tags: ', '');
      return `${nameA} and ${nameB} are working on similar deals (${tags}) — share insights`;
    }
    case 'keyword_overlap': {
      return `${nameA}'s update "${updateA.title}" aligns with ${nameB}'s "${updateB.title}" — review for synergies`;
    }
    default:
      return `${nameA} and ${nameB} have related activity — review for collaboration`;
  }
}

/**
 * Run alignment check for a newly posted update against all recent updates
 * in other channels. Creates opportunity alerts for any matches found.
 */
function runAlignmentCheck(newUpdate) {
  const db = getDb();

  // Pull recent updates from OTHER channels (last 30 days)
  const recentUpdates = db.prepare(`
    SELECT * FROM updates
    WHERE channel_id != ?
      AND datetime(timestamp) >= datetime('now', '-30 days')
    ORDER BY timestamp DESC
    LIMIT 200
  `).all(newUpdate.channel_id);

  const insertAlert = db.prepare(`
    INSERT OR IGNORE INTO opportunity_alerts
      (id, update_id_a, update_id_b, channel_a, channel_b, match_reason, match_details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  // Check for existing alerts to avoid duplicates
  const existingAlerts = db.prepare(`
    SELECT update_id_a, update_id_b FROM opportunity_alerts
    WHERE (update_id_a = ? OR update_id_b = ?)
  `).all(newUpdate.id, newUpdate.id);

  const alertedPairs = new Set(
    existingAlerts.map(a => [a.update_id_a, a.update_id_b].sort().join(':'))
  );

  const newAlerts = [];

  for (const otherUpdate of recentUpdates) {
    const pairKey = [newUpdate.id, otherUpdate.id].sort().join(':');
    if (alertedPairs.has(pairKey)) continue;

    // Run match checks in priority order
    const matchResult =
      checkContactMatch(newUpdate, otherUpdate) ||
      checkLocationMatch(newUpdate, otherUpdate) ||
      checkTagMatch(newUpdate, otherUpdate) ||
      checkKeywordMatch(newUpdate, otherUpdate);

    if (matchResult) {
      const alertId = uuidv4();
      const alertMessage = generateAlertMessage(newUpdate, otherUpdate, matchResult);

      insertAlert.run(
        alertId,
        newUpdate.id,
        otherUpdate.id,
        newUpdate.channel_name,
        otherUpdate.channel_name,
        matchResult.reason,
        JSON.stringify({
          message: alertMessage,
          detail: matchResult.details,
          score: matchResult.score,
          update_a_title: newUpdate.title,
          update_b_title: otherUpdate.title,
        })
      );

      alertedPairs.add(pairKey);
      newAlerts.push({ id: alertId, message: alertMessage, reason: matchResult.reason });
    }
  }

  return newAlerts;
}

module.exports = { runAlignmentCheck };
