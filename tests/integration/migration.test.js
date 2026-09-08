'use strict';

/**
 * Exercises scripts/migrate-collections.mjs end to end against in-memory Mongo:
 * seed legacy embedded arrays -> --run -> assert new collections + live API ->
 * --cleanup -> --rollback.
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
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'migrate-collections.mjs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-key';

let mongod;
let db;
let app;
let userId;

const cli = (mode) =>
  run('node', [SCRIPT, mode], { env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI } });

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

test('migrate-collections: run / cleanup / rollback', async () => {
  const { insertedId } = await db.collection('users').insertOne({
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
  });
  userId = insertedId.toString();
  const cookie = ['Cookie', `quaver_session=${jwt.sign({ userId }, process.env.JWT_SECRET)}`];

  // dry run writes nothing
  const dry = await cli('--dry-run');
  assert.match(dry.stdout, /would migrate/);
  assert.equal(await db.collection('playlists').countDocuments(), 0);

  // --run copies into the new collections
  await cli('--run');
  assert.equal(await db.collection('playlists').countDocuments({ userId: insertedId }), 1);
  assert.equal(await db.collection('mood_history').countDocuments({ userId: insertedId }), 2);
  assert.equal(await db.collection('listening_history').countDocuments({ userId: insertedId }), 1);

  // live API now serves the migrated rows, embedded arrays untouched
  const list = await request(app).get('/api/playlist').set(...cookie);
  assert.equal(list.body.playlists[0].name, 'Old mix');
  assert.equal(list.body.playlists[0].userId, undefined, '_id/userId projected out');
  const moods = await request(app).get('/api/mood/history').set(...cookie);
  assert.equal(moods.body.moods.length, 2);
  assert.equal(moods.body.moods[0].mood, 'sad', 'oldest first');
  const plays = await request(app).get('/api/listening/history').set(...cookie);
  assert.equal(plays.body.plays[0].title, 'One');
  assert.ok((await db.collection('users').findOne({ _id: insertedId })).playlists, 'embedded arrays kept');

  // re-run is idempotent
  await cli('--run');
  assert.equal(await db.collection('playlists').countDocuments({ userId: insertedId }), 1);

  // --cleanup removes the embedded arrays
  await cli('--cleanup');
  const cleaned = await db.collection('users').findOne({ _id: insertedId });
  assert.equal(cleaned.playlists, undefined);
  assert.equal(cleaned.recentMoods, undefined);
  assert.equal(cleaned.listeningHistory, undefined);

  // --rollback drops the new collections
  await cli('--rollback');
  assert.equal(await db.listCollections({ name: 'playlists' }).hasNext(), false);
});
