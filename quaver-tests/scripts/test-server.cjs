'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { MongoMemoryServer } = require('../../node_modules/mongodb-memory-server');

let mongo;
let app;
let stopping = false;

async function stop(code) {
  if (stopping) return;
  stopping = true;
  if (app && !app.killed) app.kill('SIGTERM');
  if (mongo) await mongo.stop();
  process.exit(code);
}

async function start() {
  mongo = await MongoMemoryServer.create();
  app = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: 'playwright-test-secret',
      MONGODB_URI: mongo.getUri('quaver-playwright'),
    },
    stdio: 'inherit',
  });
  app.on('exit', function(code) { stop(code || 0); });
}

process.on('SIGINT', function() { stop(0); });
process.on('SIGTERM', function() { stop(0); });
start().catch(function(error) {
  console.error('[test-server]', error);
  stop(1);
});
