import { defineConfig } from '@playwright/test';

// Chromium préinstallé d'une autre version de Playwright (conteneurs cloud) :
// PW_CHROMIUM=/opt/pw-browsers/chromium npm run test:e2e
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
