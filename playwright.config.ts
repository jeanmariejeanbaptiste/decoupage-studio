import { defineConfig } from '@playwright/test';

// Chromium préinstallé d'une autre version de Playwright (conteneurs cloud) :
// PW_CHROMIUM=/opt/pw-browsers/chromium npm run test:e2e
const executablePath = process.env.PW_CHROMIUM || undefined;
// Port du serveur de test (plusieurs copies de travail en parallèle : PW_PORT=4303).
const port = Number(process.env.PW_PORT) || 4173;

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
    // PW_REUSE=1 : un serveur déjà lancé sur ce port sert les tests (sans reconstruire).
    reuseExistingServer: !!process.env.PW_REUSE,
    timeout: 180_000,
  },
});
