import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';

test.describe('Quaver Homepage Interactions', () => {

  test('search input accepts text', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await homePage.dismissOverlay();
    await homePage.searchInput.fill('Kendrick Lamar');
    await expect(homePage.searchInput).toHaveValue('Kendrick Lamar');
  });

  test('search input can be cleared', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await homePage.dismissOverlay();
    await homePage.searchInput.fill('Kendrick Lamar');
    await homePage.searchInput.clear();
    await expect(homePage.searchInput).toHaveValue('');
  });

  test('clicking Select Mood opens a dropdown', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await homePage.dismissOverlay();
    await homePage.selectMoodButton.click();
    const happyOption = page.locator('#mood-select option[value="happy"]');
    await expect(happyOption).toBeAttached();
  });

  test('clicking Surprise Me triggers a response', async ({ page }) => {
    const homePage = new HomePage(page);
    let recommendationRequested = false;
    await page.route('**/api/music/recommend?**', route => {
      recommendationRequested = true;
      return route.fulfill({ json: { songs: [{ title: 'Surprise Song', artist: 'Quaver', duration: '3:00', album_art: '', spotify_url: 'https://open.spotify.com/track/surprise123' }] } });
    });
    await homePage.goto();
    await homePage.dismissOverlay();
    await homePage.surpriseMeButton.click();
    await expect(page.getByText('Surprise Song')).toBeVisible();
    expect(recommendationRequested).toBe(true);
  });

  test('mood recommendations render safely and play through data actions', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('quaver_onboarded', 'true');
      sessionStorage.setItem('quaver_launched', '1');
    });
    await page.route('**/api/music/recommend?**', route => route.fulfill({
      json: {
        songs: [{
          title: `Listener's <img src=x onerror="window.__quaverXss=true"> Song`,
          artist: 'Safe Artist',
          duration: '3:12',
          album_art: 'https://i.scdn.co/image/test',
          spotify_url: 'https://open.spotify.com/track/abc123',
        }],
      },
    }));

    await page.goto('/');
    await page.evaluate(() => {
      (window as any).__playedTrack = null;
      (window as any).playInApp = (trackId: string) => { (window as any).__playedTrack = trackId; };
    });
    await page.locator('#mood-select').selectOption('happy');
    await page.locator('#count-select').selectOption('5');
    await page.getByRole('button', { name: 'Go', exact: true }).click();

    const playButton = page.locator('.play-btn[data-result-index="0"]');
    await expect(page.locator('.song-title')).toHaveText(`Listener's <img src=x onerror="window.__quaverXss=true"> Song`);
    await expect(playButton).not.toHaveAttribute('onclick');
    expect(await page.evaluate(() => (window as any).__quaverXss)).toBeUndefined();
    await playButton.click();
    expect(await page.evaluate(() => (window as any).__playedTrack)).toBe('abc123');
  });

  test('mobile recommendations focus the song list and can be shuffled', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.addInitScript(() => {
      localStorage.setItem('quaver_onboarded', 'true');
      sessionStorage.setItem('quaver_launched', '1');
    });
    await page.route('**/api/music/recommend?**', route => route.fulfill({ json: { songs: [
      { title: 'First Song', artist: 'One', duration: '3:00', album_art: '', spotify_url: 'https://open.spotify.com/track/first123' },
      { title: 'Second Song', artist: 'Two', duration: '3:10', album_art: '', spotify_url: 'https://open.spotify.com/track/second123' },
      { title: 'Third Song', artist: 'Three', duration: '3:20', album_art: '', spotify_url: 'https://open.spotify.com/track/third123' },
    ] } }));

    await page.goto('/');
    await page.locator('#mood-select').selectOption('calm');
    await page.locator('#count-select').selectOption('5');
    await page.getByRole('button', { name: 'Go', exact: true }).click();

    const shuffle = page.getByRole('button', { name: 'Shuffle', exact: true });
    await expect(shuffle).toBeVisible();
    await expect.poll(() => page.locator('#results').evaluate(element => Math.round(element.getBoundingClientRect().top))).toBeLessThanOrEqual(110);
    const before = await page.locator('#results .song-title').allTextContents();
    await page.evaluate(() => { Math.random = () => 0; });
    await shuffle.click();
    const after = await page.locator('#results .song-title').allTextContents();
    expect(after).not.toEqual(before);
    await expect(page.getByText('Mix shuffled.')).toBeVisible();
  });

  test('expressive context is sent and recommendation explanations are shown', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('quaver_onboarded', 'true'); sessionStorage.setItem('quaver_launched', '1'); });
    let requestUrl = '';
    await page.route('**/api/music/recommend?**', async route => {
      requestUrl = route.request().url();
      await route.fulfill({ json: { context: { activity: 'studying' }, learning: { personalized: true, completed: 4, skipped: 1, ratings: 2, familiarTracks: 3, variety: 'balanced' }, songs: [{ title: 'Focus Song', artist: 'SZA', duration: '3:00', album_art: '', spotify_url: 'https://open.spotify.com/track/focus123', recommendation_reasons: ['Chosen for studying', 'Designed to help you focus'] }] } });
    });
    await page.goto('/');
    await page.getByText('Fine-tune your mix').click();
    await page.locator('#secondary-mood').selectOption('calm');
    await page.locator('#mood-activity').selectOption('studying');
    await page.locator('#mood-direction').selectOption('focus');
    await page.locator('#preferred-artist').fill('SZA');
    await page.locator('#mood-select').selectOption('focused');
    await page.locator('#count-select').selectOption('5');
    await page.getByRole('button', { name: 'Go', exact: true }).click();

    await expect(page.getByText('Chosen for studying · Designed to help you focus')).toBeVisible();
    await expect(page.getByText('Tuned for you')).toBeVisible();
    await expect(page.getByText(/4 completed/)).toBeVisible();
    expect(requestUrl).toContain('secondaryMood=calm');
    expect(requestUrl).toContain('activity=studying');
    expect(requestUrl).toContain('direction=focus');
    expect(requestUrl).toContain('artist=SZA');
  });

});

