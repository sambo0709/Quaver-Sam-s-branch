(function () {
  'use strict';
  function applyTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    const theme = saved === 'system'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : saved;
    document.documentElement.setAttribute('data-theme', theme);
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.href = theme === 'light' ? 'quaver-logo-orange.svg' : 'quaver-logo-cyan.svg';
    let themeColor = document.querySelector('meta[name="theme-color"]');
    if (!themeColor) {
      themeColor = document.createElement('meta');
      themeColor.name = 'theme-color';
      document.head.appendChild(themeColor);
    }
    themeColor.content = theme === 'light' ? '#f97316' : '#22d3ee';
  }
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
    if (localStorage.getItem('theme') === 'system') applyTheme();
  });

  fetch('/api/auth/me', { credentials: 'include' }).then(function (response) {
    return response.ok ? response.json() : null;
  }).then(function (user) {
    if (!user) return;
    const login = document.getElementById('legal-login-link');
    const account = document.getElementById('legal-account-link');
    const avatar = document.getElementById('legal-user-avatar');
    if (login) login.hidden = true;
    if (account) account.hidden = false;
    if (avatar) avatar.textContent = String(user.username || 'U').charAt(0).toUpperCase();
  }).catch(function () {});
}());
