import { defineConfig } from '@playwright/test';

// Chromium préinstallé d'une autre version de Playwright (conteneurs cloud) :
// local=/opt/pw-browsers/chromium npm run test:e2e
const executablePath = process.env.PW_CHROMIUM || undefined;
// Port distinct pour faire tourner plusieurs suites en parallèle : PW_PORT=4180
const port = 4182;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
