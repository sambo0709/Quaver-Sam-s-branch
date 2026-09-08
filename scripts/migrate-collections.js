/**
 * Manual control over the embedded-array -> collections migration.
 * The migration also runs automatically once on server boot (lib/migrate.js
 * runOnce); this script is for dry-runs, forcing a re-run, rollback, or cleanup.
 *
 *   node scripts/migrate-collections.js            # dry run — counts only
 *   node scripts/migrate-collections.js --run      # copy into the new collections
 *   node scripts/migrate-collections.js --rollback # drop the new collections + marker
 *   node scripts/migrate-collections.js --cleanup  # $unset the old embedded arrays
 *
 * Requires MONGODB_URI in the environment.
 */
'use strict';

const { MongoClient } = require('mongodb');
const { migrate, rollback, cleanup } = require('../lib/migrate');

const MODE = process.argv[2] || '--dry-run';
const VALID = new Set(['--dry-run', '--run', '--rollback', '--cleanup']);

if (!VALID.has(MODE)) {
  console.error(`unknown mode "${MODE}". use one of: ${[...VALID].join(', ')}`);
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('quaver');
  let host = '(unparseable)';
  try { host = new URL(process.env.MONGODB_URI).host; } catch (_) { /* ignore */ }
  console.log(`quaver @ ${host} — mode ${MODE}\n`);

  if (MODE === '--rollback') {
    await rollback(db, { log: console.log });
    console.log('rollback complete — embedded arrays on user docs were not touched');
    return;
  }
  if (MODE === '--cleanup') {
    const n = await cleanup(db);
    console.log(`cleanup: removed embedded arrays from ${n} user document(s)`);
    return;
  }

  const dryRun = MODE !== '--run';
  const totals = await migrate(db, { dryRun, log: console.log });
  console.log(dryRun ? '[dry run] would migrate:' : 'migrated:', totals);
  if (dryRun) console.log('\nre-run with --run to apply.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.close());
