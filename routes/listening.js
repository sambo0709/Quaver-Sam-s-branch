const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');
const { getUser } = require('./session');

const router = express.Router();

router.get('/history', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    const found = await db.collection('users').findOne(
      { _id: new ObjectId(user.userId) },
      { projection: { listeningHistory: 1 } }
    );
    res.json({ plays: (found?.listeningHistory || []).slice().reverse() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/history', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const { trackId, title, artist, albumArt, mood } = req.body;
  if (!trackId || !title) return res.status(400).json({ error: 'trackId and title required' });
  const entry = {
    trackId,
    title,
    artist: artist || '',
    albumArt: albumArt || '',
    mood: mood || '',
    playedAt: Date.now(),
  };
  try {
    const db = await getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(user.userId) },
      { $push: { listeningHistory: { $each: [entry], $slice: -500 } } }
    );
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
    await db.collection('users').updateOne(
      { _id: new ObjectId(user.userId) },
      { $set: { listeningHistory: [] } }
    );
    res.json({ message: 'Listening history cleared' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
