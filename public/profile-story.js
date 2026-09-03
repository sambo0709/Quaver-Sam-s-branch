function openWrapped() {
  const moods = getWeeklyMoods(window._profileMoods || []);
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = (window._profilePlays || []).filter(function(item) { return item.playedAt >= since; });

  const moodCounts = {};
  moods.forEach(function(m) { moodCounts[m.mood] = (moodCounts[m.mood] || 0) + 1; });
  const topMood = Object.keys(moodCounts).sort(function(a, b) { return moodCounts[b] - moodCounts[a]; })[0];

  const artistCounts = {};
  recent.forEach(function(s) {
    if (s.artist) {
      s.artist.split(', ').forEach(function(a) { artistCounts[a] = (artistCounts[a] || 0) + 1; });
    }
  });
  const topArtist = Object.keys(artistCounts).sort(function(a, b) { return artistCounts[b] - artistCounts[a]; })[0];

  let bestStreak = moods.length ? 1 : 0, runCount = 0, runMood = null;
  moods.forEach(function(m) {
    if (m.mood === runMood) { runCount++; if (runCount > bestStreak) bestStreak = runCount; }
    else { runMood = m.mood; runCount = 1; }
  });

  document.getElementById('wrapped-year').textContent = 'This week';
  document.getElementById('wrapped-top-emoji').textContent = topMood ? (moodEmoji[topMood] || '🎵') : '🎵';
  document.getElementById('wrapped-top-mood').textContent = topMood || 'No moods yet';
  document.getElementById('wrapped-total-moods').textContent = moods.length;
  document.getElementById('wrapped-total-songs').textContent = recent.length;
  document.getElementById('wrapped-streak').textContent = bestStreak;
  document.getElementById('wrapped-top-artist').textContent = topArtist || 'No songs yet';

  document.getElementById('wrapped-modal').style.display = 'flex';
}

function closeWrapped() {
  document.getElementById('wrapped-modal').style.display = 'none';
}

async function downloadWrapped() {
  const btn = document.querySelector('.wrapped-download-btn');
  btn.textContent = 'Generating...';
  btn.disabled = true;
  try {
    const card = document.getElementById('wrapped-card');
    const canvas = await html2canvas(card, { scale: 2, useCORS: true, backgroundColor: '#0d1225', logging: false });
    const blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
    const file = new File([blob], 'quaver-sound-story.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: 'My Quaver Sound Story', text: 'Here is my week in moods and music.', files: [file] });
    } else {
      const link = document.createElement('a');
      link.download = file.name;
      link.href = URL.createObjectURL(blob);
      link.click();
      setTimeout(function() { URL.revokeObjectURL(link.href); }, 1000);
    }
  } catch(e) {
    alert('Could not generate image. Try a screenshot instead!');
  }
  btn.textContent = 'Share Story';
  btn.disabled = false;
}
