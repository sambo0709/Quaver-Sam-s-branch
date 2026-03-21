const express = require('express');
const router = express.Router();

const moodMap = {
  happy:     { energy: 'high',   tempo: 'fast',   genre: 'pop' },
  sad:       { energy: 'low',    tempo: 'slow',   genre: 'acoustic' },
  angry:     { energy: 'high',   tempo: 'fast',   genre: 'rock' },
  calm:      { energy: 'low',    tempo: 'slow',   genre: 'ambient' },
  energetic: { energy: 'high',   tempo: 'fast',   genre: 'electronic' },
  romantic:  { energy: 'medium', tempo: 'medium', genre: 'jazz' },
  focused:   { energy: 'medium', tempo: 'medium', genre: 'lo-fi' },
};

router.get('/', (req, res) => {
  res.json({ moods: Object.keys(moodMap) });
});

router.get('/:mood', (req, res) => {
  const mood = req.params.mood.toLowerCase();
  const attributes = moodMap[mood];

  if (!attributes) {
    return res.status(404).json({
      error: `Mood "${mood}" not supported`,
      supported: Object.keys(moodMap),
    });
  }

  res.json({ mood, attributes });
});

module.exports = router;