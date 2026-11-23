# Règles de mise en page — Découpage Studio

Les règles techniques de trois documents : **scénario**, **découpage technique** et **storyboard**. Elles ne fixent aucune direction artistique.

Ce document est fait pour être donné tel quel à une IA chargée de produire l'un de ces documents. Elle doit appliquer les règles techniques à la lettre et ne prendre aucune liberté de mise en page.

Ce qui relève de la DA est marqué **[DA]** : police d'interface, couleurs, fonds, titres. Vous le remplacez librement, sans toucher au reste.

Unités : pt = 1/72 po ; mm. Origine des coordonnées : en haut à gauche de la page.

---

## 1. Scénario (modèle « Lorem ipsum », format KIT Scenarist)

Les règles reproduisent, au point près, le PDF du modèle Lorem ipsum. L'écran, le PDF, les images et le Word donnent exactement les mêmes pages.

### 1.1 Page
| Réglage | Valeur |
|---|---|
| Format | A4 portrait, 595,28 × 841,89 pt |
| Police | Courier Prime 12 pt, chasse fixe (1 caractère = 7,195 pt) — imposée, ce n'est pas de la DA : le minutage « 1 page ≈ 1 minute » en dépend |
| Lignes par page | 58 |
| Interligne | 12,1 pt |
| Ligne de base de la 1re ligne | 77,7 pt du haut |
| Bord droit du texte | 547,2 pt |
| Numéro de page | à partir de la page 2, en haut à droite, ligne de base 46,2 pt, aligné sur 547,2 pt, forme « 2. » ; la page 1 n'est pas numérotée |

### 1.2 Colonnes de chaque élément
`x` = abscisse du début de ligne (pt) ; `car.` = largeur maximale en caractères.

| Élément | x | car. | Particularités |
|---|---|---|---|
| En-tête de séquence | 108 | 61 | MAJUSCULES ; numéro « 1. » suspendu dans la marge, aligné à droite contre 98 pt (début du numéro vers 83,7 pt) |
| Action (didascalie) | 108 | 61 | |
| Personnage | 252,4 | 38 | MAJUSCULES |
| Didascalie de jeu (parenthèse) | 210 | 26 | entre parenthèses |
| Réplique | 181,6 | 35 | |
| Transition | 108 | 61 | MAJUSCULES, alignée à droite |
| Texte centré | 108 | 61 | centré |
| Notes, parties, résumés | — | — | jamais imprimés |

### 1.3 Espacement vertical
- Lignes vides avant un élément :
  - **2** avant un en-tête de séquence ;
  - **0** entre personnage, parenthèse et réplique d'une même prise de parole ;
  - **1** dans tous les autres cas.
- Jamais de ligne vide en haut de page.

### 1.4 Retour à la ligne
- On coupe à l'espace, comme un traitement de texte. On peut aussi couper juste après un trait d'union, un tiret (– —) ou une barre (/).
- Un mot plus long que la colonne est coupé net.
- Les espaces en fin de ligne sont retirés, ceux du début de la ligne suivante aussi.
- L'emphase ne compte pas dans la largeur : `*italique*`, `**gras**`, `_souligné_`. Les marques de révision `[[…]]` ne s'impriment jamais.

### 1.5 Pagination
- Un élément garde ses lignes ensemble. Il ne se coupe d'une page à l'autre que s'il dépasse une page entière.
- Une prise de parole (personnage, parenthèses, réplique) forme un tout.
- Un en-tête de séquence emmène au moins **2 lignes** de ce qui le suit. Sinon il passe à la page suivante.
- Un personnage emmène au moins **1 ligne** de sa réplique.
- Un saut de page forcé (`===`) commence une nouvelle page.

### 1.6 Numérotation des séquences
- Numéro dérivé de l'ordre (1, 2, 3…), imprimé dans la marge gauche devant l'en-tête.
- En Fountain : `#1#` en fin d'en-tête. Un en-tête forcé commence par un point (`.LOR. LOREM IPSUM DOLOR - ELIT  #1#`).

