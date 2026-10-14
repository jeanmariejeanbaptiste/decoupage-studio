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

## P7 — Registre ✅
- [x] Table générique triable / filtrable / éditable en ligne (`ui/DataTable`)
- [x] Séquences : n° (saut vers la grille), libellé, décor (création à la volée), INT/EXT, effet, personnages (puces + ajout manuel), plans, estimée (éditable), calculée, écart coloré, avancement
- [x] Personnages : nom, type, couleur, comédien·ne, compteurs, liste des séquences ; fusion des doublons par glisser-déposer ou menu (alias conservés)
- [x] Décors : nom, INT/EXT, adresse, séquences, durée totale à tourner
- [x] Plans : liste à plat filtrable (valeur, focale, mouvement, personnage, décor, statut, jour) + recherche
- [x] Tests : `registry.test.ts` + `e2e/registry.spec.ts` (4 parcours)

## P8 — Minutage avancé ✅
- [x] Page Réglages : projet, minutage (mode, granularité, coefficients, minimum) avec aperçu « ce texte de n mots = m:ss », capteur et recadrage, libellés et code des plans, vocabulaire personnalisé (valeurs / angles / mouvements)
- [x] Override manuel « ✎ » ; clic droit → « Revenir au calcul automatique » (menu contextuel)
- [x] Mode piste : import audio (IndexedDB), forme d'onde (canvas, pics normalisés), graduations, plages de toutes les actions, calage in/out par glisser, écoute de l'extrait, tête de lecture
- [x] Taux de couverture de la piste dans le pied de grille (plages fusionnées)
- [x] Tests : `waveform.test.ts` + `e2e/timing.spec.ts` (4 parcours, dont un WAV généré)

## P9 — Inspecteur & matériel ✅
- [x] Inspecteur repliable (ouvert par défaut au-delà de 1600 px) : code, séquence, décor, effet ; vignette storyboard (glisser / choisir, IndexedDB)
- [x] Angle de champ horizontal et diagonal, équivalent plein format, schéma en cône SVG (deux cônes pour un zoom)
- [x] Matériel déduit rangé par poste (Image, Machinerie, Lumière, Son) ; champs Son, Lumière, Notes de raccord, statut, jour
- [x] Pastilles de vérification dans la marge de la grille ; « ignorer ici » dans l'inspecteur
- [x] Page « Vérifications » (sidebar, compteur) : groupée par séquence, cliquable, ignorer / rétablir
- [x] Page « Listes de matériel » (étape 7) : agrégation par chef de poste, plans concernés cliquables, ajouts manuels, export CSV et PDF (impression)
- [x] Tests : `e2e/inspector.spec.ts` (3 parcours)

## P10 — Finitions DA ✅
- [x] Sidebar : avancement réel par étape (`domain/progress.ts`), coches sauge des étapes validées, compteurs Registre / Vérifications
- [x] Page « Note d'intention » (étape 1), états vides manuscrits partout
- [x] Thème « Encre » (lune / soleil, mémorisé), contraste des toasts adapté
- [x] Palette de commandes ⌘K (navigation, grille, fichier, affichage) et aide des raccourcis « ? »
- [x] Accessibilité : lien d'évitement, `role="grid"` + `aria-selected`, dialogues `aria-modal`, toasts `aria-live`, focus marine 2 px, libellés des boutons-icônes, `prefers-reduced-motion`
- [x] Revue visuelle : `da-truby.png` absente du dépôt ; revue faite contre la description du §11 (topbar fine, sidebar kraft 260 px à grain, numéros cerclés, entrée active en carte blanche, « bientôt » manuscrit, titres Cormorant avec chiffre en rouille, cartes à filet `--rule`)
- [x] Tests : `progress.test.ts` + `e2e/shell.spec.ts` (4 parcours)

## P11 — Scénario & liaison ✅
- [x] Analyseur Fountain (`domain/fountain.ts`) : page de titre, en-têtes (forcés « . »), personnages (« @ », extensions), dialogues, parenthèses, transitions, centré, sections, synopsis, sauts de page, commentaires ; positions dans la source
- [x] Synchronisation automatique (débounce 900 ms, appliquée aussi en quittant la page) : séquence par en-tête (libellé = lieu, INT/EXT, effet, décor), fiche par personnage parlant
- [x] Éditeur Fountain en Courier Prime avec surlignage des passages liés (fond calqué sous la zone de saisie) + vue « Page » formatée
- [x] Sélection → clic droit (ou bouton) « Créer un plan avec cette action » : plan dans la bonne séquence, action pré-remplie, répliques dans `dialogue` (« NOM : réplique »), sujet = personnage qui parle
- [x] Survol d'un plan (panneau latéral) → surligne son passage ; curseur dans un passage → surligne le plan ; l'inspecteur de la grille affiche le passage lié
- [x] Recalage des ancres quand le texte change ; import `.fountain`/`.txt`, export `.fountain`
- [x] Seed fiction doté d'un scénario ancré
- [x] Tests : `fountain.test.ts` (10) + `e2e/scenario.spec.ts` (5)

## P12 — Modèles de séquence ✅
- [x] `domain/templates.ts` : Documentaire (exposition → arrivée → action → plans de coupe → interview → beauty → fin), Interview institutionnelle, Clip performance (TOUT en mode piste), Clip narratif ; actions groupées en blocs liés
- [x] Menu « Modèle » dans la barre d'outils et dans l'état vide (modèles du format suggérés en premier) ; insertion après la séquence courante, annulable
- [x] Tests : vocabulaire strictement conforme au §5, structure, invariants (`templates.test.ts`) + `e2e/templates.spec.ts`

## P13 — Déploiement
