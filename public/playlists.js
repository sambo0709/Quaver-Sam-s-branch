(function () {
  'use strict';

  const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
  let playlists = [];
  let selectedPlaylistId = null;
  let playQueue = [];
  let playQueueIndex = -1;
  let modalAction = null;
  let toastTimer = null;
  let createDraft = [];
  let createSearchResults = [];
  try { createDraft = JSON.parse(localStorage.getItem('quaver_playlist_draft') || '[]'); } catch (_) { createDraft = []; }

  function byId(id) { return document.getElementById(id); }
  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }
  function authHeaders(json) {
    return json ? { 'Content-Type': 'application/json' } : {};
  }
  function applyTheme(theme) {
    const active = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
    document.documentElement.setAttribute('data-theme', active);
    byId('logo').src = active === 'light' ? 'quaver-q-light.png' : 'quaver-q-dark.png';
  }
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
    if (!localStorage.getItem('theme')) applyTheme('system');
  });
  window.showToast = function (message, type) {
    const toast = byId('toast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = 'toast ' + (type || 'success') + ' show';
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3200);
  };
  window.logout = async function () {
    try { await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
    ['quaver_user', 'quaver_playlists', 'quaver_spotify_name'].forEach(function (key) { localStorage.removeItem(key); });
    location.href = 'login.html';
  };
  window.toggleUserMenu = function (event) {
    event.stopPropagation();
    const menu = byId('user-menu-dropdown');
    const open = menu.hidden;
    menu.hidden = !open;
    byId('user-menu-button').setAttribute('aria-expanded', String(open));
  };
  function closeUserMenu() {
    const menu = byId('user-menu-dropdown');
    menu.hidden = true;
    byId('user-menu-button').setAttribute('aria-expanded', 'false');
  }

  function trackId(song) {
    if (song.trackId) return song.trackId;
    const match = String(song.spotify_url || '').match(/\/track\/([^?]+)/);
    return match ? match[1] : '';
  }
  function playlistById(id) { return playlists.find(function (playlist) { return String(playlist.id) === String(id); }); }
  function playlistSongs(playlist) { return Array.isArray(playlist && playlist.songs) ? playlist.songs : []; }
  function playlistMood(playlist) { return String(playlist.mood || 'mixed').replace(/(^|\s)\S/g, function (letter) { return letter.toUpperCase(); }); }
  function formatDate(value) {
    if (!value) return 'Recently created';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently created';
    return 'Created ' + new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }
  function coverHTML(playlist, className) {
    const artwork = playlistSongs(playlist).map(function (song) { return song.album_art; }).filter(Boolean).slice(0, 4);
    if (!artwork.length) return '<div class="' + className + ' playlist-cover-empty"><span>' + escapeHTML((playlist.name || 'Q').charAt(0).toUpperCase()) + '</span></div>';
    const modifier = artwork.length === 1 ? ' single' : '';
    return '<div class="' + className + modifier + '">' + artwork.map(function (url) { return '<img src="' + escapeHTML(url) + '" alt="" loading="lazy"/>'; }).join('') + '</div>';
  }

  function saveCreateDraft() {
    localStorage.setItem('quaver_playlist_draft', JSON.stringify(createDraft));
  }
  function renderCreateDraft() {
    const container = byId('playlist-create-draft');
    const count = byId('playlist-create-song-count');
    count.textContent = createDraft.length + (createDraft.length === 1 ? ' song' : ' songs');
    if (!createDraft.length) {
      container.innerHTML = '<div class="playlist-create-empty"><p>No songs added yet.</p><span>Your search results will appear on the left.</span></div>';
      return;
    }
    container.innerHTML = createDraft.map(function (song, index) {
      return '<div class="playlist-create-song">' + (song.album_art ? '<img src="' + escapeHTML(song.album_art) + '" alt=""/>' : '<div class="playlist-create-song-art"></div>') + '<div><strong>' + escapeHTML(song.title || 'Untitled song') + '</strong><span>' + escapeHTML(song.artist || 'Unknown artist') + '</span></div><button type="button" data-action="remove-create-song" data-song-index="' + index + '" aria-label="Remove ' + escapeHTML(song.title) + '">Remove</button></div>';
    }).join('');
  }
  function renderCreateResults(message) {
    const container = byId('playlist-create-results');
    if (message) { container.innerHTML = '<p>' + escapeHTML(message) + '</p>'; return; }
    if (!createSearchResults.length) { container.innerHTML = '<p>No songs found. Try another search.</p>'; return; }
    container.innerHTML = createSearchResults.map(function (song, index) {
      const alreadyAdded = createDraft.some(function (saved) { return trackId(saved) ? trackId(saved) === trackId(song) : saved.title === song.title && saved.artist === song.artist; });
      return '<div class="playlist-create-song">' + (song.album_art ? '<img src="' + escapeHTML(song.album_art) + '" alt=""/>' : '<div class="playlist-create-song-art"></div>') + '<div><strong>' + escapeHTML(song.title || 'Untitled song') + '</strong><span>' + escapeHTML(song.artist || 'Unknown artist') + '</span></div><button type="button" data-action="add-create-song" data-result-index="' + index + '"' + (alreadyAdded ? ' disabled' : '') + '>' + (alreadyAdded ? 'Added' : 'Add') + '</button></div>';
    }).join('');
  }
  function startCreate() {
    selectedPlaylistId = null;
    renderDetail();
    const section = byId('playlist-create');
    section.hidden = false;
    byId('playlist-collection').hidden = true;
    if (!byId('playlist-create-name').value && !createDraft.length) {
      const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
      byId('playlist-create-mood').value = preferences.defaultMood || 'mixed';
    }
    renderCreateDraft();
    history.replaceState({}, '', 'playlists.html?create=1');
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { byId('playlist-create-name').focus(); }, 100);
  }
  function closeCreate() {
    byId('playlist-create').hidden = true;
    byId('playlist-collection').hidden = false;
    history.replaceState({}, '', 'playlists.html');
  }
  async function searchCreateSongs(event) {
    event.preventDefault();
    const query = byId('playlist-create-search-input').value.trim();
    if (!query) return;
    renderCreateResults('Searching...');
    try {
      const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
      const response = await fetch(API + '/api/music/search?q=' + encodeURIComponent(query) + '&explicit=' + (preferences.explicitContent !== false));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed.');
      createSearchResults = Array.isArray(data.songs) ? data.songs : [];
      renderCreateResults();
    } catch (error) {
      createSearchResults = [];
      renderCreateResults(error.message || 'Search failed. Try again.');
    }
  }
  function addCreateSong(index) {
    const song = createSearchResults[index];
    if (!song) return;
    const exists = createDraft.some(function (saved) { return trackId(saved) ? trackId(saved) === trackId(song) : saved.title === song.title && saved.artist === song.artist; });
    if (exists) return;
    createDraft.push(song);
    saveCreateDraft();
    renderCreateDraft();
    renderCreateResults();
  }
  function removeCreateSong(index) {
    createDraft.splice(index, 1);
    saveCreateDraft();
    renderCreateDraft();
    renderCreateResults();
  }
  async function saveCreatedPlaylist() {
    const name = byId('playlist-create-name').value.trim();
    const mood = byId('playlist-create-mood').value || 'mixed';
    if (!name) { byId('playlist-create-name').focus(); showToast('Give your playlist a name.', 'error'); return; }
    if (!createDraft.length) { byId('playlist-create-search-input').focus(); showToast('Add at least one song.', 'error'); return; }
    const button = byId('playlist-create-save');
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      const response = await fetch(API + '/api/playlist', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ name: name, mood: mood, songs: createDraft }) });
      const data = await response.json();
      if (!response.ok || !data.playlist) throw new Error(data.error || 'Could not save playlist.');
      playlists.push(data.playlist);
      createDraft = [];
      createSearchResults = [];
      localStorage.removeItem('quaver_playlist_draft');
      byId('playlist-create-name').value = '';
      byId('playlist-create-search-input').value = '';
      closeCreate();
      renderAll();
      openPlaylist(data.playlist.id);
      showToast('Playlist created.', 'success');
    } catch (error) {
      showToast(error.message || 'Could not save playlist.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Save playlist';
    }
  }

  function renderSummary() {
    byId('playlist-total').textContent = playlists.length;
    byId('playlist-song-total').textContent = playlists.reduce(function (sum, playlist) { return sum + playlistSongs(playlist).length; }, 0);
    byId('playlist-shared-total').textContent = playlists.filter(function (playlist) { return playlist.isPublic; }).length;
  }
  function renderMoodFilter() {
    const current = byId('playlist-mood-filter').value;
    const moods = Array.from(new Set(playlists.map(function (playlist) { return playlist.mood; }).filter(Boolean))).sort();
    byId('playlist-mood-filter').innerHTML = '<option value="">All moods</option>' + moods.map(function (mood) { return '<option value="' + escapeHTML(mood) + '">' + escapeHTML(playlistMood({ mood: mood })) + '</option>'; }).join('');
    byId('playlist-mood-filter').value = moods.includes(current) ? current : '';
  }
  function filteredPlaylists() {
    const query = byId('playlist-search').value.trim().toLowerCase();
    const mood = byId('playlist-mood-filter').value;
    return playlists.filter(function (playlist) {
      const text = [playlist.name, playlist.mood].concat(playlistSongs(playlist).map(function (song) { return song.title + ' ' + song.artist; })).join(' ').toLowerCase();
      return (!query || text.includes(query)) && (!mood || playlist.mood === mood);
    });
  }
  function renderGrid() {
    const visible = filteredPlaylists();
    byId('playlist-result-count').textContent = visible.length + (visible.length === 1 ? ' playlist' : ' playlists');
    const grid = byId('playlist-library-grid');
    if (!playlists.length) {
      grid.innerHTML = '<div class="playlist-library-empty"><div class="playlist-empty-mark" aria-hidden="true">Q</div><h3>Your playlist library is ready</h3><p>Choose a mood, add a few songs, and save your first playlist.</p><button type="button" data-action="start-create">Create your first playlist</button></div>';
      return;
    }
    if (!visible.length) {
      grid.innerHTML = '<div class="playlist-library-empty"><h3>No matching playlists</h3><p>Try another name or mood.</p><button type="button" data-action="clear-filters">Clear filters</button></div>';
      return;
    }
    grid.innerHTML = visible.map(function (playlist) {
      const songs = playlistSongs(playlist);
      const id = escapeHTML(playlist.id);
      return '<article class="playlist-library-card" data-playlist-id="' + id + '">' +
        '<button class="playlist-card-open" type="button" data-action="open" aria-label="Open ' + escapeHTML(playlist.name) + '">' + coverHTML(playlist, 'playlist-library-cover') + '</button>' +
        '<div class="playlist-library-card-copy"><button type="button" data-action="open"><strong>' + escapeHTML(playlist.name) + '</strong></button><span>' + songs.length + (songs.length === 1 ? ' song' : ' songs') + ' · ' + escapeHTML(playlistMood(playlist)) + '</span><small>' + escapeHTML(formatDate(playlist.createdAt)) + '</small></div>' +
        '<div class="playlist-library-card-actions">' + (songs.some(trackId) ? '<button type="button" class="playlist-round-play" data-action="play" aria-label="Play ' + escapeHTML(playlist.name) + '">▶</button><button type="button" class="playlist-spotify-export" data-action="export" aria-label="Export ' + escapeHTML(playlist.name) + ' to Spotify">Export to Spotify</button>' : '') + '<button type="button" data-action="share" aria-label="Share ' + escapeHTML(playlist.name) + '">Share</button><button type="button" data-action="rename" aria-label="Rename ' + escapeHTML(playlist.name) + '">Rename</button></div>' +
      '</article>';
    }).join('');
  }

  function renderDetail() {
    const section = byId('playlist-detail');
    const playlist = playlistById(selectedPlaylistId);
    if (!playlist) { section.hidden = true; section.innerHTML = ''; return; }
    const songs = playlistSongs(playlist);
    section.innerHTML = '<button class="playlist-detail-back" type="button" data-action="close-detail">← All playlists</button>' +
      '<div class="playlist-detail-hero">' + coverHTML(playlist, 'playlist-detail-cover') + '<div class="playlist-detail-copy"><span>PLAYLIST</span><h2>' + escapeHTML(playlist.name) + '</h2><p>' + songs.length + (songs.length === 1 ? ' song' : ' songs') + ' · ' + escapeHTML(playlistMood(playlist)) + ' · ' + escapeHTML(formatDate(playlist.createdAt)) + '</p><div class="playlist-detail-actions">' + (songs.some(trackId) ? '<button type="button" class="playlist-primary-action" data-action="play">Play all</button><button type="button" class="playlist-spotify-export" data-action="export">Export to Spotify</button>' : '') + '<button type="button" data-action="rename">Rename</button><button type="button" data-action="share">' + (playlist.isPublic ? 'Copy share link' : 'Share') + '</button><button type="button" class="playlist-delete-action" data-action="delete">Delete</button></div></div></div>' +
      '<div class="playlist-detail-tracks">' + (songs.length ? songs.map(function (song, index) {
        const canPlay = !!trackId(song);
        return '<div class="playlist-detail-track"><span class="playlist-track-number">' + String(index + 1).padStart(2, '0') + '</span>' + (song.album_art ? '<img src="' + escapeHTML(song.album_art) + '" alt="" loading="lazy"/>' : '<div class="playlist-track-art"></div>') + '<div><strong>' + escapeHTML(song.title || 'Untitled song') + '</strong><span>' + escapeHTML(song.artist || 'Unknown artist') + '</span></div>' + (canPlay ? '<button class="playlist-track-play" type="button" data-action="play-song" data-song-index="' + index + '" aria-label="Play ' + escapeHTML(song.title) + '">▶</button>' : '') + (song.spotify_url ? '<a href="' + escapeHTML(song.spotify_url) + '" target="_blank" rel="noopener">Spotify</a>' : '') + (canPlay ? '<button class="playlist-track-remove" type="button" data-action="remove-song" data-song-index="' + index + '" aria-label="Remove ' + escapeHTML(song.title) + '">Remove</button>' : '') + '</div>';
      }).join('') : '<p class="playlist-detail-empty">There are no songs in this playlist yet.</p>') + '</div>';
    section.hidden = false;
  }

  function renderAll() {
    renderSummary();
    renderMoodFilter();
    renderGrid();
    renderDetail();
    localStorage.setItem('quaver_playlists', JSON.stringify(playlists));
  }
  async function loadPlaylists() {
    try { playlists = JSON.parse(localStorage.getItem('quaver_playlists') || '[]'); } catch (_) { playlists = []; }
    const requested = new URLSearchParams(location.search).get('id');
    if (requested && playlistById(requested)) selectedPlaylistId = requested;
    renderAll();
    try {
      const response = await fetch(API + '/api/playlist', { headers: authHeaders(false) });
      if (response.status === 401) { logout(); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load playlists.');
      playlists = Array.isArray(data.playlists) ? data.playlists : [];
      if (requested && playlistById(requested)) selectedPlaylistId = requested;
      renderAll();
    } catch (error) {
      if (!playlists.length) showToast(error.message || 'Could not load playlists.', 'error');
      else showToast('Showing playlists saved on this device.', 'error');
    }
  }

  function openPlaylist(id) {
    selectedPlaylistId = String(id);
    renderDetail();
    history.replaceState({}, '', 'playlists.html?id=' + encodeURIComponent(selectedPlaylistId));
    byId('playlist-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeDetail() {
    selectedPlaylistId = null;
    renderDetail();
    history.replaceState({}, '', 'playlists.html');
  }
  async function removePlaylistSong(id, index, button) {
    const playlist = playlistById(id);
    const song = playlistSongs(playlist)[index];
    const spotifyTrackId = song && trackId(song);
    if (!playlist || !spotifyTrackId) return;
    if (button) button.disabled = true;
    try {
      const response = await fetch(API + '/api/playlist/' + encodeURIComponent(playlist.id) + '/songs/' + encodeURIComponent(spotifyTrackId), { method: 'DELETE', headers: authHeaders(false) });
      const data = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(data.error || 'Could not remove song.');
      playlist.songs.splice(index, 1);
      renderAll();
      showToast('Song removed from “' + playlist.name + '”.', 'success');
    } catch (error) {
      if (button && button.isConnected) button.disabled = false;
      showToast(error.message || 'Could not remove song.', 'error');
    }
  }
  function beginRename(id) {
    const playlist = playlistById(id);
    if (!playlist) return;
    byId('library-modal-title').textContent = 'Rename playlist';
    byId('library-modal-message').hidden = true;
    byId('library-modal-input').hidden = false;
    byId('library-modal-input').value = playlist.name;
    byId('library-modal-confirm').textContent = 'Save';
    byId('library-modal-confirm').classList.remove('danger');
    modalAction = async function () {
      const name = byId('library-modal-input').value.trim();
      if (!name || name === playlist.name) { closeLibraryModal(); return; }
      try {
        const response = await fetch(API + '/api/playlist/' + encodeURIComponent(playlist.id), { method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ name: name }) });
        if (!response.ok) throw new Error();
        playlist.name = name;
        closeLibraryModal();
        renderAll();
        showToast('Playlist renamed.', 'success');
      } catch (_) { showToast('Could not rename the playlist.', 'error'); }
    };
    openLibraryModal(true);
  }
  function beginDelete(id) {
    const playlist = playlistById(id);
    if (!playlist) return;
    byId('library-modal-title').textContent = 'Delete “' + playlist.name + '”?';
    byId('library-modal-message').textContent = 'This playlist and all of its saved songs will be permanently removed.';
    byId('library-modal-message').hidden = false;
    byId('library-modal-input').hidden = true;
    byId('library-modal-confirm').textContent = 'Delete';
    byId('library-modal-confirm').classList.add('danger');
    modalAction = async function () {
      try {
        const response = await fetch(API + '/api/playlist/' + encodeURIComponent(playlist.id), { method: 'DELETE', headers: authHeaders(false) });
        if (!response.ok) throw new Error();
        playlists = playlists.filter(function (item) { return item.id !== playlist.id; });
        if (selectedPlaylistId === String(playlist.id)) selectedPlaylistId = null;
        closeLibraryModal();
        renderAll();
        showToast('Playlist deleted.', 'success');
      } catch (_) { showToast('Could not delete the playlist.', 'error'); }
    };
    openLibraryModal(false);
  }
  function openLibraryModal(focusInput) {
    byId('library-modal-overlay').classList.add('open');
    byId('library-modal').classList.add('open');
    if (focusInput) setTimeout(function () { byId('library-modal-input').focus(); byId('library-modal-input').select(); }, 60);
  }
  window.closeLibraryModal = function () {
    byId('library-modal-overlay').classList.remove('open');
    byId('library-modal').classList.remove('open');
    modalAction = null;
  };
  async function sharePlaylist(id) {
    const playlist = playlistById(id);
    if (!playlist) return;
    try {
      const response = await fetch(API + '/api/playlist/' + encodeURIComponent(playlist.id) + '/share', { method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ isPublic: true }) });
      if (!response.ok) throw new Error();
      playlist.isPublic = true;
      renderAll();
      const shareUrl = location.origin + '/share.html?id=' + encodeURIComponent(playlist.id);
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Share link copied.', 'success');
      } catch (_) {
        window.prompt('Copy this playlist link:', shareUrl);
      }
    } catch (_) { showToast('Could not create a share link.', 'error'); }
  }

  async function restoreSpotifySession() {
    const response = await fetch(API + '/spotify/session', { method: 'POST', credentials: 'include', headers: authHeaders(false) });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok || !data.connected) {
      const guidance = response.status === 404
        ? 'Connect Spotify in Settings before exporting.'
        : response.status === 401
          ? 'Reconnect Spotify in Settings before exporting.'
          : (data.error || 'Spotify is unavailable right now.');
      const error = new Error(guidance);
      error.needsSpotify = true;
      throw error;
    }
    if (data.displayName) localStorage.setItem('quaver_spotify_name', data.displayName);
    return true;
  }
  async function exportPlaylist(id, button) {
    const playlist = playlistById(id);
    if (!playlist) return;
    const trackUris = playlistSongs(playlist).map(trackId).filter(Boolean).map(function (id) { return 'spotify:track:' + id; });
    if (!trackUris.length) { showToast('This playlist has no Spotify tracks to export.', 'error'); return; }
    const originalLabel = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Exporting...'; }
    try {
      await restoreSpotifySession();
      const response = await fetch(API + '/spotify/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistName: playlist.name + ' (from Quaver)', trackUris: trackUris }),
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok || !data.playlist_url) throw new Error(data.error || 'Spotify export failed.');
      showToast('Playlist exported to Spotify.', 'success');
      const opened = window.open(data.playlist_url, '_blank', 'noopener');
      if (!opened) window.location.href = data.playlist_url;
    } catch (error) {
      showToast(error.message || 'Could not export to Spotify.', 'error');
    } finally {
      if (button && button.isConnected) { button.disabled = false; button.textContent = originalLabel || 'Export to Spotify'; }
    }
  }

  async function playSong(song) {
    const id = trackId(song);
    if (!id) return false;
    return QuaverPlayer.play({ trackId: id, title: song.title || '', artist: song.artist || '', albumArt: song.album_art || '' });
  }
  async function playPlaylist(id, startIndex) {
    const playlist = playlistById(id);
    if (!playlist) return;
    playQueue = playlistSongs(playlist).filter(trackId);
    if (!playQueue.length) { showToast('This playlist has no playable Spotify tracks.', 'error'); return; }
    playQueueIndex = Math.max(0, Math.min(Number(startIndex) || 0, playQueue.length - 1));
    await playSong(playQueue[playQueueIndex]);
  }
  window.playerPrevious = function () {
    if (playQueue.length && playQueueIndex > 0) { playQueueIndex--; playSong(playQueue[playQueueIndex]); }
    else QuaverPlayer.previous();
  };
  window.playerNext = function () {
    if (playQueue.length && playQueueIndex < playQueue.length - 1) { playQueueIndex++; playSong(playQueue[playQueueIndex]); }
    else QuaverPlayer.next();
  };
  window.closePlayer = function () { playQueue = []; playQueueIndex = -1; QuaverPlayer.hide(); };

  function handleAction(event) {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    const card = actionButton.closest('[data-playlist-id]');
    const id = card ? card.dataset.playlistId : selectedPlaylistId;
    if (action === 'start-create') startCreate();
    if (action === 'close-create') closeCreate();
    if (action === 'save-create') saveCreatedPlaylist();
    if (action === 'add-create-song') addCreateSong(Number(actionButton.dataset.resultIndex));
    if (action === 'remove-create-song') removeCreateSong(Number(actionButton.dataset.songIndex));
    if (action === 'open') openPlaylist(id);
    if (action === 'close-detail') closeDetail();
    if (action === 'play') playPlaylist(id, 0);
    if (action === 'play-song') playPlaylist(id, Number(actionButton.dataset.songIndex));
    if (action === 'remove-song') removePlaylistSong(id, Number(actionButton.dataset.songIndex), actionButton);
    if (action === 'rename') beginRename(id);
    if (action === 'share') sharePlaylist(id);
    if (action === 'export') exportPlaylist(id, actionButton);
    if (action === 'delete') beginDelete(id);
    if (action === 'clear-filters') { byId('playlist-search').value = ''; byId('playlist-mood-filter').value = ''; renderGrid(); }
  }

  document.addEventListener('click', function (event) { if (!event.target.closest('#user-menu')) closeUserMenu(); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') { closeUserMenu(); closeLibraryModal(); } });
  document.addEventListener('DOMContentLoaded', function () {
    if (!localStorage.getItem('quaver_user')) { location.href = 'login.html'; return; }
    const savedTheme = localStorage.getItem('theme') || 'system';
    applyTheme(savedTheme);
    const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
    document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);
    const user = JSON.parse(localStorage.getItem('quaver_user') || '{}');
    const name = user.username || user.displayName || 'Account';
    byId('nav-username').textContent = name;
    byId('user-avatar').textContent = name.charAt(0).toUpperCase();
    byId('playlist-search').addEventListener('input', renderGrid);
    byId('playlist-mood-filter').addEventListener('change', renderGrid);
    byId('playlist-library-grid').addEventListener('click', handleAction);
    byId('playlist-detail').addEventListener('click', handleAction);
    byId('playlist-create').addEventListener('click', handleAction);
    document.querySelector('.playlist-build-button').addEventListener('click', handleAction);
    byId('playlist-create-search-form').addEventListener('submit', searchCreateSongs);
    byId('library-modal-confirm').addEventListener('click', function () { if (modalAction) modalAction(); });
    byId('library-modal-input').addEventListener('keydown', function (event) { if (event.key === 'Enter' && modalAction) modalAction(); });
    loadPlaylists();
    if (new URLSearchParams(location.search).get('create') === '1') startCreate();
  });
})();
