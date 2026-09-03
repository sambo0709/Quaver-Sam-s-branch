(function () {
  'use strict';

  const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
  const TOKEN_EARLY_REFRESH_MS = 60000;
  const READY_TIMEOUT_MS = 12000;

  let player = null;
  let initializePromise = null;
  let sdkPromise = null;
  let deviceId = null;
  let accessToken = null;
  let accessTokenExpiresAt = 0;
  let currentTrack = null;
  let position = 0;
  let duration = 0;
  let paused = true;
  let progressTimer = null;
  let readyWaiters = [];
  let readinessError = null;
  let previousVolume = 0.7;

  function element(id) {
    return document.getElementById(id);
  }

  function makeError(message, code, status) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function formatTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return minutes + ':' + seconds;
  }

  function setStatus(message, state, actionLabel, actionHref) {
    const status = element('player-status');
    const action = element('player-status-action');
    if (status) {
      status.textContent = message || '';
      status.dataset.state = state || '';
    }
    if (action) {
      action.textContent = actionLabel || '';
      action.href = actionHref || 'settings.html#spotify-settings';
      action.hidden = !actionLabel;
    }
  }

  function notify(message, type) {
    if (typeof window.showToast === 'function') window.showToast(message, type || 'error');
  }

  function showPlayer(track) {
    const shell = element('spotify-player');
    if (!shell) return;
    shell.style.display = 'grid';
    document.body.classList.add('player-active');
    if (track) updateMetadata(track);
  }

  function updateMetadata(track) {
    currentTrack = Object.assign({}, currentTrack || {}, track || {});
    const title = element('player-song-name');
    const artist = element('player-song-artist');
    const art = element('player-art');
    const artPlaceholder = element('player-art-placeholder');
    const link = element('player-spotify-link');

    if (title) title.textContent = currentTrack.title || 'Choose a song';
    if (artist) artist.textContent = currentTrack.artist || 'Quaver';
    if (art) {
      art.src = currentTrack.albumArt || '';
      art.hidden = !currentTrack.albumArt;
    }
    if (artPlaceholder) artPlaceholder.hidden = !!currentTrack.albumArt;
    if (link) link.href = currentTrack.trackId
      ? 'https://open.spotify.com/track/' + encodeURIComponent(currentTrack.trackId)
      : 'https://open.spotify.com/';
  }

  function renderProgress(nextPosition, nextDuration) {
    position = Math.max(0, Number(nextPosition) || 0);
    duration = Math.max(0, Number(nextDuration) || 0);
    const slider = element('player-progress');
    if (slider && !slider.matches(':active')) {
      slider.max = String(Math.max(duration, 1));
      slider.value = String(Math.min(position, duration || position));
      slider.style.setProperty('--player-progress', (duration ? (position / duration) * 100 : 0) + '%');
    }
    const currentTime = element('player-current-time');
    const totalTime = element('player-duration');
    if (currentTime) currentTime.textContent = formatTime(position);
    if (totalTime) totalTime.textContent = formatTime(duration);
  }

  function renderPlaybackState() {
    const toggle = element('player-toggle');
    if (toggle) {
      toggle.classList.toggle('is-playing', !paused);
      toggle.setAttribute('aria-label', paused ? 'Play' : 'Pause');
      toggle.title = paused ? 'Play' : 'Pause';
    }
    clearInterval(progressTimer);
    if (!paused && duration > 0) {
      progressTimer = setInterval(function () {
        renderProgress(Math.min(position + 1000, duration), duration);
      }, 1000);
    }
  }

  function handleState(state) {
    if (!state) return;
    paused = !!state.paused;
    renderProgress(state.position, state.duration);

    const spotifyTrack = state.track_window && state.track_window.current_track;
    if (spotifyTrack) {
      const image = spotifyTrack.album && spotifyTrack.album.images && spotifyTrack.album.images[0];
      updateMetadata({
        trackId: spotifyTrack.id,
        title: spotifyTrack.name,
        artist: (spotifyTrack.artists || []).map(function (item) { return item.name; }).join(', '),
        albumArt: image ? image.url : '',
      });
    }

    setStatus(paused ? 'Paused' : 'Playing on Quaver', paused ? 'paused' : 'playing');
    renderPlaybackState();
  }

  function resolveReady(nextDeviceId) {
    deviceId = nextDeviceId;
    readinessError = null;
    const waiters = readyWaiters;
    readyWaiters = [];
    waiters.forEach(function (waiter) { waiter.resolve(nextDeviceId); });
  }

  function rejectReady(error) {
    const waiters = readyWaiters;
    readyWaiters = [];
    waiters.forEach(function (waiter) { waiter.reject(error); });
  }

  function describeError(error) {
    const code = error && error.code;
    if (code === 'QUAVER_LOGIN_REQUIRED') {
      return { message: 'Log in to Quaver to listen here.', action: 'Log in', href: 'login.html' };
    }
    if (code === 'SPOTIFY_NOT_CONNECTED') {
      return { message: 'Connect Spotify to listen in Quaver.', action: 'Connect', href: 'settings.html#spotify-settings' };
    }
    if (code === 'SPOTIFY_RECONNECT_REQUIRED' || code === 'authentication_error') {
      return { message: 'Reconnect Spotify once to enable the Quaver player.', action: 'Reconnect', href: 'settings.html#spotify-settings' };
    }
    if (code === 'account_error' || code === 'PREMIUM_REQUIRED' || (error && error.status === 403)) {
      return { message: 'Spotify Premium is required to play music inside Quaver.', action: 'Open Spotify', href: currentTrack && currentTrack.trackId ? 'https://open.spotify.com/track/' + currentTrack.trackId : 'https://open.spotify.com/' };
    }
    if (code === 'autoplay_failed') {
      return { message: 'Press play once more to start audio.', action: '', href: '' };
    }
    return { message: (error && error.message) || 'Playback is unavailable right now.', action: 'Try Settings', href: 'settings.html#spotify-settings' };
  }

  function handleError(error, shouldNotify) {
    const details = describeError(error);
    setStatus(details.message, 'error', details.action, details.href);
    if (shouldNotify) notify(details.message, 'error');
  }

  async function getAccessToken(forceRefresh) {
    if (!forceRefresh && accessToken && Date.now() < accessTokenExpiresAt - TOKEN_EARLY_REFRESH_MS) {
      return accessToken;
    }

    if (!localStorage.getItem('quaver_user')) throw makeError('Log in to Quaver first.', 'QUAVER_LOGIN_REQUIRED', 401);

    const response = await fetch(API + '/spotify/playback-token', {
      method: 'POST',
      credentials: 'include',
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok || !data.accessToken) {
      throw makeError(data.error || 'Spotify playback authorization failed.', data.code || 'SPOTIFY_RECONNECT_REQUIRED', response.status);
    }

    accessToken = data.accessToken;
    accessTokenExpiresAt = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
    return accessToken;
  }

  function loadSdk() {
    if (window.Spotify && window.Spotify.Player) return Promise.resolve();
    if (sdkPromise) return sdkPromise;

    sdkPromise = new Promise(function (resolve, reject) {
      const previousReady = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = function () {
        if (typeof previousReady === 'function') previousReady();
        resolve();
      };

      const existing = document.querySelector('script[data-quaver-spotify-sdk]');
      if (existing) {
        existing.addEventListener('error', function () { reject(makeError('Could not load Spotify playback.', 'SDK_LOAD_FAILED')); }, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.dataset.quaverSpotifySdk = 'true';
      script.addEventListener('error', function () {
        sdkPromise = null;
        reject(makeError('Could not load Spotify playback.', 'SDK_LOAD_FAILED'));
      }, { once: true });
      document.head.appendChild(script);
    });
    return sdkPromise;
  }

  async function initialize(silent) {
    if (player) return player;
    if (initializePromise) return initializePromise;
    readinessError = null;

    initializePromise = (async function () {
      if (!localStorage.getItem('quaver_user')) throw makeError('Log in to Quaver first.', 'QUAVER_LOGIN_REQUIRED', 401);
      setStatus('Connecting to Spotify…', 'loading');
      // Fail quickly with a useful connect/reconnect message before loading the
      // heavier SDK. The SDK will reuse this cached, short-lived token.
      await getAccessToken(false);
      await loadSdk();

      player = new window.Spotify.Player({
        name: 'Quaver Web Player',
        volume: Number(localStorage.getItem('quaver_player_volume') || 0.7),
        getOAuthToken: function (callback) {
          getAccessToken(false).then(callback).catch(function (error) {
            handleError(error, false);
            rejectReady(error);
            callback('');
          });
        },
      });

      player.addListener('ready', function (event) {
        resolveReady(event.device_id);
        setStatus('Ready to play', 'ready');
      });
      player.addListener('not_ready', function (event) {
        if (deviceId === event.device_id) deviceId = null;
        setStatus('Reconnecting to Spotify…', 'loading');
      });
      player.addListener('player_state_changed', handleState);
      player.addListener('initialization_error', function (event) {
        const error = makeError(event.message, 'initialization_error');
        readinessError = error;
        handleError(error, !silent);
        rejectReady(error);
      });
      player.addListener('authentication_error', function (event) {
        accessToken = null;
        accessTokenExpiresAt = 0;
        const error = makeError(event.message, 'authentication_error');
        readinessError = error;
        handleError(error, !silent);
        rejectReady(error);
      });
      player.addListener('account_error', function (event) {
        const error = makeError(event.message, 'account_error', 403);
        readinessError = error;
        handleError(error, !silent);
        rejectReady(error);
      });
      player.addListener('playback_error', function (event) {
        handleError(makeError(event.message, 'playback_error'), !silent);
      });
      player.addListener('autoplay_failed', function () {
        handleError(makeError('Press play once more to start audio.', 'autoplay_failed'), false);
      });

      const connected = await player.connect();
      if (!connected) throw makeError('Spotify could not connect to this browser.', 'SDK_CONNECT_FAILED');
      return player;
    })().catch(function (error) {
      initializePromise = null;
      if (player) {
        try { player.disconnect(); } catch (_) {}
        player = null;
      }
      deviceId = null;
      readinessError = error;
      handleError(error, !silent);
      throw error;
    });

    return initializePromise;
  }

  function waitUntilReady() {
    if (deviceId) return Promise.resolve(deviceId);
    if (readinessError) return Promise.reject(readinessError);
    return new Promise(function (resolve, reject) {
      const waiter = { resolve: resolve, reject: reject };
      readyWaiters.push(waiter);
      setTimeout(function () {
        const index = readyWaiters.indexOf(waiter);
        if (index >= 0) readyWaiters.splice(index, 1);
        reject(makeError('Spotify took too long to start. Try again.', 'SDK_READY_TIMEOUT'));
      }, READY_TIMEOUT_MS);
    });
  }

  async function requestPlayback(trackId, token, targetDeviceId) {
    return fetch('https://api.spotify.com/v1/me/player/play?device_id=' + encodeURIComponent(targetDeviceId), {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: ['spotify:track:' + trackId] }),
    });
  }

  async function startPlayback(trackId, targetDeviceId) {
    let token = await getAccessToken(false);
    let response = await requestPlayback(trackId, token, targetDeviceId);
    if (response.status === 401) {
      accessToken = null;
      accessTokenExpiresAt = 0;
      token = await getAccessToken(true);
      response = await requestPlayback(trackId, token, targetDeviceId);
    }
    if (!response.ok) {
      const data = await response.json().catch(function () { return {}; });
      const reason = data.error && data.error.reason;
      const message = (data.error && data.error.message) || 'Spotify could not start this song.';
      throw makeError(message, reason || (response.status === 403 ? 'PREMIUM_REQUIRED' : 'PLAYBACK_REQUEST_FAILED'), response.status);
    }
  }

  async function play(track) {
    if (!track || !track.trackId) return false;
    track = Object.assign({}, track, { trackId: String(track.trackId).split('?')[0] });
    showPlayer(track);
    setStatus('Connecting to Spotify…', 'loading');

    if (!localStorage.getItem('quaver_user')) {
      handleError(makeError('Log in to Quaver first.', 'QUAVER_LOGIN_REQUIRED', 401), true);
      return false;
    }

    try {
      if (player && typeof player.activateElement === 'function') await player.activateElement();
      await initialize(false);
      if (typeof player.activateElement === 'function') await player.activateElement();
      const targetDeviceId = await waitUntilReady();
      await startPlayback(track.trackId, targetDeviceId);
      paused = false;
      position = 0;
      setStatus('Playing on Quaver', 'playing');
      renderPlaybackState();
      return true;
    } catch (error) {
      handleError(error, true);
      return false;
    }
  }

  async function toggle() {
    if (!player || !deviceId) {
      if (currentTrack) return play(currentTrack);
      return false;
    }
    try {
      await player.activateElement();
      await player.togglePlay();
      return true;
    } catch (error) {
      handleError(error, true);
      return false;
    }
  }

  async function previous() {
    if (!player || !deviceId) return false;
    try { await player.previousTrack(); return true; }
    catch (error) { handleError(error, true); return false; }
  }

  async function next() {
    if (!player || !deviceId) return false;
    try { await player.nextTrack(); return true; }
    catch (error) { handleError(error, true); return false; }
  }

  function previewSeek(value) {
    const nextPosition = Number(value) || 0;
    const currentTime = element('player-current-time');
    const slider = element('player-progress');
    if (currentTime) currentTime.textContent = formatTime(nextPosition);
    if (slider) slider.style.setProperty('--player-progress', (duration ? (nextPosition / duration) * 100 : 0) + '%');
  }

  async function seek(value) {
    if (!player || !deviceId) return false;
    try {
      await player.seek(Number(value) || 0);
      renderProgress(Number(value) || 0, duration);
      return true;
    } catch (error) {
      handleError(error, true);
      return false;
    }
  }

  async function setVolume(value) {
    const normalized = Math.max(0, Math.min(1, Number(value) / 100));
    if (normalized > 0) previousVolume = normalized;
    localStorage.setItem('quaver_player_volume', String(normalized));
    const slider = element('player-volume');
    if (slider) slider.style.setProperty('--player-volume', (normalized * 100) + '%');
    const button = element('player-volume-button');
    if (button) button.classList.toggle('is-muted', normalized === 0);
    if (!player) return false;
    try { await player.setVolume(normalized); return true; }
    catch (error) { handleError(error, true); return false; }
  }

  function toggleMute() {
    const slider = element('player-volume');
    if (!slider) return;
    const current = Number(slider.value) / 100;
    slider.value = String(current > 0 ? 0 : Math.round((previousVolume || 0.7) * 100));
    setVolume(slider.value);
  }

  async function hide() {
    clearInterval(progressTimer);
    if (player) {
      try { await player.pause(); } catch (_) {}
    }
    const shell = element('spotify-player');
    if (shell) shell.style.display = 'none';
    document.body.classList.remove('player-active');
  }

  function autoInitialize() {
    if (!element('spotify-player')) return;
    const volume = Math.round(Number(localStorage.getItem('quaver_player_volume') || 0.7) * 100);
    const slider = element('player-volume');
    if (slider) {
      slider.value = String(volume);
      slider.style.setProperty('--player-volume', volume + '%');
    }
    if (localStorage.getItem('quaver_user') && localStorage.getItem('quaver_spotify_name')) {
      initialize(true).catch(function () {});
    }
  }

  window.QuaverPlayer = {
    init: function () { return initialize(true).catch(function () { return null; }); },
    play: play,
    toggle: toggle,
    previous: previous,
    next: next,
    previewSeek: previewSeek,
    seek: seek,
    setVolume: setVolume,
    toggleMute: toggleMute,
    hide: hide,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInitialize);
  else autoInitialize();
})();
