const express = require('express');
const router = express.Router();

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
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Spotify token');
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // expire 1 min early
  return cachedToken;
}

async function searchTracks(queries, token, limit) {
  const query = queries[Math.floor(Math.random() * queries.length)];
  const url = 'https://api.spotify.com/v1/search?q=' + encodeURIComponent(query) + '&type=track&limit=10';
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (res.status === 429) {
    throw new Error('Spotify rate limit reached. Please try again in a moment.');
  }
  if (!res.ok) {
    throw new Error('Spotify API error: ' + res.status);
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
    const songs = await searchTracks(moodToSearch[mood.toLowerCase()], token, songLimit);
    res.json({ mood: mood, count: songs.length, songs: songs });
  } catch (err) {
    console.error('Spotify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/music/search?q=... - search for specific songs/artists
router.get('/search', async function(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const token = await getSpotifyToken();
    const url = 'https://api.spotify.com/v1/search?q=' + encodeURIComponent(q) + '&type=track&limit=10';
    const searchRes = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (searchRes.status === 429) throw new Error('Spotify rate limit reached. Please try again in a moment.');
    if (!searchRes.ok) throw new Error('Spotify API error: ' + searchRes.status);
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

// GET /api/music/sotd — one song per mood, cached server-side for 1 hour
router.get('/sotd', async function(_req, res) {
  if (sotdCache && Date.now() < sotdExpiresAt) {
    return res.json({ picks: sotdCache });
  }

  const moodList = ['happy', 'sad', 'energetic', 'calm', 'focused', 'romantic'];
  try {
    const token = await getSpotifyToken();
    const picks = [];
    for (let i = 0; i < moodList.length; i++) {
      const mood = moodList[i];
      const songs = await searchTracks(moodToSearch[mood], token, 1);
      if (songs[0]) {
        songs[0].mood = mood;
        picks.push(songs[0]);
      }
    }
    sotdCache = picks;
    sotdExpiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
    res.json({ picks });
  } catch (err) {
    console.error('SOTD error:', err.message);
    if (sotdCache) return res.json({ picks: sotdCache }); // serve stale cache on error
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
