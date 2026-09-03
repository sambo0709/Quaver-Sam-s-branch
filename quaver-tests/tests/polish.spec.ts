import { test, expect } from '@playwright/test';

test('profile exposes the polished dashboard and dedicated settings navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
    localStorage.setItem('theme', 'dark');
  });
  await page.route('**/api/playlist', route => route.fulfill({ json: { playlists: [] } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { username: 'Listener', email: 'listener@example.com' } }));
  await page.route('**/api/mood/history', route => route.fulfill({ json: { moods: [] } }));
  await page.route('**/api/listening/history', route => route.fulfill({ json: { plays: [] } }));

  await page.goto('/profile.html');

  await expect(page.getByRole('heading', { name: 'Your Sound Story' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekly Mood Mix' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Moods' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '30-Day Mood Timeline' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle color theme' })).toHaveCount(0);
});

test('authenticated profile loads mood, listening, and playlist data', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
    localStorage.setItem('theme', 'dark');
  });
  await page.route('**/api/playlist', route => route.fulfill({
    json: { playlists: [{ id: 'evening', name: 'Evening Mix', mood: 'calm', songs: [] }] },
  }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { username: 'Listener', email: 'listener@example.com' } }));
  await page.route('**/api/mood/history', route => route.fulfill({
    json: { moods: [{ mood: 'calm', time: '8:00 PM', ts: Date.now() }] },
  }));
  await page.route('**/api/listening/history', route => route.fulfill({
    json: { plays: [{ trackId: 'played123', title: 'Loaded <img src=x onerror="window.__profileXss=true"> Song', artist: 'Loaded Artist', albumArt: '', playedAt: Date.now() }] },
  }));
  await page.route('**/api/music/recommend?**', route => route.fulfill({ json: { songs: [] } }));

  await page.goto('/profile.html');

  await expect(page.getByText('Recorded moods')).toBeVisible();
  await expect(page.getByText('Loaded <img src=x onerror="window.__profileXss=true"> Song')).toBeVisible();
  await expect(page.getByText('Evening Mix')).toBeVisible();
  await expect(page.getByText('calm', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).__profileXss)).toBeUndefined();
  await expect(page.locator('[data-profile-song="0"]')).not.toHaveAttribute('onclick');
});

test('profile rejects stale local authentication when the server session is missing', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'Not logged in' } }));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('quaver_user', JSON.stringify({ username: 'Stale User' })));
  await page.goto('/profile.html');

  await expect(page).toHaveURL(/login\.html/);
  expect(await page.evaluate(() => localStorage.getItem('quaver_user'))).toBeNull();
});

test('settings are organized on a dedicated page', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
  });
  await page.goto('/settings.html');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Music preferences' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Privacy and data' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Danger zone' })).toBeVisible();
  await expect(page.getByText("Connect a Premium account to play full songs through Quaver's player.")).toBeVisible();
});

test('homepage keeps the primary mood flow focused and leaves theme controls in settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('quaver_onboarded', 'true'));
  await page.goto('/');
  await expect(page.getByPlaceholder('Add an optional note about how you feel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle color theme' })).toHaveCount(0);
});

test('homepage renders personalized rails and contextual song actions', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_onboarded', 'true');
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

test('Play All stays readable as the results layout narrows', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.addInitScript(() => localStorage.setItem('quaver_onboarded', 'true'));
  await page.goto('/');
  await page.evaluate(() => {
    document.getElementById('results')!.innerHTML = '<div class="results-header"><span>8 tracks — nostalgic</span><button class="play-all-btn">▶ Play All</button></div>';
  });
  const button = page.getByRole('button', { name: /Play All/ });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(104);
  expect(box?.height).toBeGreaterThanOrEqual(36);
  const fits = await page.locator('.results-header').evaluate(element => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
});

test('player close button stays inside every intermediate viewport', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.addInitScript(() => localStorage.setItem('quaver_onboarded', 'true'));
  await page.goto('/');
  await page.evaluate(() => (window as any).playInApp('abc123', 'Now Playing', 'Quaver Artist', ''));
  const closeButton = page.getByRole('button', { name: 'Close player' });
  await expect(closeButton).toBeVisible();
  const box = await closeButton.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(800);
});

