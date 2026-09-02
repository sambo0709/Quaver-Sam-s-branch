import { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly loginButton: Locator;
  readonly logo: Locator;
  readonly headline: Locator;
  readonly selectMoodButton: Locator;
  readonly howManySongsButton: Locator;
  readonly surpriseMeButton: Locator;
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly letsGoButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.loginButton = page.getByRole('link', { name: /login/i });
    this.logo = page.getByText('Quaver');
    this.headline = page.getByText('How are you feeling?');
    this.selectMoodButton = page.locator('#mood-select');
    this.howManySongsButton = page.locator('#count-select');
    this.surpriseMeButton = page.getByText('Surprise Me');
    this.searchInput = page.getByPlaceholder('Song, artist, album...');
    this.searchButton = page.getByRole('button', { name: /search/i });
    this.letsGoButton = page.getByRole('button', { name: "Let's go" });
  }

  async goto() {
    await this.page.goto('/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
  }

  async dismissOverlay() {
    // Dismiss the onboarding overlay if it appears
    if (await this.letsGoButton.isVisible()) {
      await this.letsGoButton.click();
    }
  }
}
