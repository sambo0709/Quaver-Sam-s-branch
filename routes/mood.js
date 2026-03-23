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
  if (!mood) return res.status(400).json({ error: 'mood required' });
  const entry = { mood, time: new Date().toLocaleString() };
  try {
    const db = await getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(user.userId) },
      { $push: { recentMoods: { $each: [entry], $slice: -20 } } }
    );
    res.status(201).json({ message: 'Mood saved' });
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