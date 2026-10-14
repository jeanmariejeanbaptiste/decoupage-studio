# Journal des arbitrages

| Date | Décision | Raison |
|---|---|---|
| 2026-10-14 | Le dépôt git existait déjà (branche `claude/loving-cori-i2y706`) : pas de `git init`, travail sur cette branche. | Consigne d'environnement. |
| 2026-10-14 | Les images `docs/reference/*.png` sont absentes du dépôt : la DA et l'export suivent la description textuelle détaillée de la spec (§8.2, §11). | Pas de référence visuelle disponible. |
| 2026-10-14 | Vite 5.4 et Vitest 2 plutôt que les dernières majeures. | Compatibilité éprouvée avec React 18. |
| 2026-10-14 | Playwright épinglé en 1.56.1. | Correspond au Chromium préinstallé (build 1194), pas de téléchargement. |
| 2026-10-14 | Routage par hash maison (`#/route`), sans bibliothèque. | GitHub Pages sans réécriture serveur ; peu de routes. |
| 2026-10-14 | Ajout de `Shot.movementSep` (', ' ou ' + ') pour préserver le séparateur saisi entre mouvements. | §5.3 demande de préserver le séparateur ; `movement: string[]` le perdait. |
| 2026-10-14 | Les jetons d'angle et de mouvement sont stockés tels que saisis ; à l'export, seule la première lettre est mise en majuscule. Choisir une suggestion insère son libellé court. | Fidélité exacte à la référence (« Plongé », « Dos, contre plongée »). |
| 2026-10-14 | Le document projet (`ProjectDoc`) regroupe projet, séquences, plans, blocs, personnages, décors, contrôles ignorés, étapes validées, vocabulaire perso et matériel manuel. | Un seul objet sérialisable = fichier `.decoupage` et entrée IndexedDB. |
| 2026-10-14 | Ajout de `Sequence.overrideSec` : durée manuelle d'une séquence en granularité « séquence ». | §6.2 : une valeur saisie à la main remplace le calcul, quelle que soit la granularité. |
| 2026-10-14 | `Character.aliases` ajouté (Candice / « Candi »). La fusion de fiches verse le nom absorbé dans les alias. | §7 et seed §12. |
| 2026-10-14 | Dupliquer un plan (⌘D) : la copie couvre la même action (même bloc). | La copie est contiguë ; c'est l'usage le plus courant (couverture). |
| 2026-10-14 | Les cellules vides consécutives fusionnent aussi à l'export. | Rendu plus propre ; l'algorithme reste uniforme. |
| 2026-10-14 | Séquence 6 du seed : l'angle « Face, Hauteur regard » fusionne 5-10 (aucune coupure forcée). | Seule la séquence 2 est signalée comme nécessitant `mergeBreak` dans la spec. |
| 2026-10-14 | En mode piste, chaque bloc d'action du seed porte la plage de sa séquence (ex. 0:00 - 0:35 sur les 4 blocs de la séquence 1) ; la colonne TC fusionne alors par valeur identique. | Le modèle place le TC sur l'ActionBlock ; §8.1 fusionne le TC piste par valeurs identiques. |
| 2026-10-14 | « Durée du plan » (colonne optionnelle) = durée de l'action répartie entre les plans qui la couvrent. | Indication de pré-minutage sans double comptage. |
| 2026-10-14 | Dans la grille, ACTION et DIALOGUE sont fusionnées par bloc d'action, TC par séquence (cumulatif + granularité séquence) ou par bloc ; les autres colonnes restent une ligne par plan avec l'aperçu « 〃 ». | §4.3 + §4.4 : éditer chaque plan, mais une action liée est une seule cellule. |
| 2026-10-14 | Suggestions : aucune n'est présélectionnée ; ↓/↑ pour choisir, Entrée/Tab valide la suggestion choisie, sinon le texte libre. Elles n'apparaissent qu'après le début de la frappe. | Texte libre toujours accepté (« Plongé ») ; Échap doit pouvoir annuler l'édition. |
| 2026-10-14 | Tab et la validation (Entrée/Tab) sautent les colonnes en lecture seule (N°, Personnages, Machinerie, Durée) ; les flèches les visitent. | Saisie fluide façon tableur. |
| 2026-10-14 | ⌘⌫ supprime le(s) plan(s) sélectionné(s) ; Suppr/Retour arrière vide les cellules sélectionnées. | La spec ne fixe pas la touche de suppression d'un plan. |
| 2026-10-14 | Alt+↑/↓ déplace le plan dans sa séquence uniquement ; changer de séquence passe par le glisser-déposer (avec confirmation). | Garde-fou §4.5. |
| 2026-10-14 | En mode piste, le pied de grille n'affiche pas d'écart global (la somme des durées estimées des séquences n'est pas comparable à la durée de la piste) ; il affiche la couverture. | Les séquences d'un clip se chevauchent dans le morceau. |
| 2026-10-14 | Paramètre d'URL `?seed=rav3` / `?seed=fiction` pour charger un projet de démonstration (tests, démos). | Tests Playwright reproductibles. |
| 2026-10-14 | Au démarrage : seed via URL, sinon dernier projet ouvert (localStorage), sinon accueil. Une route projet sans projet ouvert propose de revenir à l'accueil. | Local-first, pas de compte. |
| 2026-10-14 | Ouvrir une démonstration crée/écrase le projet de démonstration (identifiant fixe `seed-rav3` / `seed-fiction`). | Démo toujours restaurable dans son état d'origine. |
| 2026-10-14 | Le bouton primaire marine de la barre supérieure est « Valider l'étape » (bascule `validatedSteps`). | §11 demande un bouton primaire ; il alimente « n étapes validées sur N ». |
| 2026-10-14 | La vue d'impression est une route plein écran (`#/print`) sans barre ni sidebar ; `?auto=1` lance l'impression, `?theme=` force un thème. | §8.3 : vue dédiée + `window.print()`. |
| 2026-10-14 | Le fond de page imprimé est peint par `@page { background }` (Chromium) pour couvrir aussi les marges qui accueillent le pied de page. | Fond mauve à fond perdu sur chaque page. |
| 2026-10-14 | Le CSV utilise le séparateur « ; » et un BOM UTF-8. | Ouverture directe dans Excel en français. |
| 2026-10-14 | Import CSV : une nouvelle séquence à chaque changement de libellé ; les actions identiques consécutives sont liées. | Réimport fidèle d'un export CSV. |
| 2026-10-14 | ExcelJS est chargé dynamiquement au clic. | Garder le bundle initial léger. |
| 2026-10-14 | Playwright reconstruit toujours l'application (`reuseExistingServer: false`). | Éviter de tester une version périmée. |
| 2026-10-14 | Registre accessible depuis la section « Base du projet » de la sidebar (hors des 10 étapes de préparation). | La spec ne place pas le Registre dans les étapes. |
| 2026-10-14 | Durées estimées du seed fiction choisies pour illustrer les trois niveaux d'écart (≤ 10 %, ≤ 25 %, > 25 %). | §12 : « valeurs plausibles pour illustrer les écarts ». |
| 2026-10-14 | Steadicam / gimbal, épaule et drone sont rangés au poste Image ; rails, grue, potence au poste Machinerie. | Répartition usuelle des postes en France. |
| 2026-10-14 | Le scénario s'édite en Fountain brut (zone de saisie) avec un calque de surlignage ; la vue « Page » formate le texte. Le lien grille → scénario passe par l'inspecteur (passage lié) et le panneau latéral du scénario. | Fiabilité de la sélection (positions exactes de la zone de saisie) ; la grille et le scénario sont deux pages distinctes. |
| 2026-10-14 | La k-ième scène du scénario met à jour la k-ième séquence ; les séquences en surplus ne sont jamais supprimées. | « La numérotation des séquences suit le scénario » sans perte de travail. |
| 2026-10-14 | Une séquence vide propose « Ajouter un plan » dans la grille. | Les séquences créées par le scénario n'ont pas de plan. |
| 2026-10-14 | Service worker écrit à la main (pas de plugin PWA) ; non enregistré sous WebDriver pour ne pas perturber les tests. | Zéro dépendance supplémentaire ; tests reproductibles. |
| 2026-10-14 | Plans au sol stockés dans `ProjectDoc.floorPlans` (champ optionnel, rétrocompatible) ; repère 1000 × 640 unités, grille de 20. | Pas de migration de schéma nécessaire. |
