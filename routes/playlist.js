const express = require('express');
const router = express.Router();

// in memory store for now (we'll swap this for a real DB later)
let playlists = [];

// GET /api/playlist - get all playlists
router.get('/', (req, res) => {
  res.json({ playlists });
});

// POST /api/playlist - save a new playlist
router.post('/', (req, res) => {
  const { name, mood, songs } = req.body;

  if (!name || !mood || !songs) {
    return res.status(400).json({ error: 'name, mood, and songs are required' });
  }

  const playlist = {
    id: Date.now(),
    name,
    mood,
    songs,
    createdAt: new Date().toISOString(),
  };

  playlists.push(playlist);
  res.status(201).json({ message: 'Playlist saved!', playlist });
});

// DELETE /api/playlist/:id - delete a playlist
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  playlists = playlists.filter(p => p.id !== id);
  res.json({ message: 'Playlist deleted' });
});

module.exports = router;