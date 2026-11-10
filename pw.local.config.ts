import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  use: { baseURL: 'http://localhost:4189', headless: true, viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  webServer: { command: 'npx vite preview --port 4189 --strictPort', port: 4189, reuseExistingServer: true, timeout: 120_000 },
});
