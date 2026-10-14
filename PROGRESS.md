# Avancement — Découpage Studio

> Mémoire de travail. Reprendre uniquement depuis ce fichier.

## P0 — Fondations ✅
- [x] Configuration Vite/React/TS strict, ESLint, Prettier, Vitest, Playwright
- [x] Polices @fontsource, tokens.css, paper.css
- [x] Coquille : topbar + sidebar kraft + zone principale
- [x] CLAUDE.md, PROGRESS.md, DECISIONS.md

## P1 — Domaine pur ✅
- [x] Types §3 + ColumnKey + mergeBreak
- [x] vocabulary.ts + recherche de suggestions
- [x] timecode (parse / format)
- [x] durées, plages, couverture piste
- [x] numérotation dérivée
- [x] computeMerges + test seed RAV3
- [x] normalisation des jetons
- [x] equipment.ts
- [x] lint (contrôles §9)
- [x] couverture ≥ 90 %
- Couverture `src/domain` : 99 % lignes, 90,8 % branches (102 tests).

## P2 — Grille éditable ✅
- [x] Store Zustand + immer + zundo
- [x] Rendu séquences/plans, fusion SÉQUENCE, séparateurs
- [x] Édition des cellules + navigation clavier
- [x] Ajout/suppression plans et séquences, toasts
- [x] Aperçu 〃 + vue impression
- [x] Pied de total
- [x] Test Playwright 2 × 5 au clavier
- Test Playwright `e2e/grid.spec.ts` : 2 séquences × 5 plans saisis au clavier seul ; suppression / annulation / rétablissement.

## P3 — Saisie intelligente
## P4 — Couverture & réordonnancement
## P5 — Persistance
## P6 — Export
## P7 — Registre
## P8 — Minutage avancé
## P9 — Inspecteur & matériel
## P10 — Finitions DA
## P11 — Scénario & liaison
## P12 — Modèles de séquence
## P13 — Déploiement
