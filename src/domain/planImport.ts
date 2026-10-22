import { PLAN_H, PLAN_W } from './floorplan';

/**
 * Import d'un plan de locaux décrit par une IA externe (Claude, ChatGPT, Gemini…).
 *
 * L'outil fournit des consignes très strictes, calculées pour l'image de fond posée sur le plan au sol :
 * l'IA répond par un fichier Markdown dont chaque ligne suit une grammaire exacte. Le fichier est lu
 * tel quel (aucun copier-coller), vérifié ligne par ligne, puis placé exactement sur l'image de fond.
 */

/** En-tête obligatoire, première ligne du fichier. */
export const PLAN_HEADER = '# PLAN DECOUPAGE-STUDIO v2';
/** Largeur de la grille de coordonnées de l'image (la hauteur suit le format de l'image). */
export const IMAGE_GRID_W = 1000;

export interface InstructionOptions {
  /** Format de l'image de fond (hauteur / largeur). Absent : pas d'image, repère en centimètres. */
  ratio?: number;
  /** Dimensions en pixels de l'image d'origine (rappelées à l'IA). */
  pixels?: { w: number; h: number };
}

/** Hauteur de la grille de l'image pour un format donné. */
export const imageGridH = (ratio: number) => Math.max(1, Math.round(IMAGE_GRID_W * ratio));

