const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'quaver_session';
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const useSecureCookies = () => process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce(function(cookies, part) {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function getUser(req) {
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    return token ? jwt.verify(token, process.env.JWT_SECRET) : null;
  } catch (_) { return null; }
}

function createSession(res, payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_AGE_MS,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: 'lax',
    path: '/',
  });
}

module.exports = { getUser, createSession, clearSession };
