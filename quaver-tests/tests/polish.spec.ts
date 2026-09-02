import { test, expect } from '@playwright/test';

test('profile exposes the polished dashboard and dedicated settings navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_token', 'test-token');
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
    localStorage.setItem('theme', 'dark');
  });
  await page.route('**/api/playlist', route => route.fulfill({ json: { playlists: [] } }));
  await page.route('**/api/mood/history', route => route.fulfill({ json: { moods: [] } }));
  await page.route('**/api/listening/history', route => route.fulfill({ json: { plays: [] } }));

  await page.goto('/profile.html');

  await expect(page.getByRole('heading', { name: 'Your Sound Story' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekly Mood Mix' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Moods' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '30-Day Mood Timeline' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle color theme' })).toBeVisible();
});

test('settings are organized on a dedicated page', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_token', 'test-token');
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
  });
  await page.goto('/settings.html');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Music preferences' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Privacy and data' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Danger zone' })).toBeVisible();
  await expect(page.getByText("Connect a Premium account to play full songs through Quaver's player.")).toBeVisible();
});

test('homepage keeps the primary mood flow focused and has an accessible theme control', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('quaver_onboarded', 'true'));
  await page.goto('/');
  await expect(page.getByPlaceholder('Add an optional note about how you feel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle color theme' })).toBeVisible();
});

