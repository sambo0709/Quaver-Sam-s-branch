function playPersonalized(index) {
  const song = (window._jumpBackSongs || [])[index];
  if (song) playInApp(song.trackId, song.title, song.artist, song.albumArt);
}

function chooseMoodShortcut(mood) {
  document.getElementById('mood-select').value = mood;
  onMoodSelect(mood);
  document.querySelector('main').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderJumpBack(plays) {
  const rail = document.getElementById('jump-back-rail');
  const seen = new Set();
  const songs = (plays || []).filter(function(song) {
    if (!song.trackId || seen.has(song.trackId)) return false;
    seen.add(song.trackId);
    return true;
  }).slice(0, 8);
  window._jumpBackSongs = songs;
  if (!songs.length) {
    rail.innerHTML = '<div class="rail-empty"><span class="rail-empty-icon" aria-hidden="true">♪</span><div><strong>Your recent favorites will live here</strong><span>Play a song to start building your listening history.</span></div><a href="#recommendation-form">Find your first mix</a></div>';
    return;
  }
  rail.innerHTML = songs.map(function(song, index) {
    const menuSong = { trackId: song.trackId, title: song.title, artist: song.artist || '', albumArt: song.albumArt || '', album_art: song.albumArt || '', spotify_url: 'https://open.spotify.com/track/' + song.trackId };
    return '<article class="media-card"><div class="media-art-wrap">' + (song.albumArt ? '<img src="' + escapeHTML(song.albumArt) + '" alt=""/>' : '<div class="media-art-placeholder">♪</div>') + '<button class="media-play-button" onclick="playPersonalized(' + index + ')" aria-label="Play ' + escapeHTML(song.title) + '">▶</button></div><div class="media-card-copy"><strong>' + escapeHTML(song.title) + '</strong><span>' + escapeHTML(song.artist || 'Unknown artist') + '</span></div>' + songActionMenuHTML(menuSong, false) + '</article>';
  }).join('');
}

function renderMoodShortcuts(entries) {
  const counts = {};
  (entries || []).forEach(function(entry) { if (entry.mood) counts[entry.mood] = (counts[entry.mood] || 0) + 1; });
  const preferred = JSON.parse(localStorage.getItem('quaver_preferences') || '{}').defaultMood;
  const defaults = [preferred, 'calm', 'energetic', 'focused', 'happy', 'nostalgic'].filter(Boolean);
  const ranked = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; }).concat(defaults);
  const shortcuts = ranked.filter(function(mood, index, list) { return moodColors[mood] && list.indexOf(mood) === index; }).slice(0, 5);
  document.getElementById('mood-shortcut-rail').innerHTML = shortcuts.map(function(mood, index) {
    const count = counts[mood] || 0;
    const subtitle = count ? count + ' mood check-in' + (count === 1 ? '' : 's') : (index === 0 && preferred === mood ? 'Your default mood' : 'A fresh mix');
    return '<button class="mood-shortcut-card mood-' + mood + '" onclick="chooseMoodShortcut(\'' + mood + '\')"><span class="mood-shortcut-label">' + escapeHTML(mood) + '</span><strong>' + escapeHTML(mood.charAt(0).toUpperCase() + mood.slice(1)) + ' Mix</strong><small>' + subtitle + '</small><span class="mood-shortcut-play">▶</span></button>';
  }).join('');
}

async function loadPersonalizedHome() {
  let plays = [];
  let moodHistory = recentMoods.slice();
  try { plays = JSON.parse(localStorage.getItem('quaver_recently_played') || '[]'); } catch (_) {}
  if (localStorage.getItem('quaver_user')) {
    const responses = await Promise.allSettled([
      fetch(API + '/api/listening/history', { credentials: 'include' }).then(function(res) { return res.ok ? res.json() : null; }),
      fetch(API + '/api/mood/history', { credentials: 'include' }).then(function(res) { return res.ok ? res.json() : null; })
    ]);
    if (responses[0].status === 'fulfilled' && responses[0].value?.plays) plays = responses[0].value.plays;
    if (responses[1].status === 'fulfilled' && responses[1].value?.moods) moodHistory = responses[1].value.moods;
  }
  renderJumpBack(plays);
  renderMoodShortcuts(moodHistory);
}

