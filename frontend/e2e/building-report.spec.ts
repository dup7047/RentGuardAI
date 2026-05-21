import {
  checkProductionPageShell,
  disableNativeShare,
  expect,
  expectNoCriticalA11yViolations,
  test,
} from './support/test';

test.describe('building report UI states', () => {
  test.skip(Boolean(process.env.E2E_BASE_URL), 'Mock report states run only against the local E2E backend.');

  test('@smoke report tabs, source links, share modal, and anonymous save gate work', async ({ page }) => {
    await disableNativeShare(page);
    await page.goto('/building/1008420015');
    await expect(page.getByRole('heading', { name: /350 5th Ave/i })).toBeVisible();
    await expect(page.getByText(/Notable findings/i)).toBeVisible();

    await page.getByRole('tab', { name: /HPD violations/i }).click();
    await expect(page.getByRole('heading', { name: /HPD violations/i })).toBeVisible();
    await expect(page.getByText(/Immediately hazardous heat condition/i)).toBeVisible();

    await page.getByRole('tab', { name: /DOB & 311/i }).click();
    await expect(page.getByRole('heading', { name: /DOB complaints/i })).toBeVisible();
    await expect(page.getByText(/HEAT\/HOT WATER/i)).toBeVisible();

    await page.getByRole('tab', { name: /Owner & watchlist/i }).click();
    await expect(page.getByText(/TEST OWNER LLC/i)).toBeVisible();

    await page.getByRole('tab', { name: /Sources/i }).click();
    await expect(page.getByText(/Sources for this building/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /View on source/i })).toHaveCount(6);

    await page.getByRole('button', { name: /Share report/i }).click();
    await expect(page.getByRole('dialog', { name: /Share this report/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Share this report/i })).toBeHidden();

    await page.getByRole('button', { name: /Save building/i }).click();
    await expect(page.getByRole('dialog', { name: /Sign in to save buildings/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await checkProductionPageShell(page);
  });

  test('empty and missing-data report does not hide key sections', async ({ page }) => {
    await page.goto('/building/1000000000');
    await expect(page.getByRole('heading', { name: /1 Empty Row Way/i })).toBeVisible();
    await page.getByRole('tab', { name: /HPD violations/i }).click();
    await expect(page.getByText(/No HPD violations on file/i)).toBeVisible();
    await page.getByRole('tab', { name: /DOB & 311/i }).click();
    await expect(page.getByText(/No complaints on file/i)).toBeVisible();
    await expect(page.getByText(/No 311 calls on file/i)).toBeVisible();
    await page.getByRole('tab', { name: /Owner & watchlist/i }).click();
    await expect(page.getByText(/Not on the current list/i)).toBeVisible();
    await checkProductionPageShell(page);
  });

  test('large result sets surface has-more copy and stay scroll-contained', async ({ page }) => {
    await page.goto('/building/1009999999');
    await page.getByRole('tab', { name: /HPD violations/i }).click();
    await expect(page.getByText(/Showing 18 of 140/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /View all on HPD Online/i })).toBeVisible();
    await page.getByRole('tab', { name: /DOB & 311/i }).click();
    await expect(page.getByText(/Showing 1 of 51/i)).toBeVisible();
    await checkProductionPageShell(page);
  });

  test('report page passes critical accessibility checks', async ({ page }) => {
    await page.goto('/building/1008420015');
    await expectNoCriticalA11yViolations(page);
  });
});
