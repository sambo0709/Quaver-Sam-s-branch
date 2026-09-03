function focusSearch() {
  window.location.href = 'search.html';
}
async function searchSongs() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  document.getElementById('search-filters').classList.add('visible');
  const genre = document.getElementById('filter-genre').value;
  const year = document.getElementById('filter-year').value;
  document.getElementById('loading').style.display = 'none';
  showSkeletons(5);
  try {
    let url = API + '/api/music/search?q=' + encodeURIComponent(q);
    const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
    url += '&explicit=' + (preferences.explicitContent !== false);
    if (genre) url += '&genre=' + encodeURIComponent(genre);
    if (year) url += '&year=' + encodeURIComponent(year);
    const res = await fetch(url);
    const data = await res.json();
    if (data.songs && data.songs.length > 0) {
      window._lastResults = data.songs;
      let html = '<div class="results-header"><span>' + data.songs.length + ' results for "' + q + '"</span><button class="play-all-btn" onclick="playAll(window._lastResults)">▶ Play All</button></div>';
      data.songs.forEach(function(song, i) {
        const inPlaylist = playlistSongs.some(function(s) { return s.title === song.title; });
        const trackId = song.spotify_url ? song.spotify_url.split('/track/')[1] : null;
        html += '<div class="song-card" style="animation-delay:' + (i * 0.07) + 's">';
        html += '<span class="song-num">' + String(i + 1).padStart(2, '0') + '</span>';
        html += song.album_art ? '<img class="album-art" src="' + song.album_art + '" alt="art"/>' : '<div class="album-art"></div>';
        html += '<div class="song-info"><div class="song-title">' + escapeHTML(song.title) + '</div><div class="song-artist">' + escapeHTML(song.artist) + '</div></div>';
        html += '<div class="song-actions">';
        if (trackId) html += '<button class="play-btn" onclick="playInApp(\'' + trackId + '\', \'' + song.title.replace(/'/g, "\\'") + '\', \'' + (song.artist || '').replace(/'/g, "\\'") + '\', \'' + (song.album_art || '') + '\')">&#9654;</button>';
        html += '<span class="song-duration">' + song.duration + '</span>';
        html += songActionMenuHTML(song, false);
        html += '</div></div>';
      });
      document.getElementById('results').innerHTML = html;
    } else {
      document.getElementById('results').innerHTML = '<p class="no-results">No results for "' + q + '"</p>';
    }
  } catch(err) {
    document.getElementById('results').innerHTML = '<p class="no-results">Search failed. Try again.</p>';
  }
}
function clearSearch() {
  const input = document.getElementById('search-input');
  input.value = '';
  document.getElementById('search-clear').style.display = 'none';
  document.getElementById('search-filters').classList.remove('visible');
  document.getElementById('results').innerHTML = '';
  input.focus();
}

function fireConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const colors = ['#FF006E','#FB5607','#FFBE0B','#3A86FF','#8338EC','#06D6A0','#FF4E50'];
  const pieces = Array.from({ length: 130 }, function() {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      w: Math.random() * 10 + 6,
      h: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.18,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 3.5 + 1.5,
    };
  });
  let frame;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(function(p) {
      p.x += p.vx; p.y += p.vy; p.rot += p.rotSpeed;
      if (p.y < canvas.height + 20) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (alive) { frame = requestAnimationFrame(draw); }
    else { canvas.style.display = 'none'; }
  }
  draw();
  setTimeout(function() { cancelAnimationFrame(frame); canvas.style.display = 'none'; ctx.clearRect(0,0,canvas.width,canvas.height); }, 4000);
}
