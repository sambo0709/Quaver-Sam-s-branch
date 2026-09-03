import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';

test.describe('Quaver Homepage', () => {

  test('homepage loads and has correct title', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await expect(page).toHaveTitle(/Quaver/, { timeout: 60000 });
  });

  test('displays headline and subtitle', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await expect(homePage.headline).toBeVisible();
    await expect(page.getByText('Pick your mood')).toBeVisible();
  });

  test('shows all mood selection controls', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await expect(homePage.selectMoodButton).toBeVisible();
    await expect(homePage.howManySongsButton).toBeVisible();
    await expect(homePage.surpriseMeButton).toBeVisible();
  });

  test('shows global search in the desktop navigation', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await expect(homePage.searchInput).toBeVisible();
    await expect(homePage.searchButton).toBeVisible();
  });

  test('login button is visible in nav', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();
    await expect(homePage.loginButton).toBeVisible();
  });

});