/** Consignes complètes à copier pour l'IA externe, adaptées à l'image de fond (ou à un repère en cm). */
export function aiPlanInstructions(o: InstructionOptions = {}): string {
  const image = o.ratio !== undefined;
  const W = IMAGE_GRID_W;
  const H = image ? imageGridH(o.ratio!) : 0;
  const repere = image
    ? `REPÈRE IMPOSÉ — GRILLE DE L'IMAGE
- Le repère est l'IMAGE ELLE-MÊME, bord à bord, sans aucune marge ni recadrage.
- L'image fournie mesure ${o.pixels ? `${o.pixels.w} × ${o.pixels.h} pixels` : 'W × H pixels'}. Tu la projettes sur une grille de ${W} unités de large et ${H} unités de haut.
- Origine (0,0) = coin HAUT-GAUCHE de l'image. x croît vers la DROITE, y croît vers le BAS.
- Coin haut-droit = (${W},0). Coin bas-gauche = (0,${H}). Coin bas-droit = (${W},${H}).
- Conversion exacte : x = round(pixel_x × ${W} / largeur_en_pixels) ; y = round(pixel_y × ${H} / hauteur_en_pixels).
- Toute coordonnée DOIT vérifier 0 ≤ x ≤ ${W} et 0 ≤ y ≤ ${H}. Une coordonnée hors bornes invalide la ligne.
- La précision attendue est de ±2 unités : vise le CENTRE du trait de mur tel qu'il apparaît sur l'image. Ne « redresse » pas, ne « régularise » pas, ne recentre pas : l'outil superpose tes segments sur l'image, au pixel près.
- Les cotes, titres, légendes, cartouches, flèches du nord, mobilier, hachures, textes et surfaces colorées ne sont PAS des murs.`
    : `REPÈRE IMPOSÉ — CENTIMÈTRES RÉELS
- Origine (0,0) = coin HAUT-GAUCHE du bâtiment. x croît vers la DROITE, y croît vers le BAS. Unité : 1 unité = 1 centimètre réel.
- Estime l'échelle à partir des cotes écrites, sinon des portes (80 à 90 cm), sinon du mobilier.
- grille: <largeur>x<hauteur> donne l'emprise totale en centimètres ; toutes les coordonnées sont dans ces bornes.`;
  return `CONSIGNES MACHINE — IMPORT DE PLAN DANS « DÉCOUPAGE STUDIO »
Destinataire : une IA. Le fichier que tu produis sera lu par un analyseur automatique STRICT, ligne par ligne, octet par octet. Il n'y a aucun humain pour corriger tes écarts. Une seule ligne non conforme est rejetée et signalée comme erreur ; un en-tête non conforme rejette tout le fichier.

══════════════════════════════════════════════════════════════
EXIGENCE N° 1, NON NÉGOCIABLE : LIVRER UN FICHIER TÉLÉCHARGEABLE « plan.md »
══════════════════════════════════════════════════════════════
- Ta réponse N'EST PAS un message de discussion. Ta réponse EST un FICHIER.
- Tu DOIS créer un vrai fichier nommé exactement « plan.md » (UTF-8, fins de ligne LF) et le fournir en PIÈCE TÉLÉCHARGEABLE, avec un bouton ou un lien de téléchargement.
- Utilise pour cela ton outil de création de fichiers : création de fichier / artefact téléchargeable, exécution de code (par exemple Python : open('plan.md', 'w', encoding='utf-8').write(contenu), puis lien de téléchargement du fichier), ou tout autre outil équivalent dont tu disposes.
- INTERDIT : écrire le contenu du plan directement dans le corps de ta réponse. Une interface de discussion interprète « # » et « ## » comme des titres et détruit la syntaxe : le fichier devient illisible pour l'analyseur.
- Dans le corps de ta réponse, écris seulement une ligne : « Fichier plan.md prêt au téléchargement. », suivie du fichier.
- REPLI, UNIQUEMENT si tu n'as réellement aucun moyen de créer un fichier : place la totalité du contenu dans UN SEUL bloc de code délimité par \`\`\`text en première ligne et \`\`\` en dernière ligne, sans aucun texte avant ni après, pour que l'utilisateur l'enregistre tel quel sous « plan.md ». Ce repli est une dégradation : n'y recours jamais si un fichier est possible.
- Le contenu du fichier commence au tout premier caractère par « ${PLAN_HEADER} » et se termine par la ligne « ## FIN ».

MISSION
À partir de l'image de plan de locaux jointe (plan d'architecte, plan d'évacuation, croquis, capture), relève la géométrie des MURS, des PORTES et des FENÊTRES, et rien d'autre.

${repere}

GRAMMAIRE EXACTE (chaque ligne, dans cet ordre, sans aucune ligne vide, sans espace en début ni en fin de ligne)
Ligne 1 : ${PLAN_HEADER}
Ligne 2 : repere: ${image ? 'image' : 'cm'}
Ligne 3 : grille: ${image ? `${W}x${H}` : '<largeur entière>x<hauteur entière>'}
Ligne 4 : echelle_cm_par_unite: <nombre décimal avec un point, ex. 2.5 — ou le mot inconnue>${image ? '' : ' (en repère cm, écris exactement 1)'}
Ligne 5 : murs: <nombre exact de lignes de la section MURS>
Ligne 6 : portes: <nombre exact de lignes de la section PORTES>
Ligne 7 : fenetres: <nombre exact de lignes de la section FENETRES>
Puis : ## MURS
Puis : une ligne par mur, au format
M<numéro sur 3 chiffres> | <x1>,<y1> -> <x2>,<y2> | <standard ou blanc>
Puis : ## PORTES
Puis : une ligne par porte, au format
P<numéro sur 3 chiffres> | <x>,<y> | <largeur> | <angle>
Puis : ## FENETRES
Puis : une ligne par fenêtre, au format
F<numéro sur 3 chiffres> | <x>,<y> | <largeur> | <angle>
Dernière ligne : ## FIN

RÈGLES DE SYNTAXE (aucune tolérance)
1. Séparateur de champs : exactement « espace, barre verticale, espace » ( | ). Jamais de tabulation, jamais deux espaces.
2. Coordonnées : deux entiers séparés par une virgule SANS espace (ex. 120,48). Pas de décimales, pas d'unité, pas de signe +, pas de nombre négatif.
3. Flèche des murs : exactement « espace, tiret, chevron fermant, espace » ( -> ).
4. Numérotation : M001, M002, M003… continue, sans trou, sans doublon ; de même P001… et F001…. Au-delà de 999 éléments, continue sur 4 chiffres (M1000).
5. Largeur : entier strictement positif, dans les unités du repère. Angle : entier de 0 à 179, orientation du mur qui porte l'ouverture (0 = mur horizontal, 90 = mur vertical).
6. Les mots-clés sont en minuscules et sans accent : repere, grille, echelle_cm_par_unite, murs, portes, fenetres, standard, blanc, inconnue. Les titres de section sont en majuscules sans accent : ## MURS, ## PORTES, ## FENETRES, ## FIN.
7. Une section vide reste présente (titre seul) et son compteur vaut 0.
8. Les compteurs des lignes 5 à 7 doivent être EXACTEMENT égaux au nombre de lignes des sections : ils servent à détecter une réponse tronquée.

RÈGLES DE GÉOMÉTRIE
9. Un mur = un segment droit tracé sur l'AXE du mur (milieu de son épaisseur). Un mur épais n'est jamais décrit par ses deux faces.
10. Découpe chaque mur aux angles et aux jonctions en T : un segment par tronçon rectiligne. Un mur courbe devient une suite de segments courts (au plus 30 unités chacun).
11. Les extrémités qui se rejoignent ont des coordonnées IDENTIQUES (même x, même y) : pas d'interstice, pas de chevauchement.
12. Les murs horizontaux ont y1 = y2 ; les murs verticaux ont x1 = x2. N'introduis aucune inclinaison qui n'existe pas sur l'image.
13. Les ouvertures ne coupent pas les murs : décris le mur entier d'un seul tenant, puis chaque porte ou fenêtre séparément, par le CENTRE de l'ouverture posé sur l'axe du mur.
14. « blanc » seulement si le mur est manifestement clair ou blanc (sinon « standard »).
15. echelle_cm_par_unite : nombre de centimètres réels représentés par UNE unité de la grille, déduit des cotes, d'une échelle graphique ou des portes (80 à 90 cm). Si rien ne permet de l'estimer, écris inconnue.
16. N'invente rien. Une zone illisible est omise, jamais devinée. Mieux vaut un mur manquant qu'un mur faux.

VÉRIFICATION AVANT D'ENVOYER (fais-la réellement)
- La première ligne est exactement « ${PLAN_HEADER} », la dernière exactement « ## FIN ».
- Aucune ligne vide, aucun espace en trop, aucun texte hors grammaire.
- Les compteurs correspondent au nombre de lignes de chaque section.
- Toutes les coordonnées sont des entiers dans les bornes de la grille.
- Les numéros se suivent sans trou.
- Le résultat est un FICHIER « plan.md » téléchargeable, pas du texte dans la discussion.

EXEMPLE CONFORME (valeurs fictives, à remplacer entièrement)
${PLAN_HEADER}
repere: ${image ? 'image' : 'cm'}
grille: ${image ? `${W}x${H}` : '850x520'}
echelle_cm_par_unite: ${image ? '2.5' : '1'}
murs: 3
portes: 1
fenetres: 1
## MURS
M001 | 40,40 -> 400,40 | blanc
M002 | 400,40 -> 400,${image ? Math.min(H, 300) : 300} | standard
M003 | 40,40 -> 40,${image ? Math.min(H, 300) : 300} | standard
## PORTES
P001 | 220,40 | 36 | 0
## FENETRES
F001 | 400,150 | 60 | 90
## FIN

RAPPEL FINAL : produis maintenant le FICHIER TÉLÉCHARGEABLE « plan.md » (outil de création de fichier ou exécution de code). Ne recopie jamais son contenu dans le corps de ta réponse.
`;
}

