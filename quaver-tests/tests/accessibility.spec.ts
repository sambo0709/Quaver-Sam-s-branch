import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function mockAppData(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('quaver_onboarded', '1');
    localStorage.setItem('quaver_user', JSON.stringify({ username: 'Accessibility Listener', email: 'listener@example.com', profileImage: '' }));
  });
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return route.fulfill({ json: { username: 'Accessibility Listener', email: 'listener@example.com', profileImage: '' } });
    if (pathname === '/api/auth/settings') return route.fulfill({ json: { username: 'Accessibility Listener', profileImage: '', defaultTheme: 'dark', preferences: {} } });
    if (pathname === '/api/playlist') return route.fulfill({ json: { playlists: [] } });
    if (pathname === '/api/mood/history') return route.fulfill({ json: { moods: [] } });
    if (pathname === '/api/listening/history') return route.fulfill({ json: { plays: [] } });
    if (pathname === '/api/music/sotd') return route.fulfill({ json: { mood: 'calm', count: 1, songs: [] } });
    if (pathname === '/api/music/trending') return route.fulfill({ json: { moods: [] } });
    if (pathname === '/api/music/recommend') return route.fulfill({ json: { songs: [] } });
    return route.fulfill({ json: {} });
  });
}

async function expectNoWcagViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, results.violations.map(violation => {
    return violation.id + ': ' + violation.nodes.map(node => node.target.join(' ')).join(', ');
  }).join('\n')).toEqual([]);
}

for (const entry of [
  { name: 'Home', path: '/' },
  { name: 'Search', path: '/search.html' },
  { name: 'Playlists', path: '/playlists.html' },
  { name: 'Profile', path: '/profile.html' },
  { name: 'Settings', path: '/settings.html' },
]) {
  test(entry.name + ' has no automated WCAG A/AA violations', async ({ page }) => {
    await mockAppData(page);
    await page.goto(entry.path);
    await expect(page.locator('main')).toBeVisible();
    await expectNoWcagViolations(page);
  });
}
