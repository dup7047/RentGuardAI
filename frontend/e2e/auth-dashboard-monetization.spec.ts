import { checkProductionPageShell, expect, test } from './support/test';

test.describe('auth, dashboard, and monetization UI', () => {
  test('@smoke dashboard redirects anonymous users to login with context', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fdashboard|\/login\?redirectTo=\/dashboard/);
    await expect(page.getByText(/Sign in first to view your dashboard/i)).toBeVisible();
    await checkProductionPageShell(page);
  });

  test('login validates email and handles magic-link success in the mock auth service', async ({ page }) => {
    test.skip(Boolean(process.env.E2E_BASE_URL), 'Mock auth success runs only against local E2E backend.');
    await page.goto('/login');
    await page.getByRole('button', { name: /Use a magic link instead/i }).click();
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByRole('button', { name: /Email me a magic link/i }).click();
    await expect(page.getByLabel('Email address')).toHaveJSProperty('validity.valid', false);

    await page.getByLabel('Email address').fill('renter@example.com');
    await page.getByRole('button', { name: /Email me a magic link/i }).click();
    await expect(page.getByText(/Check renter@example.com/i)).toBeVisible();
  });

  test('invalid callback and redirect allow-list failures route back to login error UI', async ({ page }) => {
    await page.goto('/auth/callback?next=https://evil.example');
    await expect(page).toHaveURL(/\/login\?authError=callback/);
    await expect(page.getByText(/sign-in link could not be verified/i)).toBeVisible();

    await page.goto('/auth/confirm?token_hash=bad&type=email&redirect_to=https://evil.example');
    await expect(page).toHaveURL(/\/login\?authError=callback/);
  });

  test('@smoke forgot-password and reset-password pages render their form states', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: /Forgot your password/i })).toBeVisible();
    await checkProductionPageShell(page);

    await page.goto('/auth/reset-password');
    await expect(page.getByRole('heading', { name: /This link is no longer valid/i })).toBeVisible();
    await checkProductionPageShell(page);
  });

  test('affiliate disclosure modal logs before continue and preserves legal copy', async ({ page, context }) => {
    test.skip(Boolean(process.env.E2E_BASE_URL), 'Mock affiliate logging runs only against local E2E backend.');
    await page.goto('/how-we-make-money');
    await page.getByRole('button', { name: /Visit Lemonade/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/referral fee/i);
    await expect(dialog).toContainText(/editorial independence/i);
    const popupPromise = context.waitForEvent('page');
    await dialog.getByRole('button', { name: /Continue/i }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/lemonade\.com/);
    await popup.close();
  });
});
