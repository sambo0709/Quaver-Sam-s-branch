const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const SCOPES = [
  'playlist-modify-public',
  'playlist-modify-private',
  'user-read-private',
  'user-read-email'
].join(' ');

// GET /spotify/login - redirect to Spotify auth
router.get('/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    scope: SCOPES,
    show_dialog: 'true',
  });
  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

// GET /spotify/callback - Spotify redirects here
router.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/Index.html?error=spotify_denied');

  try {
    const credentials = Buffer.from(
      process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
    ).toString('base64');

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + credentials,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.redirect('/Index.html?error=spotify_token_failed');
    }
    console.log('Spotify scopes granted:', tokenData.scope);

    // Get Spotify user info
    const userRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
    });
    const spotifyUser = await userRes.json();

    // Create a short-lived JWT with Spotify tokens
    const spotifyToken = jwt.sign({
      spotify_access_token: tokenData.access_token,
      spotify_refresh_token: tokenData.refresh_token,
      spotify_user_id: spotifyUser.id,
      spotify_display_name: spotifyUser.display_name || spotifyUser.id,
    }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Redirect back to app with token in URL fragment
    res.redirect('/Index.html?spotify_token=' + spotifyToken + '&spotify_name=' + encodeURIComponent(spotifyUser.display_name || spotifyUser.id));
  } catch (err) {
    console.error('Spotify callback error:', err);
    res.redirect('/Index.html?error=spotify_error');
  }
});

// POST /spotify/export - create playlist on Spotify
router.post('/export', async (req, res) => {
  const { playlistName, trackUris, spotifyToken } = req.body;

  if (!playlistName || !trackUris || !spotifyToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    let decoded;
    try {
      decoded = jwt.verify(spotifyToken, process.env.JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({ error: 'Spotify session expired. Please login with Spotify again.' });
    }
    const accessToken = decoded.spotify_access_token;

    // Create the playlist
    const createRes = await fetch('https://api.spotify.com/v1/me/playlists', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: playlistName,
        description: 'Created with Quaver 🎵',
        public: true,
      }),
    });

    const playlist = await createRes.json();
    console.log('Playlist created:', playlist.id, 'owner:', playlist.owner?.id);
    if (!playlist.id) {
      console.error('Spotify create playlist failed:', JSON.stringify(playlist));
      if (createRes.status === 401) {
        return res.status(401).json({ error: 'Spotify session expired. Please login with Spotify again.' });
      }
      return res.status(500).json({ error: 'Failed to create playlist on Spotify: ' + (playlist.error?.message || 'unknown error') });
    }

    // Sanitize URIs — strip any query params (e.g. ?si=...) that Spotify rejects
    const cleanUris = trackUris.map(function(uri) {
      const parts = uri.split('?');
      return parts[0];
    });

    // Add tracks to playlist
    const addRes = await fetch('https://api.spotify.com/v1/playlists/' + playlist.id + '/tracks', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: cleanUris }),
    });

    const addData = await addRes.json();
    if (!addData.snapshot_id) {
      console.error('Spotify add tracks failed:', addRes.status, JSON.stringify(addData));
      console.error('Track URIs sent:', JSON.stringify(trackUris));
      return res.status(500).json({ error: 'Failed to add tracks: ' + (addData.error?.message || addRes.status) });
    }

    res.json({
      message: 'Playlist exported to Spotify!',
      playlist_url: playlist.external_urls.spotify,
      playlist_id: playlist.id,
    });
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Export failed. Please login with Spotify again.' });
  }
});

// POST /spotify/refresh - silently get a new access token using the refresh token
router.post('/refresh', async (req, res) => {
  const { spotifyToken } = req.body;
  if (!spotifyToken) return res.status(400).json({ error: 'Missing token' });

  try {
    const decoded = jwt.verify(spotifyToken, process.env.JWT_SECRET, { ignoreExpiration: true });
    const refreshToken = decoded.spotify_refresh_token;
    if (!refreshToken) return res.status(400).json({ error: 'No refresh token available' });

    const credentials = Buffer.from(
      process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
    ).toString('base64');

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + credentials,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(401).json({ error: 'Could not refresh. Please login with Spotify again.' });
    }

    const newSpotifyToken = jwt.sign({
      spotify_access_token: tokenData.access_token,
      spotify_refresh_token: tokenData.refresh_token || refreshToken,
      spotify_user_id: decoded.spotify_user_id,
      spotify_display_name: decoded.spotify_display_name,
    }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.json({ spotifyToken: newSpotifyToken });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(401).json({ error: 'Session expired. Please login with Spotify again.' });
  }
});

module.exports = router;