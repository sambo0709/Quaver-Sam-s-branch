(function () {
  'use strict';

  const API = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
  const TOKEN_EARLY_REFRESH_MS = 60000;
  const READY_TIMEOUT_MS = 12000;
  const PLAYBACK_STORAGE_KEY = 'quaver_playback_session';

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
  let playbackObservation = null;
  let persistedPlayback = readPersistedPlayback();
  let lastPersistedAt = 0;

  function readPersistedPlayback() {
    try { return JSON.parse(localStorage.getItem(PLAYBACK_STORAGE_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function savePersistedPlayback(force) {
    if (!currentTrack) return;
    if (!force && Date.now() - lastPersistedAt < 900) return;
    lastPersistedAt = Date.now();
    persistedPlayback.track = currentTrack;
    persistedPlayback.position = position;
    persistedPlayback.duration = duration;
    persistedPlayback.paused = paused;
    persistedPlayback.updatedAt = Date.now();
    localStorage.setItem(PLAYBACK_STORAGE_KEY, JSON.stringify(persistedPlayback));
    renderExpandedPlayer();
  }

  function emitPlaybackOutcome(type, observation) {
    if (!observation || !observation.trackId) return;
    window.dispatchEvent(new CustomEvent('quaver:playback-outcome', { detail: {
      type: type,
      trackId: observation.trackId,
      title: observation.title || '',
      artist: observation.artist || '',
      listenedMs: Math.round(observation.maxPosition || 0),
      durationMs: Math.round(observation.duration || 0),
      completionRate: observation.duration ? Math.min(1, observation.maxPosition / observation.duration) : 0,
    } }));
  }

  function finishObservation(observation) {
    if (!observation || observation.reported || !observation.duration) return;
    const remaining = observation.duration - observation.maxPosition;
    const completionRate = observation.maxPosition / observation.duration;
    if (completionRate >= 0.9 || remaining <= 10000) emitPlaybackOutcome('complete', observation);
    else if (observation.maxPosition <= 30000 || completionRate <= 0.25) emitPlaybackOutcome('skip', observation);
    observation.reported = true;
  }

  function observePlayback(track, nextPosition, nextDuration) {
    if (!track || !track.id) return;
    if (playbackObservation && playbackObservation.trackId !== track.id) finishObservation(playbackObservation);
    if (!playbackObservation || playbackObservation.trackId !== track.id) {
      playbackObservation = {
        trackId: track.id,
        title: track.name || '',
        artist: (track.artists || []).map(function (item) { return item.name; }).join(', '),
        maxPosition: 0,
        duration: Number(nextDuration) || 0,
        reported: false,
      };
    }
    const priorPosition = playbackObservation.maxPosition;
    playbackObservation.maxPosition = Math.max(priorPosition, Number(nextPosition) || 0);
    playbackObservation.duration = Math.max(playbackObservation.duration, Number(nextDuration) || 0);
    if (priorPosition > 0 && Number(nextPosition) < 2000 && priorPosition >= playbackObservation.duration * 0.9) {
      finishObservation(playbackObservation);
    }
  }

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
      art.onerror = function () {
        art.hidden = true;
        if (artPlaceholder) artPlaceholder.hidden = false;
      };
      art.onload = function () {
        art.hidden = false;
        if (artPlaceholder) artPlaceholder.hidden = true;
      };
      art.src = currentTrack.albumArt || '';
      art.hidden = !currentTrack.albumArt;
    }
    if (artPlaceholder) artPlaceholder.hidden = !!currentTrack.albumArt;
    if (link) link.href = currentTrack.trackId
      ? 'https://open.spotify.com/track/' + encodeURIComponent(currentTrack.trackId)
      : 'https://open.spotify.com/';
    savePersistedPlayback(false);
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
    savePersistedPlayback(false);
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
      observePlayback(spotifyTrack, state.position, state.duration);
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
    savePersistedPlayback(true);
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

  async function requestPlayback(trackId, token, targetDeviceId, startPosition) {
    return fetch('https://api.spotify.com/v1/me/player/play?device_id=' + encodeURIComponent(targetDeviceId), {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: ['spotify:track:' + trackId], position_ms: Math.max(0, Number(startPosition) || 0) }),
    });
  }

  async function startPlayback(trackId, targetDeviceId, startPosition) {
    let token = await getAccessToken(false);
    let response = await requestPlayback(trackId, token, targetDeviceId, startPosition);
    if (response.status === 401) {
      accessToken = null;
      accessTokenExpiresAt = 0;
      token = await getAccessToken(true);
      response = await requestPlayback(trackId, token, targetDeviceId, startPosition);
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
    const queue = Array.isArray(persistedPlayback.queue) ? persistedPlayback.queue : [];
    const queueIndex = queue.findIndex(function(item) { return item.trackId === track.trackId; });
    if (queueIndex >= 0) persistedPlayback.index = queueIndex;
    else { persistedPlayback.queue = [track]; persistedPlayback.index = 0; }
    persistedPlayback.userStopped = false;
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
      await startPlayback(track.trackId, targetDeviceId, 0);
      paused = false;
      position = 0;
      setStatus('Playing on Quaver', 'playing');
      renderPlaybackState();
      savePersistedPlayback(true);
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
      persistedPlayback.userStopped = false;
      return true;
    } catch (error) {
      handleError(error, true);
      return false;
    }
  }

  async function previous() {
    const queue = Array.isArray(persistedPlayback.queue) ? persistedPlayback.queue : [];
    if (queue.length && Number(persistedPlayback.index) > 0) return playQueueIndex(Number(persistedPlayback.index) - 1);
    if (!player || !deviceId) return false;
    try { await player.previousTrack(); return true; }
    catch (error) { handleError(error, true); return false; }
  }

  async function next() {
    const queue = Array.isArray(persistedPlayback.queue) ? persistedPlayback.queue : [];
    if (queue.length && Number(persistedPlayback.index) < queue.length - 1) return playQueueIndex(Number(persistedPlayback.index) + 1);
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
    persistedPlayback.userStopped = true;
    persistedPlayback.paused = true;
    savePersistedPlayback(true);
    closeExpandedPlayer();
  }

  function normalizeQueueTrack(track) {
    const trackId=String(track && (track.trackId || '') || '').split('?')[0] || String(track && track.spotify_url || '').split('/track/')[1]?.split('?')[0];
    return { trackId:trackId||'', title:track && track.title || '', artist:track && track.artist || '', albumArt:track && (track.albumArt || track.album_art) || '' };
  }

  function setQueue(tracks, index) {
    persistedPlayback.queue=(tracks||[]).map(normalizeQueueTrack).filter(function(track){return track.trackId;});
    persistedPlayback.index=Math.max(0,Math.min(persistedPlayback.queue.length-1,Number(index)||0));
    localStorage.setItem(PLAYBACK_STORAGE_KEY,JSON.stringify(persistedPlayback));
    renderExpandedPlayer();
  }

  function playQueueIndex(index) {
    const queue=Array.isArray(persistedPlayback.queue)?persistedPlayback.queue:[];
    const track=queue[index];
    if(!track)return false;
    persistedPlayback.index=index;
    return play(track);
  }

  function ensureExpandedPlayer() {
    if (element('expanded-player')) return;
    const shell=document.createElement('div');
    shell.id='expanded-player';shell.className='expanded-player';shell.hidden=true;
    shell.innerHTML='<div class="expanded-player-header"><span>NOW PLAYING</span><button type="button" data-expanded-action="close" aria-label="Collapse player">⌄</button></div><div class="expanded-player-now"><div class="expanded-player-art"><img id="expanded-player-art" alt=""/></div><div><strong id="expanded-player-title">Choose a song</strong><span id="expanded-player-artist">Quaver</span></div></div><div class="expanded-player-progress"><span id="expanded-player-current">0:00</span><div><i id="expanded-player-progress-fill"></i></div><span id="expanded-player-duration">0:00</span></div><div class="expanded-player-controls"><button type="button" data-expanded-action="previous" aria-label="Previous song">◀</button><button type="button" data-expanded-action="toggle" aria-label="Play or pause">▶</button><button type="button" data-expanded-action="next" aria-label="Next song">▶</button></div><section><div class="expanded-queue-heading"><h2>Up next</h2><span id="expanded-queue-count"></span></div><div id="expanded-queue-list" class="expanded-queue-list"></div></section>';
    shell.addEventListener('click',function(event){const button=event.target.closest('[data-expanded-action]');if(!button)return;const action=button.dataset.expandedAction;if(action==='close')closeExpandedPlayer();if(action==='toggle')toggle();if(action==='previous')previous();if(action==='next')next();const index=button.dataset.queueIndex;if(index!=null)playQueueIndex(Number(index));});
    document.body.appendChild(shell);
  }

  function escapeText(value) { return String(value||'').replace(/[&<>"']/g,function(char){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char];}); }
  function renderExpandedPlayer() {
    const shell=element('expanded-player');if(!shell)return;
    const track=currentTrack||persistedPlayback.track||{};
    element('expanded-player-title').textContent=track.title||'Choose a song';
    element('expanded-player-artist').textContent=track.artist||'Quaver';
    const art=element('expanded-player-art');art.src=track.albumArt||'';art.hidden=!track.albumArt;
    element('expanded-player-current').textContent=formatTime(position||persistedPlayback.position);
    element('expanded-player-duration').textContent=formatTime(duration||persistedPlayback.duration);
    element('expanded-player-progress-fill').style.width=((duration||persistedPlayback.duration)?((position||persistedPlayback.position)/(duration||persistedPlayback.duration))*100:0)+'%';
    const queue=Array.isArray(persistedPlayback.queue)?persistedPlayback.queue:[];
    const active=Number(persistedPlayback.index)||0;
    element('expanded-queue-count').textContent=queue.length+(queue.length===1?' song':' songs');
    element('expanded-queue-list').innerHTML=queue.map(function(item,index){return '<button type="button" data-expanded-action="queue" data-queue-index="'+index+'" class="expanded-queue-item'+(index===active?' active':'')+'"><span>'+(index+1)+'</span>'+(item.albumArt?'<img src="'+escapeText(item.albumArt)+'" alt=""/>':'<i></i>')+'<span><strong>'+escapeText(item.title)+'</strong><small>'+escapeText(item.artist)+'</small></span>'+(index===active?'<b>Playing</b>':'')+'</button>';}).join('')||'<p>Your queue will appear here when you play a mix.</p>';
  }

  function openExpandedPlayer() { ensureExpandedPlayer();renderExpandedPlayer();element('expanded-player').hidden=false;document.body.classList.add('expanded-player-open'); }
  function closeExpandedPlayer() { const shell=element('expanded-player');if(shell)shell.hidden=true;document.body.classList.remove('expanded-player-open'); }

  function autoInitialize() {
    if (!element('spotify-player')) return;
    const volume = Math.round(Number(localStorage.getItem('quaver_player_volume') || 0.7) * 100);
    const slider = element('player-volume');
    if (slider) {
      slider.value = String(volume);
      slider.style.setProperty('--player-volume', volume + '%');
    }
    if (localStorage.getItem('quaver_user') && localStorage.getItem('quaver_spotify_name')) {
      if (persistedPlayback.track && !persistedPlayback.userStopped) {
        currentTrack=persistedPlayback.track;position=Number(persistedPlayback.position)||0;duration=Number(persistedPlayback.duration)||0;paused=!!persistedPlayback.paused;showPlayer(currentTrack);renderProgress(position,duration);renderPlaybackState();
      }
      initialize(true).then(async function(){
        if (!persistedPlayback.track || persistedPlayback.userStopped || persistedPlayback.paused || Date.now()-(persistedPlayback.updatedAt||0)>30*60*1000) return;
        const targetDeviceId=await waitUntilReady();
        await startPlayback(persistedPlayback.track.trackId,targetDeviceId,persistedPlayback.position||0);
      }).catch(function () {});
    }
    ensureExpandedPlayer();
    const identity=element('spotify-player')&&element('spotify-player').querySelector('.player-identity');
    if(identity){identity.setAttribute('role','button');identity.setAttribute('tabindex','0');identity.setAttribute('aria-label','Open now playing and queue');identity.addEventListener('click',openExpandedPlayer);identity.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();openExpandedPlayer();}});}
    window.addEventListener('pagehide',function(){savePersistedPlayback(true);});
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
    setQueue: setQueue,
    playQueueIndex: playQueueIndex,
    showQueue: openExpandedPlayer,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInitialize);
  else autoInitialize();
})();
