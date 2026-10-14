# SPEC — DÉCOUPAGE STUDIO
### Outil de découpage technique intelligent, relié à la chaîne de préparation d'un tournage
> Document de référence unique. À lire intégralement avant toute ligne de code. Il fait foi sur toute autre intuition.

---

## 0. PROTOCOLE DE TRAVAIL AUTONOME (à respecter avant tout le reste)

Tu travailles seul, toute une soirée, sans superviseur. Règles :

1. **Ne pose aucune question.** Quand un choix est ambigu, prends la décision la plus raisonnable au regard de cette spec, consigne-la en une ligne dans `DECISIONS.md` (date, décision, raison), et continue.
2. **Fichiers de pilotage à la racine** :
   - `SPEC.md` : ce document. S'il n'existe pas, crée-le avec ce contenu intégral. Ne le modifie jamais.
   - `PROGRESS.md` : la liste des phases (§14) sous forme de cases à cocher, avec sous-tâches. Mets-le à jour à la fin de chaque sous-tâche. C'est ta mémoire : si ton contexte est compacté ou la session relancée, tu reprends **uniquement** depuis ce fichier.
   - `DECISIONS.md` : journal des arbitrages.
   - `CLAUDE.md` : 30 lignes maximum : stack, commandes (`dev`, `test`, `build`), conventions, chemin de SPEC/PROGRESS. Rien d'autre.
3. **Ordre strict des phases** (§14). Une phase n'est cochée que si sa *Definition of Done* est remplie **et** que `npm run test` et `npm run build` passent sans erreur.
4. **Git** : `git init` en phase 0. Un commit par sous-tâche significative, message en français à l'impératif (« Ajoute la fusion verticale des cellules à l'export »). Jamais de force-push.
5. **Économie de contexte** : ne relis pas des fichiers entiers inutilement ; utilise la recherche ciblée. Ne lance pas le serveur de dev en boucle : privilégie les tests unitaires et Playwright en mode headless. Ne réécris jamais une phase cochée, sauf bug bloquant (et note-le dans DECISIONS.md).
6. **Références visuelles** : `docs/reference/export-decoupage.png` (la cible exacte de l'export) et `docs/reference/da-truby.png` (la direction artistique de l'application). Ouvre-les et étudie-les avant les phases 2 et 6.
7. **Qualité** : TypeScript strict, aucun `any` non justifié, logique métier en fonctions pures testées, composants petits. Langue de l'interface : **français**. Identifiants de code : anglais.
8. Si toutes les phases sont terminées, poursuis avec la section §15 (« Si tu as encore du temps »), dans l'ordre.

---

## 1. VISION

**Découpage Studio** est l'outil de découpage technique d'un réalisateur et de son chef opérateur. Il remplace le tableau Excel ou Pages bricolé par une grille vivante qui :

- numérote, minute et fusionne toute seule ;
- connaît le vocabulaire du cadre (valeurs, axes, angles, mouvements, focales) et le suggère pendant la frappe ;
- tient une **base de données** des séquences, personnages et décors, et compare la durée **estimée** par l'auteur à la durée **calculée** ;
- produit un **export PDF identique au modèle de référence** (tableau mauve, cellules fusionnées verticalement) ;
- se relie aux étapes voisines de la préparation, dans l'ordre réel de la production : scénario → dépouillement → **découpage** → storyboard et plan au sol → listes de matériel → plan de travail → feuille de service.

Rappel métier qui guide toute l'ergonomie : le découpage est rédigé par le **réalisateur et le chef opérateur** à partir du scénario, d'un storyboard ou d'un synopsis ; il est **distribué à chaque chef de poste** ; la **scripte** s'en sert pour le pré-minutage et la continuité ; le **1er assistant** s'en sert pour bâtir le plan de travail en regroupant par décors, comédiens et axes ; le **chef opérateur** en déduit ses listes image, lumière et machinerie. L'outil doit servir ces quatre lecteurs.

Le nom de l'app est configurable dans une constante (`APP_NAME`).

---

## 2. STACK (imposée, pour aller vite et rester déployable sur GitHub Pages)

