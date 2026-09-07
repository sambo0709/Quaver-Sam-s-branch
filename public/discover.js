(function () {
  'use strict';
  const API = location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://localhost:3000' : '';
  let root = null;
  let listener = null;
  const cache = new Map();
  function escapeHTML(value) { const node = document.createElement('div'); node.textContent = value == null ? '' : String(value); return node.innerHTML; }
  function trackId(song) { return String(song.spotify_url || '').split('/track/')[1]?.split('?')[0] || ''; }
  function playerTrack(song) { return { trackId: trackId(song), title: song.title || '', artist: song.artist || '', albumArt: song.album_art || '' }; }
  function renderCards() {
    const library = window.QuaverMoodCollections;
    const grid = root.querySelector('#discover-mood-grid');
    grid.innerHTML = library.daily(library.all.length).map(function (item) {
      return '<button type="button" class="discover-mood-card mood-' + escapeHTML(item.mood) + '" data-collection="' + escapeHTML(item.id) + '"><span>' + escapeHTML(item.mood) + '</span><strong>' + escapeHTML(item.name) + '</strong><small>' + escapeHTML(item.description) + '</small><b>Open today\'s mix →</b></button>';
    }).join('');
  }
  function renderSongs(item, songs) {
    const detail = root.querySelector('#discover-mood-detail');
    detail.hidden = false;
    detail.innerHTML = '<header><div><span>TODAY · ' + escapeHTML(item.mood) + '</span><h2>' + escapeHTML(item.name) + '</h2><p>' + escapeHTML(item.description) + '</p></div><button class="discover-play-all" type="button" data-play-all>Play all</button></header><div class="discover-daily-tracks">' + songs.map(function (song, index) {
      const artwork = song.album_art ? '<img src="' + escapeHTML(song.album_art) + '" alt="" loading="lazy">' : '<span class="discover-track-art" aria-hidden="true">Q</span>';
      return '<article class="discover-track"><span class="discover-track-number">' + String(index + 1).padStart(2, '0') + '</span>' + artwork + '<div class="discover-track-copy"><strong>' + escapeHTML(song.title || 'Untitled') + '</strong><small>' + escapeHTML(song.artist || 'Unknown artist') + '</small></div><button class="discover-track-play" type="button" data-play="' + index + '" aria-label="Play ' + escapeHTML(song.title || 'song') + '">▶</button></article>';
    }).join('') + '</div>';
    detail._songs = songs;
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function openCollection(id) {
    const library = window.QuaverMoodCollections;
    const item = library.all.find(function (entry) { return entry.id === id; });
    if (!item) return;
    const key = library.todayKey() + ':' + id;
    const detail = root.querySelector('#discover-mood-detail');
    detail.hidden = false;
    detail._songs = [];
    detail.innerHTML = '<div class="discover-loading">Creating today\'s ' + escapeHTML(item.name) + '…</div>';
    try {
      let songs = cache.get(key);
      if (!songs) {
        const params = new URLSearchParams({ mood: item.mood, limit: '10', activity: item.activity, direction: item.direction, variety: 'balanced', daily: library.todayKey() });
        const response = await fetch(API + '/api/music/recommend?' + params, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load this daily collection.');
        songs = data.songs || []; cache.set(key, songs);
      }
      renderSongs(item, songs);
    } catch (error) { detail.innerHTML = '<div class="discover-loading">' + escapeHTML(error.message) + ' <button type="button" data-collection="' + escapeHTML(id) + '">Try again</button></div>'; }
  }
  function mount(scope) {
    root = scope || document;
    if (!root.querySelector('#discover-mood-grid') || !window.QuaverMoodCollections) return;
    renderCards();
    listener = function (event) {
      const collection = event.target.closest('[data-collection]'); if (collection) return openCollection(collection.dataset.collection);
      const detail = root.querySelector('#discover-mood-detail'); const songs = detail && detail._songs || [];
      const play = event.target.closest('[data-play]');
      if (play && window.QuaverPlayer) return window.QuaverPlayer.play(playerTrack(songs[Number(play.dataset.play)]));
      if (event.target.closest('[data-play-all]') && songs.length && window.QuaverPlayer) {
        window.QuaverPlayer.setQueue(songs.map(playerTrack), 0);
        window.QuaverPlayer.play(playerTrack(songs[0]));
      }
    };
    root.addEventListener('click', listener);
  }
  function unmount() { if (root && listener) root.removeEventListener('click', listener); root = null; listener = null; }
  window.QuaverDiscover = { mount: mount, unmount: unmount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(document); }); else mount(document);
}());
