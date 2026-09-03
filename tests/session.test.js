const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'quaver-test-secret-with-sufficient-length';
process.env.NODE_ENV = 'test';

const { getUser, createSession, clearSession } = require('../routes/session');

test('session cookie round-trips authenticated user data', function() {
  let issued;
  const response = {
    cookie(name, value, options) { issued = { name, value, options }; },
  };

  createSession(response, { userId: 'user-123', username: 'Listener', email: 'listener@example.com' });

  assert.equal(issued.name, 'quaver_session');
  assert.equal(issued.options.httpOnly, true);
  assert.equal(issued.options.sameSite, 'lax');
  assert.equal(issued.options.secure, false);
  const user = getUser({ headers: { cookie: issued.name + '=' + encodeURIComponent(issued.value) } });
  assert.equal(user.userId, 'user-123');
  assert.equal(user.username, 'Listener');
  assert.equal(user.email, 'listener@example.com');
});

test('invalid or missing session cookies are rejected', function() {
  assert.equal(getUser({ headers: {} }), null);
  assert.equal(getUser({ headers: { cookie: 'quaver_session=not-a-valid-token' } }), null);
});

test('logout clears the cookie with matching security attributes', function() {
  let cleared;
  clearSession({ clearCookie(name, options) { cleared = { name, options }; } });
  assert.equal(cleared.name, 'quaver_session');
  assert.equal(cleared.options.httpOnly, true);
  assert.equal(cleared.options.sameSite, 'lax');
  assert.equal(cleared.options.path, '/');
});
