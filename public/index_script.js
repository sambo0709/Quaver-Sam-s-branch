const heroTitle = document.getElementById('hero-title');
const moods = ['happy', 'sad', 'angry', 'calm', 'energetic', 'romantic', 'focused'];

let currentMood = null;
let currentLimit = 6;
let playlistSongs = [];
let savedPlaylists = [];
let currentAudio = null;
let currentPlayingBtn = null;

function onMoodSelect(value) {
  if (!value) return;
  document.getElementById('random-select').selectedIndex = 0;
  setMood(value);
}

function onRandomSelect(value) {
  if (value !== 'surprise') return;
  const randomMood = moods[Math.floor(Math.random() * moods.length)];
  document.getElementById('mood-select').value = randomMood;
  document.getElementById('random-select').selectedIndex = 0;
  setMood(randomMood);
}

function onCountSelect(value) {
  currentLimit = parseInt(value);
  if (currentMood) fetchSongs();
}

function setMood(mood) {
  currentMood = mood;
  heroTitle.textContent = mood.charAt(0).toUpperCase() + mood.slice(1) + '.';
  heroTitle.classList.add('has-mood');
  fetchSongs();
}

async function fetchSongs() {
  stopCurrentAudio();
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('results').innerHTML = '';

  try {
    const res = await fetch(`http://localhost:3000/api/music/recommend?mood=${currentMood}&limit=${currentLimit}`);
    const data = await res.json();
    document.getElementById('loading').style.display = 'none';

    if (data.songs && data.songs.length > 0) {
      let html = `<div class="results-header">${data.songs.length} tracks — ${currentMood}</div>`;

      data.songs.forEach((song, i) => {
        const inPlaylist = playlistSongs.some(s => s.title === song.title);
        const hasPreview = !!song.preview_url;

        html += `
          <div class="song-card" style="animation-delay:${i * 0.06}s">
            <span class="song-num">${String(i + 1).padStart(2, '0')}</span>
            ${song.album_art
              ? `<img class="album-art" src="${song.album_art}" alt="album art" />`
              : `<div class="album-art"></div>`}
            <div class="song-info">
              <div class="song-title">${song.title}</div>
              <div class="song-artist">${song.artist}</div>
            </div>
            <div class="song-actions">
              ${hasPreview
                ? `<button class="play-btn" data-url="${song.preview_url}" onclick="togglePlay(this)">&#9654;</button>`
                : `<span class="no-preview">no preview</span>`}
              <span class="song-duration">${song.duration}</span>
              ${song.spotify_url
                ? `<a class="spotify-link" href="${song.spotify_url}" target="_blank">Open</a>`
                : ''}
              <button class="add-btn ${inPlaylist ? 'added' : ''}"
                onclick='addToPlaylist(${JSON.stringify(song).replace(/'/g, "&#39;")}, this)'>
                ${inPlaylist ? 'Added' : '+ Add'}
              </button>
            </div>
          </div>
        `;
      });

      html += `
        <div class="player-bar" id="player-bar" style="display:none">
          <div class="player-info">
            <span class="player-title" id="player-title">—</span>
            <span class="player-artist" id="player-artist">—</span>
          </div>
          <div class="player-controls">
            <div class="progress-wrap">
              <div class="progress-fill" id="progress-fill"></div>
            </div>
            <span class="player-time" id="player-time">0:00 / 0:30</span>
          </div>
          <button class="player-stop" onclick="stopCurrentAudio()">&#9632;</button>
        </div>
      `;

      document.getElementById('results').innerHTML = html;
    } else {
      document.getElementById('results').innerHTML =
        '<p style="text-align:center;color:#aaa;font-family:Georgia,serif;padding:40px 0;">No songs found. Try another mood!</p>';
    }
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('results').innerHTML =
      '<p style="text-align:center;color:#aaa;font-family:Georgia,serif;padding:40px 0;">Could not connect to server. Make sure it\'s running on port 3000.</p>';
  }
}

function togglePlay(btn) {
  const url = btn.dataset.url;

  if (currentPlayingBtn === btn && currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    btn.innerHTML = '&#9654;';
    btn.classList.remove('playing');
    return;
  }

  stopCurrentAudio();

  currentAudio = new Audio(url);
  currentPlayingBtn = btn;
  btn.innerHTML = '&#9646;&#9646;';
  btn.classList.add('playing');

  const card = btn.closest('.song-card');
  document.getElementById('player-title').textContent = card.querySelector('.song-title').textContent;
  document.getElementById('player-artist').textContent = card.querySelector('.song-artist').textContent;
  document.getElementById('player-bar').style.display = 'flex';

  currentAudio.play();

  currentAudio.addEventListener('timeupdate', () => {
    const pct = (currentAudio.currentTime / currentAudio.duration) * 100;
    const fill = document.getElementById('progress-fill');
    const time = document.getElementById('player-time');
    if (fill) fill.style.width = pct + '%';
    if (time) time.textContent = `${formatTime(currentAudio.currentTime)} / ${formatTime(currentAudio.duration)}`;
  });

  currentAudio.addEventListener('ended', () => {
    btn.innerHTML = '&#9654;';
    btn.classList.remove('playing');
    currentPlayingBtn = null;
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = '0%';
  });
}

function stopCurrentAudio() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (currentPlayingBtn) {
    currentPlayingBtn.innerHTML = '&#9654;';
    currentPlayingBtn.classList.remove('playing');
    currentPlayingBtn = null;
  }
  const bar = document.getElementById('player-bar');
  if (bar) bar.style.display = 'none';
}

function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${sec}`;
}

