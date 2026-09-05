const profileActionSongs = [];

function profileTrackId(url, fallback) {
  if (fallback && /^[A-Za-z0-9]+$/.test(fallback)) return fallback;
  const match = String(url || '').match(/^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]+)(?:\?.*)?$/);
  return match ? match[1] : '';
}

function profileSongHTML(song, reason) {
  const index = profileActionSongs.push(song) - 1;
  const trackId = profileTrackId(song.spotify_url, song.trackId);
  return '<div class="profile-suggestion-item">' +
    (song.album_art || song.albumArt ? '<img class="profile-suggestion-art" src="' + profileEscapeHTML(song.album_art || song.albumArt) + '" alt="art"/>' : '<div class="profile-suggestion-art"></div>') +
    '<div class="profile-suggestion-info"><div class="profile-suggestion-title">' + profileEscapeHTML(song.title) + '</div><div class="profile-suggestion-artist">' + profileEscapeHTML(song.artist || '') + '</div>' +
    (reason ? '<div class="recommendation-reason">' + profileEscapeHTML(reason) + '</div>' : '') + '</div>' +
    (trackId ? '<button class="profile-suggestion-play" data-profile-song="' + index + '" aria-label="Play ' + profileEscapeHTML(song.title) + '">&#9654;</button>' : '') +
  '</div>';
}

function getMoodStreak(moods) {
  if (!moods || moods.length < 2) return null;
  const lastMood = moods[0].mood;
  let count = 0;
  for (var i = 0; i < moods.length; i++) {
    if (moods[i].mood === lastMood) count++;
    else break;
  }
  return count >= 2 ? { mood: lastMood, count: count } : null;
}

function renderMoodAnalytics(moods) {
  const container = document.getElementById('mood-analytics');
  if (!moods || moods.length === 0) {
    container.innerHTML = '<div class="box-empty"><p>No moods recorded yet.</p><a href="Index.html">Choose your first mood</a></div>';
    return;
  }
  const counts = {};
  moods.forEach(function(m) { counts[m.mood] = (counts[m.mood] || 0) + 1; });
  const total = moods.length;
  const sorted = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });

  const streak = getMoodStreak(moods);
  let html = '<div class="mood-summary"><span>Recorded moods</span><strong>' + total + '</strong></div>';
  if (streak) {
    html += '<div class="mood-streak"><strong>' + streak.count + '-pick streak</strong><span>' + profileEscapeHTML(streak.mood) + '</span></div>';
  }

  html += '<div class="mood-stat-list">';
  sorted.forEach(function(mood) {
    const pct = Math.round((counts[mood] / total) * 100);
    html += '<div class="mood-stat-row">';
    html += '<span class="mood-stat-name">' + profileEscapeHTML(mood) + '</span>';
    html += '<div class="mood-stat-track"><span style="width:' + pct + '%"></span></div>';
    html += '<span class="mood-stat-count">' + counts[mood] + '</span>';
    html += '<span class="mood-stat-percent">' + pct + '%</span>';
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderPlaylists(playlists) {
  const container = document.getElementById('playlists-list');
  if (!playlists || playlists.length === 0) {
    container.innerHTML = '<div class="box-empty"><p>No playlists saved yet.</p><a href="Index.html">Build your first playlist</a></div>';
    return;
  }
  container.innerHTML = playlists.map(function(pl, i) {
    return '<div class="profile-playlist-item" data-profile-playlist="' + i + '" role="button" tabindex="0">' +
      '<div><div class="profile-playlist-name">' + profileEscapeHTML(pl.name) + '</div>' +
      '<div class="profile-playlist-meta">' + pl.songs.length + ' songs · ' + profileEscapeHTML(pl.mood) + '</div></div>' +
      '<span style="color:var(--accent);font-size:12px;flex-shrink:0;">▼</span>' +
    '</div>' +
    '<div id="playlist-songs-' + i + '" style="display:none;padding:8px 0 4px;">' +
      pl.songs.map(function(song) { return profileSongHTML(song); }).join('') +
    '</div>';
  }).join('');
}

function togglePlaylistSongs(index) {
  const el = document.getElementById('playlist-songs-' + index);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function getWeeklyMoods(moods) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return (moods || []).filter(function(item) { return item.ts && item.ts >= since; });
}

document.addEventListener('click', function(event) {
  const playButton = event.target.closest('[data-profile-song]');
  if (playButton) {
    event.stopPropagation();
    const song = profileActionSongs[Number(playButton.dataset.profileSong)];
    const trackId = song && profileTrackId(song.spotify_url, song.trackId);
    if (trackId) playInApp(trackId, song.title, song.artist, song.album_art || song.albumArt);
    return;
  }
  const playlist = event.target.closest('[data-profile-playlist]');
  if (playlist) togglePlaylistSongs(Number(playlist.dataset.profilePlaylist));
});

document.addEventListener('keydown', function(event) {
  const playlist = event.target.closest('[data-profile-playlist]');
  if (playlist && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    togglePlaylistSongs(Number(playlist.dataset.profilePlaylist));
  }
});

async function loadProfileData() {
  const hasSession = true;
  let playlists = JSON.parse(localStorage.getItem('quaver_playlists') || '[]');
  if (hasSession) {
    try {
      const res = await fetch(PROFILE_API + '/api/playlist', {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.playlists) {
        playlists = data.playlists;
        localStorage.setItem('quaver_playlists', JSON.stringify(playlists));
      }
    } catch (e) {}
  }
  let moods = [];
  if (hasSession) {
    try {
      const moodRes = await fetch(PROFILE_API + '/api/mood/history', {
        credentials: 'include'
      });
      const moodData = await moodRes.json();
      if (moodData.moods) moods = [...moodData.moods].reverse();
    } catch (e) {}
  }
  window._profileMoods = moods;

  let plays = JSON.parse(localStorage.getItem('quaver_recently_played') || '[]');
  if (hasSession) {
    try {
      const playRes = await fetch(PROFILE_API + '/api/listening/history', { credentials: 'include' });
      const playData = await playRes.json();
      if (playData.plays && playData.plays.length) plays = playData.plays;
    } catch (_) {}
  }
  window._profilePlays = plays;

  document.getElementById('profile-playlist-count').textContent = playlists.length;
  document.getElementById('profile-mood-count').textContent = moods.length;
  document.getElementById('profile-play-count').textContent = plays.length;

  renderMoodAnalytics(moods);
  renderRecentlyPlayed();
  renderPlaylists(playlists);
}
