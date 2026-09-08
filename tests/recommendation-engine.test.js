const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecommendationContext, buildSearchQueries, rankSongs } = require('../routes/recommendation-engine');

test('recommendation context validates expressive mood inputs', function() {
  const context = parseRecommendationContext({ mood: 'anxious', secondaryMood: 'happy', intensity: '9', activity: 'studying', direction: 'uplift', minutes: '60', artist: 'SZA', genre: 'r&b' });
  assert.deepEqual(context, { mood: 'anxious', secondaryMood: 'happy', intensity: 5, activity: 'studying', direction: 'uplift', minutes: 60, preferredArtist: 'SZA', preferredGenre: 'r&b', partOfDay: '', sessionTrackIds: [] });
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

test('ranking fills the requested mix after applying artist diversity first', function() {
  const pool = Array.from({ length: 10 }, function(_, index) {
    return { trackId: 'track-' + index, title: 'Track ' + index, artist: index < 8 ? 'Main Artist' : 'Guest ' + index };
  });
  const context = { mood: 'focused', secondaryMood: '', intensity: 3, activity: 'none', direction: 'stay', preferredArtist: '', preferredGenre: '', variety: 'balanced' };
  const history = { liked: new Set(), disliked: new Set(), played: new Set(), likedArtists: new Set() };
  const ranked = rankSongs(pool, context, history, 8);
  assert.equal(ranked.length, 8);
  assert.equal(new Set(ranked.map(function(song) { return song.trackId; })).size, 8);
  assert.ok(ranked.filter(function(song) { return song.artist === 'Main Artist'; }).length > 2);
});

test('ranking boosts seed artists and hard-excludes blocked artists', function() {
  const pool = [
    { trackId: 'seed', title: 'Seed pick', artist: 'SZA' },
    { trackId: 'neutral', title: 'Neutral', artist: 'Someone Else' },
    { trackId: 'blocked', title: 'Blocked', artist: 'Nickelback' },
  ];
  const context = { mood: 'calm', secondaryMood: '', intensity: 3, activity: 'none', direction: 'stay', preferredArtist: '', preferredGenre: '', variety: 'balanced' };
  const history = {
    liked: new Set(), disliked: new Set(), played: new Set(), likedArtists: new Set(),
    seedArtists: new Set(['sza']), blockedArtists: new Set(['nickelback']),
  };
  const ranked = rankSongs(pool, context, history, 3);
  assert.equal(ranked[0].trackId, 'seed');
  assert.ok(ranked[0].recommendation_reasons.some(function(r) { return /go-to artist/.test(r); }));
  assert.equal(ranked.some(function(song) { return song.trackId === 'blocked'; }), false);
});

test('ranking still works when taste sets are absent (back-compat)', function() {
  const pool = [{ trackId: 'a', title: 'A', artist: 'X' }, { trackId: 'b', title: 'B', artist: 'Y' }];
  const context = { mood: 'happy', secondaryMood: '', intensity: 3, activity: 'none', direction: 'stay', preferredArtist: '', preferredGenre: '', variety: 'balanced' };
  const history = { liked: new Set(), disliked: new Set(), played: new Set(), likedArtists: new Set() };
  assert.equal(rankSongs(pool, context, history, 2).length, 2);
});

test('context: parses hour into part of day and session track ids', function() {
  assert.equal(parseRecommendationContext({ mood: 'calm', hour: '23' }).partOfDay, 'late night');
  assert.equal(parseRecommendationContext({ mood: 'calm', hour: '7' }).partOfDay, 'morning');
  assert.equal(parseRecommendationContext({ mood: 'calm', hour: '14' }).partOfDay, 'daytime');
  assert.equal(parseRecommendationContext({ mood: 'calm' }).partOfDay, '');
  assert.deepEqual(parseRecommendationContext({ mood: 'calm', session: 'a, b ,,c' }).sessionTrackIds, ['a', 'b', 'c']);
});

test('search queries fold in a time-of-day term at night', function() {
  const night = buildSearchQueries({ mood: 'calm', secondaryMood: '', intensity: 3, activity: 'none', direction: 'stay', preferredGenre: '', partOfDay: 'late night' });
  assert.ok(night.every(function(q) { return /late night/.test(q); }));
  const day = buildSearchQueries({ mood: 'calm', secondaryMood: '', intensity: 3, activity: 'none', direction: 'stay', preferredGenre: '', partOfDay: 'daytime' });
  assert.ok(day.every(function(q) { return !/late night|morning/.test(q); }));
});

test('ranking demotes tracks already heard this session (unless variety is familiar)', function() {
  const pool = [
    { trackId: 'fresh', title: 'Fresh', artist: 'A' },
    { trackId: 'heard', title: 'Heard', artist: 'B' },
  ];
  const history = { liked: new Set(), disliked: new Set(), played: new Set(), likedArtists: new Set() };
  const base = { mood: 'calm', secondaryMood: '', intensity: 3, activity: 'none', direction: 'stay', preferredArtist: '', preferredGenre: '', sessionTrackIds: ['heard'] };
  assert.equal(rankSongs(pool, { ...base, variety: 'balanced' }, history, 2)[0].trackId, 'fresh');
  // familiar listeners are allowed to loop back
  const familiar = rankSongs(pool, { ...base, variety: 'familiar' }, history, 2);
  assert.equal(familiar.length, 2);
});
