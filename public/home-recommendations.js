function spotifyTrackId(url) {
  const match = String(url || '').match(/^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]+)(?:\?.*)?$/);
  return match ? match[1] : '';
}

function songActionMenuHTML(song, includeFeedback) {
  const itemIndex = songActionItems.push(song) - 1;
  const feedback = includeFeedback && song.spotify_url
    ? '<div class="song-menu-divider"></div><button onclick="songMenuAction(\'helpful\',' + itemIndex + ',this)">Fits this mood</button><button onclick="songMenuAction(\'not-helpful\',' + itemIndex + ',this)">Not for me</button>'
    : '';
  return '<div class="song-menu-wrap"><button class="song-more-button" onclick="toggleSongMenu(event,this)" aria-label="More options for ' + escapeHTML(song.title) + '" aria-expanded="false">•••</button><div class="song-action-menu" hidden><button onclick="songMenuAction(\'play\',' + itemIndex + ',this)">Play now</button><button onclick="songMenuAction(\'queue\',' + itemIndex + ',this)">Add to queue</button><button onclick="songMenuAction(\'playlist\',' + itemIndex + ',this)">Add to playlist</button><button onclick="songMenuAction(\'similar\',' + itemIndex + ',this)">More like this</button>' + feedback + '<div class="song-menu-divider"></div><button onclick="songMenuAction(\'spotify\',' + itemIndex + ',this)">Open in Spotify</button></div></div>';
}

function closeSongMenus(except) {
  document.querySelectorAll('.song-action-menu').forEach(function(menu) {
    if (menu === except) return;
    menu.hidden = true;
    menu.parentElement.classList.remove('drop-up');
    const trigger = menu.previousElementSibling;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    const card = menu.closest('.song-card,.sotd-card,.media-card');
    if (card) card.classList.remove('menu-open');
  });
}

function toggleSongMenu(event, button) {
  event.stopPropagation();
  const menu = button.nextElementSibling;
  const open = menu.hidden;
  closeSongMenus(menu);
  menu.parentElement.classList.remove('drop-up');
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  const card = menu.closest('.song-card,.sotd-card,.media-card');
  if (card) card.classList.toggle('menu-open', open);
  if (open && window.innerWidth > 768) {
    const player = document.getElementById('spotify-player');
    const limit = player && player.style.display !== 'none' ? player.getBoundingClientRect().top : window.innerHeight;
    if (menu.getBoundingClientRect().bottom > limit - 8) menu.parentElement.classList.add('drop-up');
  }
}

function songMenuAction(action, index, button) {
  const song = songActionItems[index];
  if (!song) return;
  const trackId = song.trackId || spotifyTrackId(song.spotify_url);
  if (action === 'play' && trackId) playInApp(trackId, song.title, song.artist, song.album_art || song.albumArt);
  if (action === 'queue') addToQueue(song);
  if (action === 'playlist') addToPlaylist(song, button);
  if (action === 'similar') moreLikeThis(song.title, song.artist);
  if (action === 'spotify' && trackId) window.open('https://open.spotify.com/track/' + trackId, '_blank', 'noopener');
  if (action === 'helpful' && trackId) sendRecommendationFeedback(trackId, true, button);
  if (action === 'not-helpful' && trackId) sendRecommendationFeedback(trackId, false, button);
  closeSongMenus();
}

function randomMood() {
  const random = moods[Math.floor(Math.random() * moods.length)];
  const counts = [5, 8, 10];
  const randomCount = counts[Math.floor(Math.random() * counts.length)];
  currentLimit = randomCount;
  document.getElementById('mood-select').value = random;
  document.getElementById('count-select').value = String(randomCount);
  setMood(random);
}

function onMoodSelect(value) {
  if (!value) return;
  currentMood = value;
  applyMoodColors(value);
}

function onCountSelect(value) {
  currentLimit = parseInt(value, 10);
}

function submitRecommendation(event) {
  if (event) event.preventDefault();
  const mood = document.getElementById('mood-select').value;
  const count = parseInt(document.getElementById('count-select').value, 10);
  if (!mood || !count) return;
  currentLimit = count;
  setMood(mood);
}

function checkMoodStreak(mood) {
  let streak = 0;
  for (let i = 0; i < recentMoods.length; i++) {
    if (recentMoods[i].mood === mood) streak++;
    else break;
  }
  const banner = document.getElementById('streak-banner');
  if (streak >= 2) {
    const label = streak >= 5 ? '🔥' : streak >= 3 ? '✨' : '💫';
    banner.textContent = label + ' ' + streak + '-pick ' + mood + ' streak!';
    banner.style.display = 'block';
    void banner.offsetWidth;
    banner.classList.add('streak-banner-show');
  } else {
    banner.style.display = 'none';
    banner.classList.remove('streak-banner-show');
  }
}

