const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

const UI_ICONS = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z"/><path d="m14.5 7.1 2.8 2.8"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>'
};

function uiIcon(name) {
  return UI_ICONS[name] || '';
}

function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}

async function syncAccountPreferences() {
  if (!localStorage.getItem('quaver_user')) return;
  const deviceTheme = localStorage.getItem('theme');
  try {
    const res = await fetch(API + '/api/auth/settings', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    localStorage.setItem('quaver_preferences', JSON.stringify(data.preferences || {}));
    const account = JSON.parse(localStorage.getItem('quaver_user') || '{}');
    account.username = data.username || account.username;
    account.profileImage = data.profileImage || '';
    localStorage.setItem('quaver_user', JSON.stringify(account));
    if (typeof updateAuthUI === 'function') updateAuthUI();

    if (!deviceTheme) {
      const accountTheme = data.defaultTheme || 'dark';
      localStorage.setItem('theme', accountTheme);
      const activeTheme = accountTheme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : accountTheme;
      applyTheme(activeTheme);
    }

    const preferences = data.preferences || {};
    document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);
    if (preferences.defaultMood) {
      currentMood = preferences.defaultMood;
      document.getElementById('mood-select').value = currentMood;
      applyMoodColors(currentMood);
    }
    if ([5, 8, 10].includes(Number(preferences.songCount))) {
      currentLimit = Number(preferences.songCount);
      document.getElementById('count-select').value = String(currentLimit);
    }
  } catch (_) {}
}

const moods = ['happy', 'sad', 'energetic', 'calm', 'focused', 'angry', 'romantic', 'nostalgic', 'party', 'sleepy', 'anxious'];

const moodColors = {
  happy:     { accent: '#D7A300', accent2: '#E8B923' },
  sad:       { accent: '#2878D0', accent2: '#3157A4' },
  energetic: { accent: '#E85D04', accent2: '#F48C06' },
  calm:      { accent: '#168C8C', accent2: '#2AA7A1' },
  focused:   { accent: '#4F46E5', accent2: '#7C3AED' },
  angry:     { accent: '#C1121F', accent2: '#780000' },
  romantic:  { accent: '#D63384', accent2: '#F06595' },
  nostalgic: { accent: '#9C6644', accent2: '#C08457' },
  party:     { accent: '#9D00C6', accent2: '#E0008A' },
  sleepy:    { accent: '#40577A', accent2: '#68769B' },
  anxious:   { accent: '#3A8D44', accent2: '#78A641' },
};

function applyMoodColors(mood) {
  const colors = moodColors[mood];
  if (!colors) return;
  const root = document.documentElement;
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--accent2', colors.accent2);
  root.style.setProperty('--gradient', 'linear-gradient(135deg, ' + colors.accent + ', ' + colors.accent2 + ')');
  root.style.setProperty('--accent-glow', colors.accent + '40');
  root.style.setProperty('--accent2-glow', colors.accent2 + '40');
}
