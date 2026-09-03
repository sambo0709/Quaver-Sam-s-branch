const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecommendationContext, buildSearchQueries, rankSongs } = require('../routes/recommendation-engine');

test('recommendation context validates expressive mood inputs', function() {
  const context = parseRecommendationContext({ mood: 'anxious', secondaryMood: 'happy', intensity: '9', activity: 'studying', direction: 'uplift', minutes: '60', artist: 'SZA', genre: 'r&b' });
  assert.deepEqual(context, { mood: 'anxious', secondaryMood: 'happy', intensity: 5, activity: 'studying', direction: 'uplift', minutes: 60, preferredArtist: 'SZA', preferredGenre: 'r&b' });
  const queries = buildSearchQueries(context);
  assert.equal(queries[0], 'artist:SZA');
  assert.ok(queries.some(function(query) { return query.includes('SZA') && query.includes('happy') && query.includes('studying'); }));
});

test('ranking removes dislikes, favors learned artists, and explains picks', function() {
  const pool = [
    { trackId: 'likedArtist', title: 'One', artist: 'SZA' },
    { trackId: 'blocked', title: 'Two', artist: 'Other' },
    { trackId: 'fresh', title: 'Three', artist: 'New Artist' },
  ];
  const context = { mood: 'calm', secondaryMood: '', intensity: 3, activity: 'studying', direction: 'focus', preferredArtist: '', preferredGenre: '', variety: 'balanced' };
  const history = { liked: new Set(), disliked: new Set(['blocked']), played: new Set(), likedArtists: new Set(['sza']) };
  const ranked = rankSongs(pool, context, history, 3);
  assert.equal(ranked[0].trackId, 'likedArtist');
  assert.equal(ranked.some(function(song) { return song.trackId === 'blocked'; }), false);
  assert.ok(ranked[0].recommendation_reasons.some(function(reason) { return reason.includes('SZA'); }));
});

test('ranking learns from skips, completions, and artist completion patterns', function() {
  const pool = [
    { trackId: 'skipped', title: 'Skipped', artist: 'Artist A' },
    { trackId: 'completed', title: 'Completed', artist: 'Artist B' },
    { trackId: 'related', title: 'Related', artist: 'Artist B' },
  ];
  const context = { mood: 'calm', secondaryMood: '', intensity: 3, activity: 'none', direction: 'stay', preferredArtist: '', preferredGenre: '', variety: 'balanced' };
  const history = {
    liked: new Set(), disliked: new Set(), played: new Set(), likedArtists: new Set(),
    skipped: new Map([['skipped', 2]]), completed: new Map([['completed', 2]]), artistAffinity: new Map([['artist a', -2], ['artist b', 2]]),
  };
  const ranked = rankSongs(pool, context, history, 3);
  assert.equal(ranked[0].trackId, 'completed');
  assert.equal(ranked[2].trackId, 'skipped');
  assert.ok(ranked[0].recommendation_reasons.some(function(reason) { return reason.includes('listened to this through'); }));
});
