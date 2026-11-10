import base from './playwright.config';
import { defineConfig } from '@playwright/test';

// Copie locale (non versionnée) : port propre à ce worktree.
const port = Number(process.env.PW_PORT || 4183);
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://localhost:${port}` },
  webServer: { ...base.webServer, command: `npm run build && npx vite preview --port ${port} --strictPort`, port },
});
