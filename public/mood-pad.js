(function () {
  'use strict';

  // valence (x, downbeat -> upbeat) and energy (y, calm -> intense), 0..1.
  // Mirrors MOOD_PROFILES in routes/recommendation-engine.js.
  const MOOD_COORDS = {
    happy: { x: 0.90, y: 0.75 },
    energetic: { x: 0.75, y: 0.95 },
    party: { x: 0.85, y: 1.00 },
    romantic: { x: 0.80, y: 0.45 },
    nostalgic: { x: 0.65, y: 0.55 },
    calm: { x: 0.65, y: 0.20 },
    focused: { x: 0.55, y: 0.45 },
    sleepy: { x: 0.50, y: 0.10 },
    anxious: { x: 0.45, y: 0.25 },
    sad: { x: 0.15, y: 0.30 },
    angry: { x: 0.20, y: 0.90 },
  };
  const MOODS = Object.keys(MOOD_COORDS);

  let built = false;
  let surface;
  let thumb;
  let readout;

  function clamp01(n) { return Math.min(1, Math.max(0, n)); }

  function nearestMood(x, y) {
    let best = MOODS[0];
    let bestDist = Infinity;
    for (const mood of MOODS) {
      const c = MOOD_COORDS[mood];
      const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
      if (d < bestDist) { bestDist = d; best = mood; }
    }
    return best;
  }

  function placeThumb(x, y) {
    thumb.style.left = (x * 100) + '%';
    thumb.style.top = ((1 - y) * 100) + '%';
  }

  function setActiveLabel(mood) {
    surface.querySelectorAll('.mood-pad-label').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.mood === mood);
    });
  }

  // Move the pad to a mood without re-dispatching to the <select> (used when the
  // change came from the chips / select itself).
  function reflectMood(mood) {
    const c = MOOD_COORDS[mood];
    if (!c) return;
    placeThumb(c.x, c.y);
    thumb.setAttribute('aria-valuetext', mood);
    readout.textContent = mood;
    setActiveLabel(mood);
  }

  function commitMood(mood) {
    const select = document.getElementById('mood-select');
    if (select && select.value !== mood) {
      select.value = mood;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    reflectMood(mood);
  }

  function pointFromEvent(event) {
    const rect = surface.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01(1 - (event.clientY - rect.top) / rect.height),
    };
  }

  function build() {
    if (built) return;
    const host = document.getElementById('mood-pad');
    if (!host) return;
    built = true;

    host.innerHTML =
      '<div class="mood-pad-surface" role="slider" tabindex="0" aria-label="Mood pad: left–right sets positivity, up–down sets energy"' +
      ' aria-valuemin="0" aria-valuemax="10" aria-valuenow="0">' +
      '<span class="mood-pad-axis mood-pad-axis-y-top">Intense</span>' +
      '<span class="mood-pad-axis mood-pad-axis-y-bottom">Calm</span>' +
      '<span class="mood-pad-axis mood-pad-axis-x-left">Downbeat</span>' +
      '<span class="mood-pad-axis mood-pad-axis-x-right">Upbeat</span>' +
      MOODS.map(function (mood) {
        const c = MOOD_COORDS[mood];
        return '<span class="mood-pad-label" data-mood="' + mood + '" style="left:' + (c.x * 100) + '%;top:' + ((1 - c.y) * 100) + '%">' + mood + '</span>';
      }).join('') +
      '<span class="mood-pad-thumb" aria-hidden="true"></span>' +
      '</div>' +
      '<p class="mood-pad-readout">Feeling <strong id="mood-pad-readout">—</strong></p>';

    surface = host.querySelector('.mood-pad-surface');
    thumb = host.querySelector('.mood-pad-thumb');
    readout = host.querySelector('#mood-pad-readout');

    let dragging = false;
    function update(event) {
      const p = pointFromEvent(event);
      placeThumb(p.x, p.y);
      commitMood(nearestMood(p.x, p.y));
    }
    surface.addEventListener('pointerdown', function (event) {
      dragging = true;
      surface.setPointerCapture(event.pointerId);
      surface.focus();
      update(event);
    });
    surface.addEventListener('pointermove', function (event) { if (dragging) update(event); });
    surface.addEventListener('pointerup', function () { dragging = false; });
    surface.addEventListener('pointercancel', function () { dragging = false; });

    surface.addEventListener('keydown', function (event) {
      const step = 0.06;
      const current = document.getElementById('mood-select').value;
      const c = MOOD_COORDS[current] || { x: 0.5, y: 0.5 };
      let { x, y } = c;
      if (event.key === 'ArrowLeft') x -= step;
      else if (event.key === 'ArrowRight') x += step;
      else if (event.key === 'ArrowUp') y += step;
      else if (event.key === 'ArrowDown') y -= step;
      else return;
      event.preventDefault();
      x = clamp01(x); y = clamp01(y);
      placeThumb(x, y);
      commitMood(nearestMood(x, y));
    });

    document.getElementById('mood-select').addEventListener('change', function (event) {
      if (MOOD_COORDS[event.target.value]) reflectMood(event.target.value);
    });

    const existing = document.getElementById('mood-select').value;
    if (MOOD_COORDS[existing]) reflectMood(existing);
    else placeThumb(0.5, 0.5);
  }

  function toggleMoodPad() {
    build();
    const pad = document.getElementById('mood-pad');
    const chips = document.querySelector('.main-mood-chips');
    const toggle = document.querySelector('.mood-pad-toggle');
    if (!pad || !chips || !toggle) return;
    const showPad = pad.hidden;
    pad.hidden = !showPad;
    chips.hidden = showPad;
    toggle.setAttribute('aria-pressed', showPad ? 'true' : 'false');
    const label = toggle.querySelector('span');
    if (label) label.textContent = showPad ? 'Chips' : 'Pad';
    try { localStorage.setItem('quaver_mood_input', showPad ? 'pad' : 'chips'); } catch (_) {}
    if (showPad) surface.focus();
  }
  window.toggleMoodPad = toggleMoodPad;

  function init() {
    if (document.getElementById('mood-pad') && localStorage.getItem('quaver_mood_input') === 'pad') {
      toggleMoodPad();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
