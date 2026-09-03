const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');
const { getUser, createSession, clearSession } = require('./session');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email and password are required' });
  }
  if (username.length > 40 || !/^[\p{L}\p{N}_. -]+$/u.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Password must be between 10 and 128 characters' });

  try {
    const db = await getDB();
    const users = db.collection('users');

    const existing = await users.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({ error: 'Username or email already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await users.insertOne({
      username,
      email,
      password: hashedPassword,
      playlists: [],
      recentMoods: [],
      listeningHistory: [],
      createdAt: new Date(),
    });

    createSession(res, { userId: result.insertedId, username, email });
    res.status(201).json({ message: 'Registered successfully!', username, email });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const db = await getDB();
    const users = db.collection('users');

    const user = await users.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Email or password is incorrect' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }

    createSession(res, { userId: user._id, username: user.username, email: user.email });
    res.json({ message: 'Login successful!', username: user.username, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me - verify token and return user info
router.get('/me', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ userId: user.userId, username: user.username, email: user.email });
});

router.post('/logout', function(req, res) {
  clearSession(res);
  res.json({ message: 'Logged out' });
});

router.get('/settings', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    const found = await db.collection('users').findOne(
      { _id: new ObjectId(user.userId) },
      { projection: { username: 1, defaultTheme: 1, preferences: 1 } }
    );
    if (!found) return res.status(404).json({ error: 'Account not found' });
    res.json({ username: found.username, defaultTheme: found.defaultTheme || 'system', preferences: found.preferences || {} });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/settings', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const displayName = String(req.body.displayName || '').trim().slice(0, 40);
  const defaultTheme = ['light', 'dark', 'system'].includes(req.body.defaultTheme) ? req.body.defaultTheme : 'system';
  const allowedMoods = ['happy', 'sad', 'angry', 'calm', 'energetic', 'romantic', 'focused', 'nostalgic', 'party', 'sleepy', 'anxious'];
  const defaultMood = allowedMoods.includes(req.body.defaultMood) ? req.body.defaultMood : '';
  const songCount = [5, 8, 10].includes(Number(req.body.songCount)) ? Number(req.body.songCount) : 5;
  const reducedMotion = !!req.body.reducedMotion;
  const explicitContent = req.body.explicitContent !== false;
  const recommendationVariety = ['familiar', 'balanced', 'adventurous'].includes(req.body.recommendationVariety) ? req.body.recommendationVariety : 'balanced';
  if (!displayName) return res.status(400).json({ error: 'Display name required' });
  try {
    const db = await getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(user.userId) },
      { $set: { username: displayName, defaultTheme, preferences: { defaultMood, songCount, reducedMotion, explicitContent, recommendationVariety } } }
    );
    res.json({ message: 'Settings saved', username: displayName, defaultTheme, preferences: { defaultMood, songCount, reducedMotion, explicitContent, recommendationVariety } });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ error: 'Display name already taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/password', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 128) return res.status(400).json({ error: 'New password must be between 10 and 128 characters' });
  try {
    const db = await getDB();
    const found = await db.collection('users').findOne({ _id: new ObjectId(user.userId) });
    if (!found || !(await bcrypt.compare(currentPassword, found.password))) return res.status(401).json({ error: 'Current password is incorrect' });
    await db.collection('users').updateOne({ _id: found._id }, { $set: { password: await bcrypt.hash(newPassword, 10) } });
    createSession(res, { userId: found._id, username: found.username, email: found.email });
    res.json({ message: 'Password updated' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/export', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    const found = await db.collection('users').findOne({ _id: new ObjectId(user.userId) }, { projection: { password: 0, 'spotifyConnection.refreshToken': 0 } });
    if (!found) return res.status(404).json({ error: 'Account not found' });
    res.setHeader('Content-Disposition', 'attachment; filename="quaver-account-data.json"');
    res.json(found);
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/account', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    await db.collection('users').deleteOne({ _id: new ObjectId(user.userId) });
    clearSession(res);
    res.json({ message: 'Account deleted' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
