const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');
const { getUser } = require('./session');

// user.taste = { seedArtists: [], seedGenres: [], blockedArtists: [], updatedAt }
// - seedArtists  : favourites picked at onboarding / edited later -> ranking boost
// - seedGenres   : preferred genres -> woven into search queries
// - blockedArtists: never recommend -> hard-excluded in ranking
const FIELDS = {
  seedArtists: 30,
  seedGenres: 15,
  blockedArtists: 100,
};
const MAX_ITEM_LEN = 80;
const EMPTY_TASTE = { seedArtists: [], seedGenres: [], blockedArtists: [] };

function cleanList(value, maxItems) {
  if (!Array.isArray(value)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const item = raw.trim().toLowerCase().slice(0, MAX_ITEM_LEN);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

async function getUserTaste(db, oid) {
  const found = await db.collection('users').findOne({ _id: oid }, { projection: { taste: 1 } });
  const taste = found && found.taste ? found.taste : {};
  return {
    seedArtists: Array.isArray(taste.seedArtists) ? taste.seedArtists : [],
    seedGenres: Array.isArray(taste.seedGenres) ? taste.seedGenres : [],
    blockedArtists: Array.isArray(taste.blockedArtists) ? taste.blockedArtists : [],
  };
}

// GET /api/taste
router.get('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    res.json({ taste: await getUserTaste(db, new ObjectId(user.userId)) });
  } catch (_) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/taste - replace any provided list; omitted lists are left as-is
router.put('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  const update = {};
  for (const [field, maxItems] of Object.entries(FIELDS)) {
    if (req.body[field] === undefined) continue;
    const cleaned = cleanList(req.body[field], maxItems);
    if (cleaned === null) return res.status(400).json({ error: `${field} must be an array of strings` });
    update[`taste.${field}`] = cleaned;
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
  update['taste.updatedAt'] = new Date();

  try {
    const db = await getDB();
    const oid = new ObjectId(user.userId);
    await db.collection('users').updateOne({ _id: oid }, { $set: update });
    res.json({ taste: await getUserTaste(db, oid) });
  } catch (_) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.getUserTaste = getUserTaste;
module.exports.EMPTY_TASTE = EMPTY_TASTE;
