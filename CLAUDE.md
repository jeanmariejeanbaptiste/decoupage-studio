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

## Architecture récente (v2.5.0)
- Coquille : `features/shell` (Topbar + ProjectMenu, Sidebar groupée et réductible, SettingsPage en brouillon, Account pour Google).
- Scénario : `domain/screenplay.ts` (blocs typés ↔ Fountain, « @ » seul = réplique sans personnage), `domain/scriptLayout.ts` (gabarit du modèle KIT : Courier Prime, 58 lignes, pagination ; sert l'éditeur et tous les exports, tests ligne à ligne sur `src/domain/__fixtures__/kit`), `domain/fdx.ts` (Final Draft), `features/scenario/ScriptEditor.tsx` (pages de l'export à l'écran, lignes de 16 px), `scriptExport.ts` (PDF texte pdf-lib, images, .docx). `ScriptReader` reste le lecteur du panneau du découpage.
- Note d'intention : `domain/richText.ts` (HTML réduit et nettoyé), `features/intention/RichEditor.tsx` (pages A4, ruban, barre d'état, annulation propre), `noteExport.ts` ; `intentionHtml` + `intention` (texte brut tenu à jour).
- Dépouillement : `domain/tagging.ts` + `features/breakdown/SceneText.tsx`.
- Découpage : `GridPage` porte les vues Tableau / Storyboard et la bascule Aperçu (tableau ou planches) ; `grid/CutExport.tsx` = export unique.
- Plan au sol : `domain/floorSymbols.ts` (projecteur, caméra, rails : mêmes tracés écran / export), `features/floorplan/icons.tsx`.
- Assistant : `domain/aiTools.ts` (outils), `features/assistant` (fournisseurs, `askWithImage` pour la vision, raccourcis `quickActions.ts`, conversation, panneau).
- Google Drive : `store/cloud.ts` (dormant sans `VITE_GOOGLE_CLIENT_ID`, variable de dépôt `GOOGLE_CLIENT_ID` lue par deploy.yml).

## Chantiers en cours (au 8 nov. 2026, v2.5.0)
- Sauvegarde cloud facultative via Google Drive : code livré et testé en simulation. En attente : l'ID client OAuth que l'utilisateur doit créer (origine `https://jeanmariejeanbaptiste.github.io`), à placer dans la variable de dépôt `GOOGLE_CLIENT_ID` (guide pas à pas donné le 8 nov.).
- Points d'audit encore ouverts (Safari, jamais vérifié) : pincement du trackpad dans l'éditeur de dessin, pied de page @page à l'impression navigateur, mémoire des captures très longues. Les contrôles de la scripte et le minutage ignorent encore les temps d'un plan-séquence (seuls personnages et matériel les comptent).
- Partage invité : la copie conservée garde l'identifiant du projet de l'hôte ; proposer d'en faire un projet distinct si besoin.
- Inspirations des captures (rapports d'analyse du 8 nov.) encore à proposer : typographie française automatique (espaces fines), sommaire triable et recherche dans le scénario, versions et comparaison, présence des personnages ; feuille de service complète (PAT, repas, lever / coucher du soleil, urgences, figuration à part, consignes par poste, J+1, équipe, version) ; découpage : tout replier, masquer les séquences vides, « Ajouter plusieurs plans », jour de tournage sur les cartes ; plan au sol : types de projecteur (Fresnel, LED, HMI, tube, ballon), échelle réelle et gabarits de pièce, liste du plateau qui alimente le matériel ; registre : colonnes calculées (1er jour, jours). Gris de l'interface légèrement bleutés (#111318, #6b7079) : à neutraliser si l'utilisateur le souhaite.
- Reportés (proposés, jamais faits, à soumettre à l'utilisateur) : numéros figés après impression avec plans bis (1.2A) ; colonnes Séquence et N° figées au défilement horizontal ; bloc « raccords » pour la scripte ; partage via serveur hébergé (aujourd'hui PeerJS public) ; cellules « 〃 » affichées en entier ; retirer le champ Lumière de l'Inspecteur (colonne retirée) ; lier l'action sur téléphone (sélection multiple) ; créneau B-roll relié au Plan de travail ; deux adresses pour un même décor dans une journée ; vérification Google de l'app OAuth.
- Jamais vérifié : Safari (impression, export, pincement du plan au sol) — tests sous Chromium uniquement.
- Historique complet des demandes : fichier `decoupage-studio-historique.md` fourni par l'utilisateur en pièce jointe (hors dépôt).
