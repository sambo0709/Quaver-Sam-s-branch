(function () {
  'use strict';

  const all = [
    { id: 'calm-focus', name: 'Calm Focus', mood: 'focused', description: 'Low-key tracks for uninterrupted concentration.', activity: 'studying', direction: 'focus' },
    { id: 'energy-boost', name: 'Energy Boost', mood: 'energetic', description: 'High-energy picks for movement and momentum.', activity: 'working out', direction: 'energize' },
    { id: 'late-night', name: 'Late Night', mood: 'calm', description: 'Unhurried songs for winding down after dark.', activity: 'relaxing', direction: 'stay' },
    { id: 'feel-good', name: 'Feel Good', mood: 'happy', description: 'Bright, easy listening for a lighter mood.', activity: 'socializing', direction: 'stay' },
    { id: 'deep-rest', name: 'Deep Rest', mood: 'sleepy', description: 'Soft selections for a quiet end to the day.', activity: 'sleeping', direction: 'calm down' },
    { id: 'throwback', name: 'Throwback', mood: 'nostalgic', description: 'Familiar sounds with a nostalgic pull.', activity: 'none', direction: 'stay' },
    { id: 'rainy-window', name: 'Rainy Window', mood: 'sad', description: 'Reflective songs for sitting with the feeling.', activity: 'relaxing', direction: 'stay' },
    { id: 'controlled-fire', name: 'Controlled Fire', mood: 'angry', description: 'A forceful release without losing the thread.', activity: 'working out', direction: 'energize' },
    { id: 'soft-hearts', name: 'Soft Hearts', mood: 'romantic', description: 'Warm songs for closeness and connection.', activity: 'relaxing', direction: 'stay' },
    { id: 'after-hours', name: 'After Hours', mood: 'party', description: 'Lively picks built to keep the room moving.', activity: 'socializing', direction: 'energize' },
    { id: 'steady-ground', name: 'Steady Ground', mood: 'anxious', description: 'Gentle tracks that leave room to breathe.', activity: 'relaxing', direction: 'calm down' }
  ];

  function todayKey(date) {
    const value = date || new Date();
    return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
  }
  function hash(value) {
    let result = 2166136261;
    String(value).split('').forEach(function (character) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); });
    return result >>> 0;
  }
  function daily(count, dateKey) {
    const key = dateKey || todayKey();
    return all.slice().sort(function (a, b) { return hash(key + ':' + a.id) - hash(key + ':' + b.id); }).slice(0, count || 6);
  }

  window.QuaverMoodCollections = { all: all, daily: daily, todayKey: todayKey, hash: hash };
}());
