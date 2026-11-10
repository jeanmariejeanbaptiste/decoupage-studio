import { defineConfig } from '@playwright/test';

// Configuration locale (non versionnée) : préversion déjà construite, servie sur le port 4184.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4184',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
  webServer: {
    command: 'npx vite preview --port 4184 --strictPort',
    port: 4184,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
