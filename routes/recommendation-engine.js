const MOOD_PROFILES = {
  happy: { energy: 0.75, valence: 0.9, tempo: 'upbeat', terms: ['feel good', 'bright pop'] },
  sad: { energy: 0.3, valence: 0.15, tempo: 'slow', terms: ['emotional acoustic', 'melancholy'] },
  angry: { energy: 0.9, valence: 0.2, tempo: 'fast', terms: ['intense rock', 'heavy energy'] },
  calm: { energy: 0.2, valence: 0.65, tempo: 'slow', terms: ['peaceful ambient', 'soft acoustic'] },
  energetic: { energy: 0.95, valence: 0.75, tempo: 'fast', terms: ['workout energy', 'dance anthems'] },
  romantic: { energy: 0.45, valence: 0.8, tempo: 'medium', terms: ['love songs', 'smooth r&b'] },
  focused: { energy: 0.45, valence: 0.55, tempo: 'steady', terms: ['deep focus instrumental', 'lofi study'] },
  nostalgic: { energy: 0.55, valence: 0.65, tempo: 'medium', terms: ['throwback classics', 'nostalgic hits'] },
  party: { energy: 1, valence: 0.85, tempo: 'fast', terms: ['party anthems', 'dance floor'] },
  sleepy: { energy: 0.1, valence: 0.5, tempo: 'very slow', terms: ['gentle sleep', 'night ambient'] },
  anxious: { energy: 0.25, valence: 0.45, tempo: 'slow', terms: ['soothing stress relief', 'grounding calm'] },
};

const ACTIVITIES = new Set(['none', 'studying', 'working out', 'commuting', 'relaxing', 'sleeping', 'socializing']);
const DIRECTIONS = new Set(['stay', 'uplift', 'calm down', 'energize', 'focus']);

function cleanChoice(value, allowed, fallback) {
  const clean = String(value || '').trim().toLowerCase();
  return allowed.has(clean) ? clean : fallback;
}

function parseRecommendationContext(query) {
  const mood = String(query.mood || '').toLowerCase();
  const secondaryMood = MOOD_PROFILES[String(query.secondaryMood || '').toLowerCase()] ? String(query.secondaryMood).toLowerCase() : '';
  return {
    mood,
    secondaryMood: secondaryMood === mood ? '' : secondaryMood,
    intensity: Math.min(5, Math.max(1, Number.parseInt(query.intensity, 10) || 3)),
    activity: cleanChoice(query.activity, ACTIVITIES, 'none'),
    direction: cleanChoice(query.direction, DIRECTIONS, 'stay'),
    minutes: Math.min(180, Math.max(10, Number.parseInt(query.minutes, 10) || 30)),
    preferredArtist: String(query.artist || '').trim().slice(0, 80),
    preferredGenre: String(query.genre || '').trim().slice(0, 40),
  };
}

function buildSearchQueries(context) {
  const profile = MOOD_PROFILES[context.mood];
  if (!profile) return [];
  const secondary = context.secondaryMood ? ' ' + context.secondaryMood : '';
  const activity = context.activity === 'none' ? '' : ' for ' + context.activity;
  const direction = context.direction === 'stay' ? '' : ' ' + context.direction;
  const intensity = context.intensity >= 4 ? ' intense' : context.intensity <= 2 ? ' gentle' : '';
  const moodQueries = profile.terms.map(function(term) {
    const genre = context.preferredGenre ? ' ' + context.preferredGenre : '';
    return term + secondary + direction + intensity + activity + genre;
  });
  if (context.preferredArtist) {
    // Combining Spotify field filters with several mood terms can produce an
    // empty result set. Search the requested artist first, then use natural
    // language mood fallbacks; ranking still favors exact artist matches.
    return ['artist:' + context.preferredArtist]
      .concat(moodQueries.map(function(query) { return context.preferredArtist + ' ' + query; }))
      .concat([context.preferredArtist]);
  }
  return moodQueries;
}

function scoreAndExplain(song, context, history) {
  const id = song.trackId;
  const artistKey = String(song.artist || '').toLowerCase();
  let score = Math.random() * 0.15;
  const reasons = [];
  if (history.disliked.has(id)) return { score: -Infinity, reasons: [] };
  if (history.liked.has(id)) { score += context.direction === 'stay' ? 1.5 : 0.55; reasons.push('Because you liked this track'); }
  if (history.played.has(id)) { score += context.variety === 'familiar' ? 1.1 : -0.2; reasons.push('A familiar pick from your history'); }
  if (history.likedArtists.has(artistKey)) { score += 0.8; reasons.push('Because you respond well to ' + song.artist); }
  const skipCount = history.skipped?.get(id) || 0;
  const completionCount = history.completed?.get(id) || 0;
  const artistAffinity = history.artistAffinity?.get(artistKey) || 0;
  if (skipCount) score -= Math.min(2.4, skipCount * 1.2);
  if (completionCount) { score += Math.min(2, completionCount * 0.8); reasons.push('Because you listened to this through'); }
  if (artistAffinity > 0) { score += Math.min(1.2, artistAffinity * 0.3); reasons.push('Based on artists you finish listening to'); }
  if (artistAffinity < 0) score -= Math.min(1.2, Math.abs(artistAffinity) * 0.3);
  if (context.preferredArtist && artistKey.includes(context.preferredArtist.toLowerCase())) { score += 1.8; reasons.push('Matches your artist preference'); }
  if (context.preferredGenre) reasons.push('Exploring your ' + context.preferredGenre + ' preference');
  if (context.activity !== 'none') reasons.push('Chosen for ' + context.activity);
  if (context.direction !== 'stay') reasons.push('Designed to help you ' + context.direction);
  if (context.secondaryMood) reasons.push('Blends ' + context.mood + ' with ' + context.secondaryMood);
  if (!reasons.length) reasons.push('Matches your ' + context.mood + ' mood at intensity ' + context.intensity);
  return { score, reasons: reasons.slice(0, 2) };
}

function rankSongs(pool, context, history, limit) {
  const ranked = pool.map(function(song) {
    const result = scoreAndExplain(song, context, history);
    return { song, score: result.score, reasons: result.reasons };
  }).filter(function(item) { return Number.isFinite(item.score); }).sort(function(a, b) { return b.score - a.score; });
  const selected = [];
  const artistCounts = new Map();
  for (const item of ranked) {
    const artist = String(item.song.artist || '').toLowerCase();
    if ((artistCounts.get(artist) || 0) >= 2) continue;
    selected.push({ ...item.song, recommendation_reasons: item.reasons });
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

module.exports = { MOOD_PROFILES, parseRecommendationContext, buildSearchQueries, rankSongs };
