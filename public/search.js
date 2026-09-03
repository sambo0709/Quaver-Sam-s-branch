(function () {
  'use strict';
  const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
  const input = document.getElementById('search-page-input');
  const results = document.getElementById('search-page-results');
  const status = document.getElementById('search-page-status');

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
    });
  }

  function themeIcon(theme) {
    return theme === 'light'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2 12h2M20 12h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg>';
  }

  function applyTheme(theme) {
    const active = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
    document.documentElement.setAttribute('data-theme', active);
    document.getElementById('theme-btn').innerHTML = themeIcon(active);
    document.getElementById('logo').src = active === 'light' ? 'lightmode_logo.png' : 'nightmode_logo.png';
  }

  function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + (type || 'success') + ' show';
    setTimeout(function () { toast.className = 'toast'; }, 2800);
  }

  function addToPlaylist(index) {
    if (!localStorage.getItem('quaver_token')) {
      showToast('Log in to add songs to a playlist.', 'error');
      return;
    }
    const song = (window.searchSongs || [])[index];
    if (!song) return;
    let draft = [];
    try { draft = JSON.parse(localStorage.getItem('quaver_playlist_draft') || '[]'); } catch (_) {}
    if (!draft.some(function (item) { return item.spotify_url === song.spotify_url; })) draft.push(song);
    localStorage.setItem('quaver_playlist_draft', JSON.stringify(draft));
    window.location.href = 'playlists.html?create=1';
  }

  function renderSongs(songs, query) {
    window.searchSongs = songs;
    status.textContent = songs.length ? songs.length + ' results for “' + query + '”' : 'No results for “' + query + '”.';
    results.innerHTML = songs.map(function (song, index) {
      const art = song.album_art ? '<img src="' + escapeHTML(song.album_art) + '" alt="" loading="lazy"/>' : '<div class="search-result-art"></div>';
      const spotify = song.spotify_url ? '<a href="' + escapeHTML(song.spotify_url) + '" target="_blank" rel="noopener">Open Spotify</a>' : '';
      return '<article class="search-result-card">' + art + '<div><strong>' + escapeHTML(song.title || 'Untitled song') + '</strong><span>' + escapeHTML(song.artist || 'Unknown artist') + '</span></div><div class="search-result-actions">' + spotify + '<button type="button" data-add-index="' + index + '">Add to playlist</button></div></article>';
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

  document.getElementById('theme-btn').addEventListener('click', function () {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
  });
  document.getElementById('search-page-form').addEventListener('submit', function (event) { event.preventDefault(); search(input.value); });
  results.addEventListener('click', function (event) { const button = event.target.closest('[data-add-index]'); if (button) addToPlaylist(Number(button.dataset.addIndex)); });

  const savedTheme = localStorage.getItem('theme') || 'system';
  applyTheme(savedTheme);
  const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
  document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);
  const query = new URLSearchParams(window.location.search).get('q') || '';
  if (query) search(query); else input.focus();
})();
