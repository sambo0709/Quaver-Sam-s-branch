const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');
const { getUser } = require('./session');

// One document per playlist in the `playlists` collection:
//   { _id, id, userId, name, mood, songs, createdAt, updatedAt, isPublic?, coverImage? }
// `id` is an opaque UUID. `_id` / `userId` are always projected out of responses.
const PUBLIC_PROJECTION = { _id: 0, userId: 0 };

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
function cleanCoverImage(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 650000) return null;
  return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
}

function ownerId(user) {
  return new ObjectId(user.userId);
}

// GET /api/playlist
router.get('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  try {
    const db = await getDB();
    const playlists = await db.collection('playlists')
      .find({ userId: ownerId(user) })
      .project(PUBLIC_PROJECTION)
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    res.json({ playlists });
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

  const now = new Date().toISOString();
  const playlist = {
    id: crypto.randomUUID(),
    name,
    mood,
    songs,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const db = await getDB();
    await db.collection('playlists').insertOne({ ...playlist, userId: ownerId(user) });
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
    const playlists = db.collection('playlists');
    const playlist = await playlists.findOne({ userId: ownerId(user), id: req.params.id });
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    if ((playlist.songs || []).some(function(item) { return item.spotify_url === song.spotify_url; })) {
      return res.status(409).json({ error: 'Song is already in this playlist' });
    }
    if ((playlist.songs || []).length >= 100) return res.status(400).json({ error: 'Playlist is full' });
    await playlists.updateOne(
      { userId: ownerId(user), id: req.params.id },
      { $push: { songs: song }, $set: { updatedAt: new Date().toISOString() } }
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
    const result = await db.collection('playlists').updateOne(
      { userId: ownerId(user), id: req.params.id, 'songs.spotify_url': spotifyUrl },
      { $pull: { songs: { spotify_url: spotifyUrl } }, $set: { updatedAt: new Date().toISOString() } }
    );
    if (!result.modifiedCount) return res.status(404).json({ error: 'Song or playlist not found' });
    res.json({ message: 'Song removed' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id/songs/reorder', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const trackIds = req.body.trackIds;
  if (!Array.isArray(trackIds) || trackIds.length > 100 || !trackIds.every(function(id) { return typeof id === 'string' && /^[A-Za-z0-9]+$/.test(id); }) || new Set(trackIds).size !== trackIds.length) {
    return res.status(400).json({ error: 'Invalid song order' });
  }
  try {
    const db = await getDB();
    const playlists = db.collection('playlists');
    const playlist = await playlists.findOne({ userId: ownerId(user), id: req.params.id });
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    const songsById = new Map((playlist.songs || []).map(function(song) { return [cleanSpotifyUrl(song.spotify_url).split('/').pop(), song]; }));
    if (trackIds.length !== songsById.size || trackIds.some(function(id) { return !songsById.has(id); })) return res.status(400).json({ error: 'Song order does not match playlist' });
    const songs = trackIds.map(function(id) { return songsById.get(id); });
    const updatedAt = new Date().toISOString();
    await playlists.updateOne({ userId: ownerId(user), id: req.params.id }, { $set: { songs: songs, updatedAt: updatedAt } });
    res.json({ message: 'Song order updated', updatedAt });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id/cover', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const coverImage = cleanCoverImage(req.body.coverImage);
  if (coverImage === null) return res.status(400).json({ error: 'Invalid cover image' });
  try {
    const updatedAt = new Date().toISOString();
    const result = await (await getDB()).collection('playlists').updateOne({ userId: ownerId(user), id: req.params.id }, { $set: { coverImage: coverImage, updatedAt: updatedAt } });
    if (!result.matchedCount) return res.status(404).json({ error: 'Playlist not found' });
    res.json({ message: 'Cover updated', updatedAt });
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
    const result = await db.collection('playlists').updateOne(
      { userId: ownerId(user), id: req.params.id },
      { $set: { name: name, updatedAt: new Date().toISOString() } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: 'Playlist not found' });
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
    const result = await db.collection('playlists').updateOne(
      { userId: ownerId(user), id: req.params.id },
      { $set: { isPublic: !!isPublic, updatedAt: new Date().toISOString() } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: 'Playlist not found' });
    res.json({ message: 'Updated', isPublic: !!isPublic });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/playlist/public/:id - fetch a public playlist (no auth required)
router.get('/public/:id', async (req, res) => {
  try {
    const db = await getDB();
    const playlist = await db.collection('playlists').findOne(
      { id: req.params.id, isPublic: true },
      { projection: { _id: 0 } }
    );
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found or not public' });
    }
    const owner = await db.collection('users').findOne(
      { _id: playlist.userId },
      { projection: { username: 1 } }
    );
    delete playlist.userId;
    res.json({ playlist, owner: owner && owner.username });
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
    const result = await db.collection('playlists').deleteOne({ userId: ownerId(user), id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Playlist not found' });
    res.json({ message: 'Playlist deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
