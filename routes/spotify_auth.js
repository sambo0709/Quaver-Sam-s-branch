const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');

const SCOPES = [
  'playlist-modify-public',
  'playlist-modify-private',
  'user-read-private',
  'user-read-email',
  'streaming',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state'
].join(' ');

const PLAYBACK_SCOPES = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
];

function getQuaverUser(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  try { return jwt.verify(header.split(' ')[1], process.env.JWT_SECRET); }
  catch (_) { return null; }
}

function encryptionKey() {
  return crypto.createHash('sha256').update(process.env.JWT_SECRET).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(value) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}

function authorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    scope: SCOPES,
    show_dialog: 'true',
  });
  if (state) params.set('state', state);
  return 'https://accounts.spotify.com/authorize?' + params.toString();
}

function hasPlaybackScopes(scopes) {
  const granted = new Set(String(scopes || '').split(/\s+/).filter(Boolean));
  return PLAYBACK_SCOPES.every((scope) => granted.has(scope));
}

function createSpotifySession(accessToken, refreshToken, spotifyUser) {
  const payload = {
    spotify_access_token: accessToken,
    spotify_user_id: spotifyUser.id,
    spotify_display_name: spotifyUser.displayName,
  };
  // Kept only for the legacy direct-login flow. Account-linked sessions keep
  // the reusable refresh credential encrypted on the server.
  if (refreshToken) payload.spotify_refresh_token = refreshToken;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function refreshAccessToken(refreshToken) {
  const credentials = Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('Spotify refresh failed');
  return data;
}

router.post('/connect', (req, res) => {
  const user = getQuaverUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to Quaver first.' });
  const state = jwt.sign({ userId: String(user.userId), purpose: 'spotify-connect' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  res.json({ url: authorizationUrl(state) });
});

// GET /spotify/login - redirect to Spotify auth
router.get('/login', (req, res) => {
  res.redirect(authorizationUrl());
});

// GET /spotify/callback - Spotify redirects here
router.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/Index.html?error=spotify_denied');

  try {
    let quaverUserId = null;
    if (req.query.state) {
      const state = jwt.verify(req.query.state, process.env.JWT_SECRET);
      if (state.purpose !== 'spotify-connect') throw new Error('Invalid Spotify state');
      quaverUserId = state.userId;
    }
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
    // Get Spotify user info
    const userRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
    });
    const spotifyUser = await userRes.json();

    const spotifyIdentity = { id: spotifyUser.id, displayName: spotifyUser.display_name || spotifyUser.id };
    if (quaverUserId && tokenData.refresh_token) {
      const db = await getDB();
      await db.collection('users').updateOne(
        { _id: new ObjectId(quaverUserId) },
        { $set: { spotifyConnection: {
          userId: spotifyIdentity.id,
          displayName: spotifyIdentity.displayName,
          refreshToken: encrypt(tokenData.refresh_token),
          scopes: tokenData.scope || SCOPES,
          connectedAt: new Date(),
        } } }
      );
    }

    // Create a short-lived JWT with Spotify tokens
    const spotifyToken = createSpotifySession(tokenData.access_token, quaverUserId ? null : tokenData.refresh_token, spotifyIdentity);

    // Redirect back to app with token in URL fragment
    res.redirect('/Index.html?spotify_token=' + spotifyToken + '&spotify_name=' + encodeURIComponent(spotifyUser.display_name || spotifyUser.id));
  } catch (err) {
    console.error('Spotify callback error:', err);
    res.redirect('/Index.html?error=spotify_error');
  }
});

router.get('/status', async (req, res) => {
  const user = getQuaverUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    const found = await db.collection('users').findOne(
      { _id: new ObjectId(user.userId) },
      { projection: { spotifyConnection: 1 } }
    );
    const connection = found && found.spotifyConnection;
    res.json({
      connected: !!connection,
      displayName: connection?.displayName || null,
      playbackReady: !!connection && hasPlaybackScopes(connection.scopes),
    });
  } catch (_) { res.status(500).json({ error: 'Could not check Spotify connection' }); }
});

router.post('/session', async (req, res) => {
  const user = getQuaverUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    const found = await db.collection('users').findOne({ _id: new ObjectId(user.userId) }, { projection: { spotifyConnection: 1 } });
    if (!found?.spotifyConnection?.refreshToken) return res.status(404).json({ error: 'Spotify is not connected' });
    const refreshToken = decrypt(found.spotifyConnection.refreshToken);
    const tokenData = await refreshAccessToken(refreshToken);
    const activeRefreshToken = tokenData.refresh_token || refreshToken;
    if (tokenData.refresh_token) {
      await db.collection('users').updateOne({ _id: found._id }, { $set: { 'spotifyConnection.refreshToken': encrypt(activeRefreshToken) } });
    }
    const identity = { id: found.spotifyConnection.userId, displayName: found.spotifyConnection.displayName };
    res.json({ spotifyToken: createSpotifySession(tokenData.access_token, null, identity), displayName: identity.displayName });
  } catch (error) {
    console.error('Spotify account session error:', error);
    res.status(401).json({ error: 'Spotify needs to be reconnected' });
  }
});

// The Web Playback SDK must receive a short-lived Spotify access token in the
// browser. The reusable refresh token remains encrypted in MongoDB and is
// never returned to the client.
router.post('/playback-token', async (req, res) => {
  const user = getQuaverUser(req);
  if (!user) return res.status(401).json({ code: 'QUAVER_LOGIN_REQUIRED', error: 'Log in to Quaver first.' });

  try {
    const db = await getDB();
    const found = await db.collection('users').findOne(
      { _id: new ObjectId(user.userId) },
      { projection: { spotifyConnection: 1 } }
    );
    const connection = found?.spotifyConnection;
    if (!connection?.refreshToken) {
      return res.status(404).json({ code: 'SPOTIFY_NOT_CONNECTED', error: 'Connect Spotify in Settings to listen in Quaver.' });
    }
    if (!hasPlaybackScopes(connection.scopes)) {
      return res.status(409).json({
        code: 'SPOTIFY_RECONNECT_REQUIRED',
        error: 'Reconnect Spotify once to enable the new Quaver player.',
      });
    }

    const refreshToken = decrypt(connection.refreshToken);
    const tokenData = await refreshAccessToken(refreshToken);
    if (tokenData.refresh_token) {
      await db.collection('users').updateOne(
        { _id: found._id },
        { $set: { 'spotifyConnection.refreshToken': encrypt(tokenData.refresh_token) } }
      );
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in || 3600,
    });
  } catch (error) {
    console.error('Spotify playback token error:', error);
    res.status(401).json({
      code: 'SPOTIFY_RECONNECT_REQUIRED',
      error: 'Spotify needs to be reconnected in Settings.',
    });
  }
});

router.delete('/connection', async (req, res) => {
  const user = getQuaverUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    await db.collection('users').updateOne({ _id: new ObjectId(user.userId) }, { $unset: { spotifyConnection: '' } });
    res.json({ message: 'Spotify disconnected' });
  } catch (_) { res.status(500).json({ error: 'Could not disconnect Spotify' }); }
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

    // Add tracks to playlist (using query params - more compatible across Spotify API versions)
    const addRes = await fetch('https://api.spotify.com/v1/playlists/' + playlist.id + '/items?uris=' + cleanUris.join(','), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const addData = await addRes.json();
    if (!addData.snapshot_id) {
      // Clean up the empty playlist so it doesn't litter the user's Spotify
      await fetch('https://api.spotify.com/v1/playlists/' + playlist.id + '/followers', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + accessToken },
      }).catch(() => {});
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
