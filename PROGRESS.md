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

## P13 — Déploiement ✅
- [x] `.github/workflows/deploy.yml` : tests + build (`BASE_PATH` configurable, `/<dépôt>/` par défaut) → GitHub Pages ; `404.html` de secours
- [x] `.github/workflows/ci.yml` : lint, tests unitaires, build, Playwright sur chaque PR
- [x] PWA : manifeste, icônes (dont masquable), service worker (réseau d'abord pour les pages, cache d'abord pour les ressources) → hors ligne et installable
- [x] README illustré en français (`docs/screenshots/*.jpg`)

## §15 — Si tu as encore du temps
- [x] §15.1 Storyboard : cartes par séquence (vignette 16:9, code, valeur · focale · mouvement, sujet, action, durée), réordonnables (dnd-kit, garde-fou inter-séquences), dépôt d'image sur le cadre, planche PDF 2 / 4 / 6 par page (`e2e/storyboard.spec.ts`)
- [x] §15.2 Plan au sol : éditeur SVG par séquence (grille aimantée, caméras avec cône calculé depuis la focale du plan lié et le capteur, comédiens numérotés liés aux personnages avec déplacement fléché, murs, rails, portes, fenêtres, sources de lumière ; déplacer, pivoter, supprimer au clavier) ; caméras liées aux plans, rappel dans l'inspecteur (`floorplan.test.ts`, `e2e/floorplan.spec.ts`)
- [x] §15.3 Plan de travail : bandes par jour (couleurs INT/EXT × JOUR/NUIT), glisser une séquence d'un jour à l'autre, affectation plan par plan, dates, statistiques par jour (plans, durée d'écran, décors), suggestion automatique décor → comédiens → axes avec capacité réglable (`schedule.test.ts`, `e2e/schedule.spec.ts`)
- [x] §15.4 Feuille de service : jour choisi, rendez-vous, décors et adresses, convocations par personnage, plans du jour, matériel requis par poste, notes, export PDF (A4 portrait)
- [x] §15.5 Dépouillement : par séquence, 10 catégories (personnages et figurants déduits, accessoires, costumes, maquillage, effets, véhicules, machinerie / lumière / son déduits du matériel) ; détection lexicale dans actions, dialogues et sujets, ajout en un clic ou « Tout ajouter » (`breakdown.test.ts`, `e2e/breakdown.spec.ts`)
- [x] §15.6 Assistant IA facultatif : clé API saisie dans les Réglages, gardée en localStorage (jamais dans le projet ni l'export) ; « Proposer » un découpage de départ pour la séquence courante via le SDK officiel (`@anthropic-ai/sdk`, chargé à la demande, modèle `claude-opus-5-5`, sorties structurées JSON limitées au vocabulaire §5, repli serveur en cas de refus) ; réponse revalidée côté client ; bouton désactivé sans clé (`assistant.test.ts`, `e2e/assistant.spec.ts` avec API simulée)

**Toutes les phases P0 → P13 et tous les points du §15 sont livrés.**

## Retours utilisateur — lot 1
- [x] Storyboard : bouton « Importer / Remplacer » et « × » directement sur chaque carte
- [x] Plan au sol : l'outil choisi reste actif jusqu'à Échap ou au choix d'un autre outil
- [x] Plan au sol : faisceau lumineux en dégradé (ouverture et portée réglables) ; outil Réflecteur qui renvoie et diffuse la lumière selon sa taille
- [x] Plan au sol : plusieurs plans par séquence (onglets, nouveau, dupliquer, renommer au double-clic, supprimer)
- [x] Plan au sol : nommage rapide des comédiens (personnage de la séquence attribué automatiquement + boutons d'un clic)

## Retours utilisateur — lot 2
- [x] Économie d'encre pour le PDF et l'Excel : aucun aplat (couleur avec Mauve / Papier, noir et blanc avec Sobre)
- [x] Dossier de production complet (.zip) rangé par étape : projet, intention, scénario, dépouillement, découpage (xlsx + csv), images du storyboard, plans au sol (SVG), matériel, plan de travail, feuilles de service, registre
- [x] Exports individuels par onglet : Registre (CSV de l'onglet), Dépouillement, Plan de travail, Feuille de service (CSV), Plan au sol (SVG), Note d'intention (texte) + PDF par impression

## Retours utilisateur — lot 3
- [x] Import de scénario PDF, Word (.docx), Markdown, texte, Fountain → conversion Fountain (en-têtes INT./EXT., répliques centrées ou en retrait, nom au-dessus, parenthèses, transitions)
- [x] Documents mis en page (PDF sans interface ni nom d'outil, et Word) : dépouillement, matériel, plan de travail, feuilles de service, registre, plans au sol (toutes les vues), note d'intention ; CSV conservés en données brutes
- [x] Aucun nom d'outil ni lien dans les exports ; marges d'impression sans en-tête automatique du navigateur
- [x] Changer le type de projet change le minutage (clip / pub → piste, sinon cumulatif)
- [x] Suppression visible des plans et séquences (grille et storyboard), confirmation renforcée au-delà de 10 plans
- [x] Storyboard : impression paysage corrigée (page nommée), suppression de plans depuis les cartes
- [x] Plan au sol : « Vue 1, 2… », export de toutes les vues (PDF, Word, zip SVG), couverture caméra des plans toujours visible (facultative)
- [x] Matériel : plans concernés affichables / masquables, liste complète sans abréviation
- [x] Plan de travail : rendez-vous du jour, horaires de début et fin par séquence (tri par horaire), repris dans la feuille de service

## Itérations d'usage (octobre 2026)
- Exports : PDF et images A4 générés par l'outil (assemblage interne, sans impression navigateur), panneau d'export par onglet, numérotation, thèmes, économie d'encre ; images redessinées pour Safari.
- Storyboard : keyframes, dessin (crayon, texte, flèches 2D/3D manipulables), recadrage (zoom, rotation, remplir/ajuster), format d'image par projet, pictogrammes de cadre, planches pleine image.
- Plan-séquence : éditeur de chorégraphie, temps alignés dans la grille, vue dédiée au plan au sol, annexe PDF (frise, transitions, plan).
- Plan au sol : lumière occultée par murs, comédiens et drapeaux, diffuseurs, murs blancs, zoom borné, fond de plan, import de plan via consignes IA (format Markdown `# PLAN`).
- Emploi du temps : blocs détaillés, plans fractionnés (reprises, jour suivant) ; feuille de service, note d'intention et scénario en A4 ; scénario indicatif (vue découpage, répliques).
- Harmonisation visuelle : palette claire.

- Lumière : les faisceaux secondaires (diffusés, renvoyés par réflecteur ou mur blanc) sont lancés rayon par rayon, coupés par murs, drapeaux et comédiens, et transformés en cascade (2 rebonds max).
- Plan-séquence : « liaison » entre deux temps (panoramique, travelling, bascule de point…), signalée « à préciser » quand le sujet change ; reprise dans la colonne Mouvement de la grille, les transitions et l'annexe.
- Plan-séquence : chaque temps est une vraie ligne de tableau (grille, aperçu, PDF, Excel), liaisons sur leur propre ligne ; option d'export « Sans fusion de cellules ».
- Storyboard : nombre de cartes par ligne, fiche compacte en une ligne colorée, keyframes une à la fois avec vignettes, « Précision » retirée, pictogramme Insert en pot de fleur.
- Plan au sol : consignes IA strictes (grammaire v2, grille calée sur l'image de fond), import réel du fichier .md avec rapport d'erreurs ligne par ligne, aperçu des murs à déplacer et mettre à l'échelle avant validation, échelle réelle optionnelle, réglage du fond (glisser, molette, pincement Safari), zoom élargi, sélection multiple au rectangle (Maj + clic, ⌘A, déplacement et suppression groupés).
- Storyboard : icônes provisoires au trait (domain/thumbnail.ts → iconSpec, ShotSketch.tsx), sans couleur : silhouette cadrée par la valeur, axe (face, 3/4, profil, dos), hauteur (horizon et tête), sol en perspective selon la focale, décor intérieur / rue / nature, fond estompé selon l'ouverture (si la colonne est affichée), glyphe du mouvement, objets d'insert reconnus dans le sujet, yeux en très gros plan.
- Découpage : colonne facultative « Ouverture » (f/2,8), rangée après la focale, importable en CSV.
- Découpage : insertion à l'endroit voulu (« + » sous chaque ligne au survol, « + séquence » entre deux séquences) ; boutons Plan / Séquence retirés de la barre (raccourcis ⌘↵ et ⌘⇧↵ conservés).
- Interface épurée : retrait des mini-tutoriels et indications décoratives (« lié · N plans », aides de glissement, notes explicatives, descriptions des formats d'export).
- Feuille de service : pages A4 réelles à l'écran (useA4Pages), une ligne ou un titre ne se coupe jamais entre deux pages.
- Plan au sol : cadrage mémorisé par vue (même après rechargement), épaisseur des traits réglable par vue.

## Version 2.0.0 — 2026-10-22
Série de retours close : plans-séquences en lignes alignées et liaisons, annexe, storyboard (icônes au trait, keyframes en vignettes, plans par ligne), plan au sol (import IA strict, fond réglable, sélection multiple, lampe de jeu, outils par famille, cadrage mémorisé), feuille de service en pages A4, insertion entre les lignes, interface épurée.

## 2026-11-02
- Exports : téléchargement fiabilisé sous Safari (adresse temporaire conservée 1 min), rechargement automatique quand une page ouverte réclame un module d'une version précédente (cause probable de l'export Excel « qui ne marche pas » après une mise en ligne), erreur affichée en cas d'échec.
- Suggestions : liste complète du vocabulaire à l'ouverture d'une cellule.
- Partage en temps réel d'ordinateur à ordinateur (store/share.ts, features/share) : bouton « Partager » (lien + mot de passe, invités en modification ou lecture seule, copie autorisée ou non, liste des connectés, exclusion, fermeture), page « Rejoindre », bandeau invité. Synchronisation champ par champ (domain/patch.ts), relais par l'hôte, images transmises à la demande. Mise en relation : service public PeerJS (ou `localStorage['ds-peer-server']` pour un serveur propre ; serveur local dans e2e/share.spec.ts).
- TC : nouveau mode par défaut « Durée de chaque plan » (0:10 par plan, durée totale en pied de tableau) ; cumulatif et piste restent au choix dans Paramètres. Les projets existants en cumulatif y passent à l'ouverture, sauf choix explicite.
- Scénario ↔ découpage (domain/scriptToShot.ts, features/scenario/ScriptReader.tsx, ScenarioPanel.tsx) : panneau « Scénario » dans le découpage (un seul panneau à droite, inspecteur OU scénario, largeur réglable mémorisée, lecture active ou écriture synchronisée avec l'onglet Scénario). Au survol, « + » en fin de phrase (ou de réplique) ; sélection libre → « + » au-dessus de sa fin. Mode lié (par défaut) : plan rangé dans la séquence de la scène (créée à sa place si absente) ; mode libre : séquence au choix. Ordre chronologique respecté dans la séquence. Sujet : personnage qui parle, ou prénom en MAJUSCULES dans l'action. Didascalies de réplique dans l'action ; réplique résumée dans Son si la colonne Dialogue n'est pas affichée.
- Export : mode « export intelligent » (colonnes facultatives vides masquées page par page), titre « Découpage technique » en petit en tête de la première page ; suppression de séquence en corbeille, sans chevauchement du libellé.
- Messages : plus de confirmation pour les actions courantes (plan ou séquence supprimés, ajouts…), seulement pour les actions importantes. Suppression de projet annulable et rétablissable (⌘Z / ⌘⇧Z à l'accueil, store/homeHistory.ts).
- Accueil (features/shell/HomePage.tsx) : page plein écran sans la barre de projet, composée sur un axe central. Faisceau de projecteur animé (dégradé orange, rose, violet, bleu), grain de pellicule, poussière, repères de viseur symétriques, code temporel. Nom de l'application au centre, boutons Nouveau projet / Ouvrir, projets en cartes de verre sur plusieurs rangées centrées. Interrupteur Jour / Nuit.
- Thème : passage jour / nuit par une ouverture à l'iris depuis le point cliqué (ui/themeSwitch.ts, View Transitions ; changement immédiat sinon).
- Paramètres : une rubrique à la fois (Projet, Minutage, Caméra, Découpage, Vocabulaire, Assistant IA, Raccourcis clavier, Apparence), réglages en lignes intitulé / commande, rubrique dans l'adresse (`#/settings?section=…`).
- Raccourcis clavier personnalisables (domain/shortcuts.ts, store/shortcuts.ts) : saisie de la combinaison, refus des conflits et des touches de saisie, rétablissement un par un ou global ; propres au navigateur ; repris dans l'aide « ? », la palette ⌘K, le menu latéral et la barre du haut.
- Exporter : dossier de production en bandeau, bloc « Découpage technique » (Aperçu, CSV, Excel, PDF ; mise en page et options dont Masquer les colonnes vides et Sans fusion ; colonnes exportées puis non exportées, pastille fusion / sans fusion), bloc « Fichier du projet » (JSON, ouvrir, importer CSV).
- Colonnes : afficher une colonne dans la grille l'ajoute à l'export (et la masquer l'en retire) ; ordre des colonnes facultatives réglable dans le menu Colonnes, repris à l'export. Personnages, Lumière, Machinerie et Durée retirées (données conservées) ; Notes renommée Image. Son élargie, Son / Lumière / Machinerie éditées sur plusieurs lignes ; plus de suggestions dans Son.
- Export : un mouvement de caméra vide s'écrit « Fixe » (PDF, Excel, CSV), la grille reste vide.
- Grille : la hauteur d'une cellule fusionnée (séquence, TC, action liée) est répartie à parts égales entre ses lignes (grid/useEvenRowSpans.ts) ; colonne de suppression des plans placée entre SÉQUENCE et N°.
- Scénario ↔ découpage : mention de réplique abrégée dans Son (« Rép. « … » », sans le nom déjà en Sujet) ; « + » de fin de phrase hors du flux du texte ; « + » de sélection au ras du curseur, effacé avec la sélection ; une sélection à cheval sur plusieurs scènes est découpée scène par scène, chaque morceau rangé dans la séquence de sa scène ; deux scènes au même lieu donnent deux séquences (fountain.ts → matchSequence par ancre de scène).
- Scénario → Action : « [Rép]. » (ou « [Rép (didascalie)]. ») marque l'endroit où des répliques s'intercalent entre deux séries d'actions ; ces repères ne comptent pas dans le minutage.
- Revue bêta (Peter, Jean-Claude) — corrections retenues : actions liées sans perte de durée forcée, plage de piste ni passage (lier additionne les durées) ; collage depuis un tableur qui suit la grille d'une séquence à l'autre ; plan sans action = aucune durée (plus de 0:02 inventé) ; plus d'alerte « sujet absent des personnages » pour un insert ou un objet ; inspecteur : saisie annulable d'un seul ⌘Z, section « Son, lumière, image » ; raccourcis lus d'après la lettre de la touche (AZERTY) ; pas de césure dans les noms de séquence et de sujet.
- Refonte du découpage : une seule police (Inter), palette blanc / noir / bleu (thème sombre assorti), export d'un seul style sans thème ni économie d'encre ; sélection sans cadre (légère teinte sur la cellule et la ligne cliquées, rien au survol) ; barre rangée (Découpage / Aperçu à gauche, Lier seulement quand plusieurs plans sont sélectionnés, Colonnes / Inspecteur / Scénario en icônes, Exporter) ; grille épurée (commandes au survol, lignes d'insertion fines, pas de badge d'écart, action liée en simple filet). Nouveaux plans vierges ; hauteur des plans-séquences stable. Téléphone : un plan à la fois (MobileCut), flèches, + Plan / + Séquence, vue d'ensemble en liste, menu latéral en tiroir.
- Reporté : assistant IA ouvert à tout fournisseur ; partage par serveur hébergé.

## Version 2.1.0 — 2026-11-02
Accueil refait, Paramètres en rubriques avec raccourcis modifiables, onglet Exporter réorganisé, colonnes réordonnables et allégées, « Fixe » à l'export, répartition des sélections du scénario par scène, nombreuses corrections de la grille.

## Version 2.3.0 — 2026-11-05
- Interview : plusieurs cadres par intervenant (regard, caméras sans limite, lieu, lumière, son), questions communes / par intervenant / par cadre, réponse attendue par question ; liste « Avant de tourner » retirée.
- Fiche d'interview visible dans l'Aperçu (avant les illustrations) et exportable ; anciennes fiches converties au chargement (corrige la page blanche).

## Version 2.2.0 — 2026-11-05
- Découpage épuré (une police, noir / blanc / gris), sélection discrète, barre rangée, vue téléphone complète (un plan à la fois, glisser, onglets de séquences, suggestions à toucher, dupliquer / supprimer, nom et effets de séquence modifiables).
- Formats : Fiction (publicité comprise), Clip, Institutionnel. Le format règle le minutage (piste musicale pour le clip, jamais ailleurs), les modèles proposés et, en institutionnel, masque la colonne TC (facultative). Projets existants remis en cohérence à l'ouverture.
- Institutionnel : deux volets dans le découpage. « Interview » (A-roll, features/interview) : une fiche par intervenant (un par défaut), nom et fonction pour le synthé, regard à gauche / caméra / à droite (alterné entre intervenants, alerte si deux regards identiques), dispositif caméra A / B (≈ 30°, même balance), lieu, arrière-plan, lumière, son (cravate + perche), questions ordonnées, communes ou propres à un intervenant, cochables « posées », liste « Avant de tourner » (droit à l'image, synthé, tenue, micro, bruits, balance des blancs, synchro, reformulation, 30 s de silence plateau). « Illustrations » (B-roll) : la grille classique, avec un créneau horaire par séquence au lieu d'un minutage. Export « Fiche d'interview » (PDF, une page par intervenant).
- Modèles : deux de fiction (dialogue, action), deux de clip, un institutionnel ; seuls ceux du format sont proposés (tous dans un projet vide, le premier choisit le format).
- Corrections : plans-séquences à hauteur stable, nouveaux plans vierges, collage multi-séquences, actions liées sans perte de minutage, plans vides sans durée, annulation d'un trait dans l'inspecteur, raccourcis AZERTY.

## Version 2.4.0 — 2026-11-08 (revue complète et refonte ergonomique)
- Revue du code (cinq axes : grille et minutage, scénario, plans, exports, coquille et persistance) : 150 points relevés, dont 6 bloquants, tous corrigés (images absentes du fichier .decoupage, ancres du scénario décalées, page blanche, plans perdus dans le PDF, séquences invisibles sur un jour entamé, copier-coller cassé). Restent ouverts (Safari, non vérifiable ici) : pincement du trackpad dans l'éditeur de dessin du storyboard, pied de page de l'impression navigateur, mémoire des captures très longues. Corrigés en fin de série : temps du plan-séquence pris en compte (personnages, matériel), chorégraphie annulable par saisie, plans au sol exportés comme à l'écran, images orphelines retirées au démarrage, planches d'impression montées à la demande.
- Coquille : projet en tête de l'écran (menu Titre, Version, Format, Réalisation, Image ; ouvrir un fichier) ; menu latéral regroupé (Écriture, Préparation, Tournage, Projet) qui se réduit en barre d'icônes ; Paramètres en brouillon avec « Annuler » et « Enregistrer » (⌘S), appliqué aussi en quittant la page ; rubriques Projet et Apparence retirées (doublons).
- Assistant IA (features/assistant) : panneau de conversation, fournisseurs Anthropic, OpenAI, Gemini, Mistral, OpenRouter ou API compatible ; outils qui lisent et modifient le projet (domain/aiTools.ts : séquences, plans, dépouillement, personnages, scénario, format) ; un tour = une étape d'annulation ; clé gardée dans le navigateur.
- Scénario (domain/screenplay.ts, features/scenario/ScriptEditor.tsx) : éditeur par paragraphes typés sur pages A4 visibles (retraits du scénario, numéros de séquence et de page), Entrée et Tab qui enchaînent les types, ⌥1–8, reconnaissance des en-têtes, personnages et transitions, suggestions, page de titre mise en forme, sommaire, plans liés, statistiques, export PDF / images / Word / Fountain.
- Dépouillement : scènes du scénario, texte de la scène, sélection → catégorie, suggestions soulignées, ajouts manuels, éléments déduits du découpage ; une scène absente du découpage y entre au premier élément.
- Découpage technique et storyboard réunis : vues Tableau, Storyboard, Aperçu ; sélection partagée ; un seul export avec choix du contenu.
- Plan au sol : barre unique, palette d'outils verticale, raccourcis, vues renommées sur place et dupliquées proprement, plan à pleine hauteur, gestes annulables d'un coup, nombreuses corrections.
- Google Drive (store/cloud.ts) : connexion facultative, synchronisation projet par projet (le plus récent l'emporte), suppressions propagées entre appareils ; dormante tant que la variable de dépôt GOOGLE_CLIENT_ID n'est pas renseignée.
- Charte : plus aucune couleur dans les pages de travail (storyboard, dépouillement, plan au sol, sélection, contrôles natifs) ; l'accueil et le panneau de partage gardent leur ambiance d'après le moodboard.
- Tests : 294 tests unitaires, 83 parcours de bout en bout (Chromium).

## Version 2.5.0 — 2026-11-08 (modèle d'export du scénario, note d'intention, retours)
- Scénario au gabarit du modèle fourni (« lorem ipsum modèle exports imports », KIT Scenarist) : domain/scriptLayout.ts (Courier Prime 12 pt, A4, 58 lignes, retraits et largeurs mesurés au point, coupures de page : répliques entières, en-tête jamais seul, personnage jamais seul en bas de page). Le modèle complet (17 pages, 700 lignes) est reproduit ligne à ligne depuis le Fountain et depuis le Final Draft (tests sur les fichiers du modèle, src/domain/__fixtures__/kit).
- Exports du scénario (features/scenario/scriptExport.ts) : PDF en vrai texte (pdf-lib, Courier Prime intégrée), images A4 aux mêmes positions, Word .docx (styles nommés, police intégrée, mêmes pages), Final Draft (.fdx), Fountain. Le document vide est corrigé. Dossier de production : PDF et .fdx en plus.
- Final Draft (domain/fdx.ts) : import fidèle (types exacts, emphase, page de titre, sauts de page, répliques sans personnage écrites « @ » seul en Fountain) et export.
- Éditeur du scénario : pages de l'export à l'écran (Courier Prime, même pagination, lignes de 16 px entiers), page de titre identique, ni numérotée ni comptée ; chronomètre position / total ; ⌃1–8 sur Mac (⌥ + chiffre tape « » ’ [ {), Alt+1–8 ailleurs ; import d'un scénario entier : passages liés retrouvés par leur texte ou détachés.
- Note d'intention (features/intention/RichEditor.tsx, domain/richText.ts) : pages A4, ruban à la Word (styles, police, corps, gras / italique / souligné / barré, indice, exposant, surlignage gris, listes, retraits, alignements, interligne, images, saut de page), barre d'état (page, mots, zoom), annulation propre ; la feuille suit le thème ; exports PDF / images (pages de l'éditeur, papier blanc), Word, texte. HTML réduit et nettoyé (`intentionHtml`), texte brut tenu à jour (`intention`).
- Plan au sol : projecteur de cinéma (Fresnel vu de dessus), caméra avec objectif et pare-soleil, rails à deux filets, mêmes tracés à l'export (domain/floorSymbols.ts) ; icônes de palette dédiées ; repères derrière l'appareil. « Tracer les murs avec l'assistant » : l'image du plan des locaux est lue par le fournisseur réglé, réponse vérifiée par l'analyseur strict, aperçu à valider.
- Découpage : « Aperçu » devient une bascule (tableau tel qu'à l'export, ou planches du storyboard) ; l'assistant propose des plans pour une séquence, et dépouille une scène depuis la page Dépouillement.
- Partage : panneau à la charte, QR code du lien en plein écran avec le mot de passe en grand.
- Assistant : lien « Obtenir une clé » vers la page du fournisseur choisi.
- Charte : plan de travail en gris (hachures pour aube et crépuscule), plus de couleurs dans les cartes du storyboard, la frise de la journée et l'aperçu du découpage.
- Corrigé : pages blanches à l'export des onglets (régression de la 2.4.0).
- Tests : 323 tests unitaires, 89 parcours de bout en bout (Chromium).


## Version 2.6.0 — 2026-11-08 (interview dans le découpage, captures, thème sombre)
- Institutionnel : un cadre d'interview reste en annexe ou se place dans une séquence, au numéro de plan choisi ; une ligne par caméra (1A, 1B) dans les colonnes habituelles, l'action dit qui, où, le regard et le nombre de questions ; la fiche reste la source (synchronisation dans le magasin, domain/interview.ts). Vues Interview, Tableau, Storyboard ; aperçu propre à chaque vue ; fiche en trois colonnes, exportée en paysage ou portrait, image du cadre par caméra.
- Aperçus : découpage en pages A4 paysage, planches et fiche sur papier blanc quel que soit le thème (`.paper-light`) ; feuilles A4 de l'écran au thème (`--sheet`).
- Feuille de service au format professionnel : en-tête en trois blocs (RDV, jour n sur N, météo, soleil, horaires clés, hôpital), comédiens numérotés et convocation détaillée, besoins des postes, prévisions du lendemain.
- Plan au sol : dimensions de la pièce (murs, superficie, gabarits) ; projecteurs avec modèle, watts et kelvins, repris dans la liste Lumière.
- Scénario : panneaux Personnages (répliques, présence, fiche, répliques à remettre), Décors, Recherche (genre, logline, synopsis, documents) ; page de garde éditée à part et reconnue à l'import.
- Assistant : clé essayée à la saisie, le plus rapide des modèles disponibles qui répondent est choisi.
- Retirés : modèles de découpage. « Séquence » partout au lieu de « scène ».
- Tests : 340 tests unitaires, 90 parcours de bout en bout (Chromium).
- À faire : gras, italique et couleurs dans l'éditeur du scénario (rendu en place des marques) ; chantier production (inventaire : scratchpad/inventaire-production.md, résumé dans CLAUDE.md).

## Version 2.7.0 — 2026-11-09 (scénario à la KIT, production)
- Scénario : gras, italique, souligné (⌘B / ⌘I / ⌘U) rendus en place ; surlignage de révision en six couleurs (`[[=couleur]]…[[=]]`), jamais imprimé ; statistiques complètes (sommaire, séquences, décors, personnages, dialogues, structure, activité), graphiques exportés en PNG ou PDF ; renommage des personnages et décors ; paragraphes trop longs coupés à l'import.
- Minutage du scénario (Paramètres → Scénario) : par pages (s / page), par caractères (N caractères = M s, espaces au choix) ou par type de paragraphe (forfait + s / 50 caractères), comme KIT (`domain/chronometry.ts`) ; repris par le chronomètre, les rapports et les graphiques. Compteurs sans les marques.
- Plan de travail : « Jour n sur N » avec totaux, bandes grises INT/EXT × moment, bandeaux installation / trajet / repas / pause, horaires en cascade depuis le RDV (les horaires saisis priment), durées prévues par bande.
- Registre : numéros des personnages (repris partout), séquences, 1er jour, nombre de jours, fiches inutilisées estompées. Lieux de tournage distincts des décors (nom, adresse, accès, contact), repris par la feuille de service et les exports (`domain/locations.ts`).
- Thème sombre : contrôles natifs sombres (`color-scheme`).
- Tests : 368 tests unitaires, 94 parcours de bout en bout (Chromium).
- Suite possible : réordonner les séquences dans un jour, horaire par plan, lieu de tournage commun à plusieurs décors.

## Version 2.8.0 — 2026-11-09 (versions, relecture, dépouillement)
- Versions du film communes au scénario et au découpage (sélecteur dans les deux pages) : une nouvelle version copie la courante avec les mêmes identifiants ; ce qui reste garde plans, dépouillement, plans au sol, jours de tournage ; rien n'est effacé tant qu'une autre version s'en sert. Les autres pages suivent la version courante.
- Nouveau texte importé (nouvelle version ou remplacement) : chaque scène retrouve sa séquence (similarité lieu / texte / personnages, alignement dans l'ordre puis scènes déplacées) ; scènes neuves insérées à leur place si le découpage suivait le scénario ; scènes retirées gardées au découpage ; numéros d'en-tête ignorés ; marques de révision (*) dans le sommaire et le dépouillement.
- Relecture : partage « Commenter » ; l'invité commente un passage du scénario ou une cellule / séquence de l'aperçu du découpage ; l'auteur lit, répond, règle ou retire depuis le menu des versions (compteur discret).
- Dépouillement : vue « Scénario entier » avec la liste du film, rapports (éléments et séquences, PDF), numéros du scénario partout ; page de garde reconnue par indices ; filigrane Fade In retiré.
- Divers : glisser des plans en liste triable, Entrée sans transformer une ligne en personnage, page d'erreur qui rouvre le projet, session Google gardée.
- Tests : 387 unitaires, 101 parcours de bout en bout.

## Comparer les versions du scénario — 2026-11-10
- Menu des versions (Scénario et Découpage) : « Comparer les versions… » remplace les différences abrégées ; invités et relecteurs : un bouton à côté du nom de la version.
- Sous-page `#/scenario?compare=A~B` : « Comparer [A] avec [B] » (par défaut la courante avec celle dont elle est partie), texte entier aux colonnes du scénario, marques sans couleur, résumé (séquences, mots, pages, durée), seulement les changements, J / K, séquence ouverte dans l'éditeur (version courante), export PDF.
- Domaine : `domain/scriptDiff.ts` (séquences par `sceneAlign`, blocs, mots), `domain/scriptDiffLayout.ts` (pages A4 de l'export) ; `sceneAlign` compte les triplets communs par index (plus rapide, mêmes résultats).

## Carte des lieux — 2026-11-09
- Plan de travail : carte Leaflet masquable (réglage retenu), tuiles OpenStreetMap en gris, repères numérotés par jour, jour choisi en avant, infobulle décor et adresse, liste avec état de la recherche et lien d'itinéraire ; rendez-vous du calendrier sous chaque jour daté.
- Géocodage Nominatim : une requête par seconde au plus, seulement carte affichée et en ligne, résultat gardé dans le projet (hors annulation), délai, nouvel essai et pause après refus.
- Feuille de service : carte réduite des lieux du jour à l'écran et dans l'export (image composée des tuiles en gris, repères numérotés, légende, attribution), lien d'itinéraire par lieu, cliquable dans le PDF et le Word.
- Relecture : carte isolée sous les fenêtres et panneaux ; hôpital sans nom jamais replié sur la ville ; aucune requête après une carte masquée pendant la pause d'un refus 429 ; outils du jour en colonne fixe ; rendez-vous courts entiers ; réserve sans indication superflue ; légende entière.
- Tests : 498 unitaires, 131 parcours de bout en bout (1 capture sur demande ignorée).

## Version 2.9.0 — 2026-11-10 (comparaison, carte, calendrier de production, relecture Drive, revue)
- Comparaison des versions du scénario (voir plus haut), relue de façon contradictoire : nombres des en-têtes comparés, citations exactes, casse ignorée en capitales, invités limités aux versions publiées.
- Plan au sol : pièce en tête du panneau (modèles Petite / Moyenne / Grande avec dimensions, Personnalisée), cotes en mètres sur le plan et dans l'export, pièce déplacée d'un bloc avec portes et fenêtres, posée au coin du plan des locaux, dimensions bornées ; un outil actif trace ou pose depuis un mur.
- Carte des lieux : plan de travail et feuille de service, export compris (voir plus haut).
- Calendrier de production (Gantt) : tournage lié fidèle au plan de travail (date corrigée, jours datés en partie), modèle autour d'un tournage daté, calendriers dans le dossier .zip, Word en tableau ; rendez-vous du calendrier repérés sur la frise, tout effacer annulable.
- Relecture en ligne par Google Drive : jeton du relecteur limité à l'onglet, retrait annulé qui tient, citation gardée d'un passage réécrit, lien fermé à la suppression du projet, envois manqués gardés, version publiée non supprimable, rien de la relecture chez un invité du partage en direct.
- Revue approfondie (73 défauts confirmés, 59 corrigés, le reste déjà réglé) : scénario (pages et minutage de l'impression), versions et commentaires, dépouillement et registre, plan au sol, production (déroulé unique plan de travail / feuille de service, nuit « (+1) », repas vers midi), coquille et paramètres.
- Ouvert : sur un scénario annoté, le numéro de page écrit sur une feuille de l'éditeur peut dépasser celui du PDF (notes comptées à l'écran). Pré-remplir la pièce depuis le plan des locaux écarté : l'échelle réelle n'est pas enregistrée.
- Tests : 587 unitaires, 161 parcours de bout en bout (1 capture sur demande ignorée).

## Suite 2.9.x — 2026-11-10 (publié, puis pause)
- Matériel : page centrée, recherche, postes en cartes, ajout en ligne avec focus, poste supprimable.
- Calendrier et Production : une seule page (Jour / Semaine / Mois / Année / Production), une barre commune.
- Plan au sol : section Pièce repliée en une ligne de résumé ; température de couleur (bleu à orange) sur faisceaux, lampes, liste et export, gris sans température.
- Découpage : séquence sans plan refaite (en-tête, aperçu du texte, premier plan d'un clic ou au clavier, Suppr la retire), absente de l'export PDF.
- Vérifications : chaque ligne mène à l'endroit exact (`domain/checkTarget.ts`, `features/checks/openCheck.ts`), sautes consécutives en une ligne, contrôle d'angle incompatible.
- Tests : 614 unitaires, 179 parcours de bout en bout.

## File d'attente (à reprendre dans cet ordre)
1. Scénario : refonte complète des sous-sections (barre trop compacte, « pas épurée » : plus d'air, moins de boutons tassés) et séquencier façon John Truby (« tissage des séquences » : une phrase par séquence, vue d'ensemble du film, lisible avant et après l'écriture).
2. Retirer le Registre en déplaçant ce qui n'existe que là : nature et fusion des personnages (`mergeCharacters`) vers les fiches du Scénario ; durée estimée, écart et avancement vers l'en-tête de séquence du découpage ; personnages manuels de séquence vers le Dépouillement ; tableaux et CSV vers Exporter. La cible `registry` de `checkTarget` (écart estimé) passe alors à l'en-tête de séquence.
3. Vérifications : la cellule visée s'ouvre directement en saisie (comme un double-clic), un test par type de contrôle.
4. Cent améliorations (ergonomie, fonctions, robustesse), par lots indépendants, stabilité d'abord : un lot qui casse un test est écarté.
