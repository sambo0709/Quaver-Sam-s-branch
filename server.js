// Must be first: lets Sentry instrument http/express before they load.
const Sentry = require('./instrument');

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');

dotenv.config();

// Validate the environment before anything else touches it (exits on failure).
const config = require('./config');

const app = express();
const PORT = config.port;

// Serve the built, content-hashed assets from dist/ when `npm run build` has
// run; fall back to the raw sources in public/ otherwise (dev, or an un-built
// deploy). Everything downstream uses STATIC_DIR / STATIC_ROOT.
const STATIC_DIR = fs.existsSync(path.join(__dirname, 'dist', 'Index.html')) ? 'dist' : 'public';
const STATIC_ROOT = path.join(__dirname, STATIC_DIR);
console.log(`Serving static assets from ${STATIC_DIR}/`);

// Middleware
// Render terminates HTTPS at its proxy and forwards the original client IP.
app.set('trust proxy', 1);
const allowedOrigins = new Set([
  process.env.APP_ORIGIN,
  'https://quaver.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // A single active session fires 15-25 API calls on load plus one per mix, so
  // 100/15min locked real users out. Overridable via env.
  max: Number(process.env.API_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many requests, please try again later.' },
});
const spotifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many Spotify requests, please slow down.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});
app.use(['/api/auth/login', '/api/auth/register'], authLimiter);
app.use('/api/', limiter);
app.use('/spotify/', spotifyLimiter);
app.use(['/api/auth', '/spotify'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const spaRoutes = ['/', '/Index.html', '/index.html', '/search.html', '/playlists.html', '/profile.html', '/settings.html', '/archive.html', '/discover.html'];
app.get(spaRoutes, (req, res, next) => {
  // The client router reuses the existing page documents as view templates.
  if (req.get('X-Quaver-View') === '1') return next();
  return res.sendFile(path.join(STATIC_ROOT, 'Index.html'));
});
app.use(express.static(STATIC_DIR, {
  // Hashed filenames are safe to cache hard; HTML must stay fresh.
  setHeaders(res, filePath) {
    if (/\.[0-9a-f]{10}\.(?:js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Routes
app.use('/api/mood', require('./routes/mood'));
app.use('/api/music', require('./routes/music'));
app.use('/api/playlist', require('./routes/playlist'));
app.use('/api/listening', require('./routes/listening'));
app.use('/api/taste', require('./routes/taste'));
app.use('/api/auth', require('./routes/auth'));
app.use('/spotify', require('./routes/spotify_auth'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Mood Music API is running!' });
});

// Sink for front-end errors (window.onerror / unhandledrejection). Rate-limited
// hard so a broken client can't flood it; forwarded to Sentry when configured.
const clientErrorLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.post('/api/client-errors', clientErrorLimiter, (req, res) => {
  const b = req.body || {};
  const message = String(b.message || '').slice(0, 500);
  if (!message) return res.status(400).json({ error: 'message required' });
  const context = {
    url: String(b.url || '').slice(0, 500),
    stack: String(b.stack || '').slice(0, 4000),
    userAgent: req.get('user-agent'),
  };
  if (Sentry.enabled) {
    Sentry.captureException(new Error(message), { extra: context, tags: { source: 'browser' } });
  } else {
    console.error('[client-error]', message, context.url);
  }
  res.status(204).end();
});

// Turn unhandled route errors into JSON, not an Express HTML stack page.
if (Sentry.enabled) Sentry.setupExpressErrorHandler(app);
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled]', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(err && err.status ? err.status : 500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// One-time data migration (embedded user-doc arrays -> own collections).
// Guarded by a marker in `_migrations`, so this is a no-op on every boot after
// the first and can never clobber data written through the API afterwards.
if (!config.isTest) {
  (async () => {
    try {
      const { getDB } = require('./routes/db');
      const { runOnce } = require('./lib/migrate');
      await runOnce(await getDB(), { log: console.log });
    } catch (err) {
      console.error('[migrate] startup migration failed (will retry next boot):', err.message);
      if (Sentry.enabled) Sentry.captureException(err);
    }
  })();
}
