const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');
const { getUser } = require('./session');

const moodMap = {
  happy:     { energy: 'high',   tempo: 'fast',   genre: 'pop' },
  sad:       { energy: 'low',    tempo: 'slow',   genre: 'acoustic' },
  angry:     { energy: 'high',   tempo: 'fast',   genre: 'rock' },
  calm:      { energy: 'low',    tempo: 'slow',   genre: 'ambient' },
  energetic: { energy: 'high',   tempo: 'fast',   genre: 'electronic' },
  romantic:  { energy: 'medium', tempo: 'medium', genre: 'jazz' },
  focused:   { energy: 'medium', tempo: 'medium', genre: 'lo-fi' },
  nostalgic: { energy: 'medium', tempo: 'medium', genre: 'retro' },
  party:     { energy: 'high',   tempo: 'fast',   genre: 'dance' },
  sleepy:    { energy: 'low',    tempo: 'slow',   genre: 'ambient' },
  anxious:   { energy: 'low',    tempo: 'slow',   genre: 'meditation' },
};

// One document per entry in the `mood_history` collection:
//   { _id, userId, mood, note, time, ts }

router.get('/', (_, res) => {
  res.json({ moods: Object.keys(moodMap) });
});

// GET /api/mood/history - get logged-in user's recent moods
router.get('/history', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    const moods = await db.collection('mood_history')
      .find({ userId: new ObjectId(user.userId) })
      .project({ _id: 0, userId: 0 })
      .sort({ ts: 1, _id: 1 })
      .toArray();
    res.json({ moods });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/mood/history - save a mood entry for the logged-in user
router.post('/history', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const { mood } = req.body;
  const note = String(req.body.note || '').trim().slice(0, 160);
  if (!mood) return res.status(400).json({ error: 'mood required' });
  const entry = {
    userId: new ObjectId(user.userId),
    mood,
    note,
    time: new Date().toLocaleString(),
    ts: Date.now(),
  };
  try {
    const db = await getDB();
    await db.collection('mood_history').insertOne(entry);
    res.status(201).json({ message: 'Mood saved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/history', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    await db.collection('mood_history').deleteMany({ userId: new ObjectId(user.userId) });
    res.json({ message: 'Mood history cleared' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/mood/trending - top moods across all users in last 24h
router.get('/trending', async (req, res) => {
  try {
    const db = await getDB();
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const rows = await db.collection('mood_history').aggregate([
      { $match: { ts: { $gt: since }, mood: { $type: 'string' } } },
      { $group: { _id: '$mood', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]).toArray();

    const trending = rows.map(function(row) { return { mood: row._id, count: row.count }; });
    res.json({ trending });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:mood', (req, res) => {
  const mood = req.params.mood.toLowerCase();
  const attributes = moodMap[mood];

  if (!attributes) {
    return res.status(404).json({
      error: `Mood "${mood}" not supported`,
      supported: Object.keys(moodMap),
    });
  }

  res.json({ mood, attributes });
});

module.exports = router;
