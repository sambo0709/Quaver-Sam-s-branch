'use strict';

/**
 * Integration coverage for the data-layer routes (playlist / mood / listening),
 * running against an in-memory MongoDB. These lock in the current HTTP contract
 * so the storage refactor (embedded arrays -> own collections) can be proven
 * response-compatible.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-key';

let mongod;
let db;
let app;
let userId;

function auth(id = userId) {
  return ['Cookie', `quaver_session=${jwt.sign({ userId: id }, process.env.JWT_SECRET)}`];
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { getDB } = require('../../routes/db');
  db = await getDB();

  app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/playlist', require('../../routes/playlist'));
  app.use('/api/mood', require('../../routes/mood'));
  app.use('/api/listening', require('../../routes/listening'));
});

test.after(async () => {
  const { closeDB } = require('../../routes/db');
  if (typeof closeDB === 'function') await closeDB();
  if (mongod) await mongod.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    db.collection('users').deleteMany({}),
    db.collection('playlists').deleteMany({}),
    db.collection('listening_history').deleteMany({}),
    db.collection('mood_history').deleteMany({}),
  ]);
  const { insertedId } = await db.collection('users').insertOne({ username: 'tester', email: 't@e.st' });
  userId = insertedId.toString();
});

const song = (n = 1) => ({
  title: `Song ${n}`,
  artist: `Artist ${n}`,
  duration: '3:20',
  album_art: 'https://example.com/a.jpg',
  spotify_url: `https://open.spotify.com/track/abc${n}`,
});

// ---------------------------------------------------------------- playlists ---

test('playlist: create -> list -> shapes', async () => {
  const create = await request(app).post('/api/playlist').set(...auth())
    .send({ name: 'Road trip', mood: 'happy', songs: [song(1), song(2)] });
  assert.equal(create.status, 201);
  assert.equal(create.body.message, 'Playlist saved!');
  const pl = create.body.playlist;
  assert.ok(pl.id && pl.name === 'Road trip' && pl.mood === 'happy');
  assert.equal(pl.songs.length, 2);
  assert.ok(pl.createdAt && pl.updatedAt);

  const list = await request(app).get('/api/playlist').set(...auth());
  assert.equal(list.status, 200);
  assert.equal(list.body.playlists.length, 1);
  assert.equal(list.body.playlists[0].id, pl.id);
});

test('playlist: rejects bad payloads and unauthed calls', async () => {
  assert.equal((await request(app).get('/api/playlist')).status, 401);
  assert.equal(
    (await request(app).post('/api/playlist').set(...auth()).send({ name: '', mood: 'nope', songs: [] })).status,
    400,
  );
});

test('playlist: add / dedupe / remove songs', async () => {
  const { body } = await request(app).post('/api/playlist').set(...auth())
    .send({ name: 'P', mood: 'calm', songs: [song(1)] });
  const id = body.playlist.id;

  const add = await request(app).post(`/api/playlist/${id}/songs`).set(...auth()).send({ song: song(2) });
  assert.equal(add.status, 201);

  const dup = await request(app).post(`/api/playlist/${id}/songs`).set(...auth()).send({ song: song(2) });
  assert.equal(dup.status, 409);

  const missing = await request(app).post('/api/playlist/nope/songs').set(...auth()).send({ song: song(3) });
  assert.equal(missing.status, 404);

  const del = await request(app).delete(`/api/playlist/${id}/songs/abc2`).set(...auth());
  assert.equal(del.status, 200);
  const delMissing = await request(app).delete(`/api/playlist/${id}/songs/zzz`).set(...auth());
  assert.equal(delMissing.status, 404);
});

test('playlist: reorder, cover, rename', async () => {
  const { body } = await request(app).post('/api/playlist').set(...auth())
    .send({ name: 'P', mood: 'calm', songs: [song(1), song(2), song(3)] });
  const id = body.playlist.id;

  const reorder = await request(app).patch(`/api/playlist/${id}/songs/reorder`).set(...auth())
    .send({ trackIds: ['abc3', 'abc1', 'abc2'] });
  assert.equal(reorder.status, 200);
  assert.ok(reorder.body.updatedAt);

  const badOrder = await request(app).patch(`/api/playlist/${id}/songs/reorder`).set(...auth())
    .send({ trackIds: ['abc3', 'abc1'] });
  assert.equal(badOrder.status, 400);

  const cover = await request(app).patch(`/api/playlist/${id}/cover`).set(...auth())
    .send({ coverImage: `data:image/png;base64,${Buffer.from('x').toString('base64')}` });
  assert.equal(cover.status, 200);

  const rename = await request(app).patch(`/api/playlist/${id}`).set(...auth()).send({ name: 'Renamed' });
  assert.equal(rename.status, 200);
  const list = await request(app).get('/api/playlist').set(...auth());
  assert.equal(list.body.playlists[0].name, 'Renamed');
});

test('playlist: public sharing + delete', async () => {
  const { body } = await request(app).post('/api/playlist').set(...auth())
    .send({ name: 'Shared', mood: 'party', songs: [song(1)] });
  const id = body.playlist.id;

  assert.equal((await request(app).get(`/api/playlist/public/${id}`)).status, 404);

  const share = await request(app).patch(`/api/playlist/${id}/share`).set(...auth()).send({ isPublic: true });
  assert.equal(share.status, 200);
  assert.equal(share.body.isPublic, true);

  const pub = await request(app).get(`/api/playlist/public/${id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.playlist.id, id);
  assert.equal(pub.body.owner, 'tester');

  const del = await request(app).delete(`/api/playlist/${id}`).set(...auth());
  assert.equal(del.status, 200);
  assert.equal((await request(app).get('/api/playlist').set(...auth())).body.playlists.length, 0);
});

// -------------------------------------------------------------------- mood ---

test('mood: list + attributes lookup', async () => {
  const list = await request(app).get('/api/mood');
  assert.equal(list.status, 200);
  assert.equal(list.body.moods.length, 11);

  assert.equal((await request(app).get('/api/mood/happy')).body.attributes.genre, 'pop');
  assert.equal((await request(app).get('/api/mood/notamood')).status, 404);
});

test('mood: history save / read / clear', async () => {
  const save = await request(app).post('/api/mood/history').set(...auth()).send({ mood: 'sad', note: 'rainy' });
  assert.equal(save.status, 201);

  const read = await request(app).get('/api/mood/history').set(...auth());
  assert.equal(read.status, 200);
  assert.equal(read.body.moods.length, 1);
  assert.equal(read.body.moods[0].mood, 'sad');
  assert.equal(read.body.moods[0].note, 'rainy');
  assert.ok(read.body.moods[0].ts);

  assert.equal((await request(app).post('/api/mood/history').set(...auth()).send({})).status, 400);

  const clear = await request(app).delete('/api/mood/history').set(...auth());
  assert.equal(clear.status, 200);
  assert.equal((await request(app).get('/api/mood/history').set(...auth())).body.moods.length, 0);
});

test('mood: trending aggregates recent entries across users', async () => {
  await request(app).post('/api/mood/history').set(...auth()).send({ mood: 'happy' });
  await request(app).post('/api/mood/history').set(...auth()).send({ mood: 'happy' });
  await request(app).post('/api/mood/history').set(...auth()).send({ mood: 'calm' });

  const trending = await request(app).get('/api/mood/trending');
  assert.equal(trending.status, 200);
  assert.equal(trending.body.trending[0].mood, 'happy');
  assert.equal(trending.body.trending[0].count, 2);
});

test('mood: history requires auth', async () => {
  assert.equal((await request(app).get('/api/mood/history')).status, 401);
  assert.equal((await request(app).post('/api/mood/history').send({ mood: 'happy' })).status, 401);
});

// --------------------------------------------------------------- listening ---

test('listening: record / read newest-first / clear', async () => {
  await request(app).post('/api/listening/history').set(...auth())
    .send({ trackId: 't1', title: 'First', artist: 'A' });
  await request(app).post('/api/listening/history').set(...auth())
    .send({ trackId: 't2', title: 'Second', artist: 'B', mood: 'happy' });

  const read = await request(app).get('/api/listening/history').set(...auth());
  assert.equal(read.status, 200);
  assert.equal(read.body.plays.length, 2);
  assert.equal(read.body.plays[0].title, 'Second', 'newest first');

  assert.equal(
    (await request(app).post('/api/listening/history').set(...auth()).send({ trackId: 'x' })).status,
    400,
    'title required',
  );

  await request(app).delete('/api/listening/history').set(...auth());
  assert.equal((await request(app).get('/api/listening/history').set(...auth())).body.plays.length, 0);
});

test('listening: requires auth', async () => {
  assert.equal((await request(app).get('/api/listening/history')).status, 401);
});