export interface PlanIssue {
  line: number;
  message: string;
}

export interface ParsedPlan {
  mode: 'image' | 'cm';
  grid: { w: number; h: number };
  /** Centimètres réels par unité de grille (si l'IA a pu l'estimer). */
  scale?: number;
  walls: Array<{ x: number; y: number; x2: number; y2: number; white: boolean }>;
  doors: Array<{ x: number; y: number; width: number; rot: number }>;
  windows: Array<{ x: number; y: number; width: number; rot: number }>;
  /** Lignes rejetées : le fichier ne respecte pas la grammaire. */
  errors: PlanIssue[];
  /** Écarts tolérés (bloc de code autour du fichier, fins de ligne Windows). */
  warnings: PlanIssue[];
}

const INT = String.raw`(0|[1-9]\d*)`;
const WALL = new RegExp(String.raw`^M(\d{3,}) \| ${INT},${INT} -> ${INT},${INT} \| (standard|blanc)$`);
const OPENING = (p: string) => new RegExp(String.raw`^${p}(\d{3,}) \| ${INT},${INT} \| ([1-9]\d*) \| (0|[1-9]\d?|1[0-7]\d)$`);
const DOOR = OPENING('P');
const WINDOW = OPENING('F');

/**
 * Analyse stricte du fichier Markdown : chaque écart à la grammaire est signalé avec son numéro de
 * ligne. Les lignes valides restent utilisables ; un en-tête invalide rend le fichier inutilisable.
 */
