(function () {
  'use strict';
  function applyTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    const theme = saved === 'system'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : saved;
    document.documentElement.setAttribute('data-theme', theme);
  }
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
    if (localStorage.getItem('theme') === 'system') applyTheme();
  });
}());