function addToPlaylist(song, btn) {
  if (playlistSongs.some(s => s.title === song.title)) return;
  playlistSongs.push(song);
  btn.textContent = 'Added';
  btn.classList.add('added');
  updatePlaylistBadge();
  renderPanelSongs();
}

function removeFromPlaylist(index) {
  const removed = playlistSongs[index];
  playlistSongs.splice(index, 1);
  updatePlaylistBadge();
  renderPanelSongs();
  document.querySelectorAll('.add-btn').forEach(btn => {
    if (btn.closest('.song-card')?.querySelector('.song-title')?.textContent === removed.title) {
      btn.textContent = '+ Add';
      btn.classList.remove('added');
    }
  });
}

function updatePlaylistBadge() {
  document.getElementById('playlist-count').textContent = playlistSongs.length;
}

function renderPanelSongs() {
  const container = document.getElementById('panel-songs');
  if (playlistSongs.length === 0) {
    container.innerHTML = '<p class="empty-msg">Add songs from your results.</p>';
    return;
  }
  container.innerHTML = playlistSongs.map((song, i) => `
    <div class="panel-song-item">
      <div>
        <div class="panel-song-title">${song.title}</div>
        <div class="panel-song-artist">${song.artist}</div>
      </div>
      <button class="remove-btn" onclick="removeFromPlaylist(${i})">✕</button>
    </div>
  `).join('');
}

async function savePlaylist() {
  const name = document.getElementById('playlist-name').value.trim();
  if (!name) { document.getElementById('playlist-name').focus(); return; }
  if (playlistSongs.length === 0) { alert('Add some songs first!'); return; }

  try {
    const res = await fetch('http://localhost:3000/api/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mood: currentMood || 'mixed', songs: playlistSongs }),
    });
    const data = await res.json();
    savedPlaylists.push(data.playlist);
    document.getElementById('playlist-name').value = '';
    renderSavedPlaylists();
  } catch (err) {
    alert('Could not save. Is the server running on port 3000?');
  }
}

function renderSavedPlaylists() {
  const container = document.getElementById('saved-playlists');
  if (savedPlaylists.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div class="saved-section-label">Saved playlists</div>
    ${savedPlaylists.map((pl, i) => `
      <div class="saved-playlist-item">
        <div>
          <div class="saved-playlist-name">${pl.name}</div>
          <div class="saved-playlist-meta">${pl.songs.length} songs · ${pl.mood}</div>
        </div>
        <button class="delete-playlist-btn" onclick="deletePlaylist(${i})">✕</button>
      </div>
    `).join('')}
  `;
}

async function deletePlaylist(index) {
  const pl = savedPlaylists[index];
  try {
    await fetch(`http://localhost:3000/api/playlist/${pl.id}`, { method: 'DELETE' });
  } catch (err) {}
  savedPlaylists.splice(index, 1);
  renderSavedPlaylists();
}

function togglePlaylistPanel() {
  document.getElementById('playlist-panel').classList.toggle('open');
  document.getElementById('playlist-overlay').classList.toggle('open');
}