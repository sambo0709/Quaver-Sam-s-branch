(function () {
  'use strict';
  const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
  let input = null;
  let results = null;
  let status = null;
  let mountedRoot = null;
  let listeners = null;
  let savedPlaylists = [];
  let pendingPlaylistSong = null;
  let playlistLoadPromise = Promise.resolve();
  let currentQuery = '';

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
    });
  }

  function applyTheme(theme) {
    const active = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
    document.documentElement.setAttribute('data-theme', active);
    document.getElementById('logo').src = active === 'light' ? 'quaver-logo-orange.svg' : 'quaver-logo-cyan.svg';
  }

  matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
    if (localStorage.getItem('theme') === 'system') applyTheme('system');
  });

  function renderSearchAccount(user) {
    const menu=document.getElementById('user-menu');
    const login=document.getElementById('nav-login-link');
    if (!user) { menu.hidden=true; login.hidden=false; return; }
    const name=user.username||'Account';
    const button=document.getElementById('user-menu-button');
    document.getElementById('nav-username').textContent=name;
    document.getElementById('user-avatar').textContent=name.charAt(0).toUpperCase();
    button.style.backgroundImage=user.profileImage?'url("'+user.profileImage+'")':'';
    button.classList.toggle('has-photo',!!user.profileImage);
    menu.hidden=false;login.hidden=true;
  }

  async function syncSearchAccount() {
    let user=null;
    try { user=JSON.parse(localStorage.getItem('quaver_user')||'null'); } catch (_) {}
    renderSearchAccount(user);
    if (!user) return;
    try {
      const response=await fetch(API+'/api/auth/me',{credentials:'include'});
      if (!response.ok) return;
      user=await response.json();
      localStorage.setItem('quaver_user',JSON.stringify({username:user.username,email:user.email,profileImage:user.profileImage||''}));
      renderSearchAccount(user);
    } catch (_) {}
  }

  function showToast(message, type) {
    if (window.QuaverShell && window.QuaverShell.state.mounted) return window.QuaverShell.showToast(message, type);
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

  const moodSignals = {
    energetic: ['energy','energetic','hype','workout','fast','power','fire','run'],
    calm: ['calm','peace','peaceful','quiet','soft','gentle','ambient','relax','chill'],
    focused: ['focus','focused','study','work','deep','instrumental','lofi'],
    sleepy: ['sleep','sleepy','dream','night','lullaby','rest','bed'],
    romantic: ['love','lover','romance','romantic','kiss','heart','passion'],
    sad: ['sad','cry','tears','heartbreak','lonely','alone','miss','blue'],
    happy: ['happy','joy','smile','sunshine','good time','feel good'],
    angry: ['angry','rage','hate','war','metal','aggressive','mad'],
    nostalgic: ['throwback','classic','retro','memories','memory','yesterday','old school'],
    party: ['party','club','dance','anthem','celebrate','tonight'],
    anxious: ['anxious','anxiety','stress','worry','panic','nervous'],
  };

  function scoreMoods(text) {
    const normalized = String(text || '').toLowerCase();
    return Object.keys(moodSignals).map(function(mood) {
      return { mood: mood, score: moodSignals[mood].reduce(function(total, phrase) { return total + (normalized.includes(phrase) ? 1 : 0); }, 0) };
    }).filter(function(item) { return item.score > 0; }).sort(function(a, b) { return b.score - a.score; });
  }

  function renderMoodProfile(songs, query) {
    const panel = mountedRoot.querySelector('#search-mood-profile');
    const totals = {};
    songs.forEach(function(song) {
      scoreMoods([song.title, song.artist, query].join(' ')).slice(0, 2).forEach(function(item, index) {
        totals[item.mood] = (totals[item.mood] || 0) + item.score * (index ? 0.5 : 1);
      });
    });
    const ranked = Object.keys(totals).map(function(mood) { return { mood: mood, score: totals[mood] }; }).sort(function(a, b) { return b.score - a.score; }).slice(0, 3);
    if (!songs.length || !ranked.length) { panel.hidden = true; panel.innerHTML = ''; return; }
    const total = ranked.reduce(function(sum, item) { return sum + item.score; }, 0);
    const primaryArtists = songs.map(function(song) { return String(song.artist || '').split(',')[0].trim().toLowerCase(); });
    const queryKey = query.trim().toLowerCase();
    const artistMatches = primaryArtists.filter(function(artist) { return artist === queryKey; }).length;
    const subject = artistMatches >= Math.ceil(songs.length / 2) ? query : 'These results';
    panel.innerHTML = '<div><span>QUAVER MOOD PROFILE</span><h2 id="search-mood-profile-title">' + escapeHTML(subject) + ' often sounds</h2><p>Our interpretation based on the tracks in these results.</p></div><div class="search-mood-profile-breakdown">' + ranked.map(function(item) { const percent = Math.round((item.score / total) * 100); return '<span><b>' + escapeHTML(item.mood) + '</b><small>' + percent + '%</small></span>'; }).join('') + '</div><a href="Index.html?mood=' + encodeURIComponent(ranked[0].mood) + '" data-route="home">Create a ' + escapeHTML(ranked[0].mood) + ' mix</a>';
    panel.hidden = false;
  }

  function renderSongs(songs, query) {
    window.searchSongs = songs;
    status.textContent = songs.length ? songs.length + ' results for “' + query + '”' : 'No results for “' + query + '”.';
    renderMoodProfile(songs, query);
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
    currentQuery = q;
    input.value = q;
    document.getElementById('search-starters').hidden = true;
    status.innerHTML = '<span class="loading-bar" aria-hidden="true"></span><span>Searching…</span>';
    results.innerHTML = '';
    mountedRoot.querySelector('#search-mood-profile').hidden = true;
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

  window.playerPrevious = function () { QuaverPlayer.previous(); };
  window.playerNext = function () { QuaverPlayer.next(); };
  window.closePlayer = function () { QuaverPlayer.hide(); };

  function mount(root) {
    const scope = root || document;
    const nextInput = scope.querySelector('#search-page-input');
    if (!nextInput) return false;
    if (mountedRoot === scope && input === nextInput) { update(); return true; }
    unmount();
    mountedRoot = scope;
    listeners = new AbortController();
    const signal = listeners.signal;
    input = nextInput;
    results = scope.querySelector('#search-page-results');
    status = scope.querySelector('#search-page-status');
    scope.querySelector('#search-page-form').addEventListener('submit', function (event) { event.preventDefault(); search(input.value); }, { signal: signal });
    scope.querySelector('#search-starters').addEventListener('click', function(event) { const button=event.target.closest('[data-search-starter]'); if(button)search(button.dataset.searchStarter); }, { signal: signal });
    results.addEventListener('click', function (event) {
      const playButton = event.target.closest('[data-play-index]');
      if (playButton) { playSearchSong(Number(playButton.dataset.playIndex)); return; }
      const addButton = event.target.closest('[data-add-index]');
      if (addButton) addToPlaylist(Number(addButton.dataset.addIndex));
    }, { signal: signal });
    const pickerList = document.getElementById('playlist-picker-list');
    const pickerClose = document.getElementById('playlist-picker-close') || document.querySelector('#playlist-picker button[aria-label="Close"]');
    const pickerOverlay = document.getElementById('playlist-picker-overlay');
    const pickerCreate = document.getElementById('playlist-picker-create') || document.querySelector('.playlist-picker-create');
    if (pickerList) pickerList.addEventListener('click', function(event) { const button=event.target.closest('[data-playlist-index]'); if (button) addToExistingPlaylist(Number(button.dataset.playlistIndex)); }, { signal: signal });
    if (pickerClose) pickerClose.addEventListener('click', closePlaylistPicker, { signal: signal });
    if (pickerOverlay) pickerOverlay.addEventListener('click', closePlaylistPicker, { signal: signal });
    if (pickerCreate) pickerCreate.addEventListener('click', function() { if (pendingPlaylistSong) startNewPlaylist(pendingPlaylistSong); }, { signal: signal });
    const menuButton = document.getElementById('user-menu-button');
    if (menuButton && !menuButton.hasAttribute('onclick')) menuButton.addEventListener('click', function(event) { event.stopPropagation(); const dropdown=document.getElementById('user-menu-dropdown'); dropdown.hidden=!dropdown.hidden; this.setAttribute('aria-expanded',String(!dropdown.hidden)); }, { signal: signal });
    const logoutButton = document.getElementById('search-logout');
    if (logoutButton) logoutButton.addEventListener('click', async function() { try { await fetch(API+'/api/auth/logout',{method:'POST',credentials:'include'}); } catch (_) {} localStorage.removeItem('quaver_user'); location.href='login.html'; }, { signal: signal });
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
    syncSearchAccount();
    const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
    document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);
    const query = new URLSearchParams(window.location.search).get('q') || '';
    playlistLoadPromise = loadPlaylists();
    if (query) search(query); else input.focus();
    return true;
  }

  function update() {
    if (!input) return;
    const query = new URLSearchParams(window.location.search).get('q') || '';
    if (query && query !== currentQuery) search(query);
    if (!query && currentQuery) {
      currentQuery = '';
      input.value = '';
      results.innerHTML = '';
      mountedRoot.querySelector('#search-mood-profile').hidden = true;
      status.textContent = 'Start with a song, artist, or album.';
      document.getElementById('search-starters').hidden = false;
    }
  }

  function unmount() {
    if (listeners) listeners.abort();
    listeners = null;
    mountedRoot = null;
    input = null;
    results = null;
    status = null;
  }

  window.QuaverSearch = { mount: mount, unmount: unmount, update: update, search: search };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(document); }, { once: true });
  else mount(document);
})();
