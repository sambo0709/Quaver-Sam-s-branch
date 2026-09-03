async function loadPlaylists() {
  if (localStorage.getItem('quaver_user')) {
    try {
      const res = await fetch(API + '/api/playlist', { credentials: 'include' });
      const data = await res.json();
      if (data.playlists) {
        savedPlaylists = data.playlists;
        localStorage.setItem('quaver_playlists', JSON.stringify(savedPlaylists));
      }
    } catch (e) {}
  }
  renderSavedPlaylists();
  updatePlaylistBadge();
}
let pendingPlaylistSong = null;

function addToPlaylist(song, btn) {
  if (!requireLogin('You need an account to save songs!')) return;
  if (!savedPlaylists.length) return stageNewPlaylistSong(song);
  pendingPlaylistSong = song;
  const list = document.getElementById('playlist-picker-list');
  document.getElementById('playlist-picker-song').textContent = song.title + ' · ' + (song.artist || 'Unknown artist');
  list.innerHTML = savedPlaylists.map(function(playlist, index) {
    const duplicate = (playlist.songs || []).some(function(saved) { return spotifyTrackId(saved.spotify_url) === spotifyTrackId(song.spotify_url); });
    return '<button type="button" onclick="addPendingSongToPlaylist(' + index + ')"' + (duplicate ? ' disabled' : '') + '><span>' + escapeHTML(playlist.name) + '</span><small>' + (duplicate ? 'Already added' : (playlist.songs || []).length + ' songs') + '</small></button>';
  }).join('');
  document.getElementById('playlist-picker').hidden = false;
  document.getElementById('playlist-picker-overlay').classList.add('open');
}

function closePlaylistPicker() {
  document.getElementById('playlist-picker').hidden = true;
  document.getElementById('playlist-picker-overlay').classList.remove('open');
  pendingPlaylistSong = null;
}

function stageNewPlaylistSong(song) {
  playlistSongs = [song];
  localStorage.setItem('quaver_playlist_draft', JSON.stringify(playlistSongs));
  window.location.href = 'playlists.html?create=1';
}

function addPendingSongToNewPlaylist() {
  if (pendingPlaylistSong) stageNewPlaylistSong(pendingPlaylistSong);
}

async function addPendingSongToPlaylist(index) {
  const song = pendingPlaylistSong;
  const playlist = savedPlaylists[index];
  if (!song || !playlist) return;
  try {
    const response = await fetch(API + '/api/playlist/' + encodeURIComponent(playlist.id) + '/songs', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song: song })
    });
    const data = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(data.error || 'Could not add song.');
    playlist.songs = playlist.songs || [];
    playlist.songs.push(data.song || song);
    localStorage.setItem('quaver_playlists', JSON.stringify(savedPlaylists));
    trackRecommendationEvent('save', spotifyTrackId(song.spotify_url));
    closePlaylistPicker();
    showToast(song.title + ' added to “' + playlist.name + '”.', 'success');
  } catch (error) { showToast(error.message || 'Could not add song.', 'error'); }
}

function removeFromPlaylist(index) {
  const removed = playlistSongs[index];
  playlistSongs.splice(index, 1);
  updatePlaylistBadge();
  renderPanelSongs();
  document.querySelectorAll('.add-btn').forEach(function(btn) {
    const titleEl = btn.closest('.song-card') && btn.closest('.song-card').querySelector('.song-title');
    if (titleEl && titleEl.textContent === removed.title) {
      btn.textContent = '+ Add';
      btn.classList.remove('added');
    }
  });
}

function updatePlaylistBadge() {
  const savedCount = document.getElementById('playlist-count');
  if (savedCount) savedCount.textContent = savedPlaylists.length;
}

