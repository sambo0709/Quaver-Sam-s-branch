const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}
let toastTimer;
let meaningfulPlayTimer;
function showToast(message, type) {
  const toast = document.getElementById('toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = 'toast ' + (type || 'success') + ' show';
  toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 3200);
}

function applyTheme(theme) {
  const active = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  document.documentElement.setAttribute('data-theme', active);
  document.getElementById('logo').src = active === 'light' ? 'lightmode_logo.png' : 'nightmode_logo.png';
}

matchMedia('(prefers-color-scheme: light)').addEventListener('change', function() {
  if (!localStorage.getItem('theme')) applyTheme('system');
});

async function logout() {
  try { await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
  localStorage.removeItem('quaver_user');
  localStorage.removeItem('quaver_playlists');
  localStorage.removeItem('quaver_spotify_name');
  window.location.href = 'login.html';
}

function updateAuthUI() {
  const user = JSON.parse(localStorage.getItem('quaver_user') || 'null');
  const usernameEl = document.getElementById('nav-username');
  if (user) {
    usernameEl.textContent = user.username;
    document.getElementById('user-avatar').textContent=(user.username||'U').charAt(0).toUpperCase();
    document.getElementById('user-menu').style.display='block';
  }
}

function toggleUserMenu(event){event.stopPropagation();const menu=document.getElementById('user-menu-dropdown');const open=menu.hidden;menu.hidden=!open;document.getElementById('user-menu-button').setAttribute('aria-expanded',String(open));}
function closeUserMenu(){const menu=document.getElementById('user-menu-dropdown');if(!menu)return;menu.hidden=true;document.getElementById('user-menu-button').setAttribute('aria-expanded','false');}
document.addEventListener('click',closeUserMenu);
document.addEventListener('keydown',function(event){if(event.key==='Escape')closeUserMenu();});
  window.addEventListener('DOMContentLoaded', function() {
  if (!localStorage.getItem('quaver_user')) {
    window.location.href = 'login.html';
    return;
  }
  const theme = localStorage.getItem('theme') || 'system';
  const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
  applyTheme(theme);
  document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);
  updateAuthUI();
  loadProfileData();
});
