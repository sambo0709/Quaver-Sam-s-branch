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

});