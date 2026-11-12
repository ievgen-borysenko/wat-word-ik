import { defineConfig } from '@playwright/test';

// End-to-end checks of the BUILT site (dist/), served by `vite preview`.
// Build first (`npm run build`); in CI the job unpacks the audited Pages artifact
// into dist/ instead of building again.
const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: ORIGIN,
    locale: 'en-GB',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `${ORIGIN}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
