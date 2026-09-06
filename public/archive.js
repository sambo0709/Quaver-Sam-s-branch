(function () {
  'use strict';
  const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
  let root = null;
  let listeners = null;
  let entries = [];
  let selectedDate = '';

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
    });
  }

  function trackId(song) {
    return String(song?.trackId || song?.spotify_url || '').match(/(?:track\/|^)([A-Za-z0-9]+)(?:\?|$)/)?.[1] || '';
  }

  function playerTrack(song) {
    return { trackId: trackId(song), title: song.title || '', artist: song.artist || '', albumArt: song.album_art || song.albumArt || '' };
  }

  function formatDate(value) {
    const date = new Date(value + 'T12:00:00');
    return new Intl.DateTimeFormat(undefined, { weekday:'long', month:'long', day:'numeric', year:'numeric' }).format(date);
  }

  function monthLabel(value) {
    return new Intl.DateTimeFormat(undefined, { month:'long', year:'numeric' }).format(new Date(value + '-02T12:00:00'));
  }

  function render() {
    if (!root) return;
    const month = root.querySelector('#archive-month').value;
    const visible = entries.filter(function(entry) { return entry.date.slice(0, 7) === month; });
    const byDate = new Map(visible.map(function(entry) { return [entry.date, entry]; }));
    const selected = byDate.get(selectedDate) || visible[0];
    selectedDate = selected?.date || '';
    const firstDay = new Date(month + '-01T12:00:00');
    const daysInMonth = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate();
    const cells = Array(firstDay.getDay()).fill('<span class="archive-calendar-blank" aria-hidden="true"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = month + '-' + String(day).padStart(2, '0');
      const entry = byDate.get(date);
      cells.push(entry
        ? '<button class="archive-calendar-day has-mix' + (date === selectedDate ? ' is-selected' : '') + '" type="button" data-select-date="' + date + '" aria-label="' + escapeHTML(formatDate(date)) + ', ' + escapeHTML(entry.mood) + ' mood"><b>' + day + '</b><span>' + escapeHTML(entry.mood) + '</span></button>'
        : '<span class="archive-calendar-day"><b>' + day + '</b></span>');
    }
    root.querySelector('#archive-calendar-grid').innerHTML = cells.join('');
    root.querySelector('#archive-status').textContent = visible.length ? visible.length + ' daily mix' + (visible.length === 1 ? '' : 'es') + ' saved this month' : 'No archived moods for this month yet.';
    root.querySelector('#archive-list').innerHTML = selected ? [selected].map(function(entry) {
      const entryIndex = entries.indexOf(entry);
      const songs = (entry.songs || []).slice(0, 3);
      return '<article class="archive-day" data-entry-date="' + escapeHTML(entry.date) + '"><div class="archive-day-heading"><div><span>' + escapeHTML(entry.mood) + '</span><h2>' + escapeHTML(formatDate(entry.date)) + '</h2></div><button type="button" data-play-day="' + entryIndex + '">Play daily mix</button></div><div class="archive-tracks">' + songs.map(function(song, songIndex) {
        const art = song.album_art || song.albumArt;
        return '<div class="archive-track">' + (art ? '<img src="' + escapeHTML(art) + '" alt="" loading="lazy"/>' : '<i></i>') + '<div><strong>' + escapeHTML(song.title || 'Untitled song') + '</strong><small>' + escapeHTML(song.artist || 'Unknown artist') + '</small></div><button type="button" data-play-song="' + entryIndex + ':' + songIndex + '" aria-label="Play ' + escapeHTML(song.title || 'song') + '">▶</button></div>';
      }).join('') + '</div></article>';
    }).join('') : '';
  }

  function populateMonths() {
    const select = root.querySelector('#archive-month');
    const months = Array.from(new Set(entries.map(function(entry) { return entry.date.slice(0, 7); })));
    const current = months[0] || new Date().toISOString().slice(0, 7);
    select.innerHTML = (months.length ? months : [current]).map(function(month) { return '<option value="' + month + '">' + escapeHTML(monthLabel(month)) + '</option>'; }).join('');
    select.value = current;
    selectedDate = entries.find(function(entry) { return entry.date.slice(0, 7) === current; })?.date || '';
  }

  function playDay(index) {
    const tracks = (entries[index]?.songs || []).map(playerTrack).filter(function(song) { return song.trackId; });
    if (!tracks.length || !window.QuaverPlayer) return;
    QuaverPlayer.setQueue(tracks, 0);
    QuaverPlayer.play(tracks[0]);
  }

  async function load() {
    const status = root.querySelector('#archive-status');
    status.setAttribute('aria-busy', 'true');
    status.textContent = entries.length ? 'Refreshing archive…' : 'Loading the archive…';
    try {
      await fetch(API + '/api/music/sotd').catch(function() {});
      const response = await fetch(API + '/api/music/sotd/archive?limit=366');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load the mood archive.');
      entries = data.entries || [];
      populateMonths();
      render();
    } catch (error) {
      status.innerHTML = '<span>' + escapeHTML(error.message || 'Could not load the mood archive.') + '</span><button type="button" data-retry-archive>Try again</button>';
    } finally {
      status.removeAttribute('aria-busy');
    }
  }

  function mount(nextRoot) {
    root = nextRoot || document;
    if (!root.querySelector('#archive-list')) return false;
    listeners = new AbortController();
    root.querySelector('#archive-month').addEventListener('change', function() { selectedDate = ''; render(); }, { signal:listeners.signal });
    root.querySelector('#archive-calendar-grid').addEventListener('click', function(event) {
      const day = event.target.closest('[data-select-date]');
      if (!day) return;
      selectedDate = day.dataset.selectDate;
      render();
    }, { signal:listeners.signal });
    root.querySelector('#archive-list').addEventListener('click', function(event) {
      const day = event.target.closest('[data-play-day]');
      if (day) return playDay(Number(day.dataset.playDay));
      const songButton = event.target.closest('[data-play-song]');
      if (!songButton) return;
      const parts = songButton.dataset.playSong.split(':').map(Number);
      const song = entries[parts[0]]?.songs?.[parts[1]];
      const track = playerTrack(song || {});
      if (track.trackId && window.QuaverPlayer) QuaverPlayer.play(track);
    }, { signal:listeners.signal });
    root.querySelector('#archive-status').addEventListener('click', function(event) {
      if (event.target.closest('[data-retry-archive]')) load();
    }, { signal:listeners.signal });
    load();
    return true;
  }

  function unmount() { if (listeners) listeners.abort(); listeners = null; root = null; }
  window.QuaverArchive = { mount, unmount };
})();
