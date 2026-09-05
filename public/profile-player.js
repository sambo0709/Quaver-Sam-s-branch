async function playInApp(trackId, title, artist, albumArt) {
  const started = await QuaverPlayer.play({ trackId: trackId, title: title, artist: artist || '', albumArt: albumArt || '' });
  if (!started) return false;
  clearTimeout(profileMeaningfulPlayTimer);
  profileMeaningfulPlayTimer = setTimeout(function() {
    try {
      const recent = JSON.parse(localStorage.getItem('quaver_recently_played') || '[]');
      recent.unshift({ trackId, title, artist: artist || '', albumArt: albumArt || '', playedAt: Date.now() });
      const seen = new Set();
      const deduped = recent.filter(function(s) { if (seen.has(s.trackId)) return false; seen.add(s.trackId); return true; });
      localStorage.setItem('quaver_recently_played', JSON.stringify(deduped.slice(0, 20)));
    } catch(e) {}
    if (localStorage.getItem('quaver_user')) {
      const mood = (window._profileMoods && window._profileMoods[0]) ? window._profileMoods[0].mood : '';
      fetch(PROFILE_API + '/api/listening/history', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId, title, artist: artist || '', albumArt: albumArt || '', mood }) }).catch(function() {});
    }
  }, 10000);
  return true;
}

function renderRecentlyPlayed() {
  const container = document.getElementById('recently-played-list');
  try {
    const recent = window._profilePlays || JSON.parse(localStorage.getItem('quaver_recently_played') || '[]');
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthly = recent.filter(function(song) { return !song.playedAt || song.playedAt >= monthStart.getTime(); });
    const grouped = new Map();
    monthly.forEach(function(song) {
      const key = song.trackId || (song.title + '|' + (song.artist || ''));
      const entry = grouped.get(key) || { song: song, plays: 0 };
      entry.plays++;
      grouped.set(key, entry);
    });
    const topTracks = Array.from(grouped.values()).sort(function(a, b) { return b.plays - a.plays; }).slice(0, 5);
    if (topTracks.length === 0) {
      container.innerHTML = '<div class="box-empty"><p>No songs played yet.</p><a href="Index.html">Find something to play</a></div>';
      return;
    }
    container.innerHTML = topTracks.map(function(entry, index) {
      return '<div class="profile-ranked-track"><span class="profile-track-rank">' + (index + 1) + '</span>' + profileSongHTML(entry.song, entry.plays > 1 ? entry.plays + ' plays this month' : '') + '</div>';
    }).join('');
  } catch(e) {
    container.innerHTML = '<p class="box-empty">No songs played yet.</p>';
  }
}

function closeProfilePlayer() {
  clearTimeout(profileMeaningfulPlayTimer);
  QuaverPlayer.hide();
}
