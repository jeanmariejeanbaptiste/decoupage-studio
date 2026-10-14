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

## P3 — Saisie intelligente ✅
- [x] Popover de suggestions (préfixe puis sous-chaîne, sans accents, alias), ↑/↓ + Entrée/Tab
- [x] TokenInput angle / mouvement (virgule, « + » préservé, retour arrière, avertissement d'incompatibilité)
- [x] Focale « mm » verrouillée, dédoublement automatique « de … à … » si zoom, `to` conservé masqué
- [x] Info-bulle angle de champ horizontal + diagonal, équivalent plein format
- [x] Sujet ↔ personnages (reconnaissance + toast « Créer le personnage »)
- [x] Saisie tolérante du TC (cumulatif : override ✎ ; piste : plages et TOUT)
- [x] Tests Playwright `e2e/smart-input.spec.ts` (6 parcours)
- Note : l'ajout de termes personnalisés (Réglages → Vocabulaire) est livré avec la page Réglages (P8).

## P4 — Couverture & réordonnancement ✅
- [x] Lier / délier l'action (barre d'outils), cellule ACTION fusionnée « lié · n plans »
- [x] Glisser-déposer dnd-kit des plans (poignée 6 points) avec renumérotation en direct (document d'aperçu)
- [x] Glisser-déposer des séquences entières (poignée sur la cellule SÉQUENCE)
- [x] Garde-fou inter-séquences (modale + « Ne plus demander pour cette session »)
- [x] Scission automatique des blocs + toast « Annuler »
- [x] Tests : invariants unitaires après chaque opération (`ops.test.ts`) + `e2e/dnd.spec.ts` (7 parcours, invariants vérifiés via `window.__ds`)

## P5 — Persistance ✅
- [x] Dexie : tables `projects` et `blobs` ; sauvegarde automatique (débounce 600 ms) + indicateur manuscrit
- [x] Accueil : liste des projets (format, version, compteurs, date), suppression confirmée, démonstrations
- [x] Assistant « Nouveau projet » en 2 étapes (titre/format → minutage, avec aperçu « ce texte de n mots = m:ss »)
- [x] Fichier `.decoupage` : ⌘S (File System Access API, sinon téléchargement), ouverture (sélecteur natif ou `<input type=file>`), validation + migration
- [x] Bouton « Valider l'étape » (topbar) relié à `validatedSteps` et à la barre de progression
- [x] Tests : `serialize.test.ts` (aller-retour sans perte, migration, erreurs) + `e2e/persistence.spec.ts` (rechargement, aller-retour fichier)

## P6 — Export ✅
- [x] Vue `#/print` : thème Mauve (fond #C98BB4 + grain, titre Fraunces 800 SOFT, en-tête #DFA6D3, couleurs par colonne, ligne d'espacement), thèmes Papier et Sobre
- [x] PDF via `window.print()` (`#/print?auto=1`) : `@page` A4/A3 paysage, fond de page peint (`@page { background }`), séquence insécable (`tbody` + `break-inside: avoid`), en-tête répété, pied de page « titre · version · date · page x / y » (boîte de marge `@bottom-center`)
- [x] Excel (ExcelJS, chargé à la demande) : fusions, couleurs, polices, largeurs, ligne d'espacement, onglet « Registre » (testé)
- [x] CSV (une ligne par plan, `;`, BOM) et JSON (projet complet)
- [x] Import `.decoupage` / JSON / CSV-TSV avec assistant de correspondance des colonnes
- [x] Page « Exporter » : formats, thème, format de page, colonnes exportées (ordre, « ne jamais fusionner »)
- [x] Contrôle visuel §8.4 : `e2e/export.spec.ts` produit `test-results/export-rav3.png` et `test-results/export-rav3.pdf`

### Comparaison visuelle de l'export RAV3
La référence `docs/reference/export-decoupage.png` est absente du dépôt (voir DECISIONS.md) : la capture a été comparée point par point à la description du §8.2 et à la transcription du §12.
- Conforme : fusions colonne par colonne (identiques au test unitaire du seed), SÉQUENCE fusionnée sur toute la hauteur et centrée, N° jamais fusionné et en rouge, ACTION fusionnée par bloc, TC fusionné par valeur (« TOUT » sur 4-8 en séquence 2), couleurs (#111 / #C42B2B / #7A2E1F), FOCALE et TC en noir gras (TC italique), ligne d'espacement #DFA6D3 après chaque séquence, largeurs relatives du §8.2, titre Fraunces 800 #7A4E74.
- Pagination A4 : 3 pages (séquences 1-3, 4-6, 7) sans coupure, en-tête répété, pied de page numéroté.
- Écarts possibles non vérifiables sans l'image : hauteur exacte des lignes, graisse précise du titre, présence ou non du pied de page dans la référence (désactivable).

## P7 — Registre
## P8 — Minutage avancé
## P9 — Inspecteur & matériel
## P10 — Finitions DA
## P11 — Scénario & liaison
## P12 — Modèles de séquence
## P13 — Déploiement