test.describe('Playlist discovery', () => {
  test('suggests mood-matched songs, adds one, and lists featured artists', async ({ page }) => {
    const playlist = {
      id: 'playlist-1',
      name: 'Quiet Hours',
      mood: 'calm',
      createdAt: '2026-08-20T12:00:00.000Z',
      songs: [{ title: 'Bloom', artist: 'The Paper Kites', album_art: 'https://i.scdn.co/image/existing', spotify_url: 'https://open.spotify.com/track/existing123' }],
    };
    await page.addInitScript(value => {
      localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
      localStorage.setItem('quaver_playlists', JSON.stringify([value]));
    }, playlist);
    await page.route('**/api/playlist', route => route.fulfill({ json: { playlists: [playlist] } }));
    await page.route('**/api/music/recommend?**', route => route.fulfill({ json: { songs: [{ title: 'Soft Focus', artist: 'Novo Amor', album_art: 'https://i.scdn.co/image/suggested', spotify_url: 'https://open.spotify.com/track/suggested123' }] } }));
    await page.route('**/api/playlist/playlist-1/songs', route => route.fulfill({ status: 201, json: { song: { title: 'Soft Focus', artist: 'Novo Amor', album_art: 'https://i.scdn.co/image/suggested', spotify_url: 'https://open.spotify.com/track/suggested123' } } }));

    await page.goto('/playlists.html?id=playlist-1');
    await expect(page.getByRole('heading', { name: 'Suggested songs' })).toBeVisible();
    await expect(page.getByText('Soft Focus')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Featured artists' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Find music by The Paper Kites' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Soft Focus to playlist' }).click();
    await expect(page.locator('.playlist-detail-track').filter({ hasText: 'Soft Focus' })).toBeVisible();
  });

  test('keeps playlist rows compact on mobile regardless of track controls', async ({ page }) => {
    const playlist = {
      id: 'mobile-playlist', name: 'Mixed controls', mood: 'mixed',
      songs: [
        { title: 'Playable', artist: 'Artist One', album_art: '', spotify_url: 'https://open.spotify.com/track/playable123' },
        { title: 'Imported song', artist: 'Artist Two', album_art: '', spotify_url: '' },
      ],
    };
    await page.setViewportSize({ width: 393, height: 852 });
    await page.addInitScript(value => {
      localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
      localStorage.setItem('quaver_playlists', JSON.stringify([value]));
    }, playlist);
    await page.route('**/api/playlist', route => route.fulfill({ json: { playlists: [playlist] } }));
    await page.route('**/api/music/recommend?**', route => route.fulfill({ json: { songs: [] } }));
    await page.route('**/api/music/artists?**', route => route.fulfill({ json: { artists: [] } }));
    await page.goto('/playlists.html?id=mobile-playlist');

    const heights = await page.locator('.playlist-detail-track').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
    expect(heights.every(height => height < 80)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.evaluate(() => {
      const player = document.getElementById('spotify-player');
      if (player) player.style.display = 'grid';
      document.body.classList.add('player-active');
    });
    await page.waitForTimeout(400);
    const playerNavLayout = await page.evaluate(() => {
      const playerElement = document.getElementById('spotify-player')!;
      const player = playerElement.getBoundingClientRect();
      const nav = document.querySelector('.mobile-bottom-nav')!.getBoundingClientRect();
      return { gap: Math.abs(nav.top - player.bottom), height: player.height, playerBottom: player.bottom, navTop: nav.top, cssBottom: getComputedStyle(playerElement).bottom };
    });
    expect(playerNavLayout.gap, JSON.stringify(playerNavLayout)).toBeLessThanOrEqual(1);
    expect(playerNavLayout.height).toBeLessThanOrEqual(68);
  });
});