function renderMotd(data, grid) {
  const mood = data.mood;
  const songs = data.songs;
  document.getElementById('sotd-mood-subtitle').textContent = mood.charAt(0).toUpperCase() + mood.slice(1) + ' — ' + songs.length + ' picks for today';
  let html = '';
  songs.forEach(function(song, index) {
    const trackId = spotifyTrackId(song.spotify_url);
    html += '<div class="sotd-card" style="animation-delay:' + (index * 0.1) + 's"><span class="sotd-num">' + String(index + 1).padStart(2, '0') + '</span>';
    html += song.album_art ? '<img class="sotd-art" src="' + escapeHTML(song.album_art) + '" alt="art"/>' : '<div class="sotd-art"></div>';
    html += '<div class="sotd-info"><div class="sotd-song-title">' + escapeHTML(song.title) + '</div><div class="sotd-song-artist">' + escapeHTML(song.artist) + '</div><div class="recommendation-reason">Selected for today\'s ' + escapeHTML(mood) + ' mood</div></div><div class="sotd-actions">';
    if (trackId) html += '<button class="sotd-play-btn" data-motd-index="' + index + '" aria-label="Play ' + escapeHTML(song.title) + '">&#9654;</button>';
    html += songActionMenuHTML(song, false) + '</div></div>';
  });
  window._motdSongs = songs;
  grid.innerHTML = html;
}

function trendingButton(mood, index) {
  const rank = index + 1;
  const label = rank + '. ' + mood;
  return '<button class="trending-pill" data-trending-mood="' + escapeHTML(mood) + '" aria-label="' + escapeHTML(label) + '" aria-pressed="false"><span class="trending-rank">' + rank + '</span><span class="trending-mood-name">' + escapeHTML(mood) + '</span></button>';
}

function renderTrendingPills() {
  document.getElementById('trending-pills').innerHTML = '<span class="trending-pill-skeleton"></span>'.repeat(5);
}

async function loadTrendingMoods() {
  try {
    const data = await fetch(API + '/api/mood/trending').then(function(res) { return res.json(); });
    if (!data.trending || !data.trending.length) {
      document.getElementById('trending-pills').innerHTML = '<span class="trending-empty">No community check-ins yet today.</span>';
      return;
    }
    document.getElementById('trending-pills').innerHTML = data.trending.map(function(item, index) { return trendingButton(item.mood, index); }).join('');
  } catch (_) {
    document.getElementById('trending-pills').innerHTML = '<span class="trending-empty">Community trends are unavailable right now.</span>';
  }
}

async function loadSongsOfTheDay() {
  const grid = document.getElementById('sotd-grid');
  const cacheKey = 'quaver_motd';
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.ts < 86400000 && cached.data?.songs?.length) return renderMotd(cached.data, grid);
  } catch (_) {}
  try {
    const data = await fetch(API + '/api/music/sotd').then(function(res) { return res.json(); });
    if (!data.songs || !data.songs.length) return void (grid.innerHTML = '<p class="no-results">Could not load today\'s mood.</p>');
    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: data })); } catch (_) {}
    renderMotd(data, grid);
  } catch (_) {
    grid.innerHTML = '<div class="error-state"><p>Could not load today\'s mood.</p><button class="retry-btn" onclick="loadSongsOfTheDay()">Try again</button></div>';
  }
}

document.addEventListener('click', function(event) {
  const moodButton = event.target.closest('[data-trending-mood]');
  if (moodButton) {
    const mood = moodButton.dataset.trendingMood;
    document.querySelectorAll('[data-trending-mood]').forEach(function(button) {
      button.classList.toggle('is-active', button === moodButton);
      button.setAttribute('aria-pressed', String(button === moodButton));
    });
    document.getElementById('mood-select').value = mood;
    document.getElementById('count-select').value = '10';
    currentLimit = 10;
    setMood(mood);
    requestAnimationFrame(function() {
      document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  const playButton = event.target.closest('[data-motd-index]');
  if (playButton) {
    const song = (window._motdSongs || [])[Number(playButton.dataset.motdIndex)];
    const trackId = song && spotifyTrackId(song.spotify_url);
    if (trackId) playInApp(trackId, song.title, song.artist, song.album_art);
  }
});