function renderPanelSongs() {
  const container = document.getElementById('panel-songs');
  let header = '';
  if (activePlaylistName) {
    header = '<div class="active-playlist-header"><button class="back-btn" onclick="clearActivePlaylist()">← Back</button><span class="active-playlist-name">' + activePlaylistName + '</span></div>';
  }
  if (playlistSongs.length === 0) {
    container.innerHTML = header + '<p class="empty-msg">Add songs from your results.</p>';
    return;
  }
  container.innerHTML = header + playlistSongs.map(function(song, i) {
    const trackId = song.spotify_url ? song.spotify_url.split('/track/')[1] : null;
    return '<div class="panel-song-item"><div class="panel-song-info"><div class="panel-song-title">' + song.title + '</div><div class="panel-song-artist">' + song.artist + '</div></div><div class="panel-song-actions">' +
      (trackId ? '<button class="panel-play-btn" onclick="playInApp(\'' + trackId + '\', \'' + song.title.replace(/'/g, "\\'") + '\')">&#9654;</button>' : '') +
      '<button class="remove-btn" onclick="removeFromPlaylist(' + i + ')">✕</button></div></div>';
  }).join('');
}

function openSavedPlaylist(index) {
  const pl = savedPlaylists[index];
  activePlaylistName = pl.name;
  playlistSongs = pl.songs.slice();
  updatePlaylistBadge();
  renderPanelSongs();
}

function clearActivePlaylist() {
  activePlaylistName = null;
  playlistSongs = [];
  updatePlaylistBadge();
  renderPanelSongs();
}

function togglePlaylistPanel() {
  if (!requireLogin('You need an account to use playlists!')) return;
  document.getElementById('playlist-panel').classList.toggle('open');
  document.getElementById('playlist-overlay').classList.toggle('open');
}

async function savePlaylist() {
  if (!requireLogin('You need an account to save playlists!')) return;
  const name = document.getElementById('playlist-name').value.trim();
  if (!name) { document.getElementById('playlist-name').focus(); return; }
  if (playlistSongs.length === 0) { showToast('Add some songs first!', 'error'); return; }
  try {
    const res = await fetch(API + '/api/playlist', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, mood: currentMood || 'mixed', songs: playlistSongs }),
    });
    const data = await res.json();
    savedPlaylists.push(data.playlist);
    localStorage.setItem('quaver_playlists', JSON.stringify(savedPlaylists));
    document.getElementById('playlist-name').value = '';
    activePlaylistName = null;
    playlistSongs = [];
    updatePlaylistBadge();
    renderPanelSongs();
    renderSavedPlaylists();
    showToast('Playlist "' + name + '" saved!', 'success');
  } catch (err) {
    showToast('Could not save. Is the server running?', 'error');
  }
}
async function refreshSpotifyToken() {
  try {
    const res = await fetch(API + '/spotify/session', {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();
    if (res.ok && data.connected) {
      spotifyToken = true;
      return true;
    }
  } catch(e) {}
  return false;
}

let _confirmCallback = null;

function showConfirm(title, message, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  _confirmCallback = onConfirm;
  document.getElementById('confirm-overlay').classList.add('open');
  document.getElementById('confirm-modal').classList.add('open');
}

function closeConfirmModal() {
  document.getElementById('confirm-overlay').classList.remove('open');
  document.getElementById('confirm-modal').classList.remove('open');
  _confirmCallback = null;
}

function confirmAction() {
  if (_confirmCallback) _confirmCallback();
  closeConfirmModal();
}

let renamingIndex = -1;

function renamePlaylist(index) {
  renamingIndex = index;
  const pl = savedPlaylists[index];
  const input = document.getElementById('rename-modal-input');
  input.value = pl.name;
  document.getElementById('rename-modal-overlay').classList.add('open');
  document.getElementById('rename-modal').classList.add('open');
  setTimeout(function() { input.focus(); input.select(); }, 50);
}

function closeRenameModal() {
  document.getElementById('rename-modal-overlay').classList.remove('open');
  document.getElementById('rename-modal').classList.remove('open');
  renamingIndex = -1;
}

async function confirmRename() {
  if (renamingIndex === -1) return;
  const newName = document.getElementById('rename-modal-input').value.trim();
  const idx = renamingIndex;
  const pl = savedPlaylists[idx];
  if (!newName || newName === pl.name) { closeRenameModal(); return; }
  closeRenameModal();
  try {
    await fetch(API + '/api/playlist/' + pl.id, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    savedPlaylists[idx].name = newName;
    localStorage.setItem('quaver_playlists', JSON.stringify(savedPlaylists));
    renderSavedPlaylists();
    showToast('Playlist renamed!', 'success');
  } catch (err) {
    showToast('Could not rename playlist.', 'error');
  }
}

async function sharePlaylist(index) {
  const pl = savedPlaylists[index];
  try {
    await fetch(API + '/api/playlist/' + pl.id + '/share', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic: true }),
    });
    savedPlaylists[index].isPublic = true;
    localStorage.setItem('quaver_playlists', JSON.stringify(savedPlaylists));
    const shareUrl = window.location.origin + '/share.html?id=' + pl.id;
    navigator.clipboard.writeText(shareUrl).then(function() {
      showToast('Share link copied!', 'success');
    }).catch(function() {
      window.prompt('Copy this link:', shareUrl);
    });
  } catch (err) {
    showToast('Could not create share link.', 'error');
  }
}