### 1.7 Page de garde (non numérotée)
- Titre au **17e rang**, centré sur la page, 52 caractères au plus par ligne, en majuscules, 3 lignes au plus.
- Puis crédit, auteur et source, centrés, séparés par une ligne vide.
- Contact aligné à gauche (x 108, 61 car.) à partir du **43e rang**.
- Date (et copyright) centrée sur la dernière ligne.
- Rien n'est coupé : un texte trop long continue sur une deuxième page de garde.

### 1.8 Extrait de référence (Lorem ipsum)
Source Fountain :
```
.LOR. LOREM IPSUM DOLOR - ELIT  #1#

LOREM ipsum dolor sit amet, consectetur adipiscing elit. Quisque quis nulla eu mi euismod vestibulum. IPSUM ante sem, vehicula id ultrices vitae, laoreet id ligula.

IPSUM
(aliquam erat)
Quisque consectetur felis eu nibh facilisis, quis lacinia nisi semper.
```
Résultat attendu, colonnes : page · rang (0 = première ligne) · x en pt · texte. Les rangs sautés sont des lignes vides (§ 1.3).
```
1  0   83.7  1. LOR. LOREM IPSUM DOLOR - ELIT
1  2  108.0  LOREM ipsum dolor sit amet, consectetur adipiscing elit.
1  3  108.0  Quisque quis nulla eu mi euismod vestibulum. IPSUM ante sem,
1  4  108.0  vehicula id ultrices vitae, laoreet id ligula.
1  6  252.4  IPSUM
1  7  210.0  (aliquam erat)
1  8  181.6  Quisque consectetur felis eu nibh
1  9  181.6  facilisis, quis lacinia nisi
1 10  181.6  semper.
```
Le modèle complet (Fountain + lignes attendues, 700 lignes) est dans `src/domain/__fixtures__/kit/modele-complet.*`. Une mise en page est juste quand elle donne ces lignes à l'identique.

---

## 2. Découpage technique (tableau)

### 2.1 Page
- A4 paysage (A3 en option), marges 12 mm.
- Pied de page facultatif : titre du projet · version · date · « page x / y ».
- **[DA]** Fond, grain papier, titre « Découpage technique » au-dessus du tableau.

### 2.2 Colonnes, dans cet ordre
Largeurs relatives, en % de la largeur du tableau. Quand on ajoute des colonnes facultatives, les largeurs sont recalculées en proportion.

| Colonne | Largeur | Fusion verticale |
|---|---|---|
| SÉQUENCE | 16 | un seul bloc par séquence : « 3, LIBELLÉ » |
| N° | 2,5 | jamais ; tient sur une seule ligne |
| Sujet | 8 | valeurs identiques consécutives |
| Valeur | 7 | idem |
| Angle | 14,5 | idem (axe puis hauteur) |
| Mouvement de caméra | 14 | idem |
| Focale | 7,5 | idem |
| Action | 23,5 | même bloc d'action (pas même texte) |
| TC MIN | 7 | selon le minutage choisi |

Colonnes facultatives : Ouverture 5 (rangée juste après Focale), Dialogue 16, Son 11, Statut 6, Image 12, Jour 4, Storyboard 2,5.

### 2.3 Règles de fusion (cellules fusionnées verticalement)
- Une fusion ne traverse jamais deux séquences.
- La comparaison ignore la casse et les espaces superflus. Les listes de jetons (angle, mouvement) se comparent dans l'ordre.
- Chaque colonne fusionne indépendamment des autres : une fusion d'Action peut chevaucher un changement d'Angle.
- Pendant la saisie, une valeur répétée s'affiche « 〃 ». À l'export, elle devient une fusion.

