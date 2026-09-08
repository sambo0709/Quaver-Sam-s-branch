function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + (type || 'success') + ' show';
  setTimeout(function() { toast.className = 'toast'; }, 3000);
}

function requireLogin(message) {
  if (!localStorage.getItem('quaver_user')) {
    showToast(message || 'You need an account to do that!', 'error');
    setTimeout(function() { window.location.href = 'login.html'; }, 1200);
    return false;
  }
  return true;
}

async function logout() {
  try {
    await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (_) {}
  localStorage.removeItem('quaver_user');
  localStorage.removeItem('quaver_spotify_name');
  localStorage.removeItem('quaver_playlists');
  window.location.href = 'login.html';
}

function updateAuthUI() {
  const user = JSON.parse(localStorage.getItem('quaver_user') || 'null');
  const userMenu = document.getElementById('user-menu');
  const loginLink = document.getElementById('nav-login-link');
  const username = document.getElementById('nav-username');

  if (user) {
    username.textContent = user.username;
    const avatarButton = document.getElementById('user-menu-button');
    document.getElementById('user-avatar').textContent = (user.username || 'U').charAt(0).toUpperCase();
    avatarButton.style.backgroundImage = user.profileImage ? 'url("' + user.profileImage + '")' : '';
    avatarButton.classList.toggle('has-photo', !!user.profileImage);
    userMenu.style.display = 'block';
    loginLink.style.display = 'none';
  } else {
    username.textContent = '';
    userMenu.style.display = 'none';
    loginLink.style.display = 'inline-block';
  }
  if (window.QuaverShell) QuaverShell.setUser(user);
}

function toggleUserMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('user-menu-dropdown');
  const open = menu.hidden;
  menu.hidden = !open;
  document.getElementById('user-menu-button').setAttribute('aria-expanded', String(open));
}

function closeUserMenu() {
  const menu = document.getElementById('user-menu-dropdown');
  if (!menu) return;
  menu.hidden = true;
  document.getElementById('user-menu-button').setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', closeUserMenu);
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') closeUserMenu();
});

function applyTheme(theme) {
  const activeTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  document.documentElement.setAttribute('data-theme', activeTheme);
  document.getElementById('logo').src = activeTheme === 'dark' ? 'quaver-logo-cyan.svg' : 'quaver-logo-orange.svg';
  const splashLogo = document.getElementById('splash-logo');
  if (splashLogo) {
    splashLogo.src = activeTheme === 'dark' ? 'quaver-logo-cyan.svg' : 'quaver-logo-orange.svg';
  }
  const onboardingLogo = document.querySelector('.onboarding-brand-mark');
  if (onboardingLogo) onboardingLogo.src = activeTheme === 'dark' ? 'quaver-logo-cyan.svg' : 'quaver-logo-orange.svg';
  if (window.QuaverShell) QuaverShell.setTheme(theme);
}

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function() {
  if (localStorage.getItem('theme') === 'system') applyTheme('system');
});

