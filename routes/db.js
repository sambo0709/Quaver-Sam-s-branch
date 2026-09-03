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
      database.collection('users').createIndex(
        { 'recentMoods.ts': -1 },
        { name: 'users_recent_moods_ts' }
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

module.exports = { getDB };