### 2.4 Tableau
- Bordures pleines 1 px sur toutes les cellules.
- Texte centré horizontalement et verticalement.
- Corps 8,5 pt, interligne 1,2, marges internes 1,6 × 1,2 mm.
- En-tête de colonnes : 9 pt, gras, marges internes 1,8 × 1 mm. SÉQUENCE en majuscules, TC MIN en italique gras.
- Focale et TC : gras ; TC en italique.
- Une ligne d'espacement vide de 4,2 mm après **chaque** séquence, la dernière comprise.
- Numéro de plan : dérivé de l'ordre dans la séquence (1, 2, 3…). Code complet au choix : `3.4`, `3-4` ou `3D`.
- Numérotation figée (option) : un plan ajouté prend le numéro bis du précédent (`2A`, `2B`) et les autres gardent le leur.
- **[DA]** Polices, couleurs du texte par colonne, couleur de fond de l'en-tête et de la ligne d'espacement. Variante « économie d'encre » : sans fonds, trait inférieur de l'en-tête à 2 px, ligne d'espacement de 2,5 mm.

### 2.5 Pagination
- Une séquence ne se coupe pas entre deux pages si elle tient sur une page.
- Sinon elle continue sur la page suivante, et l'en-tête de colonnes est répété en haut de chaque page.
- Les cellules fusionnées coupées par la page sont reprises sur la page suivante.

### 2.6 Autres sorties
- Excel : mêmes fusions, largeurs et ligne d'espacement.
- CSV : une ligne par plan, sans fusion.

---

## 3. Storyboard (planches)

### 3.1 Feuille
| Réglage | Valeur |
|---|---|
| Format | A4, paysage par défaut ; portrait pour les images verticales |
| Marges | 10 mm sur les côtés, 6 mm en haut et en bas |
| Pied de page | bande de 3,5 mm (titre, version, date), réservée même vide |
| Espace entre cases | 5 mm |
| Cases par feuille | 1, 2, 3, 4, 6 ou 9 |

Seuls les nombres qui remplissent bien la feuille pour le format d'image du projet sont proposés : la grille doit occuper au moins **73 %** de la hauteur utile et **80 %** de la largeur utile. À défaut, on propose les deux grilles les mieux remplies.

### 3.2 Calcul de la grille
1. Zone utile = feuille − marges − pied de page.
2. Pour chaque nombre de colonnes qui divise le nombre de cases, on calcule la plus grande image au bon format (16/9 par défaut) qui tient dans la case. La case contient l'image, une légende de 13 mm, 4,2 mm de marge de cadre et 0,6 mm de bordure.
3. On retient la grille dont l'image est la plus grande.
4. Le reste de hauteur se répartit ainsi :
   - 30 % aèrent l'espace entre les rangées ;
   - du reste, un quart va en haut et le solde en bas (le bas est plus généreux) ;
   - avec une seule rangée : 40 % en haut, 60 % en bas.
5. Le reste de largeur se partage également à gauche et à droite.

### 3.3 Case
- Image au format du projet, en pleine largeur de la case, filet de 1 px sous l'image.
- Code du plan (« 3.4 ») en haut à gauche de l'image, 8 pt, à 4 px du bord.
- Légende sous l'image, 7,5 pt, interligne 1,3, justifiée, **3 lignes au plus** (le surplus est coupé). Dans l'ordre : **sujet en gras** · valeur · angle · mouvement · focale · texte de l'action · durée.
- Plusieurs images pour un plan : côte à côte dans la même case, séparées par un filet vertical.
- Une case ne se coupe jamais. Une nouvelle feuille commence après chaque planche.
- **[DA]** Couleur des filets, coins arrondis, police, fond.

---

## 4. Consigne à donner à l'IA
> Applique strictement les règles techniques de ce document (formats, positions, largeurs, espacements, coupures, fusions, pagination). Ne modifie que ce qui est marqué [DA], selon la direction artistique fournie. N'ajoute aucun élément décoratif qui changerait la place du texte. En cas de doute, la règle technique l'emporte sur la DA.
