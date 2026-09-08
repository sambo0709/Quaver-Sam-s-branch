/**
 * Move playlists / mood history / listening history out of the embedded arrays
 * on each user document into their own collections.
 *
 *   node scripts/migrate-collections.mjs            # dry run (default) — counts only
 *   node scripts/migrate-collections.mjs --run      # copy into the new collections
 *   node scripts/migrate-collections.mjs --rollback # drop the new collections
 *   node scripts/migrate-collections.mjs --cleanup  # $unset the old embedded arrays
 *
 * --run is non-destructive: the embedded arrays stay on the user docs, so
 * rollback is just "redeploy the old code + --rollback". It is also idempotent
 * (clears a user's target docs before re-inserting), so it is safe to re-run.
 * Only run --cleanup once the deployment is confirmed healthy on the new code.
 *
 * Requires MONGODB_URI in the environment.
 */
import { MongoClient } from 'mongodb';

const MODE = process.argv[2] || '--dry-run';
const VALID = new Set(['--dry-run', '--run', '--rollback', '--cleanup']);
const NEW_COLLECTIONS = ['playlists', 'mood_history', 'listening_history'];

if (!VALID.has(MODE)) {
  console.error(`unknown mode "${MODE}". use one of: ${[...VALID].join(', ')}`);
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);

async function rollback(db) {
  for (const name of NEW_COLLECTIONS) {
    if (await db.listCollections({ name }).hasNext()) {
      await db.collection(name).drop();
      console.log(`dropped ${name}`);
    }
  }
  console.log('rollback complete — embedded arrays on user docs were not touched');
}

async function cleanup(db) {
  const result = await db.collection('users').updateMany(
    {},
    { $unset: { playlists: '', recentMoods: '', listeningHistory: '' } },
  );
  console.log(`cleanup: removed embedded arrays from ${result.modifiedCount} user document(s)`);
}

async function migrate(db, dryRun) {
  const users = db.collection('users');
  const cursor = users.find(
    {
      $or: [
        { 'playlists.0': { $exists: true } },
        { 'recentMoods.0': { $exists: true } },
        { 'listeningHistory.0': { $exists: true } },
      ],
    },
    { projection: { playlists: 1, recentMoods: 1, listeningHistory: 1 } },
  );

  const totals = { users: 0, playlists: 0, mood_history: 0, listening_history: 0, errors: 0 };

  for await (const user of cursor) {
    totals.users += 1;
    const groups = [
      ['playlists', (user.playlists || [])],
      ['mood_history', (user.recentMoods || [])],
      ['listening_history', (user.listeningHistory || [])],
    ];

    for (const [name, source] of groups) {
      totals[name] += source.length;
      if (dryRun) continue;

      await db.collection(name).deleteMany({ userId: user._id });
      if (!source.length) continue;

      const rows = source.map((entry) => ({ ...entry, userId: user._id }));
      try {
        await db.collection(name).insertMany(rows, { ordered: false });
      } catch (err) {
        totals.errors += 1;
        console.error(`  ${name} for user ${user._id}: ${err.message}`);
      }
    }
  }

  console.log(dryRun ? '[dry run] would migrate:' : 'migrated:', totals);
  if (dryRun) console.log('\nre-run with --run to apply.');
}

async function main() {
  await client.connect();
  const db = client.db('quaver');
  const host = (() => {
    try { return new URL(process.env.MONGODB_URI).host; } catch (_) { return '(unparseable)'; }
  })();
  console.log(`quaver @ ${host} — mode ${MODE}\n`);

  if (MODE === '--rollback') await rollback(db);
  else if (MODE === '--cleanup') await cleanup(db);
  else await migrate(db, MODE !== '--run');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.close());
