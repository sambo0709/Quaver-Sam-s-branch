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

  test('mood pad toggles on, resolves a mood by position, and stays in sync with chips', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('quaver_onboarded', '1'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.locator('.mood-pad-toggle').click();
    const pad = page.locator('#mood-pad');
    await expect(pad).toBeVisible();
    await expect(page.locator('.main-mood-chips')).toBeHidden();

    const surface = pad.locator('.mood-pad-surface');
    const box = (await surface.boundingBox())!;

    // top-right = high energy + upbeat -> an energetic-family mood
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.08);
    const upbeat = await page.locator('#mood-select').inputValue();
    expect(['energetic', 'party', 'happy']).toContain(upbeat);
    await expect(page.locator('#mood-pad-readout')).toHaveText(upbeat);

    // bottom-left = low energy + downbeat -> sad
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.75);
    expect(await page.locator('#mood-select').inputValue()).toBe('sad');

    // keyboard nudge still resolves a mood
    await surface.focus();
    await surface.press('ArrowUp');
    await surface.press('ArrowUp');
    expect(await page.locator('#mood-select').inputValue()).not.toBe('');

    // switch back to chips; a chip click drives the same select
    await page.locator('.mood-pad-toggle').click();
    await expect(page.locator('.main-mood-chips')).toBeVisible();
    await page.locator('.main-mood-chips button[data-value="calm"]').click();
    expect(await page.locator('#mood-select').inputValue()).toBe('calm');
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
