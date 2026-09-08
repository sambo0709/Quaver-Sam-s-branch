const { MongoClient } = require('mongodb');

let client;
let db;
let indexesPromise;

async function ensureIndexes(database) {
  try {
    await Promise.all([
      database.collection('users').createIndex(
        { email: 1 },
        { unique: true, name: 'users_email_unique', partialFilterExpression: { email: { $type: 'string' } } }
      ),
      database.collection('users').createIndex(
        { username: 1 },
        { unique: true, name: 'users_username_unique', partialFilterExpression: { username: { $type: 'string' } } }
      ),
      database.collection('sotd_archive').createIndex(
        { date: -1 },
        { name: 'sotd_archive_date' }
      ),
      // Playlists / history / moods live in their own collections (one doc each)
      // instead of arrays embedded in the user document.
      database.collection('playlists').createIndex(
        { userId: 1, createdAt: 1 },
        { name: 'playlists_user_created' }
      ),
      database.collection('playlists').createIndex(
        { userId: 1, id: 1 },
        { unique: true, name: 'playlists_user_id_unique' }
      ),
      database.collection('listening_history').createIndex(
        { userId: 1, playedAt: -1 },
        { name: 'listening_user_played' }
      ),
      database.collection('mood_history').createIndex(
        { userId: 1, ts: 1 },
        { name: 'mood_user_ts' }
      ),
      database.collection('mood_history').createIndex(
        { ts: -1 },
        { name: 'mood_ts' }
      ),
      database.collection('password_resets').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'password_resets_expiry' }
      ),
      database.collection('email_verifications').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'email_verifications_expiry' }
      ),
    ]);
  } catch (error) {
    // Preserve availability for an existing deployment with conflicting legacy data.
    // Registration still checks both fields at the application layer.
    console.error('Database index initialization failed:', error.message);
  }
}

async function getDB() {
  if (!db) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
    client = client || new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('quaver');
    indexesPromise = indexesPromise || ensureIndexes(db);
    await indexesPromise;
  }
  return db;
}

// Tear down the pooled connection (used by tests; no-op in normal runtime).
async function closeDB() {
  if (client) await client.close();
  client = undefined;
  db = undefined;
  indexesPromise = undefined;
}

module.exports = { getDB, closeDB };
