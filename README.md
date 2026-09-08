# Quaver

Quaver is a mood-first music discovery app. It creates Spotify-powered mixes from a listener's mood, context, taste preferences, and feedback, then lets them play, save, edit, share, and export those mixes.

## Main features

- Mood mixes with activity, direction, duration, artist, genre, variety, and explicit-content controls
- Spotify search, Web Playback SDK support, 30-second preview fallback, and playlist export
- Quaver accounts, profiles, settings, taste preferences, and data controls
- Saved and public playlists with editing, ordering, covers, and sharing
- Mood archive, listening history, recommendation feedback, and collaborative ranking signals
- Responsive SPA shell, installable web manifest, light/dark themes, and reduced motion

## Local setup

Requirements: Node.js 22+, npm, MongoDB, and a Spotify developer application.

1. Install dependencies with `npm ci`.
2. Create a local `.env` file. It is ignored by Git and must never be committed.
3. Add the variables described below.
4. Run `npm run dev`.
5. Open `http://localhost:3000`.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Session signing and Spotify-token encryption secret; use a long random value |
| `SPOTIFY_CLIENT_ID` | Production | Spotify application client ID |
| `SPOTIFY_CLIENT_SECRET` | Production | Spotify application client secret |
| `SPOTIFY_REDIRECT_URI` | Production | Exact registered callback, ending in `/spotify/callback` |
| `APP_ORIGIN` | Production | Canonical HTTPS application origin |
| `SENTRY_DSN` | Recommended | Server and browser-error reporting destination |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | Performance trace sample rate |
| `API_RATE_LIMIT_MAX` | Optional | General API requests allowed per 15 minutes |

Never place real credentials in source files, frontend JavaScript, screenshots, issues, or committed example files. Configure production values in the hosting provider's secret manager.

## Commands

- `npm run dev` — development server with reloads
- `npm start` — production-style server
- `npm run build` — build hashed assets into `dist/`
- `npm test` — unit tests
- `npm run test:integration` — MongoDB-backed integration tests
- `npm run test:all` — all backend tests
- `cd quaver-tests && npm test` — Playwright suite

## Architecture

- `server.js` configures HTTP security, static assets, rate limits, health checks, and routes.
- `routes/` contains authentication, Spotify, music, playlist, taste, mood, and listening APIs.
- `public/` contains the SPA shell, page templates, player, styles, manifest, and service worker.
- `tests/` contains unit and MongoDB-backed integration tests.
- `quaver-tests/` contains Chromium, Firefox, WebKit, responsive, and accessibility tests.

`GET /api/health` confirms that the process is running. `GET /api/ready` also verifies MongoDB and should be used by production readiness monitoring.

## Production checklist

- Run `npm ci`, `npm run test:all`, and `npm run build` in CI.
- Set `NODE_ENV=production`, `APP_ORIGIN`, MongoDB, JWT, Spotify, and monitoring secrets.
- Register the exact production Spotify redirect URI.
- Use managed MongoDB backups and test restoration before launch.
- Point readiness checks to `/api/ready` and uptime checks to `/api/health`.
- Configure Sentry alerts and a monitored support address.
- Replace the contact placeholder in `public/privacy.html`.
- Have the Privacy Policy and Terms reviewed for the launch jurisdiction.
- Add a transactional email provider before enabling public registration; email verification and password recovery require it.
- Confirm Spotify production access, account eligibility, branding, and playback behavior before inviting users.

## Data and security

Quaver uses an HTTP-only session cookie. Production cookies are Secure and SameSite=Lax. Mutating browser requests are protected by origin/fetch-metadata checks. Spotify refresh tokens are encrypted at rest and never returned to the browser. Users can clear personalization history, export their account data, disconnect Spotify, and delete their account after password confirmation.

The repository intentionally contains no `.env` or credential template populated with secrets.