test('homepage renders personalized rails and contextual song actions', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_onboarded', 'true');
    localStorage.setItem('quaver_token', 'test-token');
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
  });
  await page.route('**/api/listening/history', route => route.fulfill({ json: { plays: [{ trackId: 'abc123', title: 'A familiar song', artist: 'Quaver Artist', albumArt: '' }] } }));
  await page.route('**/api/mood/history', route => route.fulfill({ json: { moods: [{ mood: 'calm' }, { mood: 'calm' }, { mood: 'focused' }] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Jump back in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your mood shortcuts' })).toBeVisible();
  await page.getByRole('button', { name: 'More options for A familiar song' }).click();
  await expect(page.getByRole('button', { name: 'Add to queue' })).toBeVisible();
});

test('mobile navigation and persistent player fit the compact layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('quaver_onboarded', 'true'));
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await page.evaluate(() => (window as any).playInApp('abc123', 'Now Playing', 'Quaver Artist', ''));
  await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/player-active/);
  await expect(page.locator('#spotify-iframe')).toHaveCount(0);
  await expect(page.getByText('Now Playing', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('Quaver player starts a Spotify SDK track without rendering an embed', async ({ page }) => {
  let playbackBody: unknown;
  await page.addInitScript(() => {
    localStorage.setItem('quaver_onboarded', 'true');
    localStorage.setItem('quaver_token', 'test-token');
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
    class MockSpotifyPlayer {
      listeners: Record<string, (event: any) => void> = {};
      addListener(name: string, callback: (event: any) => void) { this.listeners[name] = callback; }
      async connect() { setTimeout(() => this.listeners.ready?.({ device_id: 'quaver-device' }), 0); return true; }
      async activateElement() {}
      async togglePlay() {}
      async previousTrack() {}
      async nextTrack() {}
      async seek() {}
      async setVolume() {}
      async pause() {}
      disconnect() {}
    }
    (window as any).Spotify = { Player: MockSpotifyPlayer };
  });
  await page.route('**/spotify/playback-token', route => route.fulfill({ json: { accessToken: 'spotify-access-token', expiresIn: 3600 } }));
  await page.route('https://api.spotify.com/v1/me/player/play?device_id=quaver-device', async route => {
    playbackBody = route.request().postDataJSON();
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/');

  const started = await page.evaluate(() => (window as any).playInApp('abc123', 'A Quaver Song', 'Quaver Artist', ''));

  expect(started).toBe(true);
  expect(playbackBody).toEqual({ uris: ['spotify:track:abc123'] });
  await expect(page.locator('#spotify-iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(page.getByText('Playing on Quaver', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Song progress')).toBeVisible();
  await expect(page.getByLabel('Volume')).toBeVisible();
});

test('shared playlists use the same Quaver player instead of a second Spotify embed', async ({ page }) => {
  await page.route('**/api/playlist/public/shared-demo', route => route.fulfill({
    json: {
      playlist: {
        name: 'Shared Mix',
        mood: 'calm',
        songs: [{ title: 'Shared Song', artist: 'Quaver Artist', album_art: '', spotify_url: 'https://open.spotify.com/track/shared123' }],
      },
      owner: 'Listener',
    },
  }));
  await page.goto('/share.html?id=shared-demo');
  await page.locator('.play-btn').click();

  await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Now playing' }).getByText('Shared Song', { exact: true })).toBeVisible();
  await expect(page.locator('#spotify-iframe')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
});

test('Mood of the Day cards stay inside a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('quaver_onboarded', 'true');
    sessionStorage.setItem('quaver_launched', '1');
  });
  await page.route('**/api/music/sotd', route => route.fulfill({
    json: {
      mood: 'calm',
      songs: [
        { title: 'Chill Acoustic Guitar With A Long Title', artist: 'Acoustic Guitar Music, Acoustic Guitar Zone', album_art: '', spotify_url: 'https://open.spotify.com/track/mobile123' },
        { title: 'Infinite', artist: 'Auguste Braun', album_art: '', spotify_url: 'https://open.spotify.com/track/mobile456' },
      ],
    },
  }));
  await page.goto('/');
  await expect(page.locator('.sotd-card')).toHaveCount(2);
  await page.locator('.sotd-card').last().evaluate(card => new Promise<void>(resolve => {
    if (getComputedStyle(card).animationName === 'none') resolve();
    else card.addEventListener('animationend', () => resolve(), { once: true });
  }));

  const bounds = await page.locator('.sotd-card').evaluateAll(cards => cards.map(card => {
    const rect = card.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth };
  }));
  for (const rect of bounds) {
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(rect.viewport + 0.5);
  }
  await expect(page.locator('.sotd-card').first().locator('.sotd-play-btn')).toBeVisible();
});

test('playlist library reports saved totals and opens playlist details', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_token', 'test-token');
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
    localStorage.setItem('theme', 'dark');
  });
  await page.route('**/api/playlist', route => route.fulfill({
    json: {
      playlists: [
        {
          id: 'calm-mix',
          name: 'After Hours',
          mood: 'calm',
          createdAt: '2026-08-30T12:00:00.000Z',
          isPublic: true,
          songs: [
            { title: 'Acoustic', artist: 'Billy Raffoul', album_art: '', spotify_url: 'https://open.spotify.com/track/library123' },
            { title: 'Infinite', artist: 'Auguste Braun', album_art: '', spotify_url: 'https://open.spotify.com/track/library456' },
          ],
        },
        { id: 'focus-mix', name: 'Deep Focus', mood: 'focused', createdAt: '2026-09-01T12:00:00.000Z', songs: [{ title: 'Flow', artist: 'Quaver Artist', album_art: '', spotify_url: '' }] },
      ],
    },
  }));

  await page.goto('/playlists.html');
  await expect(page.getByRole('heading', { name: 'Playlists', exact: true })).toBeVisible();
  await expect(page.locator('#playlist-total')).toHaveText('2');
  await expect(page.locator('#playlist-song-total')).toHaveText('3');
  await expect(page.locator('#playlist-shared-total')).toHaveText('1');
  await expect(page.getByText('2 playlists', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open After Hours' }).click();
  await expect(page.getByRole('heading', { name: 'After Hours' })).toBeVisible();
  await expect(page.getByText('Acoustic', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Playlists', exact: true }).first()).toHaveClass(/active/);
});

test('primary playlist navigation opens the full library page', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_onboarded', 'true');
    sessionStorage.setItem('quaver_launched', '1');
  });
  await page.goto('/');
  await expect(page.locator('.nav-center a[href="playlists.html"]')).toHaveText(/Playlists/);
  await expect(page.locator('.mobile-bottom-nav a[href="playlists.html"]')).toBeAttached();
});
