const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');

function getUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

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

router.get('/', (_, res) => {
  res.json({ moods: Object.keys(moodMap) });
});

// GET /api/mood/history - get logged-in user's recent moods
router.get('/history', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    const found = await db.collection('users').findOne({ _id: new ObjectId(user.userId) });
    res.json({ moods: found?.recentMoods || [] });
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
  const entry = { mood, note, time: new Date().toLocaleString(), ts: Date.now() };
  try {
    const db = await getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(user.userId) },
      { $push: { recentMoods: { $each: [entry], $slice: -365 } } }
    );
    res.status(201).json({ message: 'Mood saved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/mood/trending - top moods across all users in last 24h
router.get('/trending', async (req, res) => {
  try {
    const db = await getDB();
    const users = await db.collection('users').find(
      { 'recentMoods.0': { $exists: true } },
      { projection: { recentMoods: 1 } }
    ).toArray();

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const counts = {};
    users.forEach(function(user) {
      (user.recentMoods || []).forEach(function(entry) {
        if (entry.mood && entry.ts && entry.ts > since) {
          counts[entry.mood] = (counts[entry.mood] || 0) + 1;
        }
      });
    });

    const trending = Object.entries(counts)
      .sort(function(a, b) { return b[1] - a[1]; })
      .slice(0, 5)
      .map(function([mood, count]) { return { mood, count }; });

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
