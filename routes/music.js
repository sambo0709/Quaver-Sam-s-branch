const express = require('express');
const router = express.Router();

const moodToSearch = {
  happy:     ['happy pop upbeat', 'feel good hits', 'happy dance music'],
  sad:       ['sad emotional acoustic', 'heartbreak songs', 'melancholy indie'],
  angry:     ['angry rock intense', 'metal aggressive', 'punk rock energy'],
  calm:      ['calm peaceful ambient', 'chill acoustic', 'soft piano'],
  energetic: ['energetic edm workout', 'pump up hits', 'hype songs'],
  romantic:  ['romantic love songs', 'smooth r&b romance', 'slow dance'],
  focused:   ['lofi study beats', 'concentration music', 'deep focus instrumental'],
};

async function getSpotifyToken() {
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
  return data.access_token;
}

async function searchTracks(queries, token, limit) {
  const query = queries[Math.floor(Math.random() * queries.length)];
  const url = 'https://api.spotify.com/v1/search?q=' + encodeURIComponent(query) + '&type=track&limit=10';
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
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

module.exports = router;
