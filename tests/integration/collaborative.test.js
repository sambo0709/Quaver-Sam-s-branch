'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';

let mongod;
let db;
let music;

const TID = (n) => String(n).padStart(22, 'a'); // 22-char pseudo Spotify ids

async function seedPlays(userId, trackIds) {
  await db.collection('listening_history').insertMany(
    trackIds.map((t) => ({ userId, trackId: t, title: 'T' + t.slice(-2), artist: 'Artist ' + t.slice(-2), playedAt: Date.now() })),
  );
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { getDB } = require('../../routes/db');
  db = await getDB();
  music = require('../../routes/music');
});

test.after(async () => {
  const { closeDB } = require('../../routes/db');
  await closeDB();
  await mongod.stop();
});

test.beforeEach(async () => {
  await db.collection('listening_history').deleteMany({});
  music._resetCollabCache();
});

test('collaborativePicks: surfaces tracks co-listeners play that I have not', async () => {
  const me = new ObjectId();
  const peer1 = new ObjectId();
  const peer2 = new ObjectId();

  const shared = [TID(1), TID(2), TID(3), TID(4), TID(5), TID(6), TID(7), TID(8)];
  await seedPlays(me, shared);
  // both peers overlap heavily with me, and both also play TID(99)
  await seedPlays(peer1, shared.slice(0, 5).concat([TID(99), TID(50)]));
  await seedPlays(peer2, shared.slice(0, 5).concat([TID(99)]));

  const picks = await music.collaborativePicks(db, me, shared);
  const ids = picks.map((p) => p.trackId);
  assert.ok(ids.includes(TID(99)), 'the track both peers share is recommended');
  assert.ok(!ids.includes(TID(1)), 'already-heard tracks are excluded');
  assert.ok(!ids.includes(TID(50)), 'a track only one peer plays does not clear the threshold');
});

test('collaborativePicks: empty when history is too thin', async () => {
  const me = new ObjectId();
  assert.deepEqual(await music.collaborativePicks(db, me, [TID(1), TID(2)]), []);
});

test('collaborativePicks: empty when nobody overlaps', async () => {
  const me = new ObjectId();
  const stranger = new ObjectId();
  await seedPlays(me, [TID(1), TID(2), TID(3), TID(4), TID(5), TID(6), TID(7), TID(8)]);
  await seedPlays(stranger, [TID(80), TID(81), TID(82), TID(83)]);
  assert.deepEqual(await music.collaborativePicks(db, me, [TID(1), TID(2), TID(3), TID(4), TID(5), TID(6), TID(7), TID(8)]), []);
});