function setMood(mood) {
  currentMood = mood;
  applyMoodColors(mood);
  recentMoods.unshift({ mood: mood, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  if (recentMoods.length > 10) recentMoods.pop();
  localStorage.setItem('quaver_moods', JSON.stringify(recentMoods));
  checkMoodStreak(mood);
  if (localStorage.getItem('quaver_user')) {
    fetch(API + '/api/mood/history', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mood: mood })
    }).catch(function() {});
  }
  fetchSongs();
}

function showSkeletons(count) {
  const card = '<div class="skeleton-card"><div class="skeleton-art"></div><div class="skeleton-lines"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div>';
  document.getElementById('results').innerHTML = card.repeat(count);
}

function renderRecommendationSongs(songs) {
  window._lastResults = songs;
  let html = '<div class="results-header"><span>' + songs.length + ' tracks — ' + escapeHTML(currentMood) + '</span><button class="play-all-btn" onclick="playAll(window._lastResults)">▶ Play All</button></div>';
  songs.forEach(function(song, index) {
    const trackId = spotifyTrackId(song.spotify_url);
    html += '<div class="song-card" style="animation-delay:' + (index * 0.07) + 's">';
    html += '<span class="song-num">' + String(index + 1).padStart(2, '0') + '</span>';
    html += song.album_art ? '<img class="album-art" src="' + escapeHTML(song.album_art) + '" alt="art"/>' : '<div class="album-art"></div>';
    const reasons = Array.isArray(song.recommendation_reasons) && song.recommendation_reasons.length ? song.recommendation_reasons.join(' · ') : 'Fits your ' + currentMood + ' mood';
    html += '<div class="song-info"><div class="song-title">' + escapeHTML(song.title) + '</div><div class="song-artist">' + escapeHTML(song.artist) + '</div><div class="recommendation-reason">' + escapeHTML(reasons) + '</div></div>';
    html += '<div class="song-actions">';
    if (trackId) html += '<button class="play-btn" data-result-index="' + index + '" aria-label="Play ' + escapeHTML(song.title) + '">&#9654;</button>';
    html += '<span class="song-duration">' + escapeHTML(song.duration) + '</span>';
    html += songActionMenuHTML(song, true) + '</div></div>';
  });
  document.getElementById('results').innerHTML = html;
}

async function fetchSongs() {
  document.getElementById('loading').style.display = 'none';
  showSkeletons(currentLimit);
  try {
    const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
    const context = {
      secondaryMood: document.getElementById('secondary-mood').value,
      intensity: document.getElementById('mood-intensity').value,
      activity: document.getElementById('mood-activity').value,
      direction: document.getElementById('mood-direction').value,
      artist: document.getElementById('preferred-artist').value.trim(),
      genre: document.getElementById('preferred-genre').value.trim(),
      minutes: document.getElementById('session-minutes').value,
    };
    const params = new URLSearchParams({ mood: currentMood, limit: currentLimit, explicit: String(preferences.explicitContent !== false), variety: preferences.recommendationVariety || 'balanced', ...context });
    const url = API + '/api/music/recommend?' + params.toString();
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (data.songs && data.songs.length > 0) {
      renderRecommendationSongs(data.songs);
      trackRecommendationEvent('impression', '', { count: data.songs.length, context: data.context });
    }
    else document.getElementById('results').innerHTML = '<p class="no-results">No songs found. Try another mood!</p>';
  } catch (_) {
    document.getElementById('results').innerHTML = '<div class="error-state"><p>Could not load songs.</p><button class="retry-btn" onclick="fetchSongs()">Try again</button></div>';
  }
}

function trackRecommendationEvent(type, trackId, details) {
  if (!localStorage.getItem('quaver_user')) return;
  fetch(API + '/api/music/events', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: type, trackId: trackId || '', mood: currentMood || '', details: details || {} })
  }).catch(function() {});
}

function sendRecommendationFeedback(trackId, helpful, button) {
  if (!localStorage.getItem('quaver_user')) return showToast('Log in to save recommendation feedback.', 'error');
  fetch(API + '/api/music/feedback', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: trackId, mood: currentMood || '', helpful: helpful })
  }).then(function(res) {
    if (!res.ok) throw new Error('Feedback failed');
    button.parentElement.querySelectorAll('button').forEach(function(item) { item.classList.remove('selected'); });
    button.classList.add('selected');
    showToast('Thanks — this will improve your recommendations.', 'success');
  }).catch(function() { showToast('Could not save feedback.', 'error'); });
}

function moreLikeThis(title, artist) {
  const query = artist ? title + ' ' + artist : title;
  window.location.href = 'search.html?q=' + encodeURIComponent(query);
}

document.addEventListener('click', function(event) {
  const playButton = event.target.closest('.play-btn[data-result-index]');
  if (playButton) {
    const song = (window._lastResults || [])[Number(playButton.dataset.resultIndex)];
    const trackId = song && spotifyTrackId(song.spotify_url);
    if (trackId) playInApp(trackId, song.title, song.artist, song.album_art);
    return;
  }
  closeSongMenus();
});

document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') closeSongMenus();
});
