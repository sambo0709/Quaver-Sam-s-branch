'use strict';

/**
 * Shared migration logic: embedded user-doc arrays -> own collections.
 * Used by scripts/migrate-collections.js (CLI) and by the one-time startup
 * migration in server.js.
 */

const NEW_COLLECTIONS = ['playlists', 'mood_history', 'listening_history'];
const MARKER_ID = 'embedded-arrays-to-collections';

const LEGACY_QUERY = {
  $or: [
    { 'playlists.0': { $exists: true } },
    { 'recentMoods.0': { $exists: true } },
    { 'listeningHistory.0': { $exists: true } },
  ],
};

/**
 * Copy every user's embedded playlists / recentMoods / listeningHistory into the
 * dedicated collections. Non-destructive (the arrays stay on the user doc) and
 * idempotent per user (clears that user's target docs first).
 */
async function migrate(db, { dryRun = true, log = () => {} } = {}) {
  const cursor = db.collection('users').find(LEGACY_QUERY, {
    projection: { playlists: 1, recentMoods: 1, listeningHistory: 1 },
  });

  const totals = { users: 0, playlists: 0, mood_history: 0, listening_history: 0, errors: 0 };

  for await (const user of cursor) {
    totals.users += 1;
    const groups = [
      ['playlists', user.playlists || []],
      ['mood_history', user.recentMoods || []],
      ['listening_history', user.listeningHistory || []],
    ];

    for (const [name, source] of groups) {
      totals[name] += source.length;
      if (dryRun) continue;

      await db.collection(name).deleteMany({ userId: user._id });
      if (!source.length) continue;

      try {
        await db.collection(name).insertMany(
          source.map((entry) => ({ ...entry, userId: user._id })),
          { ordered: false },
        );
      } catch (err) {
        totals.errors += 1;
        log(`  ${name} for user ${user._id}: ${err.message}`);
      }
    }
  }

  return totals;
}

async function rollback(db, { log = () => {} } = {}) {
  for (const name of NEW_COLLECTIONS) {
    if (await db.listCollections({ name }).hasNext()) {
      await db.collection(name).drop();
      log(`dropped ${name}`);
    }
  }
  await db.collection('_migrations').deleteOne({ _id: MARKER_ID });
}

async function cleanup(db) {
  const result = await db.collection('users').updateMany(
    {},
    { $unset: { playlists: '', recentMoods: '', listeningHistory: '' } },
  );
  return result.modifiedCount;
}

/**
 * Run migrate() exactly once per database, recorded in `_migrations`. Safe to
 * call on every boot: after the first run it is a single indexed lookup, and it
 * never touches data once the marker is set (so API writes are never clobbered).
 */
async function runOnce(db, { log = () => {} } = {}) {
  const marker = db.collection('_migrations');
  if (await marker.findOne({ _id: MARKER_ID })) return null;

  const pending = await db.collection('users').findOne(LEGACY_QUERY, { projection: { _id: 1 } });
  if (!pending) {
    await marker.insertOne({ _id: MARKER_ID, appliedAt: new Date(), note: 'nothing to migrate' });
    return null;
  }

  log('[migrate] running one-time embedded-array migration…');
  const totals = await migrate(db, { dryRun: false, log });
  await marker.insertOne({ _id: MARKER_ID, appliedAt: new Date(), totals });
  log(`[migrate] done: ${JSON.stringify(totals)}`);
  return totals;
}

module.exports = { migrate, rollback, cleanup, runOnce, NEW_COLLECTIONS, MARKER_ID };