export function parsePlanFile(text: string): ParsedPlan {
  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  let src = text.replace(/^\uFEFF/, '');
  if (src.includes('\r')) {
    warnings.push({ line: 0, message: 'Fins de ligne Windows (CRLF) converties.' });
    src = src.replace(/\r\n?/g, '\n');
  }
  let lines = src.split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  let offset = 0;
  // Tolérance unique : un bloc de code autour du fichier (signalé).
  if (/^```/.test(lines[0] ?? '') && /^```\s*$/.test(lines[lines.length - 1] ?? '')) {
    warnings.push({ line: 1, message: 'Bloc de code « ``` » autour du contenu retiré (repli toléré : l’IA aurait dû livrer un fichier).' });
    lines = lines.slice(1, -1);
    offset = 1;
  }
  const plan: ParsedPlan = { mode: 'image', grid: { w: 0, h: 0 }, walls: [], doors: [], windows: [], errors, warnings };
  const at = (i: number) => i + 1 + offset;
  const err = (i: number, message: string) => errors.push({ line: at(i), message });

  if (lines[0] !== PLAN_HEADER) {
    err(0, `En-tête attendu « ${PLAN_HEADER} », trouvé « ${lines[0] ?? ''} ».`);
    return plan;
  }
  const meta = (i: number, key: string, re: RegExp): RegExpExecArray | null => {
    const m = re.exec(lines[i] ?? '');
    if (!m) err(i, `Ligne « ${key} » attendue au format exact, trouvé « ${lines[i] ?? ''} ».`);
    return m;
  };
  const mode = meta(1, 'repere: image|cm', /^repere: (image|cm)$/);
  const grid = meta(2, 'grille: <largeur>x<hauteur>', /^grille: ([1-9]\d*)x([1-9]\d*)$/);
  const scale = meta(3, 'echelle_cm_par_unite: <nombre>|inconnue', /^echelle_cm_par_unite: (inconnue|\d+(?:\.\d+)?)$/);
  const counts = [meta(4, 'murs: <n>', /^murs: (\d+)$/), meta(5, 'portes: <n>', /^portes: (\d+)$/), meta(6, 'fenetres: <n>', /^fenetres: (\d+)$/)];
  if (!mode || !grid) return plan;
  plan.mode = mode[1] as 'image' | 'cm';
  plan.grid = { w: Number(grid[1]), h: Number(grid[2]) };
  if (scale && scale[1] !== 'inconnue' && Number(scale[1]) > 0) plan.scale = Number(scale[1]);

  const inGrid = (i: number, ...v: number[]) => {
    for (let k = 0; k < v.length; k += 2)
      if (v[k] > plan.grid.w || v[k + 1] > plan.grid.h) {
        err(i, `Coordonnée ${v[k]},${v[k + 1]} hors de la grille ${plan.grid.w}x${plan.grid.h}.`);
        return false;
      }
    return true;
  };

  const SECTIONS = ['## MURS', '## PORTES', '## FENETRES', '## FIN'] as const;
  let section = -1;
  const seen = [0, 0, 0];
  let ended = false;
  for (let i = 7; i < lines.length; i++) {
    const l = lines[i];
    if (ended) {
      err(i, 'Texte après « ## FIN ».');
      break;
    }
    const sIdx = SECTIONS.indexOf(l as (typeof SECTIONS)[number]);
    if (sIdx >= 0) {
      if (sIdx !== section + 1) err(i, `Section « ${l} » hors d'ordre (attendu « ${SECTIONS[section + 1]} »).`);
      section = sIdx;
      if (sIdx === 3) ended = true;
      continue;
    }
    if (l === '') {
      err(i, 'Ligne vide interdite.');
      continue;
    }
    if (section < 0 || section > 2) {
      err(i, `Ligne hors section : « ${l} ».`);
      continue;
    }
    const want = `${'MPF'[section]}${String(seen[section] + 1).padStart(3, '0')}`;
    if (section === 0) {
      const m = WALL.exec(l);
      if (!m) {
        err(i, `Mur mal formé (attendu « M001 | x1,y1 -> x2,y2 | standard ») : « ${l} ».`);
        continue;
      }
      seen[0]++;
      if (`M${m[1]}` !== want) err(i, `Numéro M${m[1]} : attendu ${want}.`);
      const [x, y, x2, y2] = [m[2], m[3], m[4], m[5]].map(Number);
      if (inGrid(i, x, y, x2, y2)) plan.walls.push({ x, y, x2, y2, white: m[6] === 'blanc' });
    } else {
      const m = (section === 1 ? DOOR : WINDOW).exec(l);
      if (!m) {
        err(i, `${section === 1 ? 'Porte' : 'Fenêtre'} mal formée (attendu « ${want} | x,y | largeur | angle ») : « ${l} ».`);
        continue;
      }
      seen[section]++;
      if (`${'MPF'[section]}${m[1]}` !== want) err(i, `Numéro ${'MPF'[section]}${m[1]} : attendu ${want}.`);
      const [x, y, width, rot] = [m[2], m[3], m[4], m[5]].map(Number);
      if (inGrid(i, x, y)) (section === 1 ? plan.doors : plan.windows).push({ x, y, width, rot });
    }
  }
  if (!ended) errors.push({ line: at(lines.length - 1), message: 'Ligne « ## FIN » absente : réponse probablement tronquée.' });
  counts.forEach((c, k) => {
    if (c && Number(c[1]) !== seen[k]) err(4 + k, `Compteur ${['murs', 'portes', 'fenetres'][k]} = ${c[1]}, mais ${seen[k]} ligne(s) trouvée(s).`);
  });
  return plan;
}

