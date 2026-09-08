'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-key';

let mongod;
let db;
let app;
let userId;

const auth = () => ['Cookie', `quaver_session=${jwt.sign({ userId }, process.env.JWT_SECRET)}`];

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { getDB } = require('../../routes/db');
  db = await getDB();
  app = express();
  app.use(express.json());
  app.use('/api/taste', require('../../routes/taste'));
});

test.after(async () => {
  const { closeDB } = require('../../routes/db');
  await closeDB();
  await mongod.stop();
});

test.beforeEach(async () => {
  await db.collection('users').deleteMany({});
  const { insertedId } = await db.collection('users').insertOne({ username: 'tester', email: 't@e.st' });
  userId = insertedId.toString();
});

test('taste: defaults to empty lists', async () => {
  const res = await request(app).get('/api/taste').set(...auth());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.taste, { seedArtists: [], seedGenres: [], blockedArtists: [] });
});

test('taste: PUT normalizes (trim, lowercase, dedupe) and persists', async () => {
  const put = await request(app).put('/api/taste').set(...auth()).send({
    seedArtists: ['  SZA ', 'Frank Ocean', 'sza', ''],
    seedGenres: ['R&B'],
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.taste.seedArtists, ['sza', 'frank ocean']);
  assert.deepEqual(put.body.taste.seedGenres, ['r&b']);
  assert.deepEqual(put.body.taste.blockedArtists, []);

  const get = await request(app).get('/api/taste').set(...auth());
  assert.deepEqual(get.body.taste.seedArtists, ['sza', 'frank ocean']);
});

test('taste: PUT only touches provided lists', async () => {
  await request(app).put('/api/taste').set(...auth()).send({ seedArtists: ['a'], blockedArtists: ['b'] });
  await request(app).put('/api/taste').set(...auth()).send({ blockedArtists: ['c'] });
  const get = await request(app).get('/api/taste').set(...auth());
  assert.deepEqual(get.body.taste.seedArtists, ['a'], 'seedArtists untouched');
  assert.deepEqual(get.body.taste.blockedArtists, ['c']);
});

test('taste: PUT validates types and empty body', async () => {
  assert.equal((await request(app).put('/api/taste').set(...auth()).send({ seedArtists: 'nope' })).status, 400);
  assert.equal((await request(app).put('/api/taste').set(...auth()).send({})).status, 400);
});

test('taste: caps list length', async () => {
  const many = Array.from({ length: 50 }, (_, i) => `artist ${i}`);
  const put = await request(app).put('/api/taste').set(...auth()).send({ seedArtists: many });
  assert.equal(put.body.taste.seedArtists.length, 30);
});

test('taste: requires auth', async () => {
  assert.equal((await request(app).get('/api/taste')).status, 401);
  assert.equal((await request(app).put('/api/taste').send({ seedArtists: ['x'] })).status, 401);
});
