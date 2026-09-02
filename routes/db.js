const { MongoClient } = require('mongodb');

let client;
let db;

async function getDB() {
  if (!db) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
    client = client || new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('quaver');
  }
  return db;
}

module.exports = { getDB };
