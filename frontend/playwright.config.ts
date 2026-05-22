import { defineConfig, devices } from '@playwright/test';

const MOCK_BACKEND_PORT = Number(process.env.E2E_MOCK_BACKEND_PORT ?? '18080');
const APP_PORT = Number(process.env.E2E_APP_PORT ?? '3100');
const mockBackendUrl = `http://127.0.0.1:${MOCK_BACKEND_PORT}`;
const localBaseUrl = `http://127.0.0.1:${APP_PORT}`;
const baseURL = process.env.E2E_BASE_URL ?? localBaseUrl;
const useExternalTarget = Boolean(process.env.E2E_BASE_URL);
const workers = Number(process.env.E2E_WORKERS ?? '1');

const localSupabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9' +
  '.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/e2e-junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: useExternalTarget
    ? undefined
    : [
        {
          command: `E2E_MOCK_BACKEND_PORT=${MOCK_BACKEND_PORT} tsx e2e/mock-backend.ts`,
          url: `${mockBackendUrl}/health`,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 180_000,
        },
        {
          command: `npm run build && next start --hostname 127.0.0.1 --port ${APP_PORT}`,
          url: localBaseUrl,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 180_000,
          env: {
            NEXT_PUBLIC_BACKEND_URL: mockBackendUrl,
            NEXT_PUBLIC_SUPABASE_URL: mockBackendUrl,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: localSupabaseAnonKey,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: localSupabaseAnonKey,
            NEXT_PUBLIC_AFFILIATE_ENABLED: 'true',
          },
        },
      ],
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'firefox-desktop',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'edge-equivalent-chromium',
      use: {
        ...devices['Desktop Edge'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 14'],
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
      },
    },
    {
      name: 'tablet-ipad',
      use: {
        ...devices['iPad Pro 11'],
      },
    },
  ],
});
