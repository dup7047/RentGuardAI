import {
  checkProductionPageShell,
  expect,
  expectNoCriticalA11yViolations,
  test,
} from './support/test';
import type { Locator, Page } from '@playwright/test';

const widths = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920] as const;
const keyboardProjects = new Set([
  'chromium-desktop',
  'firefox-desktop',
  'webkit-desktop',
  'edge-equivalent-chromium',
]);

async function tabUntilFocused(page: Page, locator: Locator, maxTabs = 12) {
  for (let i = 0; i <= maxTabs; i += 1) {
    const focused = await locator
      .evaluate((el) => document.activeElement === el)
      .catch(() => false);
    if (focused) return;
    await page.keyboard.press('Tab');
  }
  await expect(locator).toBeFocused();
}

test.describe('responsive visual regression guards', () => {
  test('key pages stay nonblank and overflow-free across launch breakpoints', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Breakpoint sweep runs once; device projects cover engines.');

    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      for (const path of ['/', '/building/1008420015', '/how-we-make-money', '/login']) {
        await page.goto(path);
        await checkProductionPageShell(page);
      }
    }
  });

  test('mobile and tablet orientations keep core flows visible', async ({ page }, testInfo) => {
    test.skip(
      !['mobile-safari', 'mobile-chrome', 'tablet-ipad'].includes(testInfo.project.name),
      'Orientation sweep is only relevant to mobile/tablet projects.',
    );

    const portrait = page.viewportSize() ?? { width: 390, height: 844 };
    const landscape = { width: portrait.height, height: portrait.width };
    for (const size of [portrait, landscape]) {
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: /Look up any NYC building/i })).toBeVisible();
      await checkProductionPageShell(page);

      await page.goto('/building/1008420015');
      await expect(page.getByRole('heading', { name: /350 5th Ave/i })).toBeVisible();
      await checkProductionPageShell(page);
    }
  });

  test('keyboard navigation reaches lookup, tabs, and modals without a mouse', async ({ page }, testInfo) => {
    test.skip(!keyboardProjects.has(testInfo.project.name), 'Hardware keyboard path runs on desktop browser profiles.');

    await page.goto('/');
    const input = page.getByLabel('NYC listing URL or address');
    await tabUntilFocused(page, input);
    await page.keyboard.type('350 5th Ave');
    const lookupButton = page.getByRole('button', { name: /Look up/i });
    if (testInfo.project.name === 'webkit-desktop') {
      await lookupButton.focus();
      await expect(lookupButton).toBeFocused();
    } else {
      await tabUntilFocused(page, lookupButton, 8);
    }

    await page.goto('/building/1008420015');
    await page.getByRole('tab', { name: /HPD violations/i }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Immediately hazardous heat condition/i)).toBeVisible();

    await page.getByRole('button', { name: /Share report/i }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /Share this report/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Share this report/i })).toBeHidden();
  });

  test('reduced-motion users still see stable loading UI', async ({ page }) => {
    test.skip(Boolean(process.env.E2E_BASE_URL), 'Mock slow lookup runs only against local E2E backend.');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByLabel('NYC listing URL or address').fill('slow 350 5th Ave');
    await page.getByRole('button', { name: /look up/i }).click();
    await expect(page.getByText(/Reading the listing & public records/i)).toBeVisible();
    await page.waitForURL(/\/building\/1008420015\?fresh=1/);
  });

  test('representative pages pass critical accessibility checks across engines', async ({ page }) => {
    for (const path of ['/', '/building/1008420015', '/login']) {
      await page.goto(path);
      await expectNoCriticalA11yViolations(page);
    }
  });
});
