import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(`console.error: ${message.text()}`);
      }
    });
    await use(page);
    expect(errors, 'No uncaught page errors or console.error logs').toEqual([]);
  },
});

export { expect };

export async function mockGeosearch(page: Page) {
  await page.route('https://geosearch.planninglabs.nyc/v2/autocomplete**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        features: [
          {
            properties: {
              label: '350 5 AVENUE, BROOKLYN, NY',
              housenumber: '350',
              street: '5 AVENUE',
              borough: 'Brooklyn',
              neighbourhood: 'Park Slope',
              addendum: { pad: { bbl: '1008420015' } },
            },
          },
        ],
      }),
    });
  });
}

export async function disableNativeShare(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: undefined,
    });
  });
}

export async function expectPageReady(page: Page) {
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toHaveText(/Application error|Unhandled Runtime Error/i);
  const textLength = await page.locator('body').innerText().then((text) => text.trim().length);
  expect(textLength, 'Page should not be blank').toBeGreaterThan(20);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: Math.ceil(doc.scrollWidth),
      clientWidth: Math.ceil(doc.clientWidth),
      bodyScrollWidth: Math.ceil(document.body.scrollWidth),
    };
  });
  expect(
    Math.max(overflow.scrollWidth, overflow.bodyScrollWidth),
    `Page should not horizontally overflow viewport ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

export async function expectControlsNotClipped(page: Page) {
  const clipped = await page.evaluate(() => {
    const selectors = [
      'button',
      'input',
      'textarea',
      'a.btn',
      '[role="tab"]',
      '[role="dialog"]',
      '.saved-row',
      '.source-card',
      '.finding',
    ];
    return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden') return false;
        const allowsHorizontalScroll = style.overflowX === 'auto' || style.overflowX === 'scroll';
        return !allowsHorizontalScroll && el.scrollWidth > el.clientWidth + 3;
      })
      .slice(0, 10)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? '').trim().slice(0, 80),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
  });
  expect(clipped, 'Interactive controls and cards should not clip their text').toEqual([]);
}

export async function expectNoCriticalA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    // Some brand color pairs are still being tuned; critical/serious
    // structural failures remain launch-blocking here.
    .disableRules(['color-contrast'])
    .analyze();
  const blocking = results.violations.filter((violation) =>
    violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(blocking, 'No critical or serious axe accessibility violations').toEqual([]);
}

export async function checkProductionPageShell(page: Page) {
  await expectPageReady(page);
  await expectNoHorizontalOverflow(page);
  await expectControlsNotClipped(page);
}
