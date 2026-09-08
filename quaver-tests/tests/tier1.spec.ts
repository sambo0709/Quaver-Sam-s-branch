import { randomUUID } from 'node:crypto';
import { test, expect, Page } from '@playwright/test';

// Verifies the Tier 1 UI end to end against a running server:
// settings taste editor, onboarding artist step, and the "start a mix from
// this" song-card action.

async function register(page: Page) {
  // This file runs in parallel across browser workers, so process-local counters
  // and timestamps alone can collide against the shared test database.
  const username = `t1_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const res = await page.request.post('/api/auth/register', {
    data: { username, email: `${username}@example.test`, password: 'passw0rd-长-enough' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  await page.addInitScript(
    ([u, e]) => localStorage.setItem('quaver_user', JSON.stringify({ username: u, email: e })),
    [body.username, body.email],
  );
  return body;
}

test('settings: taste editor adds a loved artist and it persists', async ({ page }) => {
  await register(page);
  await page.goto('/settings.html', { waitUntil: 'networkidle' });

  const section = page.locator('#settings-taste');
  await expect(section).toBeVisible();

  const savePromise = page.waitForResponse(
    (r) => r.url().includes('/api/taste') && r.request().method() === 'PUT' && r.ok(),
  );
  const input = section.locator('#taste-loved .tag-input');
  await input.fill('SZA');
  await input.press('Enter');

  await expect(section.locator('#taste-loved .tag')).toHaveText(/sza/i);
  const saved = await (await savePromise).json();
  expect(saved.taste.seedArtists).toContain('sza');

  // survives a reload
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#settings-taste #taste-loved .tag')).toHaveText(/sza/i);
});

test('settings: genre chip toggles and saves', async ({ page }) => {
  await register(page);
  await page.goto('/settings.html', { waitUntil: 'networkidle' });

  const chip = page.locator('#taste-genres button[data-genre="jazz"]');
  const savePromise = page.waitForResponse(
    (r) => r.url().includes('/api/taste') && r.request().method() === 'PUT' && r.ok(),
  );
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const saved = await (await savePromise).json();
  expect(saved.taste.seedGenres).toContain('jazz');
});

test('onboarding: "Let\'s go" reveals the artist step for a fresh user', async ({ page }) => {
  await register(page);
  await page.addInitScript(() => localStorage.removeItem('quaver_onboarded'));
  await page.goto('/', { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: "Let's go" }).click();

  const tasteCard = page.locator('#onboarding-taste');
  await expect(tasteCard).toBeVisible();
  await expect(page.locator('#onboarding-welcome')).toBeHidden();

  const savePromise = page.waitForResponse(
    (r) => r.url().includes('/api/taste') && r.request().method() === 'PUT',
  );
  const input = tasteCard.locator('.tag-input');
  await input.fill('Frank Ocean');
  await input.press('Enter');
  await page.getByRole('button', { name: /save & continue/i }).click();
  const saved = await (await savePromise).json();
  expect(saved.taste.seedArtists).toContain('frank ocean');
});

test('results: "Start a mix from this" re-requests with a seedTrack', async ({ page }) => {
  await register(page);

  const fakeMix = {
    mood: 'happy',
    context: { mood: 'happy' },
    learning: { personalized: false },
    count: 1,
    songs: [
      {
        title: 'Test Song',
        artist: 'Test Artist',
        duration: '3:00',
        album_art: '',
        spotify_url: 'https://open.spotify.com/track/1234567890abcdefghijkl',
        recommendation_reasons: ['Fits your happy mood'],
      },
    ],
  };
  await page.route('**/api/music/recommend**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeMix) }),
  );
  await page.addInitScript(() => localStorage.setItem('quaver_onboarded', '1'));

  await page.goto('/', { waitUntil: 'networkidle' });

  await page.locator('#mood-select').selectOption('happy');
  await page.locator('#recommendation-form button[type="submit"]').click();

  const card = page.locator('.song-card').first();
  await expect(card).toBeVisible();
  await card.locator('.song-more-button').click();

  const seedRequest = page.waitForRequest(
    (r) => r.url().includes('/api/music/recommend') && r.url().includes('seedTrack=1234567890abcdefghijkl'),
  );
  await card.getByRole('button', { name: /start a mix from this/i }).click();
  await seedRequest;
});
