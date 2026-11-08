# Découpage Studio — mémo de travail

Référence : `SPEC.md` (fait foi, ne jamais modifier). Avancement : `PROGRESS.md` (reprendre d'ici). Arbitrages : `DECISIONS.md`.

## Stack
Vite 5 + React 18 + TypeScript strict · Zustand + immer + zundo · Dexie (IndexedDB) · @dnd-kit · ExcelJS · lucide-react · CSS natif (tokens) + CSS Modules · Vitest + Playwright.

## Commandes
- `npm run dev` — serveur de dev
- `npm run test` — tests unitaires (Vitest) ; `npm run test:coverage` pour la couverture de `src/domain`
- `npm run test:e2e` — Playwright headless (build + preview sur :4173, Playwright 1.56.1) ; dans un conteneur dont le Chromium préinstallé diffère : `PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test --trace off`
- `npm run build` — typecheck + build de production
- `npm run lint`

## Conventions
- Interface en français, identifiants de code en anglais.
- Logique métier = fonctions pures dans `src/domain/`, testées (`*.test.ts` à côté du fichier).
- Numéros de séquence/plan toujours dérivés de l'ordre, jamais stockés.
- Routage par hash (`#/grid`, `#/print`…) pour GitHub Pages.
- Commits en français à l'impératif, un par sous-tâche significative. Jamais de force-push.
- Pas de Tailwind, pas de kit UI, pas d'emoji dans l'interface.

## Préférences de l'utilisateur (durables, prioritaires)
- Répondre en français, style élégant ; ne jamais imiter sa façon d'écrire. Réponses courtes, économes en tokens.
- Aucun artefact, fichier de présentation ou mise en page coûteuse sans son accord : texte simple par défaut, proposer le reste.
- Design : uniquement noir, gris, blanc (pas de bleu ni de couleur d'accent). Une seule police : Inter. Icônes au trait, fines.
- Minimaliste et ergonomique : pas d'astuces, de tutoriels, de textes d'aide ni de toasts inutiles ; pas de doublons dans l'interface (libellés, menus, titres qui se répètent).
- Ne pas appliquer bêtement une demande : penser aux interdépendances (format ↔ minutage ↔ colonnes ↔ modèles ↔ exports), être force de proposition, s'auto-relire et corriger avant de livrer.
- Publier = pousser sur `main` (GitHub Pages). Tester avant (tsc, lint, vitest, e2e concernés). Les tags git ne passent pas (403), c'est accepté.

## Architecture récente (v2.4.0)
- Coquille : `features/shell` (Topbar + ProjectMenu, Sidebar groupée et réductible, SettingsPage en brouillon, Account pour Google).
- Scénario : `domain/screenplay.ts` (blocs typés ↔ Fountain, positions), `features/scenario/ScriptEditor.tsx` (pages A4, saisie) ; `ScriptReader` reste le lecteur actif du panneau du découpage.
- Dépouillement : `domain/tagging.ts` + `features/breakdown/SceneText.tsx`.
- Découpage : `GridPage` porte les vues Tableau / Storyboard / Aperçu ; `grid/CutExport.tsx` = export unique.
- Assistant : `domain/aiTools.ts` (outils), `features/assistant` (fournisseurs, conversation, panneau).
- Google Drive : `store/cloud.ts` (dormant sans `VITE_GOOGLE_CLIENT_ID`, variable de dépôt `GOOGLE_CLIENT_ID` lue par deploy.yml).

## Chantiers en cours (au 8 nov. 2026, v2.4.0)
- Sauvegarde cloud facultative via Google Drive : code livré et testé en simulation. En attente : l'ID client OAuth que l'utilisateur doit créer (origine `https://jeanmariejeanbaptiste.github.io`), à placer dans la variable de dépôt `GOOGLE_CLIENT_ID`.
- Points d'audit encore ouverts : temps du plan-séquence ignorés (matériel, personnages, contrôles, minutage) ; éditeur de chorégraphie (une annulation par frappe) ; export des plans au sol (portes rendues comme fenêtres) ; images orphelines jamais nettoyées ; pincement Safari dans le dessin ; pied de page @page sous Safari.
- Partage invité : la copie conservée garde l'identifiant du projet de l'hôte ; proposer d'en faire un projet distinct si besoin.
- Reportés (proposés, jamais faits, à soumettre à l'utilisateur) : recherche / filtres / « aller au plan n° » dans la grille ; numéros figés après impression avec plans bis (1.2A) ; colonnes Séquence et N° figées au défilement horizontal ; bloc « raccords » pour la scripte ; partage via serveur hébergé (aujourd'hui PeerJS public) ; cellules « 〃 » affichées en entier ; retirer le champ Lumière de l'Inspecteur (colonne retirée) ; lier l'action sur téléphone (sélection multiple) ; créneau B-roll relié au Plan de travail ; deux adresses pour un même décor dans une journée ; vérification Google de l'app OAuth.
- Jamais vérifié : Safari (impression, export, pincement du plan au sol) — tests sous Chromium uniquement.
- Historique complet des demandes : fichier `decoupage-studio-historique.md` fourni par l'utilisateur en pièce jointe (hors dépôt).