test('Quaver player starts a Spotify SDK track without rendering an embed', async ({ page }) => {
  let playbackBody: unknown;
  await page.addInitScript(() => {
    localStorage.setItem('quaver_onboarded', 'true');
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

test('shared playlist data is rendered as text instead of executable HTML', async ({ page }) => {
  await page.route('**/api/playlist/public/security-test', route => route.fulfill({
    json: {
      owner: '<img src=x onerror="window.__quaverXss=true">',
      playlist: {
        name: '<img src=x onerror="window.__quaverXss=true">',
        mood: 'calm',
        songs: [{ title: '<img src=x onerror="window.__quaverXss=true">', artist: 'Safe artist', album_art: '', spotify_url: '' }],
      },
    },
  }));
  await page.goto('/share.html?id=security-test');
  await expect(page.getByRole('heading', { name: '<img src=x onerror="window.__quaverXss=true">' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__quaverXss)).toBeUndefined();
  await expect(page.locator('#share-content img')).toHaveCount(0);
});

test('server sends baseline browser security headers', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  expect(response?.headers()['x-frame-options']).toBe('DENY');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
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

test('global search opens a dedicated discovery page', async ({ page }) => {
  await page.goto('/');
  const search = page.getByPlaceholder('What do you want to play?');
  const collapsedWidth = await page.locator('.global-search').evaluate((element) => element.getBoundingClientRect().width);
  expect(collapsedWidth).toBeLessThanOrEqual(50);
  await search.focus();
  await expect.poll(() => page.locator('.global-search').evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(200);
  await search.fill('SZA');
  await search.press('Enter');
  await expect(page).toHaveURL(/search\.html\?q=SZA/);
  await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
  await expect(page.locator('.mobile-bottom-nav a.active')).toHaveText(/Search/);
});

test('header uses a non-linking compact Quaver mark', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_onboarded', '1');
    localStorage.removeItem('theme');
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const mark = page.locator('.nav-left .brand-mark');
  await expect(mark).toHaveAttribute('src', 'nightmode_logo.png');
  await expect(mark.locator('xpath=ancestor::a')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(mark).toHaveAttribute('src', 'lightmode_logo.png');
});

test('header remains visible while scrolling and resizing', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('quaver_onboarded', '1'));
  await page.setViewportSize({ width: 700, height: 720 });
  await page.goto('/');
  const header = page.locator('body > nav').first();
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(header).toBeVisible();
  await expect.poll(() => header.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  const splitHeaderStyle = await header.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    height: element.getBoundingClientRect().height
  }));
  expect(splitHeaderStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(splitHeaderStyle.height).toBeGreaterThanOrEqual(60);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect(header).toBeVisible();
  await expect(header).not.toHaveClass(/nav-hidden/);
});

test('a playlist can be built and saved entirely on the playlist page', async ({ page }) => {
  let createdBody: any;
  await page.addInitScript(() => {
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
  });
  await page.route('**/api/playlist', async route => {
    if (route.request().method() === 'POST') {
      createdBody = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { playlist: { id: 'new-playlist', createdAt: '2026-09-02T12:00:00.000Z', ...createdBody } } });
    } else {
      await route.fulfill({ json: { playlists: [] } });
    }
  });
  await page.route('**/api/music/search?*', route => route.fulfill({
    json: { songs: [{ title: 'Quiet Hours', artist: 'Quaver Artist', album_art: '', spotify_url: 'https://open.spotify.com/track/create123' }] },
  }));

  await page.goto('/playlists.html');
  await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
  await expect(page.locator('#playlist-collection')).toBeHidden();
  await page.getByLabel('Playlist name').fill('Late Night Calm');
  await page.locator('#playlist-create-mood').selectOption('calm');
  await page.getByPlaceholder('Song, artist, or album').fill('quiet');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save playlist', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Late Night Calm' })).toBeVisible();
  expect(createdBody).toMatchObject({ name: 'Late Night Calm', mood: 'calm' });
  expect(createdBody.songs).toHaveLength(1);
  await expect(page.locator('#playlist-total')).toHaveText('1');
});

test('adding a homepage song opens the playlist-page builder instead of a popup', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
    localStorage.setItem('quaver_onboarded', 'true');
    sessionStorage.setItem('quaver_launched', '1');
  });
  await page.route('**/api/playlist*', route => route.fulfill({ json: { playlists: [] } }));
  await page.goto('/');
  await Promise.all([
    page.waitForURL('**/playlists.html?create=1'),
    page.evaluate(() => (window as any).addToPlaylist({ title: 'Draft Song', artist: 'Quaver Artist', spotify_url: 'https://open.spotify.com/track/draft123' }, null)),
  ]);
  await expect(page.getByRole('heading', { name: 'Create a playlist' })).toBeVisible();
  await expect(page.getByText('Draft Song', { exact: true })).toBeVisible();
  await expect(page.locator('#playlist-panel')).toHaveCount(0);
});

test('Trending Moods uses solid surfaces for both color themes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_onboarded', 'true');
    localStorage.setItem('theme', 'light');
    sessionStorage.setItem('quaver_launched', '1');
  });
  await page.goto('/');
  await expect.poll(() => page.locator('.trending-section').evaluate(section => getComputedStyle(section).backgroundColor)).toBe('rgb(255, 255, 255)');
  const colors = await page.locator('.trending-section').evaluate(section => ({ section: getComputedStyle(section).backgroundColor, body: getComputedStyle(document.body).backgroundColor }));
  expect(colors.section).not.toBe(colors.body);
  expect(colors.section).not.toBe('rgba(0, 0, 0, 0)');
  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await expect.poll(() => page.locator('.trending-section').evaluate(section => getComputedStyle(section).backgroundColor)).toBe('rgb(23, 28, 43)');
});

test('saved playlists can be exported to Spotify from the library', async ({ page }) => {
  let exportBody: any;
  await page.addInitScript(() => {
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Listener' }));
    (window as any).__openedSpotifyUrl = '';
    window.open = ((url?: string | URL) => {
      (window as any).__openedSpotifyUrl = String(url || '');
      return {} as Window;
    }) as typeof window.open;
  });
  await page.route('**/api/playlist', route => route.fulfill({
    json: { playlists: [{ id: 'export-me', name: 'Calm Evening', mood: 'calm', songs: [{ title: 'Quiet Hours', artist: 'Quaver Artist', spotify_url: 'https://open.spotify.com/track/export123?si=test' }] }] },
  }));
  await page.route('**/spotify/session', route => route.fulfill({ json: { connected: true, displayName: 'Listener' } }));
  await page.route('**/spotify/export', async route => {
    exportBody = route.request().postDataJSON();
    await route.fulfill({ json: { playlist_url: 'https://open.spotify.com/playlist/new123', playlist_id: 'new123' } });
  });

  await page.goto('/playlists.html');
  await page.getByRole('button', { name: 'Export Calm Evening to Spotify' }).click();
  await expect(page.getByText('Playlist exported to Spotify.')).toBeVisible();
  expect(exportBody).toEqual({
    playlistName: 'Calm Evening (from Quaver)',
    trackUris: ['spotify:track:export123'],
  });
  await expect.poll(() => page.evaluate(() => (window as any).__openedSpotifyUrl)).toBe('https://open.spotify.com/playlist/new123');
});
