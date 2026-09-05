const express = require('express');
const router = express.Router();
const { getDB } = require('./db');
const { getUser } = require('./session');
const { MOOD_PROFILES, parseRecommendationContext, buildSearchQueries, rankSongs } = require('./recommendation-engine');

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

function sotdDateKey(date) {
  return (date || new Date()).toISOString().slice(0, 10);
}

// Per-mood pool cache — avoids hitting Spotify on every recommend request
const moodPoolCache = {};
const POOL_TTL = 2 * 60 * 60 * 1000; // 2 hours
const POOL_STALE_TTL = 24 * 60 * 60 * 1000; // retain a fallback during Spotify outages
const SEARCH_TTL = 6 * 60 * 60 * 1000;
const SEARCH_STALE_TTL = 7 * 24 * 60 * 60 * 1000;
const searchCache = new Map();
const searchRequests = new Map();
const artistImageCache = new Map();
let lastSpotifySearchAt = 0;
let spotifySearchGate = Promise.resolve();
const SPOTIFY_SEARCH_INTERVAL = 250;

async function waitForSpotifySearchSlot() {
  let release;
  const previous = spotifySearchGate;
  spotifySearchGate = new Promise(function(resolve) { release = resolve; });
  await previous;
  const wait = Math.max(0, SPOTIFY_SEARCH_INTERVAL - (Date.now() - lastSpotifySearchAt));
  if (wait) await new Promise(function(resolve) { setTimeout(resolve, wait); });
  lastSpotifySearchAt = Date.now();
  release();
}

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

async function getMoodPool(context, token) {
  const cacheKey = JSON.stringify(context);
  const entry = moodPoolCache[cacheKey];
  if (entry && Date.now() < entry.expiresAt) {
    return entry.songs;
  }
  try {
    // Spotify Search currently returns at most 10 tracks per request, which is
    // also Quaver's maximum result count. A second query is only used if the
    // first one returns no tracks.
    const songs = await searchTracks(buildSearchQueries(context), token, 10);
    moodPoolCache[cacheKey] = { songs, expiresAt: Date.now() + POOL_TTL, staleUntil: Date.now() + POOL_STALE_TTL };
    return songs;
  } catch (error) {
    if (entry && Date.now() < entry.staleUntil) return entry.songs;
    throw error;
  }
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
    if (doc && doc.expiresAt > Date.now() && doc.picks?.date === sotdDateKey()) {
      sotdCache = doc.picks;
      sotdExpiresAt = doc.expiresAt;
    }
  } catch (_) {}
}

async function saveSotdToDB(picks, expiresAt) {
  try {
    const db = await getDB();
    await Promise.all([
      db.collection('sotd_cache').updateOne({ _id: 'sotd' }, { $set: { picks, expiresAt } }, { upsert: true }),
      db.collection('sotd_archive').updateOne(
        { _id: picks.date },
        { $setOnInsert: { date: picks.date, mood: picks.mood, songs: picks.songs.slice(0, 3), createdAt: new Date() } },
        { upsert: true }
      ),
    ]);
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
  for (const query of queries) {
    const songs = await cachedSpotifySearch(query, token);
    if (songs.length) return songs.slice(0, limit);
  }
  return [];
}

async function loadSearchCache(query) {
  const memoryEntry = searchCache.get(query);
  if (memoryEntry) return memoryEntry;
  try {
    const db = await getDB();
    const entry = await db.collection('spotify_search_cache').findOne({ _id: query });
    if (entry && Array.isArray(entry.songs)) {
      searchCache.set(query, entry);
      return entry;
    }
  } catch (_) {}
  return null;
}

async function saveSearchCache(query, songs) {
  const entry = { songs, expiresAt: Date.now() + SEARCH_TTL, staleUntil: Date.now() + SEARCH_STALE_TTL };
  searchCache.set(query, entry);
  try {
    const db = await getDB();
    await db.collection('spotify_search_cache').updateOne({ _id: query }, { $set: entry }, { upsert: true });
  } catch (_) {}
  return songs;
}

async function cachedSpotifySearch(query, token) {
  const cached = await loadSearchCache(query);
  if (cached && Date.now() < cached.expiresAt) return cached.songs;
  if (searchRequests.has(query)) return searchRequests.get(query);

  const request = (async function() {
    try {
      await waitForSpotifySearchSlot();
      const url = 'https://api.spotify.com/v1/search?q=' + encodeURIComponent(query) + '&type=track&limit=10';
      let res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
      if (retryAfter > 15) throw new Error('Spotify rate limit active for ' + retryAfter + 's. Try again later.');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    }
    if (res.status === 429) throw await spotifyApiError(res, 'Spotify rate limit reached');
    if (!res.ok) throw await spotifyApiError(res, 'Spotify search failed');
    const data = await res.json();
    if (!data.tracks || !data.tracks.items) throw new Error('Spotify error: ' + JSON.stringify(data));
      const songs = data.tracks.items.map(function(track) {
      return {
        trackId: track.id,
        title: track.name,
        artist: track.artists.map(function(a) { return a.name; }).join(', '),
        duration: msToMinSec(track.duration_ms),
        explicit: !!track.explicit,
        preview_url: track.preview_url,
        spotify_url: track.external_urls.spotify,
        album_art: track.album.images[1] ? track.album.images[1].url : null,
      };
      });
      return saveSearchCache(query, songs);
    } catch (error) {
      if (cached && Date.now() < cached.staleUntil) return cached.songs;
      throw error;
    } finally {
      searchRequests.delete(query);
    }
  })();
  searchRequests.set(query, request);
  return request;
}