function checkSpotifyCallback() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('spotify_connected');
  const error = params.get('error');

  if (connected) {
    window.history.replaceState({}, '', window.location.pathname);
    restoreSpotifySession().then(function() {
      updateSpotifyUI();
      showToast('Spotify connected successfully.', 'success');
    }).catch(function() {
      showToast('Spotify connected, but the session could not be started.', 'error');
    });
  }

  if (error) {
    showToast('Spotify connection failed. Try again.', 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

async function connectSpotifyAccount() {
  if (!requireLogin('Log in to connect Spotify.')) return;
  try {
    const res = await fetch(API + '/spotify/connect', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not connect Spotify.');
    window.location.href = data.url;
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function restoreSpotifySession() {
  if (!localStorage.getItem('quaver_user')) return;
  try {
    const res = await fetch(API + '/spotify/session', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) return;
    spotifyToken = !!data.connected;
    localStorage.setItem('quaver_spotify_name', data.displayName || 'Spotify User');
    updateSpotifyUI();
    if (window.QuaverPlayer) window.QuaverPlayer.init();
  } catch (_) {}
}

async function disconnectSpotify() {
  if (localStorage.getItem('quaver_user')) {
    try {
      await fetch(API + '/spotify/connection', { method: 'DELETE', credentials: 'include' });
    } catch (_) {}
  }
  localStorage.removeItem('quaver_spotify_name');
  spotifyToken = null;
  updateSpotifyUI();
  showToast('Disconnected from Spotify.', 'success');
}

function updateSpotifyUI() {
  const name = localStorage.getItem('quaver_spotify_name');
  const connectContainer = document.getElementById('spotify-login-btn');
  const connectedContainer = document.getElementById('spotify-user-info');
  if (!connectContainer || !connectedContainer) return;
  if (spotifyToken && name) {
    connectContainer.style.display = 'none';
    connectedContainer.style.display = 'flex';
    document.getElementById('spotify-user-name').textContent = '✓ ' + name;
  } else {
    connectContainer.style.display = 'flex';
    connectedContainer.style.display = 'none';
  }
}

let onboardingTasteEditor = null;

function advanceOnboarding() {
  const loggedIn = !!localStorage.getItem('quaver_user');
  const tasteCard = document.getElementById('onboarding-taste');
  if (!loggedIn || !tasteCard || !window.QuaverTaste) { dismissOnboarding(); return; }
  window.QuaverTaste.load().then(function(taste) {
    if (taste && taste.seedArtists && taste.seedArtists.length) { dismissOnboarding(); return; }
    document.getElementById('onboarding-welcome').hidden = true;
    tasteCard.hidden = false;
    if (!onboardingTasteEditor) {
      onboardingTasteEditor = window.QuaverTaste.tagEditor(document.getElementById('onboarding-taste-input'), {
        placeholder: 'e.g. SZA — press Enter', label: 'Artists you love', max: 10,
      });
    }
    onboardingTasteEditor.focus();
  }).catch(function() { dismissOnboarding(); });
}
window.advanceOnboarding = advanceOnboarding;

function saveOnboardingTaste() {
  const items = onboardingTasteEditor ? onboardingTasteEditor.items : [];
  const done = function() { dismissOnboarding(); };
  if (!items.length || !window.QuaverTaste) { done(); return; }
  window.QuaverTaste.save({ seedArtists: items }).then(done, done);
}
window.saveOnboardingTaste = saveOnboardingTaste;

function dismissOnboarding() {
  localStorage.setItem('quaver_onboarded', '1');
  const overlay = document.getElementById('onboarding-overlay');
  overlay.style.opacity = '0';
  setTimeout(function() { overlay.style.display = 'none'; }, 300);
}

function applyRequestedMoodFromNavigation() {
  const requestedMood = new URLSearchParams(window.location.search).get('mood');
  const select = document.getElementById('mood-select');
  if (!select || !requestedMood || !Array.from(select.options).some(function(option) { return option.value === requestedMood; })) return;
  select.value = requestedMood;
  currentMood = requestedMood;
  applyMoodColors(currentMood);
}
window.applyRequestedMoodFromNavigation = applyRequestedMoodFromNavigation;

function initializeHome() {
  const initialRoute = window.QuaverShell && window.QuaverShell.state.initialRoute;
  const deferHomeIntro = initialRoute && initialRoute !== 'home';
  applyTheme(localStorage.getItem('theme') || 'dark');
  const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
  document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);

  if (preferences.defaultMood) {
    document.getElementById('mood-select').value = preferences.defaultMood;
    currentMood = preferences.defaultMood;
    applyMoodColors(currentMood);
  }
  applyRequestedMoodFromNavigation();
  if ([10, 15, 20].includes(Number(preferences.songCount))) {
    currentLimit = Number(preferences.songCount);
    document.getElementById('count-select').value = String(currentLimit);
  }

  const splash = document.getElementById('splash-screen');
  if (deferHomeIntro || sessionStorage.getItem('quaver_launched')) {
    splash.style.display = 'none';
  } else {
    sessionStorage.setItem('quaver_launched', '1');
    setTimeout(function() {
      splash.classList.add('splash-hide');
      splash.addEventListener('transitionend', function() {
        splash.style.display = 'none';
      }, { once: true });
    }, 450);
  }

  checkSpotifyCallback();
  updateSpotifyUI();
  updateAuthUI();
  restoreSpotifySession();
  syncAccountPreferences();
  loadPlaylists();
  loadPersonalizedHome();
  renderTrendingPills();
  loadTrendingMoods();
  loadSongsOfTheDay();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  }
  if (!localStorage.getItem('quaver_onboarded')) {
    if (deferHomeIntro && window.QuaverShell) {
      const showOnHome = function(event) {
        if (event.detail.route !== 'home' || localStorage.getItem('quaver_onboarded')) return;
        document.getElementById('onboarding-overlay').style.display = 'flex';
        window.QuaverShell.events.removeEventListener('routechange', showOnHome);
      };
      window.QuaverShell.events.addEventListener('routechange', showOnHome);
    } else {
      document.getElementById('onboarding-overlay').style.display = 'flex';
    }
  }
  if (new URLSearchParams(window.location.search).get('open') === 'playlist') {
    window.location.replace('playlists.html?create=1');
  }
  if (window.location.hash === '#search-input') setTimeout(focusSearch, 100);
}

window.addEventListener('DOMContentLoaded', initializeHome);
