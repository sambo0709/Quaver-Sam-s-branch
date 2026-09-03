let currentMood = null;
let currentLimit = 5;
let meaningfulPlayTimer = null;
let playlistSongs = [];
try { playlistSongs = JSON.parse(localStorage.getItem('quaver_playlist_draft') || '[]'); } catch (_) { playlistSongs = []; }
let savedPlaylists = [];
let recentMoods = JSON.parse(localStorage.getItem('quaver_moods') || '[]');
let activePlaylistName = null;
let spotifyToken = null;
let songQueue = [];
let queueIndex = -1;
let songActionItems = [];
