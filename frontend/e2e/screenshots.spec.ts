import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './support/test';

// Manual screenshot capture for docs/screenshots (referenced from the README).
// Run with:
//   CAPTURE_SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts \
//     --project=chromium-desktop --project=mobile-chrome
// Env-guarded so the CI smoke and nightly matrix never execute it.
test.skip(!process.env.CAPTURE_SCREENSHOTS, 'screenshot capture is run manually');

test.use({ video: 'off', trace: 'off' });

const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'screenshots');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

test('home page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'desktop only');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'home.png') });
});

test('building report (demo data)', async ({ page }, testInfo) => {
  await page.goto('/building/1008420015');
  await expect(page.getByRole('heading', { name: /350 5th Ave/i })).toBeVisible();
  await expect(page.getByText(/Notable findings/i)).toBeVisible();
  await page.waitForTimeout(500);
  const suffix = testInfo.project.name === 'chromium-desktop' ? '' : '-mobile';
  await page.screenshot({
    path: path.join(OUT_DIR, `building-report${suffix}.png`),
    fullPage: testInfo.project.name === 'chromium-desktop',
  });
});
