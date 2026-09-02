const express = require('express');
const router = express.Router();
const { getDB } = require('./db');

const moodToSearch = {
  happy:      ['happy pop upbeat', 'feel good hits', 'happy dance music'],
  sad:        ['sad emotional acoustic', 'heartbreak songs', 'melancholy indie'],
  angry:      ['angry rock intense', 'metal aggressive', 'punk rock energy'],
  calm:       ['calm peaceful ambient', 'chill acoustic', 'soft piano'],
  energetic:  ['energetic edm workout', 'pump up hits', 'hype songs'],
  romantic:   ['romantic love songs', 'smooth r&b romance', 'slow dance'],
  focused:    ['lofi study beats', 'concentration music', 'deep focus instrumental'],
  nostalgic:  ['90s throwback hits', 'classic 2000s pop', 'retro nostalgia oldies'],
  party:      ['party anthems dance floor', 'club bangers 2024', 'party hits top 40'],
  sleepy:     ['sleep music gentle', 'calm lullaby ambient', 'night time relaxing'],
  anxious:    ['anxiety relief calm music', 'soothing stress relief', 'mindful meditation music'],
};

let cachedToken = null;
let tokenExpiresAt = 0;

let sotdCache = null;
let sotdExpiresAt = 0;

// Per-mood pool cache — avoids hitting Spotify on every recommend request
const moodPoolCache = {};
const POOL_TTL = 2 * 60 * 60 * 1000; // 2 hours

// Tracks recently served song IDs per mood to avoid repeats
const recentlyServed = {};
const MAX_SEEN = 8; // remember last 8 served per mood

async function spotifyApiError(response, context) {
  let details = '';
  try {
    details = await response.text();
  } catch (_) {}

  const suffix = details ? ' - ' + details : '';
  return new Error(context + ': ' + response.status + ' ' + response.statusText + suffix);
}

async function getMoodPool(mood, token) {
  const entry = moodPoolCache[mood];
  if (entry && Date.now() < entry.expiresAt) {
    return entry.songs;
  }
  const songs = await searchTracks(moodToSearch[mood], token, 10);
  moodPoolCache[mood] = { songs, expiresAt: Date.now() + POOL_TTL };
  return songs;
}

function pickUnseenSongs(pool, mood, limit) {
  const seen = recentlyServed[mood] || [];
  let unseen = pool.filter(function(s) { return !seen.includes(s.spotify_url); });
  // If not enough unseen songs, reset and use full pool
  if (unseen.length < limit) {
    recentlyServed[mood] = [];
    unseen = pool.slice();
  }
  const picked = unseen.sort(function() { return Math.random() - 0.5; }).slice(0, limit);
  // Record served songs
  const ids = picked.map(function(s) { return s.spotify_url; });
  recentlyServed[mood] = (recentlyServed[mood] || []).concat(ids).slice(-MAX_SEEN);
  return picked;
}

const SOTD_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function loadSotdFromDB() {
  try {
    const db = await getDB();
    const doc = await db.collection('sotd_cache').findOne({ _id: 'sotd' });
    if (doc && doc.expiresAt > Date.now()) {
      sotdCache = doc.picks;
      sotdExpiresAt = doc.expiresAt;
    }
  } catch (_) {}
}

async function saveSotdToDB(picks, expiresAt) {
  try {
    const db = await getDB();
    await db.collection('sotd_cache').updateOne(
      { _id: 'sotd' },
      { $set: { picks, expiresAt } },
      { upsert: true }
    );
  } catch (_) {}
}

async function getSpotifyToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  const credentials = Buffer.from(
    process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
  ).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + credentials,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw await spotifyApiError(res, 'Spotify token request failed');
  const data = await res.json();
  if (!data.access_token) throw new Error('Spotify token response did not include an access token');
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // expire 1 min early
  return cachedToken;
}

