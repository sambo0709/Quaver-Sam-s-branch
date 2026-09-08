'use strict';

/**
 * Covers the embedded-array -> collections migration: the shared lib/migrate.js
 * logic (runOnce marker behaviour) and the scripts/migrate-collections.js CLI
 * (dry-run / run / cleanup / rollback), against in-memory Mongo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

const run = promisify(execFile);
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'migrate-collections.js');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-key';

let mongod;
let db;
let app;

const cli = (mode) => run('node', [SCRIPT, mode], { env: { ...process.env } });
const cookieFor = (id) => ['Cookie', `quaver_session=${jwt.sign({ userId: id }, process.env.JWT_SECRET)}`];

function legacyUser() {
  return {
    username: 'legacy',
    email: 'legacy@e.st',
    playlists: [
      { id: '111', name: 'Old mix', mood: 'happy', songs: [{ title: 'S', artist: 'A', spotify_url: 'https://open.spotify.com/track/x' }], createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
    ],
    recentMoods: [
      { mood: 'sad', note: 'n', time: 'x', ts: 1700000000000 },
      { mood: 'happy', note: '', time: 'y', ts: 1700000100000 },
    ],
    listeningHistory: [
      { trackId: 't1', title: 'One', artist: 'A', albumArt: '', mood: '', playedAt: 1700000000000 },
    ],
  };
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { getDB } = require('../../routes/db');
  db = await getDB();
  app = express();
  app.use(express.json());
  app.use('/api/playlist', require('../../routes/playlist'));
  app.use('/api/mood', require('../../routes/mood'));
  app.use('/api/listening', require('../../routes/listening'));
});

test.after(async () => {
  const { closeDB } = require('../../routes/db');
  await closeDB();
  await mongod.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    db.collection('users').deleteMany({}),
    db.collection('playlists').deleteMany({}),
    db.collection('mood_history').deleteMany({}),
    db.collection('listening_history').deleteMany({}),
    db.collection('_migrations').deleteMany({}),
  ]);
});

test('runOnce: migrates once, records a marker, then no-ops', async () => {
  const { runOnce } = require('../../lib/migrate');
  const { insertedId } = await db.collection('users').insertOne(legacyUser());

  const first = await runOnce(db);
  assert.equal(first.users, 1);
  assert.equal(await db.collection('playlists').countDocuments({ userId: insertedId }), 1);
  assert.ok(await db.collection('_migrations').findOne({ _id: 'embedded-arrays-to-collections' }));

  // A playlist created through the API after the migration...
  await request(app).post('/api/playlist').set(...cookieFor(insertedId.toString()))
    .send({ name: 'New one', mood: 'calm', songs: [{ title: 'T', artist: 'B', spotify_url: 'https://open.spotify.com/track/y' }] });

  // ...survives a second runOnce (marker present => no delete/reinsert).
  const second = await runOnce(db);
  assert.equal(second, null);
  assert.equal(await db.collection('playlists').countDocuments({ userId: insertedId }), 2);
});

test('runOnce: records the marker even with nothing to migrate', async () => {
  const { runOnce } = require('../../lib/migrate');
  assert.equal(await runOnce(db), null);
  assert.ok(await db.collection('_migrations').findOne({ _id: 'embedded-arrays-to-collections' }));
});

test('CLI: dry-run / run / cleanup / rollback', async () => {
  const { insertedId } = await db.collection('users').insertOne(legacyUser());
  const cookie = cookieFor(insertedId.toString());

  const dry = await cli('--dry-run');
  assert.match(dry.stdout, /would migrate/);
  assert.equal(await db.collection('playlists').countDocuments(), 0);

  await cli('--run');
  assert.equal(await db.collection('playlists').countDocuments({ userId: insertedId }), 1);
  assert.equal(await db.collection('mood_history').countDocuments({ userId: insertedId }), 2);
  assert.equal(await db.collection('listening_history').countDocuments({ userId: insertedId }), 1);

  const list = await request(app).get('/api/playlist').set(...cookie);
  assert.equal(list.body.playlists[0].name, 'Old mix');
  assert.equal(list.body.playlists[0].userId, undefined);
  const moods = await request(app).get('/api/mood/history').set(...cookie);
  assert.equal(moods.body.moods[0].mood, 'sad', 'oldest first');
  assert.ok((await db.collection('users').findOne({ _id: insertedId })).playlists, 'embedded arrays kept');

  await cli('--run'); // idempotent
  assert.equal(await db.collection('playlists').countDocuments({ userId: insertedId }), 1);

  await cli('--cleanup');
  const cleaned = await db.collection('users').findOne({ _id: insertedId });
  assert.equal(cleaned.playlists, undefined);
  assert.equal(cleaned.recentMoods, undefined);

  await cli('--rollback');
  assert.equal(await db.listCollections({ name: 'playlists' }).hasNext(), false);
});
