/**
 * Validate the environment once, at boot, and fail fast with a readable message
 * instead of surfacing a vague 500 on the first DB or Spotify call.
 *
 * Loaded by server.js only. Route files still read process.env directly.
 */
'use strict';

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

const errors = [];
const warnings = [];

function requireVar(name, { minLength = 1, url = false } = {}) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    errors.push(`${name} is required but not set`);
    return '';
  }
  if (value.length < minLength) {
    errors.push(`${name} must be at least ${minLength} characters (got ${value.length})`);
  }
  if (url && !isUrl(value)) {
    errors.push(`${name} must be a valid URL (got "${value}")`);
  }
  return value;
}

// Spotify features degrade rather than crash the process in dev; in production a
// missing credential is a deploy mistake and should stop the boot.
function spotifyVar(name, { url = false } = {}) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    (isProd ? errors : warnings).push(
      `${name} is not set — Spotify search, recommendations and playback will not work`,
    );
    return '';
  }
  if (url && !isUrl(value)) {
    errors.push(`${name} must be a valid URL (got "${value}")`);
  }
  return value;
}

function isUrl(value) {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch (_) {
    return false;
  }
}

const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,
  isTest,
  mongoUri: isTest ? (process.env.MONGODB_URI || '') : requireVar('MONGODB_URI'),
  jwtSecret: isTest
    ? (process.env.JWT_SECRET || 'test-secret')
    : requireVar('JWT_SECRET', { minLength: 16 }),
  appOrigin: process.env.APP_ORIGIN || '',
  spotify: {
    clientId: spotifyVar('SPOTIFY_CLIENT_ID'),
    clientSecret: spotifyVar('SPOTIFY_CLIENT_SECRET'),
    redirectUri: spotifyVar('SPOTIFY_REDIRECT_URI', { url: true }),
  },
};

if (process.env.APP_ORIGIN && !isUrl(process.env.APP_ORIGIN)) {
  errors.push(`APP_ORIGIN must be a valid URL (got "${process.env.APP_ORIGIN}")`);
}

if (warnings.length) {
  console.warn(`[config] warnings:\n  - ${warnings.join('\n  - ')}`);
}
if (errors.length && !isTest) {
  console.error(`[config] invalid environment:\n  - ${errors.join('\n  - ')}`);
  console.error('[config] set the variables above, then restart.');
  process.exit(1);
}

module.exports = config;
