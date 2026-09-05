(function () {
  'use strict';

  const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
  let toastTimer;
  let mountedRoot = null;
  let listeners = null;
  let identityObserver = null;
  let previousGlobals = null;

  function showToast(message, type) {
    if (window.QuaverShell && window.QuaverShell.state.mounted) return window.QuaverShell.showToast(message, type);
    const toast = document.getElementById('toast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = 'toast ' + (type || 'success') + ' show';
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3200);
  }
  function authHeaders(json) { return json ? { 'Content-Type': 'application/json' } : {}; }
  function applyTheme(theme) {
    const active = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
    document.documentElement.setAttribute('data-theme', active);
    const logo = document.getElementById('logo');
    if (logo) logo.src = active === 'light' ? 'quaver-logo-orange.svg' : 'quaver-logo-cyan.svg';
    if (window.QuaverShell) window.QuaverShell.setTheme(theme);
  }
  async function logout() {
    try { await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
    ['quaver_user', 'quaver_playlists', 'quaver_spotify_name'].forEach(function (key) { localStorage.removeItem(key); });
    location.href = 'login.html';
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
  function updateUserIdentity(name, profileImage) {
    document.getElementById('nav-username').textContent = name || 'Account';
    document.getElementById('user-avatar').textContent = (name || 'U').charAt(0).toUpperCase();
    const button = document.getElementById('user-menu-button');
    button.style.backgroundImage = profileImage ? 'url("' + profileImage + '")' : '';
    button.classList.toggle('has-photo', !!profileImage);
  }
  async function saveSettings(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    button.textContent = 'Saving...';
    const preferences = {
      defaultMood: document.getElementById('settings-mood').value,
      songCount: Number(document.getElementById('settings-count').value),
      reducedMotion: document.getElementById('settings-motion').checked,
      explicitContent: document.getElementById('settings-explicit').checked,
      recommendationVariety: document.getElementById('settings-variety').value,
    };
    const defaultTheme = document.getElementById('settings-theme').value;
    try {
      const res = await fetch(API + '/api/auth/settings', { method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ displayName: document.getElementById('settings-name').value.trim(), defaultTheme: defaultTheme, ...preferences }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save settings.');
      const user = JSON.parse(localStorage.getItem('quaver_user') || '{}');
      user.username = data.username;
      localStorage.setItem('quaver_user', JSON.stringify(user));
      localStorage.setItem('quaver_preferences', JSON.stringify(data.preferences));
      localStorage.setItem('theme', defaultTheme);
      applyTheme(defaultTheme);
      document.documentElement.classList.toggle('reduce-motion', preferences.reducedMotion);
      updateUserIdentity(data.username, user.profileImage);
      if (window.QuaverShell) window.QuaverShell.setUser(user);
      showToast('Settings saved successfully.', 'success');
    } catch (error) { showToast(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Save preferences'; }
  }
  async function changePassword(event) {
    event.preventDefault();
    try {
      const res = await fetch(API + '/api/auth/password', { method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ currentPassword: document.getElementById('current-password').value, newPassword: document.getElementById('new-password').value }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      event.currentTarget.reset();
      showToast('Password changed successfully.', 'success');
    } catch (error) { showToast(error.message || 'Could not change password.', 'error'); }
  }
  async function clearData(path, label) {
    if (!confirm('Clear your ' + label + '?')) return;
    try {
      const res = await fetch(API + path, { method: 'DELETE', headers: authHeaders(false) });
      if (!res.ok) throw new Error();
      showToast('Your ' + label + ' was cleared.', 'success');
    } catch (_) { showToast('Could not clear ' + label + '.', 'error'); }
  }
  async function connectSpotify() {
    try {
      const res = await fetch(API + '/spotify/connect', { method: 'POST', headers: authHeaders(false) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      location.href = data.url;
    } catch (error) { showToast(error.message || 'Could not connect Spotify.', 'error'); }
  }
  async function disconnectSpotify() {
    try {
      const res = await fetch(API + '/spotify/connection', { method: 'DELETE', credentials: 'include', headers: authHeaders(false) });
      if (!res.ok) throw new Error();
      localStorage.removeItem('quaver_spotify_name');
      const status = document.getElementById('settings-spotify-status');
      status.textContent = 'Not connected';
      status.classList.remove('connected');
      showToast('Spotify disconnected.', 'success');
    } catch (_) { showToast('Could not disconnect Spotify.', 'error'); }
  }
  async function checkSpotifyConnection() {
    const status = document.getElementById('settings-spotify-status');
    status.textContent = 'Checking...';
    try {
      const res = await fetch(API + '/spotify/status', { headers: authHeaders(false) });
      const data = await res.json();
      if (!res.ok) throw new Error();
      if (!data.connected) { status.textContent = 'Not connected'; status.classList.remove('connected'); return; }
      status.textContent = data.playbackReady === false ? 'Reconnect to enable player' : (data.displayName ? 'Connected as ' + data.displayName : 'Connected');
      status.classList.toggle('connected', data.playbackReady !== false);
      const sessionRes = await fetch(API + '/spotify/session', { method: 'POST', headers: authHeaders(false) });
      const session = await sessionRes.json();
      if (sessionRes.ok && session.connected) localStorage.setItem('quaver_spotify_name', session.displayName || data.displayName);
    } catch (_) { status.textContent = 'Reconnect required'; status.classList.remove('connected'); }
  }
  async function loadAccountSettings() {
    const deviceTheme = localStorage.getItem('theme');
    try {
      const res = await fetch(API + '/api/auth/settings', { headers: authHeaders(false) });
      const data = await res.json();
      if (!res.ok) throw new Error();
      const preferences = data.preferences || {};
      const user = JSON.parse(localStorage.getItem('quaver_user') || '{}');
      user.username = data.username;
      user.profileImage = data.profileImage || '';
      localStorage.setItem('quaver_user', JSON.stringify(user));
      localStorage.setItem('quaver_preferences', JSON.stringify(preferences));
      const selectedTheme = deviceTheme || data.defaultTheme || 'dark';
      if (!deviceTheme) localStorage.setItem('theme', selectedTheme);
      document.getElementById('settings-name').value = data.username || '';
      updateUserIdentity(data.username, data.profileImage);
      document.getElementById('settings-theme').value = selectedTheme;
      document.getElementById('settings-mood').value = preferences.defaultMood || '';
      document.getElementById('settings-count').value = String(preferences.songCount || 5);
      document.getElementById('settings-motion').checked = !!preferences.reducedMotion;
      document.getElementById('settings-explicit').checked = preferences.explicitContent !== false;
      document.getElementById('settings-variety').value = preferences.recommendationVariety || 'balanced';
      document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);
      applyTheme(selectedTheme);
    } catch (_) { showToast('Using settings saved on this device.', 'error'); }
  }
  async function exportData() {
    try {
      const res = await fetch(API + '/api/auth/export', { headers: authHeaders(false) });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'quaver-account-data.json';
      link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
      showToast('Your data download is ready.', 'success');
    } catch (_) { showToast('Could not export your data.', 'error'); }
  }
  async function deleteAccount() {
    if (!confirm('Permanently delete your Quaver account and all data?')) return;
    const res = await fetch(API + '/api/auth/account', { method: 'DELETE', headers: authHeaders(false) });
    if (res.ok) logout(); else showToast('Could not delete your account.', 'error');
  }

  function mount(root) {
    const scope = root || document;
    if (!scope.querySelector('#settings-name')) return false;
    if (mountedRoot === scope && listeners) return true;
    unmount();
    if (!localStorage.getItem('quaver_user')) { location.href = 'login.html'; return false; }
    mountedRoot = scope;
    listeners = new AbortController();
    previousGlobals = {};
    ['logout', 'toggleUserMenu', 'saveSettings', 'changePassword', 'clearData', 'connectSpotify', 'disconnectSpotify', 'exportData', 'deleteAccount'].forEach(function (name) { previousGlobals[name] = window[name]; });
    Object.assign(window, { logout: logout, toggleUserMenu: toggleUserMenu, saveSettings: saveSettings, changePassword: changePassword, clearData: clearData, connectSpotify: connectSpotify, disconnectSpotify: disconnectSpotify, exportData: exportData, deleteAccount: deleteAccount });
    document.addEventListener('click', closeUserMenu, { signal: listeners.signal });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeUserMenu(); }, { signal: listeners.signal });
    const user = JSON.parse(localStorage.getItem('quaver_user') || '{}');
    const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
    const saved = localStorage.getItem('theme') || 'dark';
    document.getElementById('settings-name').value = user.username || '';
    updateUserIdentity(user.username, user.profileImage);
    document.getElementById('settings-theme').value = saved;
    document.getElementById('settings-mood').value = preferences.defaultMood || '';
    document.getElementById('settings-count').value = String(preferences.songCount || 5);
    document.getElementById('settings-motion').checked = !!preferences.reducedMotion;
    document.getElementById('settings-explicit').checked = preferences.explicitContent !== false;
    document.getElementById('settings-variety').value = preferences.recommendationVariety || 'balanced';
    document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);
    applyTheme(saved);
    const label = document.getElementById('nav-username');
    identityObserver = new MutationObserver(function () {
      const name = label.textContent.replace(/^Hi,\s*/, '').replace(/!$/, '');
      if (label.textContent !== name) label.textContent = name;
      document.getElementById('user-avatar').textContent = (name || 'U').charAt(0).toUpperCase();
    });
    identityObserver.observe(label, { childList: true });
    loadAccountSettings();
    checkSpotifyConnection();
    return true;
  }
  function unmount() {
    if (listeners) listeners.abort();
    if (identityObserver) identityObserver.disconnect();
    if (previousGlobals) Object.keys(previousGlobals).forEach(function (name) { window[name] = previousGlobals[name]; });
    listeners = null;
    identityObserver = null;
    previousGlobals = null;
    mountedRoot = null;
  }

  window.QuaverSettings = { mount: mount, unmount: unmount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(document); }, { once: true });
  else mount(document);
})();
