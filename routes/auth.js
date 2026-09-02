const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { getDB } = require('./db');

function getUser(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  try { return jwt.verify(header.split(' ')[1], process.env.JWT_SECRET); }
  catch (_) { return null; }
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email and password are required' });
  }

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

    const token = jwt.sign(
      { userId: result.insertedId, username, email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ message: 'Registered successfully!', token, username, email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const db = await getDB();
    const users = db.collection('users');

    const user = await users.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'No account found with that email' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ message: 'Login successful!', token, username: user.username, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me - verify token and return user info
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ userId: decoded.userId, username: decoded.username, email: decoded.email });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.patch('/settings', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const displayName = String(req.body.displayName || '').trim().slice(0, 40);
  const defaultTheme = ['light', 'dark', 'system'].includes(req.body.defaultTheme) ? req.body.defaultTheme : 'system';
  if (!displayName) return res.status(400).json({ error: 'Display name required' });
  try {
    const db = await getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(user.userId) },
      { $set: { username: displayName, defaultTheme } }
    );
    res.json({ message: 'Settings saved', username: displayName, defaultTheme });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/account', async function(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const db = await getDB();
    await db.collection('users').deleteOne({ _id: new ObjectId(user.userId) });
    res.json({ message: 'Account deleted' });
  } catch (_) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
