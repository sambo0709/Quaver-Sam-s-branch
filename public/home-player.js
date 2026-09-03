async function playInApp(trackId, title, artist, albumArt) {
  updateQueueCounter();
  const qp = document.getElementById('queue-panel');
  if (qp && qp.classList.contains('open')) renderQueuePanel();
  const started = await QuaverPlayer.play({ trackId: trackId, title: title, artist: artist || '', albumArt: albumArt || '' });
  if (!started) return false;
  clearTimeout(meaningfulPlayTimer);
  meaningfulPlayTimer = setTimeout(function() {
    try {
      const recent = JSON.parse(localStorage.getItem('quaver_recently_played') || '[]');
      recent.unshift({ trackId, title, artist: artist || '', albumArt: albumArt || '', playedAt: Date.now() });
      const seen = new Set();
      const deduped = recent.filter(function(s) { if (seen.has(s.trackId)) return false; seen.add(s.trackId); return true; });
      localStorage.setItem('quaver_recently_played', JSON.stringify(deduped.slice(0, 20)));
    } catch(e) {}
    if (localStorage.getItem('quaver_user')) fetch(API + '/api/listening/history', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: trackId, title: title, artist: artist || '', albumArt: albumArt || '', mood: currentMood || '' }) }).catch(function() {});
  }, 10000);
  return true;
}

function addToQueue(song) {
  songQueue.push(song);
  if (queueIndex === -1) {
    queueIndex = 0;
    const trackId = song.spotify_url ? song.spotify_url.split('/track/')[1] : null;
    if (trackId) playInApp(trackId, song.title, song.artist, song.album_art);
    showToast('Now playing: "' + song.title + '"', 'success');
  } else {
    showToast('"' + song.title + '" added to queue', 'success');
    const counter = document.getElementById('queue-counter');
    if (counter) {
      counter.classList.remove('queue-counter-pop');
      void counter.offsetWidth;
      counter.classList.add('queue-counter-pop');
    }
  }
  updateQueueCounter();
}

function playFromQueue(direction) {
  if (songQueue.length === 0) return;
  queueIndex = Math.max(0, Math.min(songQueue.length - 1, queueIndex + direction));
  const song = songQueue[queueIndex];
  const trackId = song.spotify_url ? song.spotify_url.split('/track/')[1] : null;
  if (trackId) playInApp(trackId, song.title, song.artist, song.album_art);
}

function updateQueueCounter() {
  const counter = document.getElementById('queue-counter');
  if (songQueue.length > 0) {
    counter.textContent = (queueIndex + 1) + '/' + songQueue.length;
    counter.style.display = 'inline-block';
  } else {
    counter.style.display = 'none';
  }
  const panel = document.getElementById('queue-panel');
  if (panel && panel.classList.contains('open')) renderQueuePanel();
}

function closePlayer() {
  clearTimeout(meaningfulPlayTimer);
  QuaverPlayer.hide();
}

function playerPrevious() {
  if (songQueue.length > 0) playFromQueue(-1);
  else QuaverPlayer.previous();
}

function playerNext() {
  if (songQueue.length > 0) playFromQueue(1);
  else QuaverPlayer.next();
}
function playAll(songs) {
  if (!songs || songs.length === 0) return;
  songQueue = songs.filter(function(s) { return s.spotify_url; });
  queueIndex = 0;
  const first = songQueue[0];
  const trackId = first.spotify_url.split('/track/')[1];
  playInApp(trackId, first.title, first.artist, first.album_art);
  showToast('Playing all ' + songQueue.length + ' tracks', 'success');
}

function toggleQueuePanel() {
  const panel = document.getElementById('queue-panel');
  const overlay = document.getElementById('queue-overlay');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  } else {
    renderQueuePanel();
    panel.classList.add('open');
    overlay.classList.add('open');
  }
}

function renderQueuePanel() {
  const list = document.getElementById('queue-list');
  if (!list) return;
  if (songQueue.length === 0) {
    list.innerHTML = '<p class="queue-empty">No songs queued yet.<br>Use +Q on any song to add it.</p>';
    return;
  }
  list.innerHTML = songQueue.map(function(song, i) {
    const isActive = i === queueIndex;
    return '<div class="queue-item' + (isActive ? ' active' : '') + '" onclick="jumpToQueue(' + i + ')">' +
      (song.album_art ? '<img class="queue-item-art" src="' + song.album_art + '" alt=""/>' : '<div class="queue-item-art"></div>') +
      '<div class="queue-item-info">' +
        '<div class="queue-item-title">' + song.title + '</div>' +
        '<div class="queue-item-artist">' + song.artist + '</div>' +
      '</div>' +
      (isActive ? '<span class="queue-now-playing">▶</span>' : '') +
      '<button class="queue-remove-btn" onclick="event.stopPropagation();removeFromQueue(' + i + ')" title="Remove">✕</button>' +
    '</div>';
  }).join('');
  // scroll active item into view
  const activeEl = list.querySelector('.queue-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function jumpToQueue(index) {
  queueIndex = index;
  const song = songQueue[index];
  const trackId = song.spotify_url ? song.spotify_url.split('/track/')[1] : null;
  if (trackId) playInApp(trackId, song.title, song.artist, song.album_art);
}

function removeFromQueue(index) {
  songQueue.splice(index, 1);
  if (queueIndex >= songQueue.length) queueIndex = Math.max(0, songQueue.length - 1);
  if (songQueue.length === 0) {
    queueIndex = -1;
    closePlayer();
    document.getElementById('queue-panel').classList.remove('open');
    document.getElementById('queue-overlay').classList.remove('open');
  }
  updateQueueCounter();
  renderQueuePanel();
}

function shuffleQueue() {
  const remaining = songQueue.length - (queueIndex + 1);
  if (remaining < 2) { showToast('Not enough songs to shuffle', 'error'); return; }
  const played = songQueue.slice(0, queueIndex + 1);
  const rest = songQueue.slice(queueIndex + 1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
  }
  songQueue = played.concat(rest);
  updateQueueCounter();
  renderQueuePanel();
  showToast('Queue shuffled!', 'success');
}

function clearQueue() {
  songQueue = [];
  queueIndex = -1;
  updateQueueCounter();
  closePlayer();
  document.getElementById('queue-panel').classList.remove('open');
  document.getElementById('queue-overlay').classList.remove('open');
}
