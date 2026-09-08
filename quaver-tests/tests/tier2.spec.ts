import { test, expect } from '@playwright/test';

test.describe('Tier 2 — navigation', () => {
  test('Discover is reachable from the desktop top nav', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('quaver_onboarded', '1'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });

    const link = page.locator('nav[data-shell="top-nav"] a[data-route="discover"]');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/discover\.html$/);
    await expect(page.getByRole('heading', { name: /explore every mood/i })).toBeVisible();
    await expect(link).toHaveClass(/active/);
  });

  test('mobile bottom nav shows Discover and does not overflow', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('quaver_onboarded', '1'));
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/', { waitUntil: 'networkidle' });

    const items = page.locator('.mobile-bottom-nav a');
    await expect(items).toHaveCount(5);
    await expect(page.locator('.mobile-bottom-nav a[data-route="discover"]')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  });

  test('Mood archive is in the account menu', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('quaver_onboarded', '1');
      localStorage.setItem('quaver_user', JSON.stringify({ username: 'Nav Tester' }));
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#user-menu-button')).toBeVisible();
    await page.locator('#user-menu-button').click();
    const archive = page.locator('#user-menu-dropdown a[data-route="archive"]');
    await expect(archive).toBeVisible();
    await archive.click();
    await expect(page).toHaveURL(/archive\.html$/);
  });

  test('top nav fits without horizontal overflow at laptop widths', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('quaver_onboarded', '1'));
    for (const width of [770, 900, 1100]) {
      await page.setViewportSize({ width, height: 860 });
      await page.goto('/', { waitUntil: 'networkidle' });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        `no overflow at ${width}px`,
      ).toBe(true);
    }
  });
});

test.describe('Tier 2 — mix preview', () => {
  const trackUrl = (n: number) => `https://open.spotify.com/track/${String(n).padStart(22, 'b')}`;
  const mixOf = (ids: number[]) => ({
    mood: 'happy',
    context: { mood: 'happy' },
    learning: { personalized: false },
    count: ids.length,
    songs: ids.map((n) => ({
      title: `Song ${n}`, artist: `Artist ${n}`, duration: '3:00', album_art: '',
      spotify_url: trackUrl(n), recommendation_reasons: ['Fits your happy mood'],
    })),
  });

  test('"New mix" re-requests, excluding the tracks it just served', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('quaver_onboarded', '1'));
    let call = 0;
    await page.route('**/api/music/recommend**', (route) => {
      call += 1;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(call === 1 ? mixOf([1, 2, 3]) : mixOf([4, 5, 6])) });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#mood-select').selectOption('happy');
    await page.locator('#recommendation-form button[type="submit"]').click();
    await expect(page.locator('.song-card')).toHaveCount(3);

    const secondCall = page.waitForRequest((r) => {
      const u = new URL(r.url());
      return u.pathname.endsWith('/api/music/recommend') && (u.searchParams.get('session') || '').includes('bbbbbbbbbbbbbbbbbbbbb1');
    });
    await page.getByRole('button', { name: /new mix/i }).click();
    await secondCall;
    await expect(page.locator('.song-card').first()).toContainText('Song 4');
  });

  test('"Save as playlist" posts the whole mix', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('quaver_onboarded', '1');
      localStorage.setItem('quaver_user', JSON.stringify({ username: 'Mixer' }));
    });
    await page.route('**/api/music/recommend**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mixOf([7, 8])) }),
    );
    let posted: any = null;
    await page.route('**/api/playlist', (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ playlist: { id: 'x', name: posted.name, mood: posted.mood, songs: posted.songs } }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ playlists: [] }) });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#mood-select').selectOption('happy');
    await page.locator('#recommendation-form button[type="submit"]').click();
    await expect(page.locator('.song-card')).toHaveCount(2);

    page.once('dialog', (d) => d.accept('My Saved Mix'));
    await page.getByRole('button', { name: /save as playlist/i }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted.name).toBe('My Saved Mix');
    expect(posted.songs).toHaveLength(2);
    expect(posted.songs[0].spotify_url).toContain('/track/');
  });

  test('preview-first: 30s clip plays when the SDK cannot', async ({ page }) => {
    const silentWav = (seconds = 1, rate = 8000) => {
      const size = seconds * rate;
      const buf = Buffer.alloc(44 + size);
      buf.write('RIFF', 0); buf.writeUInt32LE(36 + size, 4); buf.write('WAVE', 8);
      buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
      buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
      buf.write('data', 36); buf.writeUInt32LE(size, 40);
      buf.fill(128, 44);
      return 'data:audio/wav;base64,' + buf.toString('base64');
    };

    await page.addInitScript(() => {
      localStorage.setItem('quaver_onboarded', '1');
      localStorage.setItem('quaver_user', JSON.stringify({ username: 'Preview Listener' }));
    });
    await page.route('https://sdk.scdn.co/**', (r) => r.abort());
    await page.route('**/spotify/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) }),
    );
    await page.route('**/api/music/recommend**', (r) =>
      r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          mood: 'happy', context: { mood: 'happy' }, learning: {}, count: 1,
          songs: [{
            title: 'Preview Song', artist: 'PA', duration: '0:30', album_art: '',
            spotify_url: 'https://open.spotify.com/track/' + 'p'.repeat(22),
            preview_url: silentWav(1),
            recommendation_reasons: ['Fits your happy mood'],
          }],
        }),
      }),
    );

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#mood-select').selectOption('happy');
    await page.locator('#recommendation-form button[type="submit"]').click();
    await page.locator('.song-card .play-btn').first().click();

    await expect(page.locator('#spotify-player')).toBeVisible();
    await expect(page.locator('#player-status')).toContainText(/preview/i, { timeout: 20000 });
    const usingClip = await page.evaluate(() => {
      const audio = document.querySelector('audio');
      return !!audio && /^data:audio\/wav/.test(audio.src || audio.currentSrc || '');
    });
    expect(usingClip).toBe(true);
  });

  test('player exposes the add-to-playlist and start-a-mix actions', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('quaver_onboarded', '1'));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const player = page.locator('#spotify-player');
    await expect(player.locator('button[onclick="playerAddCurrentToPlaylist(this)"]')).toHaveCount(1);
    await expect(player.locator('button[onclick="playerMixFromCurrent()"]')).toHaveCount(1);
    // handlers are defined and safe to call with nothing playing
    const ok = await page.evaluate(() => {
      try {
        (window as any).playerAddCurrentToPlaylist();
        (window as any).playerMixFromCurrent();
        return typeof (window as any).QuaverPlayer.current === 'function';
      } catch { return false; }
    });
    expect(ok).toBe(true);
  });
});
