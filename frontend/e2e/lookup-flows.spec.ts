import {
  checkProductionPageShell,
  expect,
  mockGeosearch,
  test,
} from './support/test';

test.describe('lookup flow with mocked backend fixtures', () => {
  test.skip(Boolean(process.env.E2E_BASE_URL), 'Mock lookup flows run only against the local E2E backend.');

  test('@smoke address lookup streams phases, redirects, and renders a report', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('NYC listing URL or address').fill('slow 350 5th Ave');
    await page.getByRole('button', { name: /look up/i }).click();
    await expect(page.getByText(/Reading the listing & public records/i)).toBeVisible();
    await expect(page.getByText(/Parsing your input/i)).toBeVisible();
    await page.waitForURL(/\/building\/1008420015\?fresh=1/);
    await expect(page.getByRole('heading', { name: /350 5th Ave/i })).toBeVisible();
    await expect(page.getByText(/AI BUILDING SUMMARY/i)).toBeVisible();
    await checkProductionPageShell(page);
  });

  test('@smoke autocomplete selection forwards the picked BBL', async ({ page }) => {
    await mockGeosearch(page);
    await page.goto('/');
    await page.getByLabel('NYC listing URL or address').fill('350 5 ave');
    await expect(page.getByRole('option', { name: /350 5 Avenue/i })).toBeVisible();
    await page.getByRole('option', { name: /350 5 Avenue/i }).click();
    await page.waitForURL(/\/building\/1008420015\?fresh=1/);
    await expect(page.getByText(/BBL 1008420015/i)).toBeVisible();
  });

  test('listing URL blocked fallback accepts address and shows building-only notice', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('NYC listing URL or address').fill('https://streeteasy.com/blocked-listing');
    await page.getByRole('button', { name: /look up/i }).click();
    await expect(page.getByText(/behind bot protection/i)).toBeVisible();
    await page.getByRole('textbox', { name: /^Address$/ }).fill('350 5th Ave, New York, NY');
    await page.getByLabel(/Listing description/i).fill('No broker fee. Sunny apartment.');
    await page.getByRole('button', { name: /continue with address/i }).click();
    await page.waitForURL(/\/building\/1008420999\?fresh=1/);
    await expect(page.getByText(/LISTING DATA UNAVAILABLE/i)).toBeVisible();
  });

  test('ambiguous and outside-NYC takeover states are usable', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('NYC listing URL or address').fill('ambiguous main street');
    await page.getByRole('button', { name: /look up/i }).click();
    await expect(page.getByRole('heading', { name: /Pick the right address/i })).toBeVisible();
    await page.getByRole('button', { name: /Generate report/i }).click();
    await page.waitForURL(/\/building\/1008420015\?fresh=1/);

    await page.goto('/');
    await page.getByLabel('NYC listing URL or address').fill('outside philadelphia');
    await page.getByRole('button', { name: /look up/i }).click();
    await expect(page.getByRole('heading', { name: /Outside our coverage/i })).toBeVisible();
    await page.getByLabel(/Email address for waitlist/i).fill('renter@example.com');
    await page.getByRole('button', { name: /Notify me/i }).click();
    await expect(page.getByText(/You're on the list/i)).toBeVisible();
  });

  test('error, quota, email-gate, and malformed stream states render instead of blanking', async ({ page }) => {
    const cases = [
      { input: 'https://streeteasy.com/expired-listing', text: /listing has expired/i },
      { input: 'https://streeteasy.com/missing-listing', text: /removed or is no longer active/i },
      { input: 'https://unsupported.example/listing', text: /don't recognize that site/i },
      { input: 'rate limit address', text: /Too many lookups/i },
      { input: 'cost cap address', text: /free cap/i },
      { input: 'server error address', text: /server error/i },
      { input: 'malformed stream address', text: /valid NYC address or listing URL/i },
      { input: 'incomplete stream address', text: /valid NYC address or listing URL/i },
    ];

    for (const entry of cases) {
      await page.goto('/');
      await page.getByLabel('NYC listing URL or address').fill(entry.input);
      await page.getByRole('button', { name: /look up/i }).click();
      await expect(page.getByText(entry.text)).toBeVisible();
      await checkProductionPageShell(page);
    }

    await page.goto('/');
    await page.getByLabel('NYC listing URL or address').fill('email gate address');
    await page.getByRole('button', { name: /look up/i }).click();
    await expect(page.getByText(/Drop your email/i)).toBeVisible();
    await page.getByLabel('Email address').fill('renter@example.com');
    await page.getByRole('button', { name: /^Continue$/i }).click();
    await page.waitForURL(/\/building\/1008420015\?fresh=1/);
  });
});