- **Vite + React 18 + TypeScript strict**, application 100 % front, *local-first*.
- **État** : Zustand + immer ; historique annuler/rétablir via `zundo` (100 pas minimum).
- **Persistance** : IndexedDB via **Dexie** (sauvegarde automatique, débounce 600 ms) + fichier projet **`.decoupage`** (JSON versionné, `schemaVersion`) ouvert/enregistré par la File System Access API quand elle existe, sinon téléchargement/`<input type=file>`.
- **Glisser-déposer** : `@dnd-kit/core` + `@dnd-kit/sortable`.
- **Styles** : CSS natif avec variables (tokens §11) + CSS Modules. **Pas** de Tailwind ni de kit UI générique : la DA « papier » doit être dessinée à la main.
- **Export** : impression paginée (`window.print` + feuille `@media print`, `@page` A4/A3 paysage) pour le PDF ; **ExcelJS** pour le .xlsx (fusions + styles) ; CSV ; JSON.
- **Tests** : Vitest (logique pure, couverture élevée du dossier `src/domain`) + Playwright (parcours clés + capture de l'export à comparer à la référence).
- **Icônes** : `lucide-react`, trait fin (1.25).
- **Polices** (Google Fonts, auto-hébergées via `@fontsource` si possible) : *Cormorant Garamond*, *Source Serif 4*, *Caveat*, *Fraunces*, *Barlow Semi Condensed*, *Courier Prime*, *JetBrains Mono*.
- **Déploiement** : workflow GitHub Actions → GitHub Pages (base path configurable).

Arborescence cible :
```
src/
  domain/        # types, fonctions pures : numbering, timecode, merge, vocabulary, tokens, equipment, lint
  store/         # zustand slices + persistance Dexie
  features/
    grid/        # la grille de découpage (cœur)
    registry/    # base de données : séquences, personnages, décors, plans
    export/      # rendu imprimable, xlsx, csv, json
    scenario/    # éditeur Fountain léger + liaison
    inspector/   # panneau latéral du plan sélectionné
    shell/       # sidebar, topbar, palette de commandes, réglages
  ui/            # primitives maison (Button, Field, TokenInput, Popover, Toast, Modal)
  styles/        # tokens.css, paper.css, print.css
seed/            # projet de démonstration RAV3 (§12)
```

---

## 3. MODÈLE DE DONNÉES

```ts
type ID = string; // nanoid

interface Project {
  id: ID; schemaVersion: number;
  title: string; director?: string; dop?: string; version: string; // "V3"
  format: 'fiction' | 'clip' | 'documentaire' | 'institutionnel' | 'pub';
  settings: ProjectSettings;
  sequenceIds: ID[];           // ordre des séquences
  createdAt: string; updatedAt: string;
}

interface ProjectSettings {
  tcMode: 'cumulatif' | 'piste';      // fiction = cumulatif ; clip = piste (TC musical)
  tcGranularity: 'sequence' | 'action';
  dialogueWordsPerSecond: number;     // défaut 2.5 (≈150 mots/min)
  actionWordsPerSecond: number;       // défaut 2.0
  minActionSeconds: number;           // défaut 2
  sensor: 'FF' | 'S35' | 'APSC' | 'M43' | 'custom'; cropFactor: number; // FF=1, S35≈1.5, APSC=1.6, M43=2
  fps: 25;
  labelStyle: 'court' | 'long';       // « Taille » vs « Plan taille »
  shotCodeFormat: '{seq}.{shot}' | '{seq}-{shot}' | '{seq}{letter}';
  exportTheme: 'mauve' | 'papier' | 'sobre';
  exportColumns: ColumnKey[];          // colonnes visibles à l'export, dans l'ordre
  gridColumns: ColumnKey[];            // colonnes visibles dans la grille
  audioTrack?: { name: string; durationSec: number; blobKey?: string }; // mode clip
}

interface Sequence {
  id: ID;
  // numéro dérivé de la position, jamais stocké en dur
  label: string;                 // texte libre : « CHAMBRE ADMIRATRICE »
  decorId?: ID; intExt?: 'INT' | 'EXT' | 'INT/EXT';
  effect?: 'JOUR' | 'NUIT' | 'AUBE' | 'CRÉPUSCULE';
  characterIds: ID[];            // dérivé des plans + ajout manuel
  estimatedSec?: number;         // durée subjective saisie par l'auteur
  summary?: string; color?: string;
  shotIds: ID[];                 // ordre des plans
  actionBlockIds: ID[];
  scenarioAnchor?: { start: number; end: number };
}

interface ActionBlock {          // une action couverte par 1..n plans consécutifs
  id: ID; sequenceId: ID;
  text: string;                  // description d'action
  dialogue?: string;             // répliques éventuelles
  overrideSec?: number;          // durée manuelle
  tc?: { in?: number; out?: number; all?: boolean }; // mode piste ; all = « TOUT »
}

interface Shot {
  id: ID; sequenceId: ID;
  // numéro dérivé : position dans la séquence, à partir de 1
  subject: string;               // texte libre + suggestions personnages/objets
  characterIds: ID[];            // reconnus dans subject
  value: string;                 // valeur de cadre (texte libre + suggestions)
  angle: string[];               // jetons : axe + hauteur (« 3/4 face », « hauteur regard »)
  movement: string[];            // jetons : « trav circulaire », « suivi »
  focal: { from?: number; to?: number }; // mm ; `to` seulement si zoom
  actionBlockId: ID;
  sound?: string; light?: string; notes?: string;
  status: 'à tourner' | 'tourné' | 'abandonné';
  storyboard?: { blobKey: string };
  shootingDay?: number;
}

interface Character { id: ID; name: string; kind: 'principal'|'secondaire'|'figurant'|'silhouette'|'voix off'; color?: string; actor?: string; notes?: string; }
interface Decor { id: ID; name: string; intExt?: 'INT'|'EXT'|'INT/EXT'; address?: string; notes?: string; }
```

Invariants (testés) :
- Les numéros de séquence et de plan sont **toujours dérivés** de l'ordre ; l'utilisateur ne peut **pas** les saisir. Ils se recalculent instantanément après tout déplacement, ajout ou suppression.
- Un `ActionBlock` ne couvre que des plans **consécutifs** d'une même séquence. Un déplacement qui casserait cette contiguïté scinde le bloc (avec toast d'information et possibilité d'annuler).
- Supprimer le dernier plan d'un bloc supprime le bloc ; supprimer une séquence demande confirmation (avec le nombre de plans perdus) et reste annulable.

---

## 4. LA GRILLE DE DÉCOUPAGE (cœur du produit)

### 4.1 Colonnes par défaut (ordre de l'export de référence)

| Colonne | Contenu | Règles |
|---|---|---|
| **SÉQUENCE** | `{n}, {LIBELLÉ}` ex. « 1, CHAMBRE ADMIRATRICE » | Numéro automatique ; libellé en texte libre (forcé en majuscules à l'affichage), autocomplétion sur les décors existants. Cellule **fusionnée sur toute la hauteur** de ses plans, centrée verticalement. |
| **N°** | 1, 2, 3… | Automatique, non éditable, en rouge. Redémarre à 1 dans chaque séquence. |
| **SUJET** | « Admiratrice », « Main candice », « Affiche » | Texte libre ; suggestions = personnages de la base + sujets déjà employés. Un nom inconnu proposé : « Créer le personnage “X” ? » (non bloquant). |
| **VALEUR** | valeur de cadre | Texte libre + suggestions (§5.1). |
| **ANGLE** | axe + hauteur, plusieurs jetons | TokenInput (§5.2). |
| **MOUVEMENT DE CAMÉRA** | plusieurs jetons | TokenInput (§5.3). |
| **FOCALE** | `50mm`, ou `24 → 70mm` | Suffixe « mm » verrouillé. Si un jeton « zoom » est présent dans le mouvement, le champ se dédouble **automatiquement** en « de … à … mm » (§5.4). |
| **ACTION** | texte libre | Appartient à l'`ActionBlock` du plan. Plusieurs plans peuvent partager la même action (couverture, §4.4). |
| **TC MIN** | `m:ss` | Calculé ou manuel (§6). Total en bas de grille. |

Colonnes optionnelles, activables dans le menu « Colonnes » (et exportables) : *Personnages, Dialogue, Son, Lumière, Machinerie (déduite), Durée du plan, Jour de tournage, Statut, Notes*.

### 4.2 Saisie façon tableur
- Navigation clavier complète : flèches entre cellules ; `Entrée` = éditer / valider et descendre ; `Tab` / `Maj+Tab` = cellule suivante / précédente ; `Échap` = annuler l'édition.
- `⌘/Ctrl+Entrée` : nouveau plan sous le plan courant (hérite du sujet, de la focale et de l'angle du plan courant ; valeur et action vides).
- `⌘/Ctrl+Maj+Entrée` : nouvelle séquence après la séquence courante.
- `⌘/Ctrl+D` : dupliquer le plan. `Alt+↑/↓` : déplacer le plan. `Alt+Maj+↑/↓` : déplacer la séquence entière.
- `⌘/Ctrl+Maj+↓` : recopier la cellule vers le bas sur la sélection.
- Sélection multiple de cellules (Maj+clic, Maj+flèches) ; coller depuis Excel/Sheets (TSV) en créant les plans manquants.
- `⌘/Ctrl+Z` / `⌘/Ctrl+Maj+Z` partout. `⌘/Ctrl+K` : palette de commandes. `?` : aide des raccourcis.
- Suppression d'un plan : immédiate avec toast « Plan 3.4 supprimé — Annuler ».

### 4.3 Aperçu des fusions pendant l'édition
La grille d'édition reste **une ligne par plan** (pour pouvoir éditer chaque cellule), mais elle **préfigure l'export** : quand une cellule a la même valeur que celle juste au-dessus dans la même séquence, sa valeur s'affiche estompée, précédée d'un guillemet de répétition manuscrit « 〃 » (police Caveat, couleur rouille). Un interrupteur « Vue impression » dans la barre d'outils bascule vers le rendu fusionné réel (lecture seule, identique à l'export).

### 4.4 Couverture d'une même action
- Sélectionner plusieurs plans consécutifs → bouton/commande **« Lier l'action »** : ils partagent alors un même `ActionBlock` ; dans la grille la cellule ACTION apparaît fusionnée (fond légèrement teinté, liseré gauche couleur séquence).
- **« Délier »** redonne à chaque plan son propre bloc (le texte est copié).
- Taper dans l'action d'un plan lié modifie l'action de tout le bloc, avec un indicateur discret « lié · 3 plans ».
- Raison d'être : le temps d'écran d'une action se compte **une seule fois**, quel que soit le nombre de plans qui la couvrent (§6).

### 4.5 Réordonnancement et garde-fous
- Chaque ligne de plan porte une poignée (6 points) : glisser vers le haut ou le bas **dans sa séquence** ; la numérotation se met à jour en direct pendant le glissement.
- Déposer un plan **dans une autre séquence** n'est **pas** direct : une modale demande « Déplacer le plan 2.3 vers la séquence 5 — PARC ? Son action liée sera détachée. » [Annuler] [Déplacer]. Option « Ne plus demander pour cette session ».
- Chaque séquence a sa propre poignée sur la cellule SÉQUENCE : la glisser déplace **tout le bloc** de plans ; les numéros de séquence se recalculent.
- La hauteur de la cellule SÉQUENCE s'adapte toujours au nombre de plans (fusion verticale, comme l'export).
- Une fine ligne vide (couleur de fond de séquence) sépare deux séquences, comme dans l'export.

### 4.6 Pied de grille
Ligne de total permanente : nombre de séquences · nombre de plans · **durée totale calculée** · durée totale estimée · écart (en secondes et en %, coloré : vert ≤ 10 %, ocre ≤ 25 %, rouille au-delà).

---

## 5. VOCABULAIRE ET SAISIE INTELLIGENTE

Toutes les listes vivent dans `src/domain/vocabulary.ts` avec : `key`, `short` (libellé court d'export), `long`, `abbr`, `aliases` (pour la recherche : sans accents, sans casse, abréviations). L'utilisateur peut ajouter ses propres termes (Réglages → Vocabulaire), stockés dans le projet.

Comportement commun des suggestions : popover sous la cellule dès la 1re lettre ; correspondance par préfixe puis par sous-chaîne, insensible aux accents et à la casse, aliases inclus ; flèches pour choisir, `Entrée`/`Tab` pour valider, `Échap` pour fermer ; texte libre toujours accepté.

### 5.1 Valeurs de cadre (échelle du plus large au plus serré)
| key | short | long | abbr | aliases |
|---|---|---|---|---|
| general | Général | Plan général | PG | large, grand ensemble |
| ensemble | Ensemble | Plan d'ensemble | PE | |
| moyen | Moyen | Plan moyen (en pied) | PM | pied, plein pied |
| italien | Italien | Plan italien | PI | genoux |
| americain | Américain | Plan américain | PA | mi-cuisse |
| taille | Taille | Plan taille | PT | mi-corps |
| rapproche | Rapproché | Plan rapproché poitrine | PRP | poitrine, épaules |
| gros_plan | Gros plan | Gros plan | GP | visage |
| tres_gros_plan | Très GP | Très gros plan | TGP | détail visage, yeux |
| insert | Insert | Insert | INS | détail, objet |

L'ordre de l'échelle sert aux contrôles (§9) et au tri.

### 5.2 Angle = axe + hauteur (jetons)
- **Axes** : face, 3/4 face, profil gauche, profil droit, 3/4 dos, dos.
- **Hauteurs / angles** : hauteur regard, plongée, contre-plongée, top shot (plongée totale), low angle (caméra au sol), subjectif.
- Saisie en jetons séparés par virgule ; rendu à l'export joint par « , » avec majuscule initiale (« 3/4 Face, Hauteur regard »).
- Avertissement doux (soulignement pointillé) si deux axes ou deux hauteurs incompatibles sont saisis.
- Un tiret « - » seul est accepté (non applicable) et exporté tel quel.

### 5.3 Mouvements (jetons)
fixe, trav avant, trav arrière, trav latéral gauche, trav latéral droit, trav circulaire, trav vertical (boom up / boom down), trav courbe, pano droite, pano gauche, tilt up, tilt down, roll, zoom avant, zoom arrière, suivi, épaule, steadicam / gimbal, drone, grue.
Aliases : « tilt haut » = tilt up, « tilt bas » = tilt down, « traveling » = trav, « pano » = pano (sens à préciser). Rendu d'export joint par « , » ou « + » selon ce que l'utilisateur a tapé (préserver le séparateur saisi).

### 5.4 Focale
- Saisie numérique uniquement ; le suffixe « mm » est un élément visuel non effaçable collé au champ.
- Si un jeton de mouvement contient « zoom » : deux champs « de [24] à [70] mm » apparaissent automatiquement (animation discrète) ; rendu « 24 → 70mm ». Si le zoom est retiré, la valeur `to` est conservée en mémoire mais masquée.
- Info-bulle : angle de champ horizontal calculé pour le capteur du projet. Formule : `2·atan(36 / (2·f·crop))`, en degrés. Repères de contrôle (plein format) : 24 mm ≈ 84° (diagonale), 50 mm ≈ 46,5°, 105 mm ≈ 23°, 200 mm ≈ 12° (précise dans l'info-bulle s'il s'agit de l'angle horizontal ou diagonal). Affiche aussi l'équivalent plein format si le capteur n'est pas FF (ex. 50 mm × 1,6 = 80 mm).
- Suggestions de focales courantes : 14, 16, 18, 24, 28, 35, 50, 70, 85, 100, 135, 200.

---

## 6. MINUTAGE (TC MIN)

### 6.1 Format
- Affichage `m:ss` (`0:30`, `1:00`, `10:00`) ; `h:mm:ss` au-delà de 59:59.
- Saisie tolérante : `30` → 0:30 ; `130` → 1:30 ; `1:30` ; `90s` ; `1m30` ; `tout`/`TOUT` → « TOUT » (mode piste).

### 6.2 Mode « cumulatif » (fiction, par défaut)
- Durée d'un `ActionBlock` = `overrideSec` si défini, sinon `max(minActionSeconds, mots_action / actionWordsPerSecond + mots_dialogue / dialogueWordsPerSecond)`, arrondie à la seconde.
- Durée d'une séquence = **somme des blocs d'action** (jamais la somme des plans : une action couverte par trois plans ne compte qu'une fois).
- TC affiché = plage cumulée **in – out** : séquence 1 « 0:00 - 0:35 », séquence 2 « 0:35 - 1:26 »…
- Granularité `sequence` : une seule cellule TC fusionnée par séquence. Granularité `action` : une plage par bloc d'action.
- Une valeur saisie à la main remplace le calcul et porte la marque « ✎ » manuscrite ; un clic droit propose « Revenir au calcul automatique ».
- Les coefficients sont réglables (Réglages → Minutage), avec un aperçu « ce texte de 12 mots = 0:06 ».

### 6.3 Mode « piste » (clip, publicité musicale)
- Le TC désigne une plage **dans le morceau** ; il peut se chevaucher d'une séquence à l'autre et valoir « TOUT » (couverture sur toute la piste).
- Import optionnel d'un fichier audio (stocké en IndexedDB) : forme d'onde dans une barre en haut de grille ; cliquer-glisser sur la forme d'onde avec un bloc d'action sélectionné fixe son in/out. Lecture de l'extrait d'un bloc d'un clic.
- Le total = durée de la piste ; la ligne de total indique le taux de couverture de la piste (en %, plages fusionnées).

### 6.4 Comparaison estimé / calculé
Chaque séquence a un champ « Durée estimée » (subjective). La base de données (§7) et un badge sur la cellule SÉQUENCE comparent estimé et calculé, avec l'écart coloré (mêmes seuils qu'au §4.6).

---

## 7. BASE DE DONNÉES INTERNE (« Registre »)

Vue à onglets, chaque onglet étant une table triable et filtrable, éditable en ligne, avec recherche :

- **Séquences** : n°, libellé, décor, INT/EXT, effet, personnages (puces), nb de plans, durée estimée, durée calculée, écart, statut d'avancement (plans tournés / total). Clic → saute à la séquence dans la grille.
- **Personnages** : nom, type, couleur, comédien, nb de séquences, nb de plans, liste des séquences. Fusion de doublons (« Candice » / « Candi ») par glisser l'un sur l'autre, ce qui met à jour les plans.
- **Décors** : nom, INT/EXT, adresse, séquences concernées, durée totale à tourner dans ce décor.
- **Plans** : liste à plat de tous les plans (code `3.4`), filtrable par valeur, focale, mouvement, personnage, décor, statut, jour.

Les personnages sont reconnus automatiquement dans SUJET (correspondance de nom, insensible à la casse). La liste des personnages d'une séquence = union des sujets reconnus + ajouts manuels.

---

## 8. EXPORT (cible : `docs/reference/export-decoupage.png`, à reproduire fidèlement)

### 8.1 Algorithme de fusion verticale (fonction pure, très testée)
`computeMerges(sequence, columns) → Map<columnKey, Array<{ startRow, span, value }>>`
- Bornée à la séquence : aucune fusion ne traverse deux séquences.
- Colonne SÉQUENCE : un seul bloc pour toute la séquence.
- Colonne N° : jamais fusionnée.
- Colonne ACTION : fusion par **identité d'ActionBlock** (pas par texte).
- Colonne TC : fusion selon la granularité (§6.2) ou, en mode piste, sur valeurs identiques consécutives.
- Toutes les autres colonnes (SUJET, VALEUR, ANGLE, MOUVEMENT, FOCALE, options) : fusion des **valeurs normalisées identiques consécutives** (comparaison sans casse ni espaces superflus ; tableaux de jetons comparés en ordre).
- Les colonnes sont indépendantes : une fusion d'ACTION peut chevaucher une frontière d'ANGLE (cas réel : séquence 6 du seed).
- Option par colonne « ne jamais fusionner » (Réglages → Export).

### 8.2 Rendu « Mauve » (thème par défaut, réplique de la référence)
- Page paysage (A4 par défaut, A3 en option), marges ~12 mm, fond **mauve** `#C98BB4` avec grain papier (SVG `feTurbulence`, opacité 0,08) ; coins de page arrondis à l'écran uniquement.
- Titre « Découpage technique » en **Fraunces** 800 (axes SOFT élevé), ~34 pt, couleur `#7A4E74`, aligné à gauche au-dessus du tableau.
- Tableau : bordures noires 1 px ; en-tête de colonnes sur fond `#DFA6D3`, texte noir gras **Barlow Semi Condensed** 600, majuscules pour SÉQUENCE ; « N° » en rouge ; « TC MIN » en italique gras.
- Corps : police **Barlow Semi Condensed** 600, ~8,5 pt, centré horizontalement et verticalement.
  - SÉQUENCE et SUJET : noir `#111`.
  - N° : rouge `#C42B2B`.
  - VALEUR, ANGLE, MOUVEMENT, ACTION : brun rouge `#7A2E1F`.
  - FOCALE et TC : noir gras ; TC en italique.
- Une ligne d'espacement vide (fond `#DFA6D3`) après chaque séquence, dernière comprise.
- Largeurs relatives : SÉQUENCE 16 %, N° 2,5 %, SUJET 8 %, VALEUR 7 %, ANGLE 14,5 %, MOUVEMENT 15,5 %, FOCALE 6 %, ACTION 23,5 %, TC 7 %. Les colonnes optionnelles redistribuent proportionnellement.
- Pagination : une séquence ne se coupe pas entre deux pages si elle tient sur une page (`break-inside: avoid` sur un `<tbody>` par séquence) ; sinon l'en-tête de colonnes est répété (`thead { display: table-header-group }`).
- Pied de page optionnel : titre du projet · version · date · « page x / y ».
- Thèmes alternatifs : **Papier** (tokens de l'app, §11) et **Sobre** (noir et blanc, pour photocopie).

### 8.3 Formats
- **PDF** : vue d'impression dédiée (`/print`) + `window.print()` ; bouton « Exporter PDF » qui ouvre la vue et déclenche l'impression.
- **Excel (.xlsx)** via ExcelJS : mêmes fusions (`mergeCells`), couleurs, polices de repli, largeurs, ligne d'espacement, onglet supplémentaire « Registre ».
- **CSV** (une ligne par plan, sans fusion) et **JSON** (projet complet).
- **Import** : `.decoupage`, JSON, CSV/TSV (assistant de correspondance des colonnes).

### 8.4 Contrôle visuel
Test Playwright : charge le seed RAV3 (§12), ouvre `/print` en thème Mauve, capture en A4 paysage et enregistre `test-results/export-rav3.png`. Compare-le visuellement à `docs/reference/export-decoupage.png` (ouvre les deux images et décris les écarts dans PROGRESS.md) ; corrige jusqu'à ce que la structure (fusions, couleurs, typographie, proportions) soit indiscernable à l'œil.

---

## 9. CONTRÔLES DE LA SCRIPTE (avertissements non bloquants)

Petites pastilles dans la marge de la grille + panneau « Vérifications » listant tout, cliquable :
1. Zoom présent dans le mouvement mais focale de départ ou d'arrivée manquante.
2. Plan sans valeur de cadre, ou sans sujet.
3. Deux plans consécutifs **identiques** en valeur, angle et sujet (risque de faux raccord / saute) — sauf si leurs mouvements diffèrent.
4. Séquence sans aucun plan, ou séquence en mode documentaire qui ne s'ouvre pas ou ne se ferme pas sur un plan large (général, ensemble ou moyen).
5. Écart estimé / calculé supérieur à 25 %.
6. Mouvement « drone » : rappel réglementaire (catégorie ouverte, 120 m maximum au-dessus du sol, distances de sécurité, formation A1/A3 selon la classe ; vérifier les zones sur Géoportail).
7. Mouvement « épaule » ou « steadicam » : rappel machiniste de sécurité.
8. Sujet non reconnu dans la base des personnages (proposer de le créer).
Chaque contrôle peut être ignoré pour un plan (« ignorer ici »), mémorisé dans le projet.

---

## 10. INSPECTEUR DU PLAN ET LIENS AVEC LA PRÉPARATION

Panneau droit repliable, pour le plan sélectionné :
- Code du plan, séquence, décor, effet ; vignette storyboard (glisser une image, stockée en IndexedDB) ;
- **Angle de champ** calculé et schéma en cône (SVG) ;
- **Matériel déduit** (règles dans `src/domain/equipment.ts`, testées) :
  - trav avant/arrière/latéral → rails + dolly ou slider ;
  - trav circulaire / courbe → rails courbes ou gimbal ;
  - trav vertical / grue → grue, jib ;
  - top shot → potence ou grue ;
  - steadicam / gimbal → stabilisateur ;
  - épaule → rig épaule ;
  - drone → drone + télépilote ;
  - zoom → optique zoom couvrant la plage ;
  - chaque focale fixe distincte → ligne dans la liste optiques.
  Chaque déduction est rangée dans une catégorie de chef de poste : **Image, Machinerie, Lumière, Son**.
- Champs Son (IN / OFF / V.O. / musique diégétique / extradiégétique / playback), Lumière (effet, intention), Notes de raccord (costume, accessoire, entrée/sortie de champ).

Vue **« Listes de matériel »** (dans la sidebar) : agrégation par chef de poste de tout le matériel déduit + ajouts manuels, avec les plans concernés (clic → plan). Export PDF/CSV.

---

## 11. DIRECTION ARTISTIQUE DE L'APPLICATION (référence : `docs/reference/da-truby.png`)

Esprit : **cahier de travail papier**, organique, calme, éditorial. Pas de dark-SaaS, pas de dégradés criards, pas d'ombres lourdes, pas d'emoji dans l'interface.

**Tokens** (`src/styles/tokens.css`) :
```css
:root{
  --paper:#F2ECE1;        /* fond général, papier crème */
  --paper-card:#FBF8F2;   /* cartes et cellules */
  --kraft:#D8C7A3;        /* sidebar, papier kraft */
  --kraft-deep:#C9B48B;
  --ink:#2A2824;          /* texte principal */
  --ink-soft:#6E675B;     /* texte secondaire */
  --rule:#D3C8B4;         /* filets */
  --rust:#9C3D2B;         /* accent manuscrit, annotations */
  --navy:#2E4263;         /* bouton primaire */
  --sage:#5E7B4C;         /* validation, coche */
  --ochre:#B88A2E;        /* avertissement */
  --focus:#2E4263;
  --radius:4px;
}
```
Prévoir un thème sombre « Encre » (papier brun très sombre `#1E1B17`, encre crème `#EDE5D6`, rouille éclaircie), basculable par une icône lune, comme sur la référence.

**Typographie** :
- Grands titres de page : *Cormorant Garamond* 500, 34–40 px, avec chiffres elzéviriens ; le nombre mis en valeur en rouille (« Les **7** séquences »).
- Interface et cellules : *Source Serif 4* 14 px, chiffres tabulaires dans la grille.
- Annotations, « Enregistré dans le navigateur », étiquettes d'étape (« Étape 5 · Découpage »), guillemets de répétition : *Caveat*, rouille, soulignées à main levée (SVG).
- Scénario : *Courier Prime* 12 pt.
- Timecodes : *JetBrains Mono* 13 px.

**Composition** (calquer la référence) :
- **Topbar** fine : accueil, enregistrer, annuler/rétablir, état de sauvegarde manuscrit ; au centre « Découpage Studio · {titre du projet} » ; à droite avatar en initiale cerclée, lune, réglages, bouton « Exporter » (contour), bouton primaire marine.
- **Sidebar kraft** (260 px) : titre du projet en serif, « {n} étapes validées sur {N} » en manuscrit, barre de progression fine (vert sauge) ; liste « Processus de préparation » dans l'**ordre de production** : 1 Note d'intention · 2 Scénario · 3 Dépouillement · 4 **Découpage technique** · 5 Storyboard · 6 Plan au sol · 7 Listes de matériel · 8 Plan de travail · 9 Feuille de service · 10 Exporter ; chaque entrée a un numéro cerclé (coche sauge quand l'étape est validée) et un pourcentage d'avancement en italique à droite ; l'entrée active est une carte blanche. Les étapes non encore développées sont visibles mais marquées « bientôt » (manuscrit). Paramètres en bas, puis aide-mémoire clavier en petit.
- **Zone principale** : colonne de lecture centrée (max ~1180 px pour les pages de texte ; pleine largeur pour la grille), en-tête de page avec surtitre manuscrit + grand titre serif + icône info ; cartes à bord fin `--rule`, fond `--paper-card`.
- Grain papier global très léger (SVG noise, opacité 0,04) sur `--paper` et un grain plus marqué sur la sidebar kraft.
- Micro-interactions sobres : 120–180 ms, `ease-out`, aucune animation gratuite ; focus visible marine 2 px.
- États vides élégants : phrase manuscrite + action claire (« Aucune séquence pour l'instant — créez la première, ou importez un scénario »).
- Accessibilité : contrastes AA, navigation clavier totale, `aria` sur la grille (`role="grid"`).

---

## 12. PROJET DE DÉMONSTRATION « RAV3 » (seed + jeu de test de l'export)

Format **clip**, `tcMode: 'piste'`, granularité TC par action. Transcription exacte de la référence. Notation : `n° · sujet · valeur · angle · mouvement · focale` ; les actions et TC indiquent les plans couverts.

**1, CHAMBRE ADMIRATRICE** — focale 16mm partout — TC « 0:00 - 0:35 » (plans 1-6)
1 · Admiratrice · Taille · Face, Hauteur regard · Tilt haut, trav avant
2 · Admiratrice · Rapproché · 3/4 Face, Hauteur regard · Trav circulaire
3 · Admiratrice · Gros plan · 3/4 Face, Hauteur regard · Trav circulaire
4 · Admiratrice · Taille · 3/4 Dos · Traveling arrière
5 · Affiche · Insert · Plongé · Tilt bas
6 · Admiratrice · Rapproché · Hauteur regard, Profil · Traveling avant
Actions : [1-3] « Admiratrice assise sur le lit, pensive » · [4] « Elle prend l'affiche de la vedette » · [5] « Regarde l'affiche de la vedette » · [6] « se rapproche lentement de la fenetre »

**2, PARC DES COQUELICOTS** — 50mm partout
1 · Main candice · Insert · - · Traveling avant
2 · Candice · Taille · Face, Hauteur regard · Traveling arrière
3 · Candice · Rapproché · Face, Hauteur regard · Traveling arrière
4 · Candice · Taille · Face, Hauteur regard · Traveling arrière
5 · Candice · Rapproché · Face, Hauteur regard · Traveling arrière
6 · Candice · Taille · Face, Hauteur regard · Trav circulaire
7 · Candice · Rapproché · Face, Hauteur regard · Trav circulaire
8 · Candice · Taille · Face, Hauteur regard · Traveling arrière
Actions : [1-3] « Candice marche sur le pont en laissant glisser sa main sur la rambarde » TC 0:00 - 0:51 · [4-5] « Marche le long du chemin en chantant » TC TOUT · [6-8] « Chante assise sur un banc » TC TOUT
(À l'export, l'angle « Face, Hauteur regard » apparaît en trois blocs : 2-3, 4-5, 6-8 ; pour reproduire exactement, marque ces frontières par l'option « coupure de fusion forcée » sur un plan — ajoute cette option au modèle : `Shot.mergeBreak?: ColumnKey[]`.)

**3, JARDIN SQY** — Candice · 50mm · Traveling arrière (1-4) · action [1-4] « Candice marche le chemin en chantant » · TC 0:51 - 1:16
1 Moyen · 2 Taille · 3 Rapproché → Face, Hauteur regard (1-3) ; 4 Gros plan · Face, Plongée

**4, LOGE** — Vedette · Insert · Contre plongée · Fixe · 70mm (tous) · TC 0:20 - 0:36 (1-6)
Actions une par plan : 1 « La vedette met du rouge à lèvres » · 2 « se maquille la joue » · 3 « se coiffe les cheveux » · 4 « elle met ses bagues » · 5 « maquilleuse lui fais les cils » · 6 « elle enlève ses lunettes »

**5, ROND POINT SQY** — Candice · Trav circulaire + suivi · 50mm · action [1-4] « Candi marche et chante en déambulant. » · TC 1:34 - 2:01
1 Moyen · 2 Taille · 3 Rapproché → 3/4 Face, Hauteur regard ; 4 Gros plan · Face, Hauteur regard

**6, ESCALIERS SQY** — Candice · 50mm · TC 2:01 - 2:26
1 Moyen · 2 Taille · 3 Rapproché · 4 Gros plan → 3/4 Face, Hauteur regard · Traveling latéral
5 Moyen · 6 Taille · 7 Rapproché · 8 Gros plan → Face, Hauteur regard · Traveling arrière
9 Taille · 10 Rapproché → Face, Hauteur regard · Trav circulaire
Actions : [1-8] « Candice descend marches en chantant » · [9-10] « Elle pose un dernier pas et s'arrête et le soleil se lève derrière son dos »

**7, SALLE DE CONCERT** — TC 2:00 - 3:01 (1-15)
1 · Vedette · Rapproché · Dos, contre plongée · Traveling avant · 16mm
2 · Vedette · Taille · Dos, contre plongée · Trav. avant, Trav. circulaire · 16mm
3 · Vedette · Très GP · 3/4 Face, Hauteur regard · Pano, Trav. arrière · 100mm
4 · Vedette · Taille · 3/4 Dos, Hauteur regard · Traveling latéral · 50mm
5 · Vedette · Rapproché · 3/4 Dos, Hauteur regard · Traveling latéral · 50mm
6 · Vedette · Gros plan · 3/4 Dos, Hauteur regard · Traveling latéral · 50mm
7 · Vedette · Ensemble · Face, Hauteur regard · Traveling avant · 16mm
8 · Vedette · Insert · Plongé · Traveling avant · 50mm
9 · Vedette · Rapproché · 3/4 Face, Hauteur regard · Traveling avant · 50mm
10 · Admiratrice · Moyen · Face, Hauteur regard · Traveling avant · 16mm
11 · Admiratrice · Moyen · Face, Hauteur regard · Traveling arrière · 16mm
12 · Admiratrice · Taille · 3/4 Face, Hauteur regard · Trav circulaire · 16mm
13 · Admiratrice · Taille · 3/4 Face, Hauteur regard · Trav circulaire · 16mm
14 · Admiratrice · Rapproché · 3/4 Face, Hauteur regard · Trav circulaire · 16mm
15 · Admiratrice · Gros plan · 3/4 Face, Hauteur regard · Trav circulaire · 16mm
Actions : [1-3] « La vedette marche en direction du piano » · [4-7] « Assise, elle joue au piano » · [8] « Ses mains qui jouent au piano » · [9] « Dernière parole "ma vedette" » · [10-15] « L'admiratrice, assise, admire la vedette »

Personnages du seed : Admiratrice, Candice (alias « Candi »), Vedette, Maquilleuse (figurante). Durées estimées : renseigne des valeurs plausibles pour illustrer les écarts.

Prévoir aussi un **second seed « fiction »** court (3 séquences, mode cumulatif, avec dialogues) pour illustrer le minutage automatique.

---

## 13. SCÉNARIO ET LIAISON (phase ultérieure, voir §14)

- Éditeur de scénario léger en syntaxe **Fountain** (en-têtes `INT./EXT. LIEU - JOUR`, personnages en majuscules, dialogues, parenthèses, transitions), rendu en Courier Prime façon page de scénario.
- Analyse automatique : chaque en-tête crée ou met à jour une séquence (libellé = lieu, INT/EXT, effet), chaque personnage parlant crée une fiche ; la numérotation des séquences suit le scénario.
- **Sélectionner du texte → clic droit → « Créer un plan avec cette action »** : crée le plan dans la bonne séquence, l'action est pré-remplie, le passage est surligné dans le scénario (couleur de séquence) ; survoler le plan dans la grille surligne son passage, et inversement.
- Les répliques sélectionnées vont dans `dialogue` et nourrissent le minutage.
- Import `.fountain`, `.txt` ; export `.fountain`.

---

## 14. PHASES (ordre strict, chacune avec sa Definition of Done)

**P0 — Fondations.** Vite/React/TS strict, ESLint, Prettier, Vitest, Playwright, polices, tokens.css, paper.css, coquille vide (topbar + sidebar kraft + zone principale) fidèle à la DA. `CLAUDE.md`, `PROGRESS.md`, `DECISIONS.md`, `git init`.
*DoD* : `npm run dev` affiche la coquille ; test et build verts.

**P1 — Domaine pur.** Types §3, `vocabulary.ts`, parseur/formatteur de timecode, calcul des durées et des plages, numérotation dérivée, `computeMerges`, normalisation des jetons, règles matériel, contrôles §9. **Tests unitaires exhaustifs**, dont un test qui calcule les fusions du seed RAV3 et vérifie les blocs attendus colonne par colonne.
*DoD* : couverture de `src/domain` ≥ 90 %.

**P2 — Grille éditable.** Store Zustand + zundo, rendu des séquences/plans, édition de cellules, navigation clavier §4.2, ajout/suppression de plans et séquences, aperçu « 〃 » des fusions, pied de total.
*DoD* : saisir un découpage de 2 séquences × 5 plans au clavier seul, sans souris (test Playwright).

**P3 — Saisie intelligente.** Popover de suggestions, TokenInput angle/mouvement, focale verrouillée « mm » avec dédoublement zoom, sujet ↔ personnages, saisie tolérante du TC.
*DoD* : tests Playwright de chaque comportement.

**P4 — Couverture & réordonnancement.** Lier/délier l'action, dnd-kit plans et séquences, garde-fou inter-séquences, scission automatique des blocs, toasts d'annulation.
*DoD* : tests sur les invariants §3 après chaque opération.

**P5 — Persistance.** Dexie (autosave + indicateur manuscrit « Enregistré dans le navigateur »), liste des projets à l'accueil, nouveau projet (assistant 2 étapes : titre/format → réglages minutage), ouvrir/enregistrer `.decoupage` (`⌘/Ctrl+S`), chargement des deux seeds.
*DoD* : recharger la page conserve tout ; aller-retour fichier sans perte (test).

**P6 — Export.** Vue `/print` thème Mauve fidèle à la référence, thèmes Papier et Sobre, PDF via impression, xlsx ExcelJS avec fusions, CSV, JSON, import CSV/JSON, comparaison visuelle §8.4.
*DoD* : capture RAV3 jugée conforme et écarts résiduels documentés dans PROGRESS.md.

**P7 — Registre.** Les quatre onglets §7, comparaison estimé/calculé, fusion de personnages, navigation vers la grille.

**P8 — Minutage avancé.** Réglages des coefficients avec aperçu, override manuel « ✎ », mode piste avec import audio, forme d'onde, sélection des plages, lecture d'extrait, taux de couverture.

**P9 — Inspecteur & matériel.** Panneau §10, angle de champ et cône, matériel déduit, vue « Listes de matériel » par chef de poste, panneau « Vérifications » §9.

**P10 — Finitions DA.** Sidebar avec avancement réel par étape, états vides, thème « Encre », palette de commandes, aide des raccourcis `?`, revue d'accessibilité, revue visuelle complète contre `da-truby.png`.

**P11 — Scénario & liaison** (§13).

**P12 — Modèles de séquence.** Insertion de gabarits selon le format :
- *Documentaire* : plan d'exposition du lieu → arrivée du personnage → action/interaction → plans de coupe (mains, regards, écoute, amorce) → interview → illustrations « beauty » → plan de fin (large) ;
- *Interview institutionnelle* : large d'ouverture, axe épaule hauteur regard, gros plan à chaque question, plans de coupe, large de fin ;
- *Clip* : couverture performance (TOUT) + séquences narratives.
Les gabarits créent des plans pré-remplis (valeur, axe) à compléter.

**P13 — Déploiement.** Workflow GitHub Actions → GitHub Pages, PWA (hors ligne, installable), README illustré en français.

---

## 15. SI TU AS ENCORE DU TEMPS (dans l'ordre)

1. **Storyboard** : vue en cartes des mêmes plans (vignette, code, valeur · focale · mouvement, action, durée), réordonnable, export planche PDF (2/4/6 par page).
2. **Plan au sol** : éditeur SVG par séquence (caméras avec cône calculé depuis la focale et le capteur, comédiens numérotés et leurs déplacements, murs, portes, fenêtres, sources de lumière, rails) ; chaque caméra est liée à un ou plusieurs plans.
3. **Plan de travail** : bandes par jour de tournage, glisser les séquences/plans entre les jours, regroupement suggéré par décor puis par comédiens puis par axes, durée estimée par jour.
4. **Feuille de service** générée pour un jour : convocations, décor et adresse, plans du jour, matériel requis, export PDF dans la même DA.
5. **Dépouillement** par séquence : personnages, figurants, accessoires, costumes, maquillage, effets, véhicules, machinerie, lumière, son ; accessoires détectés dans les actions proposés en un clic.
6. Assistant IA **facultatif** (clé API saisie dans les réglages, stockée localement, jamais exportée) : proposer un découpage de départ pour une séquence à partir de son texte, en respectant strictement le vocabulaire §5 ; désactivé proprement sans clé.

---

## 16. CE QU'IL NE FAUT PAS FAIRE

- Pas de backend, pas de compte, pas de cloud obligatoire.
- Ne jamais laisser l'utilisateur éditer un numéro de séquence ou de plan.
- Ne jamais compter plusieurs fois la durée d'une action couverte par plusieurs plans.
- Ne jamais fusionner des cellules à travers deux séquences.
- Pas de listes déroulantes fermées pour valeur, angle ou mouvement : texte libre + suggestions.
- Pas de thème sombre « SaaS » par défaut, pas de dégradés, pas d'emoji dans l'interface.
- Ne pas s'arrêter pour poser une question : décider, consigner, continuer.