function msToMinSec(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return mins + ':' + secs;
}

router.get('/recommend', async function(req, res) {
  const mood = req.query.mood;
  const limit = req.query.limit;
  let songLimit = Math.min(Math.max(parseInt(limit) || 5, 1), 10);
  const allowExplicit = req.query.explicit !== 'false';
  const variety = ['familiar', 'balanced', 'adventurous'].includes(req.query.variety) ? req.query.variety : 'balanced';
  const context = { ...parseRecommendationContext(req.query), variety };
  songLimit = Math.min(songLimit, Math.max(1, Math.floor(context.minutes / 3.5)));

  if (!mood || !moodToSearch[mood.toLowerCase()]) {
    return res.status(400).json({ error: 'Invalid mood', available: Object.keys(moodToSearch) });
  }

  try {
    const token = await getSpotifyToken();
    let pool = (await getMoodPool(context, token)).filter(function(song) { return allowExplicit || !song.explicit; });
    const unfilteredForVariety = pool.slice();
    const user = getUser(req);
    const history = { liked: new Set(), disliked: new Set(), played: new Set(), likedArtists: new Set(), skipped: new Map(), completed: new Map(), artistAffinity: new Map() };
    if (user) {
      try {
        const db = await getDB();
        const found = await db.collection('users').findOne(
          { _id: new (require('mongodb').ObjectId)(user.userId) },
          { projection: { recommendationFeedback: 1, recommendationEvents: 1, listeningHistory: 1 } }
        );
        const playsById = new Map((found?.listeningHistory || []).map(function(item) { return [item.trackId, item]; }));
        (found?.recommendationFeedback || []).forEach(function(item) {
          (item.helpful ? history.liked : history.disliked).add(item.trackId);
          const played = playsById.get(item.trackId);
          if (item.helpful && played?.artist) history.likedArtists.add(String(played.artist).toLowerCase());
        });
        (found?.listeningHistory || []).forEach(function(item) { if (item.trackId) history.played.add(item.trackId); });
        (found?.recommendationEvents || []).forEach(function(item) {
          if (!item.trackId) return;
          if (item.type === 'skip') history.skipped.set(item.trackId, (history.skipped.get(item.trackId) || 0) + 1);
          if (item.type === 'complete') history.completed.set(item.trackId, (history.completed.get(item.trackId) || 0) + 1);
          const artist = String(item.details?.artist || '').toLowerCase();
          if (artist && (item.type === 'skip' || item.type === 'complete')) {
            const change = item.type === 'complete' ? 1 : -1;
            history.artistAffinity.set(artist, (history.artistAffinity.get(artist) || 0) + change);
          }
        });
      } catch (_) {}
    }
    function trackId(song) { return song.spotify_url ? song.spotify_url.split('/track/')[1]?.split('?')[0] : ''; }
    if (variety === 'adventurous') pool = pool.filter(function(song) { return !history.liked.has(trackId(song)) && !history.played.has(trackId(song)); });
    if (!pool.length && unfilteredForVariety.length) pool = unfilteredForVariety;
    const songs = rankSongs(pool, context, history, songLimit);
    const learning = user ? {
      personalized: history.liked.size + history.disliked.size + history.played.size + history.skipped.size + history.completed.size > 0,
      ratings: history.liked.size + history.disliked.size,
      completed: Array.from(history.completed.values()).reduce(function(total, count) { return total + count; }, 0),
      skipped: Array.from(history.skipped.values()).reduce(function(total, count) { return total + count; }, 0),
      familiarTracks: history.played.size,
      variety,
    } : { personalized: false, loggedOut: true, ratings: 0, completed: 0, skipped: 0, familiarTracks: 0, variety };
    res.json({ mood: mood, context, profile: MOOD_PROFILES[context.mood], learning, count: songs.length, songs: songs });
  } catch (err) {
    console.error('Spotify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/music/artists?names=Artist%20One,Artist%20Two
// Resolves true Spotify artist portraits for playlist credits. Album artwork is
// still used by the client as a graceful fallback when Spotify has no portrait.
router.get('/artists', async function(req, res) {
  const names = String(req.query.names || '').split('|').map(function(name) { return name.trim().slice(0, 100); }).filter(Boolean).slice(0, 10);
  if (!names.length) return res.json({ artists: [] });
  try {
    const token = await getSpotifyToken();
    const artists = [];
    for (const name of names) {
      const key = name.toLowerCase();
      let artist = artistImageCache.get(key);
      if (!artist) {
        await waitForSpotifySearchSlot();
        const response = await fetch('https://api.spotify.com/v1/search?q=' + encodeURIComponent('artist:' + name) + '&type=artist&limit=1', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!response.ok) continue;
        const data = await response.json();
        const match = data.artists?.items?.[0];
        artist = match ? { name: match.name, requestedName: name, image: match.images?.[1]?.url || match.images?.[0]?.url || '', spotify_url: match.external_urls?.spotify || '' } : { name, requestedName: name, image: '', spotify_url: '' };
        artistImageCache.set(key, artist);
      }
      artists.push(artist);
    }
    res.json({ artists });
  } catch (error) {
    res.status(502).json({ error: 'Artist images are unavailable right now.' });
  }
});

router.post('/feedback', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const { trackId, mood, helpful } = req.body;
  if (!trackId || typeof helpful !== 'boolean') return res.status(400).json({ error: 'trackId and helpful required' });
  try {
    const db = await getDB();
    await db.collection('users').updateOne(
      { _id: new (require('mongodb').ObjectId)(user.userId) },
      { $push: { recommendationFeedback: { $each: [{ trackId, mood: mood || '', helpful, createdAt: Date.now() }], $slice: -500 } } }
    );
    res.status(201).json({ message: 'Feedback saved' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/events', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const allowed = new Set(['impression', 'play', 'meaningful_play', 'save', 'skip', 'complete']);
  const type = String(req.body.type || '');
  const trackId = String(req.body.trackId || '').slice(0, 80);
  const mood = String(req.body.mood || '').slice(0, 20);
  if (!allowed.has(type)) return res.status(400).json({ error: 'Invalid recommendation event' });
  if (['play', 'meaningful_play', 'save', 'skip', 'complete'].includes(type) && !trackId) return res.status(400).json({ error: 'trackId required' });
  const details = req.body.details && typeof req.body.details === 'object' && !Array.isArray(req.body.details) ? req.body.details : {};
  try {
    const db = await getDB();
    await db.collection('users').updateOne(
      { _id: new (require('mongodb').ObjectId)(user.userId) },
      { $push: { recommendationEvents: { $each: [{ type, trackId, mood, details, createdAt: Date.now() }], $slice: -2000 } } }
    );
    res.status(201).json({ message: 'Event recorded' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/feedback', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    await db.collection('users').updateOne({ _id: new (require('mongodb').ObjectId)(user.userId) }, { $set: { recommendationFeedback: [] } });
    res.json({ message: 'Recommendation feedback cleared' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
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
    const allowExplicit = req.query.explicit !== 'false';
    const songs = (data.tracks?.items || []).filter(function(track) { return allowExplicit || !track.explicit; }).map(function(track) {
      return {
        title: track.name,
        artist: track.artists.map(function(a) { return a.name; }).join(', '),
        duration: msToMinSec(track.duration_ms),
        explicit: !!track.explicit,
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

// GET /api/music/sotd/archive — retained daily three-song mixes, newest first
router.get('/sotd/archive', async function(req, res) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 120, 1), 366);
  try {
    const db = await getDB();
    const entries = await db.collection('sotd_archive')
      .find({}, { projection: { _id: 0, date: 1, mood: 1, songs: 1 } })
      .sort({ date: -1 })
      .limit(limit)
      .toArray();
    res.json({ entries });
  } catch (error) {
    res.status(500).json({ error: 'Mood archive is unavailable right now.' });
  }
});

// GET /api/music/sotd — mood of the day: 3 songs from one mood, cached in MongoDB and archived by date
router.get('/sotd', async function(_req, res) {
  // 1. Fast path: in-memory cache still valid
  if (sotdCache && sotdCache.date === sotdDateKey() && Date.now() < sotdExpiresAt) {
    return res.json(sotdCache);
  }

  // 2. Try loading from MongoDB (survives server restarts)
  await loadSotdFromDB();
  if (sotdCache && sotdCache.date === sotdDateKey() && Date.now() < sotdExpiresAt) {
    return res.json(sotdCache);
  }

  // 3. Cache expired or missing — one Spotify call for today's mood
  const mood = getTodayMood();
  try {
    const token = await getSpotifyToken();
    const songs = await searchTracks(moodToSearch[mood], token, 3);
    const payload = { date: sotdDateKey(), mood, songs: songs.slice(0, 3) };
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
