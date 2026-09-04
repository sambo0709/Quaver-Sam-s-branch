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
    (song.album_art || song.albumArt ? '<img class="profile-suggestion-art" src="' + escapeHTML(song.album_art || song.albumArt) + '" alt="art"/>' : '<div class="profile-suggestion-art"></div>') +
    '<div class="profile-suggestion-info"><div class="profile-suggestion-title">' + escapeHTML(song.title) + '</div><div class="profile-suggestion-artist">' + escapeHTML(song.artist || '') + '</div>' +
    (reason ? '<div class="recommendation-reason">' + escapeHTML(reason) + '</div>' : '') + '</div>' +
    (trackId ? '<button class="profile-suggestion-play" data-profile-song="' + index + '" aria-label="Play ' + escapeHTML(song.title) + '">&#9654;</button>' : '') +
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
    html += '<div class="mood-streak"><strong>' + streak.count + '-pick streak</strong><span>' + escapeHTML(streak.mood) + '</span></div>';
  }

  html += '<div class="mood-stat-list">';
  sorted.forEach(function(mood) {
    const pct = Math.round((counts[mood] / total) * 100);
    html += '<div class="mood-stat-row">';
    html += '<span class="mood-stat-name">' + escapeHTML(mood) + '</span>';
    html += '<div class="mood-stat-track"><span style="width:' + pct + '%"></span></div>';
    html += '<span class="mood-stat-count">' + counts[mood] + '</span>';
    html += '<span class="mood-stat-percent">' + pct + '%</span>';
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderRecentMoods(moods) {
  const container = document.getElementById('recent-moods-list');
  if (!moods || moods.length === 0) {
    container.innerHTML = '<div class="box-empty"><p>No recent moods yet.</p><a href="Index.html">Choose a mood</a></div>';
    return;
  }
  container.innerHTML = moods.slice(0, 5).map(function(item) {
    return '<div class="profile-mood-item"><span class="profile-mood-badge">' + escapeHTML(item.mood) + '</span><span class="profile-mood-time">' + escapeHTML(item.time) + '</span></div>';
  }).join('');
}

function renderPlaylists(playlists) {
  const container = document.getElementById('playlists-list');
  if (!playlists || playlists.length === 0) {
    container.innerHTML = '<div class="box-empty"><p>No playlists saved yet.</p><a href="Index.html">Build your first playlist</a></div>';
    return;
  }
  container.innerHTML = playlists.map(function(pl, i) {
    return '<div class="profile-playlist-item" data-profile-playlist="' + i + '" role="button" tabindex="0">' +
      '<div><div class="profile-playlist-name">' + escapeHTML(pl.name) + '</div>' +
      '<div class="profile-playlist-meta">' + pl.songs.length + ' songs · ' + escapeHTML(pl.mood) + '</div></div>' +
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

async function renderSuggestions(moods) {
  const container = document.getElementById('suggestions-list');
  if (!moods || moods.length === 0) {
    container.innerHTML = '<div class="box-empty"><p>Suggestions need a mood.</p><a href="Index.html">Choose a mood</a></div>';
    return;
  }
  const moodCounts = {};
  moods.forEach(function(m) { moodCounts[m.mood] = (moodCounts[m.mood] || 0) + 1; });
  const topMood = Object.keys(moodCounts).sort(function(a, b) { return moodCounts[b] - moodCounts[a]; })[0];
  container.innerHTML = '<p class="box-empty">Loading for <strong>' + escapeHTML(topMood) + '</strong>...</p>';
  try {
    const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
    const res = await fetch(API + '/api/music/recommend?mood=' + topMood + '&limit=5&explicit=' + (preferences.explicitContent !== false) + '&variety=' + encodeURIComponent(preferences.recommendationVariety || 'balanced'), { credentials: 'include' });
    const data = await res.json();
    if (data.songs && data.songs.length > 0) {
      container.innerHTML =
        '<div style="font-size:11px;color:var(--text);opacity:0.5;margin-bottom:12px;">Based on your love of <strong>' + escapeHTML(topMood) + '</strong></div>' +
        data.songs.map(function(song) { return profileSongHTML(song, 'Because you often choose ' + topMood); }).join('');
    }
  } catch (err) {
    container.innerHTML = '<p class="box-empty">Could not load suggestions.</p>';
  }
}

function getWeeklyMoods(moods) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return (moods || []).filter(function(item) { return item.ts && item.ts >= since; });
}

async function renderWeeklyMix(moods) {
  const container = document.getElementById('weekly-mix-list');
  const weekly = getWeeklyMoods(moods);
  if (!weekly.length) {
    container.innerHTML = '<div class="box-empty"><p>Choose a mood this week to create your mix.</p><a href="Index.html">Choose a mood</a></div>';
    return;
  }
  const counts = {};
  weekly.forEach(function(item) { counts[item.mood] = (counts[item.mood] || 0) + 1; });
  const topMood = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; })[0];
  container.innerHTML = '<p class="box-empty">Building your ' + escapeHTML(topMood) + ' mix...</p>';
  try {
    const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
    const res = await fetch(API + '/api/music/recommend?mood=' + topMood + '&limit=5&explicit=' + (preferences.explicitContent !== false) + '&variety=' + encodeURIComponent(preferences.recommendationVariety || 'balanced'), { credentials: 'include' });
    const data = await res.json();
    if (!data.songs || !data.songs.length) throw new Error('No songs');
    container.innerHTML = '<div class="mix-intro">Based on your most frequent mood this week: <strong>' + escapeHTML(topMood) + '</strong></div>' +
      data.songs.map(function(song) { return profileSongHTML(song, 'Matches your weekly ' + topMood + ' pattern'); }).join('');
  } catch (_) {
    container.innerHTML = '<div class="box-empty"><p>Your weekly mix is temporarily unavailable.</p><a href="Index.html">Browse moods</a></div>';
  }
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
      const res = await fetch(API + '/api/playlist', {
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
      const moodRes = await fetch(API + '/api/mood/history', {
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
      const playRes = await fetch(API + '/api/listening/history', { credentials: 'include' });
      const playData = await playRes.json();
      if (playData.plays && playData.plays.length) plays = playData.plays;
    } catch (_) {}
  }
  window._profilePlays = plays;

  renderMoodAnalytics(moods);
  renderRecentMoods(moods);
  renderRecentlyPlayed();
  renderPlaylists(playlists);
  renderSuggestions(moods);
  renderWeeklyMix(moods);
}
