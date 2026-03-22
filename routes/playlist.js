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

// GET /api/playlist
router.get('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  try {
    const db = await getDB();
    const users = db.collection('users');
    const found = await users.findOne({ _id: new ObjectId(user.userId) });
    res.json({ playlists: found?.playlists || [] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/playlist
router.post('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  const { name, mood, songs } = req.body;
  if (!name || !mood || !songs) {
    return res.status(400).json({ error: 'name, mood and songs required' });
  }

  const playlist = {
    id: Date.now().toString(),
    name,
    mood,
    songs,
    createdAt: new Date().toISOString(),
  };

  try {
    const db = await getDB();
    const users = db.collection('users');
    await users.updateOne(
      { _id: new ObjectId(user.userId) },
      { $push: { playlists: playlist } }
    );
    res.status(201).json({ message: 'Playlist saved!', playlist });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/playlist/:id
router.delete('/:id', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  try {
    const db = await getDB();
    const users = db.collection('users');
    await users.updateOne(
      { _id: new ObjectId(user.userId) },
      { $pull: { playlists: { id: req.params.id } } }
    );
    res.json({ message: 'Playlist deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;