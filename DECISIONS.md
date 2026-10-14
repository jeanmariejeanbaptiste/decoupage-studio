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
