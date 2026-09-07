let recommendationRequestController = null;
let artistSuggestionTimer = null;
let artistSuggestionController = null;

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
    menu.parentElement.classList.remove('drop-up', 'open-right');
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
  menu.parentElement.classList.remove('drop-up', 'open-right');
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  const card = menu.closest('.song-card,.sotd-card,.media-card');
  if (card) card.classList.toggle('menu-open', open);
  if (open && window.innerWidth > 768) {
    if (menu.getBoundingClientRect().left < 8) menu.parentElement.classList.add('open-right');
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
  const counts = [10, 15, 20];
  const randomCount = counts[Math.floor(Math.random() * counts.length)];
  currentLimit = randomCount;
  document.getElementById('mood-select').value = random;
  document.getElementById('count-select').value = String(randomCount);
  setMood(random);
  updateRecommendationState();
}

function onMoodSelect(value) {
  if (!value) return;
  clearRecommendationError();
  document.querySelectorAll('[data-trending-mood]').forEach(function(button) {
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
  });
  currentMood = value;
  applyMoodColors(value);
  syncChoiceChips('mood-select');
  updateRecommendationState();
}

function syncChoiceChips(targetId) {
  const control = document.getElementById(targetId);
  const group = document.querySelector('[data-choice-target="' + targetId + '"]');
  if (!control || !group) return;
  group.querySelectorAll('button[data-value]').forEach(function(button) {
    const selected = button.dataset.value === control.value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if (targetId === 'mood-select') updateRecommendationState();
}

function updateRecommendationState() {
  const moodControl = document.getElementById('mood-select');
  const countControl = document.getElementById('count-select');
  const summary = document.getElementById('recommendation-summary');
  if (!moodControl) return;
  const mood = moodControl.value;
  const count = Number(countControl && countControl.value) || 10;
  document.querySelectorAll('.recommendation-go-btn,.fine-tune-create').forEach(function(button) {
    button.disabled = !mood;
    button.setAttribute('aria-disabled', String(!mood));
  });
  if (summary) summary.textContent = mood
    ? mood.charAt(0).toUpperCase() + mood.slice(1) + ' · ' + count + ' songs'
    : 'Choose a mood to begin';
}

function updateMoodChipOverflow() {
  const rail = document.querySelector('.main-mood-chips');
  const field = rail && rail.closest('.recommendation-mood-field');
  if (!rail || !field) return;
  const overflow = rail.scrollWidth > rail.clientWidth + 2;
  field.classList.toggle('has-overflow', overflow);
  field.classList.toggle('is-scrolled', overflow && rail.scrollLeft > 4);
  field.classList.toggle('is-at-end', !overflow || rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4);
}

function initializeMoodChipRail() {
  const rail = document.querySelector('.main-mood-chips');
  if (!rail || rail.dataset.dragReady) return;
  rail.dataset.dragReady = 'true';
  let startX = 0;
  let startScroll = 0;
  let dragged = false;
  rail.addEventListener('scroll', updateMoodChipOverflow, { passive: true });
  rail.addEventListener('pointerdown', function(event) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button')) return;
    startX = event.clientX;
    startScroll = rail.scrollLeft;
    dragged = false;
    rail.setPointerCapture(event.pointerId);
  });
  rail.addEventListener('pointermove', function(event) {
    if (!rail.hasPointerCapture(event.pointerId)) return;
    if (Math.abs(event.clientX - startX) > 5) dragged = true;
    if (!dragged) return;
    rail.classList.add('is-dragging');
    rail.scrollLeft = startScroll - (event.clientX - startX);
  });
  rail.addEventListener('pointerup', function(event) {
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    rail.classList.remove('is-dragging');
    window.setTimeout(function() { dragged = false; }, 0);
  });
  rail.addEventListener('pointercancel', function() {
    rail.classList.remove('is-dragging');
    dragged = false;
  });
  rail.addEventListener('click', function(event) {
    if (!dragged) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('resize', updateMoodChipOverflow, { passive: true });
  requestAnimationFrame(updateMoodChipOverflow);
}

function selectChoiceChip(button) {
  const group = button.closest('[data-choice-target]');
  const control = group && document.getElementById(group.dataset.choiceTarget);
  if (!control) return;
  control.value = button.dataset.value || '';
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function setMoodBlendMode(mode) {
  const blending = mode === 'blend';
  document.querySelectorAll('[data-mood-mode]').forEach(function(button) {
    button.setAttribute('aria-pressed', String(button.dataset.moodMode === mode));
  });
  const options = document.querySelector('.blend-mood-options');
  if (options) options.hidden = !blending;
  if (!blending) {
    const secondary = document.getElementById('secondary-mood');
    if (secondary) secondary.value = '';
    syncChoiceChips('secondary-mood');
  }
}

function updateArtistSuggestions(query) {
  clearTimeout(artistSuggestionTimer);
  if (artistSuggestionController) artistSuggestionController.abort();
  const list = document.getElementById('artist-suggestions');
  const status = document.getElementById('artist-suggestion-status');
  if (!list || String(query).trim().length < 2) {
    if (list) list.replaceChildren();
    if (status) status.textContent = '';
    return;
  }
  artistSuggestionTimer = setTimeout(async function() {
    artistSuggestionController = new AbortController();
    try {
      const response = await fetch(API + '/api/music/search?q=' + encodeURIComponent(String(query).trim()), { credentials: 'include', signal: artistSuggestionController.signal });
      const data = await response.json();
      if (!response.ok) throw new Error('Artist lookup failed');
      const names = Array.from(new Set((data.artists || []).map(function(artist) { return artist.name; }).filter(Boolean))).slice(0, 6);
      list.replaceChildren.apply(list, names.map(function(name) {
        const option = document.createElement('option');
        option.value = name;
        return option;
      }));
      if (status) status.textContent = names.length ? names.length + ' artist suggestions available' : '';
    } catch (error) {
      if (error.name !== 'AbortError' && status) status.textContent = '';
    }
  }, 250);
}

function updateIntensityLabel(value) {
  const labels = { 1: 'Mellow', 2: 'Gentle', 3: 'Balanced', 4: 'Strong', 5: 'Intense' };
  const output = document.getElementById('intensity-output');
  if (output) output.value = labels[Number(value)] || 'Balanced';
}

function onCountSelect(value) {
  clearRecommendationError();
  currentLimit = parseInt(value, 10);
  updateRecommendationState();
}

function clearRecommendationError() {
  const results = document.getElementById('results');
  if (results && results.querySelector('.error-state')) results.replaceChildren();
}

async function submitRecommendation(event) {
  if (event) event.preventDefault();
  const mood = document.getElementById('mood-select').value;
  const count = parseInt(document.getElementById('count-select').value, 10);
  if (!mood || !count) return;
  currentLimit = count;
  clearRecommendationError();
  const buttons = Array.from(document.querySelectorAll('.recommendation-go-btn,.fine-tune-create'));
  buttons.forEach(function(button) {
    button.disabled = true;
    button.dataset.previousLabel = button.textContent.trim();
    button.textContent = 'Creating…';
  });
  try {
    await setMood(mood);
  } finally {
    buttons.forEach(function(button) {
      button.textContent = button.dataset.previousLabel || 'Create mix';
      delete button.dataset.previousLabel;
    });
    updateRecommendationState();
  }
}

function checkMoodStreak(mood) {
  let streak = 0;
  for (let i = 0; i < recentMoods.length; i++) {
    if (recentMoods[i].mood === mood) streak++;
    else break;
  }
  const banner = document.getElementById('streak-banner');
  if (streak >= 2) {
    banner.textContent = streak + '-pick ' + mood + ' streak';
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
  return fetchSongs();
}

function showSkeletons(count) {
  const card = '<div class="skeleton-card"><div class="skeleton-art"></div><div class="skeleton-lines"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div>';
  document.getElementById('results').innerHTML = card.repeat(count);
}

function recommendationLearningHTML(learning) {
  if (!learning) return '';
  if (learning.loggedOut) return '<div class="recommendation-learning"><strong>Fresh mix</strong><span>Log in to let completions, skips, and ratings shape future picks.</span></div>';
  if (!learning.personalized) return '<div class="recommendation-learning"><strong>Learning your taste</strong><span>Play, finish, skip, or rate songs and Quaver will adapt.</span></div>';
  const signals = [];
  if (learning.completed) signals.push(learning.completed + ' completed');
  if (learning.skipped) signals.push(learning.skipped + ' skipped');
  if (learning.ratings) signals.push(learning.ratings + ' rated');
  if (learning.familiarTracks) signals.push(learning.familiarTracks + ' from your history');
  return '<div class="recommendation-learning"><strong>Tuned for you</strong><span>Using ' + escapeHTML(signals.slice(0, 3).join(' · ')) + ' · ' + escapeHTML(learning.variety || 'balanced') + ' discovery</span></div>';
}

function renderRecommendationSongs(songs, learning) {
  window._lastResults = songs;
  window._lastResultsLearning = learning;
  let html = '<div class="results-header"><span>' + songs.length + ' tracks — ' + escapeHTML(currentMood) + '</span><div class="results-actions"><button class="shuffle-mix-btn" type="button" onclick="shuffleMix()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h2.5c5 0 6 10 11 10H20M17 4l3 3-3 3M4 17h2.5c1.8 0 3-1.3 4.1-3M14 7.8c1-1 2.1-1.8 3.4-1.8H20M17 14l3 3-3 3"/></svg>Shuffle</button><button class="play-all-btn" type="button" onclick="playAll(window._lastResults)">Play all</button></div></div>';
  html += recommendationLearningHTML(learning);
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

function shuffleMix() {
  const songs=(window._lastResults||[]).slice();
  if (songs.length < 2) return showToast('Add another song before shuffling.','error');
  for (let i=songs.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    const item=songs[i];songs[i]=songs[j];songs[j]=item;
  }
  window._lastResults=songs;
  songQueue=songs.filter(function(song){return spotifyTrackId(song.spotify_url);});
  queueIndex=-1;
  if (window.QuaverPlayer) QuaverPlayer.setQueue(songQueue,0);
  updateQueueCounter();
  renderRecommendationSongs(songs,window._lastResultsLearning);
  showToast('Mix shuffled.','success');
}

function focusMobileResults() {
  if (window.matchMedia('(max-width: 768px)').matches) {
    window.setTimeout(function(){document.getElementById('results').scrollIntoView({behavior:document.documentElement.classList.contains('reduce-motion')?'auto':'smooth',block:'start'});},80);
  }
}

async function fetchSongs() {
  if (recommendationRequestController) recommendationRequestController.abort();
  const controller = new AbortController();
  recommendationRequestController = controller;
  const timeout = setTimeout(function() { controller.abort('timeout'); }, 15000);
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
    };
    const params = new URLSearchParams({ mood: currentMood, limit: currentLimit, explicit: String(preferences.explicitContent !== false), variety: preferences.recommendationVariety || 'balanced', ...context });
    const url = API + '/api/music/recommend?' + params.toString();
    const res = await fetch(url, { credentials: 'include', signal: controller.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Recommendation request failed');
    if (controller !== recommendationRequestController) return;
    if (data.songs && data.songs.length > 0) {
      renderRecommendationSongs(data.songs, data.learning);
      if (document.documentElement.classList.contains('reduce-motion')) {
        document.getElementById('results').scrollIntoView({ block: 'start' });
      } else {
        document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      trackRecommendationEvent('impression', '', { count: data.songs.length, context: data.context });
    }
    else document.getElementById('results').innerHTML = '<div class="error-state"><p>No matches for that exact combination.</p><button class="retry-btn" onclick="document.getElementById(\'preferred-artist\').value=\'\';fetchSongs()">Try without the artist</button></div>';
  } catch (error) {
    if (controller !== recommendationRequestController) return;
    const message = controller.signal.aborted ? 'This mix is taking longer than expected.' : 'Could not load songs.';
    document.getElementById('results').innerHTML = '<div class="error-state"><p>' + message + '</p><button class="retry-btn" onclick="fetchSongs()">Try again</button></div>';
  } finally {
    clearTimeout(timeout);
    if (controller === recommendationRequestController) recommendationRequestController = null;
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
  const modeButton = event.target.closest('[data-mood-mode]');
  if (modeButton) {
    setMoodBlendMode(modeButton.dataset.moodMode);
    return;
  }
  const choiceButton = event.target.closest('.choice-chips button[data-value]');
  if (choiceButton) {
    selectChoiceChip(choiceButton);
    return;
  }
  const playButton = event.target.closest('.play-btn[data-result-index]');
  if (playButton) {
    const song = (window._lastResults || [])[Number(playButton.dataset.resultIndex)];
    const trackId = song && spotifyTrackId(song.spotify_url);
    if (trackId) playInApp(trackId, song.title, song.artist, song.album_art);
    return;
  }
  closeSongMenus();
});

document.addEventListener('input', function(event) {
  if (event.target && event.target.id === 'preferred-artist') updateArtistSuggestions(event.target.value);
});

window.addEventListener('DOMContentLoaded', function() {
  initializeMoodChipRail();
  updateRecommendationState();
});

document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') closeSongMenus();
});
