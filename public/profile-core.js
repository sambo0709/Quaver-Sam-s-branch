const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}
let toastTimer;
let meaningfulPlayTimer;
let currentProfileImage = '';
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
  document.getElementById('logo').src = active === 'light' ? 'quaver-q-light.png' : 'quaver-q-dark.png';
}

matchMedia('(prefers-color-scheme: light)').addEventListener('change', function() {
  if (localStorage.getItem('theme') === 'system') applyTheme('system');
});

async function logout() {
  try { await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
  localStorage.removeItem('quaver_user');
  localStorage.removeItem('quaver_playlists');
  localStorage.removeItem('quaver_spotify_name');
  window.location.href = 'login.html';
}

function updateAuthUI(user) {
  const usernameEl = document.getElementById('nav-username');
  if (user) {
    usernameEl.textContent = user.username;
    const initial=(user.username||'U').charAt(0).toUpperCase();
    const navAvatar=document.getElementById('user-avatar');
    const navButton=document.getElementById('user-menu-button');
    navAvatar.textContent=initial;
    document.getElementById('profile-display-name').textContent=user.username||'Your profile';
    document.getElementById('profile-hero-initial').textContent=initial;
    document.getElementById('profile-photo-preview-initial').textContent=initial;
    currentProfileImage=user.profileImage||'';
    renderProfilePhoto(currentProfileImage);
    navButton.style.backgroundImage=currentProfileImage?'url("'+currentProfileImage+'")':'';
    navButton.classList.toggle('has-photo',!!currentProfileImage);
    document.getElementById('user-menu').style.display='block';
  }
}

function renderProfilePhoto(source) {
  const heroImage=document.getElementById('profile-hero-image');
  const previewImage=document.getElementById('profile-photo-preview-image');
  heroImage.src=source||'';
  previewImage.src=source||'';
  heroImage.hidden=!source;
  previewImage.hidden=!source;
  document.getElementById('profile-hero-initial').hidden=!!source;
  document.getElementById('profile-photo-preview-initial').hidden=!!source;
}

function openProfileEditor() {
  document.getElementById('profile-name-input').value=document.getElementById('profile-display-name').textContent;
  renderProfilePhoto(currentProfileImage);
  document.getElementById('profile-editor-overlay').hidden=false;
  document.body.classList.add('modal-open');
  setTimeout(function(){document.getElementById('profile-name-input').focus();},0);
}

function closeProfileEditor(event) {
  if (event && event.target !== document.getElementById('profile-editor-overlay')) return;
  document.getElementById('profile-editor-overlay').hidden=true;
  document.body.classList.remove('modal-open');
  renderProfilePhoto(currentProfileImage);
}

function removeProfilePhoto() {
  renderProfilePhoto('');
}

function prepareProfilePhoto(event) {
  const file=event.target.files && event.target.files[0];
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
    showToast('Choose a JPG, PNG, or WebP image under 8 MB.','error');
    event.target.value='';
    return;
  }
  const reader=new FileReader();
  reader.onload=function() {
    const image=new Image();
    image.onload=function() {
      const size=Math.min(image.naturalWidth,image.naturalHeight);
      const sx=(image.naturalWidth-size)/2;
      const sy=(image.naturalHeight-size)/2;
      const canvas=document.createElement('canvas');
      canvas.width=320;canvas.height=320;
      canvas.getContext('2d').drawImage(image,sx,sy,size,size,0,0,320,320);
      let quality=.82;
      let result=canvas.toDataURL('image/jpeg',quality);
      while(result.length>85000 && quality>.42){quality-=.08;result=canvas.toDataURL('image/jpeg',quality);}
      if(result.length>89000){showToast('That image could not be compressed enough. Try another photo.','error');return;}
      renderProfilePhoto(result);
    };
    image.onerror=function(){showToast('That photo could not be opened.','error');};
    image.src=reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveProfile(event) {
  event.preventDefault();
  const button=document.getElementById('profile-save-button');
  const displayName=document.getElementById('profile-name-input').value.trim();
  const preview=document.getElementById('profile-photo-preview-image');
  const profileImage=preview.hidden?'':preview.src;
  button.disabled=true;button.textContent='Saving...';
  try {
    const response=await fetch(API+'/api/auth/profile',{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName,profileImage})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Could not update profile');
    localStorage.setItem('quaver_user',JSON.stringify({username:data.username,email:data.email,profileImage:data.profileImage||''}));
    updateAuthUI(data);
    closeProfileEditor();
    showToast('Profile updated.','success');
  } catch(error){showToast(error.message,'error');}
  finally{button.disabled=false;button.textContent='Save profile';}
}

function toggleUserMenu(event){event.stopPropagation();const menu=document.getElementById('user-menu-dropdown');const open=menu.hidden;menu.hidden=!open;document.getElementById('user-menu-button').setAttribute('aria-expanded',String(open));}
function closeUserMenu(){const menu=document.getElementById('user-menu-dropdown');if(!menu)return;menu.hidden=true;document.getElementById('user-menu-button').setAttribute('aria-expanded','false');}
document.addEventListener('click',closeUserMenu);
document.addEventListener('keydown',function(event){if(event.key==='Escape')closeUserMenu();});
document.addEventListener('keydown',function(event){if(event.key==='Escape'&&!document.getElementById('profile-editor-overlay').hidden)closeProfileEditor();});
window.addEventListener('DOMContentLoaded', async function() {
  const theme = localStorage.getItem('theme') || 'dark';
  const preferences = JSON.parse(localStorage.getItem('quaver_preferences') || '{}');
  applyTheme(theme);
  document.documentElement.classList.toggle('reduce-motion', !!preferences.reducedMotion);
  try {
    const response = await fetch(API + '/api/auth/me', { credentials: 'include' });
    if (!response.ok) throw new Error('No active session');
    const user = await response.json();
    localStorage.setItem('quaver_user', JSON.stringify({ username: user.username, email: user.email, profileImage: user.profileImage || '' }));
    updateAuthUI(user);
  } catch (_) {
    localStorage.removeItem('quaver_user');
    localStorage.removeItem('quaver_spotify_name');
    window.location.href = 'login.html';
    return;
  }
  loadProfileData();
});
