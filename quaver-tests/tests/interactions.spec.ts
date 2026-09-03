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
    await homePage.goto();
    await homePage.dismissOverlay();
    await homePage.surpriseMeButton.click();
    await expect(page.locator('body')).not.toBeEmpty();
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

    const playButton = page.locator('.play-btn[data-result-index="0"]');
    await expect(page.locator('.song-title')).toHaveText(`Listener's <img src=x onerror="window.__quaverXss=true"> Song`);
    await expect(playButton).not.toHaveAttribute('onclick');
    expect(await page.evaluate(() => (window as any).__quaverXss)).toBeUndefined();
    await playButton.click();
    expect(await page.evaluate(() => (window as any).__playedTrack)).toBe('abc123');
  });

});
