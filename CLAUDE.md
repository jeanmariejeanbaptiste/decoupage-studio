# Découpage Studio — mémo de travail

Référence : `SPEC.md` (fait foi, ne jamais modifier). Avancement : `PROGRESS.md` (reprendre d'ici). Arbitrages : `DECISIONS.md`.

## Stack
Vite 5 + React 18 + TypeScript strict · Zustand + immer + zundo · Dexie (IndexedDB) · @dnd-kit · ExcelJS · lucide-react · CSS natif (tokens) + CSS Modules · Vitest + Playwright.

## Commandes
- `npm run dev` — serveur de dev
- `npm run test` — tests unitaires (Vitest) ; `npm run test:coverage` pour la couverture de `src/domain`
- `npm run test:e2e` — Playwright headless (build + preview sur :4173, Chromium préinstallé, Playwright 1.56.1)
- `npm run build` — typecheck + build de production
- `npm run lint`

## Conventions
- Interface en français, identifiants de code en anglais.
- Logique métier = fonctions pures dans `src/domain/`, testées (`*.test.ts` à côté du fichier).
- Numéros de séquence/plan toujours dérivés de l'ordre, jamais stockés.
- Routage par hash (`#/grid`, `#/print`…) pour GitHub Pages.
- Commits en français à l'impératif, un par sous-tâche significative. Jamais de force-push.
- Pas de Tailwind, pas de kit UI, pas d'emoji dans l'interface.