export interface PlacedPlan {
  walls: ParsedPlan['walls'];
  doors: ParsedPlan['doors'];
  windows: ParsedPlan['windows'];
}

/**
 * Place le plan lu dans le repère du plan au sol : en repère image, exactement sur le rectangle de
 * l'image de fond ; en repère cm (ou sans fond), à l'échelle 1 unité = 1 cm si `realScale`, sinon
 * ajusté à la vue avec une marge.
 */
export function placePlan(p: ParsedPlan, target?: { x: number; y: number; w: number; h: number }, realScale = false): PlacedPlan {
  let k: number;
  let ox: number;
  let oy: number;
  if (p.mode === 'image' && target) {
    k = target.w / p.grid.w;
    ox = target.x;
    oy = target.y;
  } else if (realScale) {
    k = p.mode === 'cm' ? 1 : (p.scale ?? 1);
    ox = 0;
    oy = 0;
  } else {
    const margin = 30;
    k = Math.min((PLAN_W - 2 * margin) / p.grid.w, (PLAN_H - 2 * margin) / p.grid.h);
    ox = (PLAN_W - p.grid.w * k) / 2;
    oy = (PLAN_H - p.grid.h * k) / 2;
  }
  const X = (v: number) => Math.round((ox + v * k) * 10) / 10;
  const Y = (v: number) => Math.round((oy + v * k) * 10) / 10;
  const open = (o: ParsedPlan['doors'][number]) => {
    const w = Math.max(10, Math.round(o.width * k));
    const a = (o.rot * Math.PI) / 180;
    // Le centre donné par l'IA devient le point de départ de l'ouverture (repère des portes du plan).
    return { x: X(o.x) - (Math.cos(a) * w) / 2, y: Y(o.y) - (Math.sin(a) * w) / 2, width: w, rot: o.rot };
  };
  return {
    walls: p.walls.map((w) => ({ x: X(w.x), y: Y(w.y), x2: X(w.x2), y2: Y(w.y2), white: w.white })),
    doors: p.doors.map(open),
    windows: p.windows.map(open),
  };
}