async function searchTracks(queries, token, limit) {
  const query = queries[Math.floor(Math.random() * queries.length)];
  const url = 'https://api.spotify.com/v1/search?q=' + encodeURIComponent(query) + '&type=track&limit=10';
  let res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
    if (retryAfter > 15) {
      throw new Error('Spotify rate limit active for ' + retryAfter + 's. Try again later.');
    }
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  }

  if (res.status === 429) {
    throw await spotifyApiError(res, 'Spotify rate limit reached');
  }
  if (!res.ok) {
    throw await spotifyApiError(res, 'Spotify search failed');
  }
  const data = await res.json();
  if (!data.tracks || !data.tracks.items) {
    throw new Error('Spotify error: ' + JSON.stringify(data));
  }
  return data.tracks.items
    .sort(() => Math.random() - 0.5)
    .slice(0, limit)
    .map(function(track) {
      return {
        title: track.name,
        artist: track.artists.map(function(a) { return a.name; }).join(', '),
        duration: msToMinSec(track.duration_ms),
        preview_url: track.preview_url,
        spotify_url: track.external_urls.spotify,
        album_art: track.album.images[1] ? track.album.images[1].url : null,
      };
    });
}

function msToMinSec(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return mins + ':' + secs;
}

router.get('/recommend', async function(req, res) {
  const mood = req.query.mood;
  const limit = req.query.limit;
  const songLimit = Math.min(Math.max(parseInt(limit) || 5, 1), 10);

  if (!mood || !moodToSearch[mood.toLowerCase()]) {
    return res.status(400).json({ error: 'Invalid mood', available: Object.keys(moodToSearch) });
  }

  try {
    const token = await getSpotifyToken();
    const pool = await getMoodPool(mood.toLowerCase(), token);
    const songs = pickUnseenSongs(pool, mood.toLowerCase(), songLimit);
    res.json({ mood: mood, count: songs.length, songs: songs });
  } catch (err) {
    console.error('Spotify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/music/search?q=...&genre=...&year=... - search for specific songs/artists
router.get('/search', async function(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query required' });
  const genre = (req.query.genre || '').trim();
  const year = (req.query.year || '').trim();
  let query = q;
  if (genre) query += ' genre:' + genre;
  if (year) query += ' year:' + year;
  try {
    const token = await getSpotifyToken();
    const url = 'https://api.spotify.com/v1/search?q=' + encodeURIComponent(query) + '&type=track&limit=10';
    const searchRes = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!searchRes.ok) throw await spotifyApiError(searchRes, 'Spotify search failed');
    const data = await searchRes.json();
    const songs = (data.tracks?.items || []).map(function(track) {
      return {
        title: track.name,
        artist: track.artists.map(function(a) { return a.name; }).join(', '),
        duration: msToMinSec(track.duration_ms),
        preview_url: track.preview_url,
        spotify_url: track.external_urls.spotify,
        album_art: track.album.images[1] ? track.album.images[1].url : null,
      };
    });
    res.json({ query: q, count: songs.length, songs });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Pick today's mood deterministically from the date (same mood for all users all day)
function getTodayMood() {
  const all = ['happy', 'sad', 'energetic', 'calm', 'focused', 'angry', 'romantic', 'nostalgic', 'party', 'sleepy', 'anxious'];
  const d = new Date();
  const dayNum = d.getFullYear() * 366 + d.getMonth() * 31 + d.getDate();
  return all[dayNum % all.length];
}

// GET /api/music/sotd — mood of the day: 3 songs from one mood, cached in MongoDB for 24 hours
router.get('/sotd', async function(_req, res) {
  // 1. Fast path: in-memory cache still valid
  if (sotdCache && Date.now() < sotdExpiresAt) {
    return res.json(sotdCache);
  }

  // 2. Try loading from MongoDB (survives server restarts)
  await loadSotdFromDB();
  if (sotdCache && Date.now() < sotdExpiresAt) {
    return res.json(sotdCache);
  }

  // 3. Cache expired or missing — one Spotify call for today's mood
  const mood = getTodayMood();
  try {
    const token = await getSpotifyToken();
    const songs = await searchTracks(moodToSearch[mood], token, 3);
    const payload = { mood, songs };
    const expiresAt = Date.now() + SOTD_TTL_MS;
    sotdCache = payload;
    sotdExpiresAt = expiresAt;
    await saveSotdToDB(payload, expiresAt);
    res.json(payload);
  } catch (err) {
    console.error('MOTD error:', err.message);
    if (sotdCache) return res.json(sotdCache); // serve stale on error
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