async function exportToSpotify(index) {
  if (!spotifyToken) { showToast('Connect your Spotify account first!', 'error'); return; }
  const pl = savedPlaylists[index];
  const trackUris = pl.songs
    .filter(function(s) { return s.spotify_url; })
    .map(function(s) { return 'spotify:track:' + s.spotify_url.split('/track/')[1].split('?')[0]; });
  if (trackUris.length === 0) { showToast('No Spotify tracks found in this playlist.', 'error'); return; }
  showToast('Exporting to Spotify...', 'success');
  try {
    const res = await fetch(API + '/spotify/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ playlistName: pl.name + ' (from Quaver)', trackUris }),
    });
    const data = await res.json();
    if (res.ok) {
      fireConfetti();
      showToast('Exported to Spotify! Opening...', 'success');
      setTimeout(function() { window.open(data.playlist_url, '_blank'); }, 500);
    } else if (res.status === 401 || (data.error && data.error.includes('login'))) {
      showToast('Refreshing Spotify session...', 'success');
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        showToast('Retrying export...', 'success');
        const retry = await fetch(API + '/spotify/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ playlistName: pl.name + ' (from Quaver)', trackUris }),
        });
        const retryData = await retry.json();
        if (retry.ok) {
          fireConfetti();
          showToast('Exported to Spotify! Opening...', 'success');
          setTimeout(function() { window.open(retryData.playlist_url, '_blank'); }, 500);
        } else {
          showToast(retryData.error || 'Export failed.', 'error');
        }
      } else {
        localStorage.removeItem('quaver_spotify_name');
        spotifyToken = null;
        updateSpotifyUI();
        showToast('Spotify session expired — please reconnect Spotify.', 'error');
      }
    } else {
      console.error('Spotify export failed:', res.status, data);
      showToast(data.error || 'Export failed.', 'error');
    }
  } catch (err) {
    console.error('Spotify export error:', err);
    showToast('Could not connect to server.', 'error');
  }
}

function renderSavedPlaylists() {
  const container = document.getElementById('saved-playlists');
  if (!container) return;
  if (savedPlaylists.length === 0) { container.innerHTML = ''; return; }
  let html = '<div class="saved-section-label">Saved playlists</div>';
  savedPlaylists.forEach(function(pl, i) {
    const coverArt = pl.songs && pl.songs.find(function(s) { return s.album_art; });
    html += '<div class="saved-playlist-item">';
    html += '<div class="saved-playlist-info" onclick="openSavedPlaylist(' + i + ')">';
    html += coverArt
      ? '<img class="saved-playlist-art" src="' + coverArt.album_art + '" alt="cover"/>'
      : '<div class="saved-playlist-art saved-playlist-art-empty">' + (personalizationMoodEmoji[pl.mood] || '🎵') + '</div>';
    html += '<div><div class="saved-playlist-name">' + pl.name + '</div>';
    html += '<div class="saved-playlist-meta">' + pl.songs.length + ' songs · ' + pl.mood + '</div></div>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px;align-items:center;">';
    html += '<button class="export-spotify-btn" onclick="exportToSpotify(' + i + ')">▶ Spotify</button>';
    html += '<button class="rename-playlist-btn" onclick="renamePlaylist(' + i + ')" title="Rename" aria-label="Rename">' + uiIcon('edit') + '</button>';
    html += '<button class="share-playlist-btn" onclick="sharePlaylist(' + i + ')" title="' + (pl.isPublic ? 'Copy share link' : 'Share') + '" aria-label="Share">' + uiIcon('share') + '</button>';
    html += '<button class="delete-playlist-btn" onclick="deletePlaylist(' + i + ')" title="Delete" aria-label="Delete">' + uiIcon('trash') + '</button>';
    html += '</div></div>';
  });
  container.innerHTML = html;
}
async function deletePlaylist(index) {
  const pl = savedPlaylists[index];
  showConfirm(
    'Delete "' + pl.name + '"?',
    'This playlist and all its songs will be permanently removed.',
    async function() {
      try {
        await fetch(API + '/api/playlist/' + pl.id, {
          method: 'DELETE',
          credentials: 'include'
        });
      } catch(e) {}
      savedPlaylists.splice(index, 1);
      localStorage.setItem('quaver_playlists', JSON.stringify(savedPlaylists));
      renderSavedPlaylists();
      updatePlaylistBadge();
      showToast('Playlist deleted.', 'success');
    }
  );
}
