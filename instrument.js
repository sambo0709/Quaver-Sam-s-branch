/**
 * Sentry initialisation. Required as the very first line of server.js so the
 * SDK can instrument http/express before they load.
 *
 * No-op unless SENTRY_DSN is set, so it is safe to ship before a project exists.
 */
'use strict';

require('dotenv').config();
const Sentry = require('@sentry/node');

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || undefined,
    // Off by default; set SENTRY_TRACES_SAMPLE_RATE=0.1 to sample performance.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0,
    sendDefaultPii: false,
  });
  console.log('[sentry] error reporting enabled');
}

module.exports = Sentry;
module.exports.enabled = Boolean(dsn);
