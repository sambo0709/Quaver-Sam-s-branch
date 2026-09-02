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
  await expect(page.getByRole('heading', { name: '30-Day Mood Timeline' })).toBeVisible();
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
});

test('homepage supports an optional mood note and accessible theme control', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('quaver_onboarded', 'true'));
  await page.goto('/');
  await expect(page.getByLabel('Optional mood note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle color theme' })).toBeVisible();
});
