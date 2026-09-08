const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');
const { getUser } = require('./session');

const router = express.Router();

// One document per play in the `listening_history` collection:
//   { _id, userId, trackId, title, artist, albumArt, mood, playedAt }
// Reads return the newest 500, oldest history is no longer discarded on write.
const READ_LIMIT = 500;
const ALLOWED_MOODS = new Set(['happy', 'sad', 'angry', 'calm', 'energetic', 'romantic', 'focused', 'nostalgic', 'party', 'sleepy', 'anxious', 'mixed', '']);
function cleanText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function cleanArtwork(value) {
  const text = cleanText(value, 500);
  if (!text) return '';
  try { return new URL(text).protocol === 'https:' ? text : ''; } catch (_) { return ''; }
}

router.get('/history', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    const plays = await db.collection('listening_history')
      .find({ userId: new ObjectId(user.userId) })
      .project({ _id: 0, userId: 0 })
      .sort({ playedAt: -1, _id: -1 })
      .limit(READ_LIMIT)
      .toArray();
    res.json({ plays });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/history', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const trackId = cleanText(req.body.trackId, 80);
  const title = cleanText(req.body.title, 200);
  const artist = cleanText(req.body.artist, 300);
  const albumArt = cleanArtwork(req.body.albumArt);
  const mood = cleanText(req.body.mood, 20).toLowerCase();
  if (!/^[A-Za-z0-9]+$/.test(trackId) || !title || !ALLOWED_MOODS.has(mood)) return res.status(400).json({ error: 'Valid track, title and mood required' });
  const entry = {
    userId: new ObjectId(user.userId),
    trackId,
    title,
    artist,
    albumArt,
    mood,
    playedAt: Date.now(),
  };
  try {
    const db = await getDB();
    await db.collection('listening_history').insertOne(entry);
    res.status(201).json({ message: 'Play recorded' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/history', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    await db.collection('listening_history').deleteMany({ userId: new ObjectId(user.userId) });
    res.json({ message: 'Listening history cleared' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
