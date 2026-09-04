(function () {
  'use strict';
  const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
  const input = document.getElementById('search-page-input');
  const results = document.getElementById('search-page-results');
  const status = document.getElementById('search-page-status');
  let savedPlaylists = [];
  let pendingPlaylistSong = null;
  let playlistLoadPromise = Promise.resolve();

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
    });
  }

  function applyTheme(theme) {
    const active = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
    document.documentElement.setAttribute('data-theme', active);
    document.getElementById('logo').src = active === 'light' ? 'quaver-q-light.png' : 'quaver-q-dark.png';
  }

  matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
    if (localStorage.getItem('theme') === 'system') applyTheme('system');
  });

  function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + (type || 'success') + ' show';
    setTimeout(function () { toast.className = 'toast'; }, 2800);
  }

  async function addToPlaylist(index) {
    if (!localStorage.getItem('quaver_user')) {
      showToast('Log in to add songs to a playlist.', 'error');
      return;
    }
    const song = (window.searchSongs || [])[index];
    if (!song) return;
    await playlistLoadPromise;
    if (!savedPlaylists.length) return startNewPlaylist(song);
    pendingPlaylistSong = song;
    document.getElementById('playlist-picker-song').textContent = song.title + ' · ' + (song.artist || 'Unknown artist');
    document.getElementById('playlist-picker-list').innerHTML = savedPlaylists.map(function(playlist, playlistIndex) {
      const duplicate = (playlist.songs || []).some(function(saved) { return saved.spotify_url === song.spotify_url; });
      return '<button type="button" data-playlist-index="' + playlistIndex + '"' + (duplicate ? ' disabled' : '') + '><span>' + escapeHTML(playlist.name) + '</span><small>' + (duplicate ? 'Already added' : (playlist.songs || []).length + ' songs') + '</small></button>';
    }).join('');
    document.getElementById('playlist-picker').hidden = false;
    document.getElementById('playlist-picker-overlay').classList.add('open');
  }

  function closePlaylistPicker() {
    document.getElementById('playlist-picker').hidden = true;
    document.getElementById('playlist-picker-overlay').classList.remove('open');
    pendingPlaylistSong = null;
  }

  function startNewPlaylist(song) {
    localStorage.setItem('quaver_playlist_draft', JSON.stringify([song]));
    window.location.href = 'playlists.html?create=1';
  }

  async function addToExistingPlaylist(index) {
    const playlist = savedPlaylists[index];
    const song = pendingPlaylistSong;
    if (!playlist || !song) return;
    try {
      const response = await fetch(API + '/api/playlist/' + encodeURIComponent(playlist.id) + '/songs', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song: song })
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Could not add song.');
      playlist.songs = playlist.songs || [];
      playlist.songs.push(data.song || song);
      localStorage.setItem('quaver_playlists', JSON.stringify(savedPlaylists));
      closePlaylistPicker();
      showToast(song.title + ' added to “' + playlist.name + '”.', 'success');
    } catch (error) { showToast(error.message || 'Could not add song.', 'error'); }
  }

  async function loadPlaylists() {
    try { savedPlaylists = JSON.parse(localStorage.getItem('quaver_playlists') || '[]'); } catch (_) { savedPlaylists = []; }
    if (!localStorage.getItem('quaver_user')) return;
    try {
      const response = await fetch(API + '/api/playlist', { credentials: 'include' });
      const data = await response.json();
      if (response.ok && Array.isArray(data.playlists)) {
        savedPlaylists = data.playlists;
        localStorage.setItem('quaver_playlists', JSON.stringify(savedPlaylists));
      }
    } catch (_) {}
  }

  function spotifyTrackId(song) {
    const match = String(song && song.spotify_url || '').match(/\/track\/([A-Za-z0-9]+)/);
    return match ? match[1] : '';
  }

  function playSearchSong(index) {
    const song = (window.searchSongs || [])[index];
    const trackId = spotifyTrackId(song);
    if (!song || !trackId) return;
    QuaverPlayer.play({ trackId: trackId, title: song.title || '', artist: song.artist || '', albumArt: song.album_art || '' });
  }

  function renderSongs(songs, query) {
    window.searchSongs = songs;
    status.textContent = songs.length ? songs.length + ' results for “' + query + '”' : 'No results for “' + query + '”.';
    results.innerHTML = songs.map(function (song, index) {
      const art = song.album_art ? '<img src="' + escapeHTML(song.album_art) + '" alt="" loading="lazy"/>' : '<div class="search-result-art"></div>';
      const spotify = song.spotify_url ? '<a href="' + escapeHTML(song.spotify_url) + '" target="_blank" rel="noopener">Open Spotify</a>' : '';
      const play = spotifyTrackId(song) ? '<button class="search-result-play" type="button" data-play-index="' + index + '" aria-label="Play ' + escapeHTML(song.title || 'song') + '">▶ Play</button>' : '';
      return '<article class="search-result-card">' + art + '<div><strong>' + escapeHTML(song.title || 'Untitled song') + '</strong><span>' + escapeHTML(song.artist || 'Unknown artist') + '</span></div><div class="search-result-actions">' + play + spotify + '<button type="button" data-add-index="' + index + '">Add to playlist</button></div></article>';
    }).join('');
  }

  async function search(query) {
    const q = query.trim();
    if (!q) return;
    input.value = q;
    status.innerHTML = '<span class="loading-bar" aria-hidden="true"></span><span>Searching…</span>';
    results.innerHTML = '';
    try {
      const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
      const response = await fetch(API + '/api/music/search?q=' + encodeURIComponent(q) + '&explicit=' + (preferences.explicitContent !== false));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed.');
      renderSongs(data.songs || [], q);
    } catch (error) {
      status.textContent = error.message || 'Search failed. Please try again.';
    }
  }

  document.getElementById('search-page-form').addEventListener('submit', function (event) { event.preventDefault(); search(input.value); });
  results.addEventListener('click', function (event) {
    const playButton = event.target.closest('[data-play-index]');
    if (playButton) { playSearchSong(Number(playButton.dataset.playIndex)); return; }
    const addButton = event.target.closest('[data-add-index]');
    if (addButton) addToPlaylist(Number(addButton.dataset.addIndex));
  });
  document.getElementById('playlist-picker-list').addEventListener('click', function(event) {
    const button = event.target.closest('[data-playlist-index]');
    if (button) addToExistingPlaylist(Number(button.dataset.playlistIndex));
  });
  document.getElementById('playlist-picker-close').addEventListener('click', closePlaylistPicker);
  document.getElementById('playlist-picker-overlay').addEventListener('click', closePlaylistPicker);
  document.getElementById('playlist-picker-create').addEventListener('click', function() { if (pendingPlaylistSong) startNewPlaylist(pendingPlaylistSong); });

  window.playerPrevious = function () { QuaverPlayer.previous(); };
  window.playerNext = function () { QuaverPlayer.next(); };
  window.closePlayer = function () { QuaverPlayer.hide(); };

  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);
  const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
  document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);
  const query = new URLSearchParams(window.location.search).get('q') || '';
  playlistLoadPromise = loadPlaylists();
  if (query) search(query); else input.focus();
})();
