import { checkProductionPageShell, expect, test } from './support/test';

test.describe('deployed staging smoke', () => {
  test.skip(!process.env.E2E_BASE_URL, 'Set E2E_BASE_URL to run staging smoke checks.');

  test('@staging public launch-critical pages load on the deployed target', async ({ page }) => {
    for (const path of ['/', '/how-it-works', '/pricing', '/how-we-make-money', '/legal/privacy']) {
      await page.goto(path);
      await checkProductionPageShell(page);
    }
  });

  test('@staging auth gate and SEO endpoints respond on the deployed target', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/Sign in/i)).toBeVisible();

    const robots = await page.request.get('/robots.txt');
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toMatch(/User-agent/i);

    const sitemap = await page.request.get('/sitemap.xml');
    expect(sitemap.ok()).toBe(true);
    expect(await sitemap.text()).toMatch(/urlset|sitemap/i);
  });
});
