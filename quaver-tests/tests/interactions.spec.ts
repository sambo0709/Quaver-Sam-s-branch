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

  test('expressive context is sent and recommendation explanations are shown', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('quaver_onboarded', 'true'); sessionStorage.setItem('quaver_launched', '1'); });
    let requestUrl = '';
    await page.route('**/api/music/recommend?**', async route => {
      requestUrl = route.request().url();
      await route.fulfill({ json: { context: { activity: 'studying' }, learning: { personalized: true, completed: 4, skipped: 1, ratings: 2, familiarTracks: 3, variety: 'balanced' }, songs: [{ title: 'Focus Song', artist: 'SZA', duration: '3:00', album_art: '', spotify_url: 'https://open.spotify.com/track/focus123', recommendation_reasons: ['Chosen for studying', 'Designed to help you focus'] }] } });
    });
    await page.goto('/');
    await page.getByText('Shape this recommendation').click();
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
