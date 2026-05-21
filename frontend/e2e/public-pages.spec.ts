import {
  checkProductionPageShell,
  expect,
  expectNoCriticalA11yViolations,
  test,
} from './support/test';

const publicPages = [
  { path: '/', text: /Look up any NYC building/i },
  { path: '/lookup', text: /Look up any NYC building/i },
  { path: '/how-it-works', text: /How RentGuard works/i },
  { path: '/pricing', text: /Pricing/i },
  { path: '/coverage', text: /Coverage/i },
  { path: '/for-landlords', text: /For landlords/i },
  { path: '/how-we-make-money', text: /How RentGuard pays the bills/i },
  { path: '/legal/disclaimer', text: /disclaimer/i },
  { path: '/legal/privacy', text: /privacy/i },
  { path: '/legal/terms', text: /terms/i },
];

test.describe('public pages', () => {
  for (const { path, text } of publicPages) {
    test(`@smoke renders ${path} without console errors, blank content, or layout overflow`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('body')).toContainText(text);
      await checkProductionPageShell(page);
    });
  }

  test('@smoke robots.txt and sitemap.xml are reachable', async ({ page }) => {
    const robots = await page.request.get('/robots.txt');
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toMatch(/User-agent/i);

    const sitemap = await page.request.get('/sitemap.xml');
    expect(sitemap.ok()).toBe(true);
    expect(await sitemap.text()).toMatch(/urlset|sitemap/i);
  });

  test('homepage, report disclosure page, and monetization page pass critical accessibility checks', async ({ page }) => {
    for (const path of ['/', '/legal/disclaimer', '/how-we-make-money']) {
      await page.goto(path);
      await expectNoCriticalA11yViolations(page);
    }
  });
});
