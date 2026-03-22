const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function getDB() {
  if (!db) {
    await client.connect();
    db = client.db('quaver');
  }
  return db;
}

module.exports = { getDB };
