const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');
const { getUser } = require('./session');

const ALLOWED_MOODS = new Set(['happy', 'sad', 'angry', 'calm', 'energetic', 'romantic', 'focused', 'nostalgic', 'party', 'sleepy', 'anxious', 'mixed']);
function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function cleanHttpsUrl(value, max) {
  const text = cleanText(value, max);
  if (!text) return '';
  try { return new URL(text).protocol === 'https:' ? text : ''; } catch (_) { return ''; }
}
function cleanSpotifyUrl(value) {
  const text = cleanHttpsUrl(value, 300);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.hostname === 'open.spotify.com' && /^\/track\/[A-Za-z0-9]+$/.test(url.pathname) ? url.origin + url.pathname : '';
  } catch (_) { return ''; }
}
function cleanSong(song) {
  if (!song || typeof song !== 'object' || Array.isArray(song)) return null;
    const title = cleanText(song.title, 200);
    if (!title) return null;
    return {
      title,
      artist: cleanText(song.artist, 300),
      duration: cleanText(song.duration, 12),
      album_art: cleanHttpsUrl(song.album_art, 500),
      spotify_url: cleanSpotifyUrl(song.spotify_url),
    };
}
function cleanSongs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const songs = value.map(cleanSong);
  return songs.every(Boolean) ? songs : null;
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

  const name = cleanText(req.body.name, 80);
  const mood = cleanText(req.body.mood, 20).toLowerCase();
  const songs = cleanSongs(req.body.songs);
  if (!name || !ALLOWED_MOODS.has(mood) || !songs) return res.status(400).json({ error: 'Invalid playlist data' });

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

// POST /api/playlist/:id/songs - add one track to an existing playlist
router.post('/:id/songs', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const song = cleanSong(req.body.song);
  if (!song || !song.spotify_url) return res.status(400).json({ error: 'Valid Spotify song required' });
  try {
    const db = await getDB();
    const users = db.collection('users');
    const found = await users.findOne(
      { _id: new ObjectId(user.userId), 'playlists.id': req.params.id },
      { projection: { 'playlists.$': 1 } }
    );
    const playlist = found?.playlists?.[0];
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    if ((playlist.songs || []).some(function(item) { return item.spotify_url === song.spotify_url; })) {
      return res.status(409).json({ error: 'Song is already in this playlist' });
    }
    if ((playlist.songs || []).length >= 100) return res.status(400).json({ error: 'Playlist is full' });
    await users.updateOne(
      { _id: new ObjectId(user.userId), 'playlists.id': req.params.id },
      { $push: { 'playlists.$.songs': song } }
    );
    res.status(201).json({ message: 'Song added', song });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/playlist/:id/songs/:trackId - remove one Spotify track
router.delete('/:id/songs/:trackId', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  if (!/^[A-Za-z0-9]+$/.test(req.params.trackId)) return res.status(400).json({ error: 'Invalid track ID' });
  const spotifyUrl = 'https://open.spotify.com/track/' + req.params.trackId;
  try {
    const db = await getDB();
    const result = await db.collection('users').updateOne(
      { _id: new ObjectId(user.userId), 'playlists.id': req.params.id, 'playlists.songs.spotify_url': spotifyUrl },
      { $pull: { 'playlists.$.songs': { spotify_url: spotifyUrl } } }
    );
    if (!result.modifiedCount) return res.status(404).json({ error: 'Song or playlist not found' });
    res.json({ message: 'Song removed' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/playlist/:id - rename a playlist
router.patch('/:id', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const name = cleanText(req.body.name, 80);
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const db = await getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(user.userId), 'playlists.id': req.params.id },
      { $set: { 'playlists.$.name': name } }
    );
    res.json({ message: 'Playlist renamed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/playlist/:id/share - toggle public sharing
router.patch('/:id/share', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const { isPublic } = req.body;
  try {
    const db = await getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(user.userId), 'playlists.id': req.params.id },
      { $set: { 'playlists.$.isPublic': !!isPublic } }
    );
    res.json({ message: 'Updated', isPublic: !!isPublic });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/playlist/public/:id - fetch a public playlist (no auth required)
router.get('/public/:id', async (req, res) => {
  try {
    const db = await getDB();
    const user = await db.collection('users').findOne(
      { 'playlists.id': req.params.id, 'playlists.isPublic': true },
      { projection: { 'playlists.$': 1, username: 1 } }
    );
    if (!user || !user.playlists || !user.playlists[0]) {
      return res.status(404).json({ error: 'Playlist not found or not public' });
    }
    res.json({ playlist: user.playlists[0], owner: user.username });
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
