# Découpage Studio — mémo de travail

Référence : `SPEC.md` (fait foi, ne jamais modifier). Avancement : `PROGRESS.md` (reprendre d'ici). Arbitrages : `DECISIONS.md`.

## Stack
Vite 5 + React 18 + TypeScript strict · Zustand + immer + zundo · Dexie (IndexedDB) · @dnd-kit · ExcelJS · pdf-lib (+ fontkit) · qrcode-generator · lucide-react · CSS natif (tokens) + CSS Modules · Vitest + Playwright.

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

## Architecture récente (v2.9.0)
- Coquille : `features/shell` (Topbar + ProjectMenu, Sidebar groupée et réductible, SettingsPage en brouillon, Account pour Google).
- Scénario : `domain/screenplay.ts` (blocs typés ↔ Fountain, « @ » seul = réplique sans personnage), `domain/scriptLayout.ts` (gabarit du modèle KIT : Courier Prime, 58 lignes, pagination ; sert l'éditeur et tous les exports, tests ligne à ligne sur `src/domain/__fixtures__/kit`), `domain/fdx.ts` (Final Draft), `features/scenario/ScriptEditor.tsx` (pages de l'export à l'écran, lignes de 16 px), `scriptExport.ts` (PDF texte pdf-lib, images, .docx). `ScriptReader` reste le lecteur du panneau du découpage.
- Note d'intention : `domain/richText.ts` (HTML réduit et nettoyé), `features/intention/RichEditor.tsx` (pages A4, ruban, barre d'état, annulation propre), `noteExport.ts` ; `intentionHtml` + `intention` (texte brut tenu à jour).
- Minutage du scénario : `domain/chronometry.ts` (pages / caractères / type, réglage `scriptChrono`) ; marques d'emphase et surlignage `[[=couleur]]` dans `scriptLayout.ts`, jamais imprimés.
- Production : `domain/schedule.ts` (jours, bandes, bandeaux, cascade), `domain/registry.ts` (numéros, 1er jour), `domain/locations.ts` (lieux de tournage), `domain/production.ts` + `productionChart.ts` + `features/production` (calendrier de production en Gantt, tournage lié au plan de travail), `features/calendar` (calendrier Jour / Semaine / Mois / Année).
- Carte : `domain/geo.ts` (géocodage Nominatim gardé dans `doc.geocodes`, cadrage de la carte imprimée), `features/map` (Leaflet en gris, `staticMap.ts` pour l'export de la feuille de service).
- Comparaison des versions : `domain/scriptDiff.ts` (séquences, blocs, mots ; seul le texte imprimé), `domain/scriptDiffLayout.ts` (PDF), `features/versions/ComparePage.tsx` (`#/scenario?compare=A~B`, invités : versions publiées seulement).
- Versions du film (V1, V2…) : `domain/versions.ts` (la courante vit dans le doc ; les autres figées dans `doc.versions[].slice` : scénario, séquences, plans, actions ; même identifiants, la préparation est commune), `domain/sceneAlign.ts` (rapprochement des scènes : lieu, texte en triplets, personnages, ordre), `domain/revision.ts` (nouveau texte → découpage suivi), `features/versions` (sélecteur dans Scénario et Découpage, marques de révision). Ne jamais effacer la préparation d'une séquence ou d'un plan qu'une autre version garde (`keptElsewhere` dans ops).
- Relecture : `domain/comments.ts` (commentaires par version, ancres scénario / cellule / séquence), `features/comments` (bulle, fenêtre ouverte depuis le menu des versions, marques de l'aperçu) ; partage en mode « Commenter » (`store/share.ts`, seuls les commentaires passent).
- Dépouillement : `domain/tagging.ts` + `features/breakdown/SceneText.tsx`.
- Découpage : `GridPage` porte les vues Tableau / Storyboard et la bascule Aperçu (tableau ou planches) ; `grid/CutExport.tsx` = export unique.
- Plan au sol : pièce et cotes dans `domain/floorplan.ts` (`setRoom`, `roomDimensions`, `ROOM_LIMITS`) ; `domain/floorSymbols.ts` (projecteur, caméra, rails : mêmes tracés écran / export), `features/floorplan/icons.tsx`.
- Assistant : `domain/aiTools.ts` (outils), `features/assistant` (fournisseurs, `askWithImage` pour la vision, raccourcis `quickActions.ts`, conversation, panneau).
- Interview dans le découpage : `domain/interview.ts` (placeSetup, setSetupNumber, syncInterviewShots appelé dans `projectStore.mutate`), plans liés par `Shot.interview`, numéros 3A/3B (`domain/numbering.ts`).
- Rapports du scénario : `domain/scriptReports.ts` ; panneaux `features/scenario/ResearchPanels.tsx` ; page de garde détectée à l'import (`detectTitlePage`).
- Google Drive : `store/cloud.ts` (dormant sans `VITE_GOOGLE_CLIENT_ID`, variable de dépôt `GOOGLE_CLIENT_ID` lue par deploy.yml).
- Relecture en ligne (Drive) : `domain/reviewSnapshot.ts`, `reviewMerge.ts`, `reviewTrailer.ts`, `store/review.ts`, `store/reviewDrive.ts`, `features/review` (route `review`) ; variables `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID`.

## Chantiers en cours (au 10 nov. 2026, v2.9.0)
- Google Drive (synchronisation et relecture en ligne) : code prêt ; l'utilisateur doit créer l'ID client OAuth, la clé d'API restreinte et noter le numéro du projet, puis les mettre dans les variables de dépôt `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID`.
- Ouvert : numéro de page de l'éditeur au-delà du PDF sur un scénario annoté (notes comptées à l'écran).
- Production, suite possible : réordonner les séquences dans un jour, horaire par plan, lieu commun à plusieurs décors, programme par poste.
- Ouverts (Safari jamais vérifié) : pincement du trackpad dans le dessin, pied de page @page, captures très longues.
- Reportés (à proposer) : numéros figés avec plans bis, colonnes figées au défilement, raccords pour la scripte, partage via serveur hébergé, mode révision du scénario.
- Toujours vérifier les deux thèmes (captures clair et sombre) avant de pousser ; ne jamais pousser si un test échoue.
