import { isEditable, setCellText } from './cells';
import { ALL_COLUMNS, COLUMN_DEFS } from './columns';
import { parseHeading } from './fountain';
import { addSequence, addShot, deleteShot } from './ops';
import { fold } from './text';
import { ANGLES, MOVEMENTS, SHOT_VALUES, matchVocab } from './vocabulary';
import { parseTokens } from './tokens';
import type { ColumnKey, ID, ProjectDoc } from './types';

/**
 * Découpage écrit par une IA externe (Claude, ChatGPT, Gemini…), à partir d'un découpage fait ailleurs.
 *
 * L'outil donne des consignes strictes, calculées sur les colonnes du projet : l'IA répond par un
 * fichier Markdown (une section par séquence, un tableau par séquence). Le fichier est lu tel quel,
 * vérifié, puis ajouté au découpage en une seule opération (annulable).
 */

export const CUT_HEADER = '# DECOUPAGE DECOUPAGE-STUDIO v1';

/** Colonnes que l'IA remplit : celles du projet qui s'écrivent (ni séquence, ni numéro, ni TC, ni planning). */
export function aiColumns(cols: readonly ColumnKey[]): ColumnKey[] {
  return cols.filter((c) => isEditable(c) && !['sequence', 'number', 'tc', 'status', 'shootingDay'].includes(c));
}

const list = (entries: readonly { short: string }[]) => entries.map((e) => e.short).join(' | ');

/** Règle de chaque colonne, telle que l'import la lit. */
function columnRule(c: ColumnKey): string {
  switch (c) {
    case 'subject':
      return 'Sujet : qui ou quoi est cadré (« Léa », « Léa, Paul », « Valise »). Plusieurs sujets : séparés par une virgule.';
    case 'value':
      return `Valeur : UNE seule valeur, écrite exactement comme dans cette liste :\n  ${list(SHOT_VALUES)}`;
    case 'angle':
      return `Angle : un ou plusieurs termes de cette liste, séparés par une virgule :\n  ${list(ANGLES)}`;
    case 'movement':
      return `Mouvement de caméra : un ou plusieurs termes de cette liste. Virgule si les mouvements se suivent, « + » s'ils sont simultanés :\n  ${list(MOVEMENTS)}`;
    case 'focal':
      return 'Focale : nombre de millimètres suivi de « mm », sans espace (« 35mm »). Zoom : « 24mm → 70mm ».';
    case 'aperture':
      return 'Ouverture : « f/2,8 » (nombre entre 0,7 et 64).';
    case 'action':
      return 'Action : ce qui se passe dans le plan, en phrases complètes, au présent.';
    case 'dialogue':
      return 'Dialogue : les répliques dites pendant le plan, sous la forme « NOM : réplique », une par ligne (séparées par <br>).';
    case 'sound':
      return 'Son : ce qu’on entend (ambiance, effet, musique), en quelques mots.';
    case 'light':
      return 'Lumière : l’intention ou le dispositif de lumière, en quelques mots.';
    case 'notes':
      return 'Image : remarques sur l’image (cadre, effet, accessoire visible), en quelques mots.';
    default:
      return `${COLUMN_DEFS[c].label} : texte court.`;
  }
}

/** Consignes complètes à copier pour l'IA externe : grammaire exacte, aucune liberté de forme. */
export function aiCutInstructions(cols: readonly ColumnKey[]): string {
  const keys = aiColumns(cols);
  const head = `| ${keys.map((c) => COLUMN_DEFS[c].label).join(' | ')} |`;
  const sep = `|${keys.map(() => '---').join('|')}|`;
  const row = (r: Partial<Record<ColumnKey, string>>) => `| ${keys.map((c) => r[c] ?? '').join(' | ')} |`;
  const n = keys.length;
  const vocab = keys.filter((c) => c === 'value' || c === 'angle' || c === 'movement').map((c) => COLUMN_DEFS[c].label);
  return `CONSIGNES — DÉCOUPAGE TECHNIQUE POUR DÉCOUPAGE STUDIO

Tu es l'assistant réalisateur d'un cinéaste. Tu produis un découpage technique de film, plan par plan, qui sera importé tel quel dans le logiciel Découpage Studio. La mise en page, le storyboard et les exports sont faits par le logiciel : toi, tu ne livres que le contenu, au format exact ci-dessous.

MÉTHODE
- Deux cas :
  1. Le cinéaste te fournit un découpage existant (tableau, PDF, photo, texte) : tu le convertis fidèlement, sans rien ajouter.
  2. Le cinéaste te parle ou te dicte ses intentions (souvent une transcription orale, désordonnée) : tu en déduis les séquences et les plans, avec les termes techniques justes.
- Dans le cas 2 :
  - Si une information manque pour décider (lieu, moment, qui est cadré), pose au plus 3 questions courtes, toutes en une fois, puis attends la réponse.
  - Ne demande jamais ce que tu peux déduire.
  - Avant la version finale, montre le découpage sous forme de tableau lisible et demande « Je valide ? ».
  - Dès que le cinéaste valide, livre le bloc final au format ci-dessous, et rien d'autre.
- Chaque nouvelle livraison peut ne contenir qu'une partie du film. Le logiciel ajoute les plans à la suite des séquences de même intitulé, sans rien effacer. Ne renvoie donc que les nouveaux plans, jamais ceux déjà livrés.
- Choix du vocabulaire :
  - Valeur : la taille du sujet dans le cadre, du plus large (Général) au plus serré (Très GP), Insert pour un objet ou un détail.
  - Angle : la position de la caméra par rapport au sujet.
  - Mouvement : ce que fait la caméra pendant le plan (Fixe si elle ne bouge pas).

FORMAT (import automatique : le moindre écart fait échouer l'import ; tu ne prends AUCUNE liberté de mise en forme)

LIVRABLE
- Réponds UNIQUEMENT par un bloc de code Markdown (\`\`\`markdown … \`\`\`). Aucun texte avant, aucun texte après, aucun commentaire, aucune explication.
- Ligne 1 du bloc, exactement, sans rien d'autre : ${CUT_HEADER}
- Ligne 2 : vide.

STRUCTURE (répétée pour chaque séquence, dans l'ordre du film)
1. Une ligne de titre de séquence : « ## » + espace + intitulé.
   - Intitulé en MAJUSCULES : INT. ou EXT. ou INT./EXT. + espace + LIEU + espace + tiret + espace + MOMENT.
   - MOMENT : JOUR, NUIT, SOIR, MATIN, AUBE ou CRÉPUSCULE.
   - Exemple : ## INT. CUISINE - JOUR
   - Pas de numéro de séquence. Si le moment est inconnu, n'écris que INT. LIEU.
2. Une ligne vide.
3. L'en-tête du tableau, recopié EXACTEMENT, colonnes dans cet ordre :
${head}
4. La ligne de séparation, exactement :
${sep}
5. Un plan par ligne, dans l'ordre du montage. Chaque ligne commence et finit par « | » et contient exactement ${n} cellule${n > 1 ? 's' : ''}.
6. Une ligne vide avant la séquence suivante.

RÈGLES DES CELLULES
${keys.map((c) => `- ${columnRule(c)}`).join('\n')}${vocab.length ? `\n- Si le document source n'utilise pas exactement un terme des listes (${vocab.join(', ')}), prends le terme le plus proche. S'il n'y en a aucun, laisse la cellule vide.` : ''}

INTERDITS
- N'invente rien : une information absente du document source donne une cellule VIDE (rien entre les deux « | »).
- Aucune colonne en plus, en moins ou renommée. Pas de colonne N°, Séquence ni TC : l'outil les calcule.
- Pas de gras, d'italique, de lien ni d'emoji dans les cellules.
- Pas de retour à la ligne dans une cellule : écris <br> à la place.
- Pas de « | » dans un texte : écris \\| à la place.
- Pas de « idem », « ″ » ni « même que plus haut » : répète la valeur en entier.
- Pas de ligne de total, de note ni de légende.

AVANT DE RÉPONDRE, VÉRIFIE
- Ligne 1 exacte, chaque séquence a son « ## », chaque tableau a l'en-tête exact et sa séparation.
- Chaque ligne de plan a exactement ${n} cellule${n > 1 ? 's' : ''}.${vocab.length ? `\n- Chaque valeur des colonnes ${vocab.join(', ')} appartient à sa liste, ou est vide.` : ''}

EXEMPLE CONFORME
${CUT_HEADER}

## INT. CUISINE - JOUR

${head}
${sep}
${row(EXAMPLE[0])}
${row(EXAMPLE[1])}

## EXT. RUE - NUIT

${head}
${sep}
${row(EXAMPLE[2])}
`;
}

const EXAMPLE: Partial<Record<ColumnKey, string>>[] = [
  { subject: 'Léa', value: 'Rapproché', angle: 'Face, Hauteur regard', movement: 'Fixe', focal: '50mm', aperture: 'f/2,8', action: 'Léa pose sa tasse et regarde la fenêtre.', sound: 'Pluie sur la vitre', light: 'Jour gris, fenêtre', notes: 'Buée sur la vitre' },
  { subject: 'Tasse', value: 'Insert', angle: 'Plongée', movement: 'Fixe', focal: '100mm', action: 'La vapeur monte de la tasse.' },
  { subject: 'Paul', value: 'Général', angle: 'Face', movement: 'Trav arrière + Steadicam', focal: '24mm → 35mm', action: 'Paul court vers la caméra.<br>Il s’arrête net.', dialogue: 'PAUL : Attends-moi !', sound: 'Pas sur le pavé' },
];

export interface ParsedCut {
  sequences: { heading: string; rows: Partial<Record<ColumnKey, string>>[] }[];
  /** Problèmes relevés (ligne par ligne), sans bloquer ce qui se lit. */
  warnings: string[];
}

const VOCAB: [ColumnKey, typeof SHOT_VALUES][] = [
  ['value', SHOT_VALUES],
  ['angle', ANGLES],
  ['movement', MOVEMENTS],
];

const LABELS = new Map<string, ColumnKey>();
for (const c of ALL_COLUMNS) {
  LABELS.set(fold(COLUMN_DEFS[c].label), c);
  const short = COLUMN_DEFS[c].short;
  if (short) LABELS.set(fold(short), c);
}

function cells(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (body[i] === '|') {
      out.push(cur);
      cur = '';
    } else cur += body[i];
  }
  out.push(cur);
  return out.map((c) => c.replace(/<br\s*\/?>/gi, '\n').trim());
}

/** Lit la réponse de l'IA. Lève une erreur si ce n'est pas un découpage. */
export function parseCutFile(text: string): ParsedCut {
  const lines = text.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => l.trim().toUpperCase() === CUT_HEADER.toUpperCase());
  if (start < 0) throw new Error(`Ce fichier n’est pas un découpage pour Découpage Studio (première ligne attendue : ${CUT_HEADER}).`);
  const out: ParsedCut = { sequences: [], warnings: [] };
  let cur: ParsedCut['sequences'][number] | null = null;
  let header: (ColumnKey | null)[] | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('```')) continue;
    if (/^##\s+/.test(line)) {
      cur = { heading: line.replace(/^##\s+/, '').trim(), rows: [] };
      out.sequences.push(cur);
      header = null;
      continue;
    }
    if (!line.startsWith('|')) {
      out.warnings.push(`Ligne ${i + 1} : texte hors tableau, ignoré.`);
      continue;
    }
    if (!cur) {
      out.warnings.push(`Ligne ${i + 1} : tableau sans séquence, ignoré.`);
      continue;
    }
    const cs = cells(line);
    if (!header) {
      header = cs.map((c) => LABELS.get(fold(c)) ?? null);
      header.forEach((k, j) => k === null && cs[j] && out.warnings.push(`Ligne ${i + 1} : colonne « ${cs[j]} » inconnue, ignorée.`));
      continue;
    }
    if (cs.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (cs.length !== header.length) out.warnings.push(`Ligne ${i + 1} : ${cs.length} cellules au lieu de ${header.length}.`);
    const row: Partial<Record<ColumnKey, string>> = {};
    header.forEach((k, j) => {
      if (k && cs[j]) row[k] = cs[j];
    });
    for (const [k, entries] of VOCAB) {
      const v = row[k];
      if (!v) continue;
      const tokens = k === 'value' ? [v] : parseTokens(v).tokens;
      for (const t of tokens) if (!matchVocab(t, entries)) out.warnings.push(`Ligne ${i + 1} : « ${t} » n’est pas dans la liste ${COLUMN_DEFS[k].label}.`);
    }
    if (Object.keys(row).length) cur.rows.push(row);
  }
  if (!out.sequences.length) throw new Error('Aucune séquence trouvée (titres « ## INT. LIEU - JOUR »).');
  return out;
}

/** Plan encore vierge (créé avec sa séquence, jamais rempli). */
function blankShot(doc: ProjectDoc, id: ID): boolean {
  const sh = doc.shots[id];
  if (!sh) return false;
  const b = doc.blocks[sh.actionBlockId];
  return !sh.subject && !sh.value && !sh.angle.length && !sh.movement.length && sh.focal.from === undefined && !(b?.text ?? '').trim() && !sh.oneShot && !sh.interview;
}

/**
 * Ajoute le découpage lu au projet, sans rien effacer : une séquence déjà présente (même intitulé)
 * reçoit les nouveaux plans à la suite des siens ; une nouvelle séquence se place à la fin.
 */
export function applyCut(doc: ProjectDoc, cut: ParsedCut): { sequences: number; merged: number; shots: number; rejected: number } {
  let shots = 0;
  let rejected = 0;
  let merged = 0;
  for (const s of cut.sequences) {
    const h = parseHeading(s.heading);
    const label = (h.location || s.heading).toUpperCase();
    const same = doc.project.sequenceIds.find((id) => {
      const q = doc.sequences[id];
      return q && fold(q.label) === fold(label) && (q.intExt ?? null) === (h.intExt ?? null) && (q.effect ?? null) === (h.effect ?? null);
    });
    let seqId: ID;
    if (same) {
      seqId = same;
      merged++;
    } else {
      seqId = addSequence(doc, undefined, {}, false);
      const seq = doc.sequences[seqId];
      seq.label = label;
      seq.intExt = h.intExt ?? seq.intExt;
      seq.effect = h.effect ?? seq.effect;
      if (!s.rows.length) addShot(doc, seqId);
    }
    // Séquence existante réduite à un plan vierge : il cède la place aux plans importés.
    const placeholder = same && s.rows.length && doc.sequences[seqId].shotIds.length === 1 && blankShot(doc, doc.sequences[seqId].shotIds[0]) ? doc.sequences[seqId].shotIds[0] : null;
    for (const row of s.rows) {
      const id = addShot(doc, seqId);
      shots++;
      for (const [k, v] of Object.entries(row) as [ColumnKey, string][]) if (!setCellText(doc, id, k, v)) rejected++;
    }
    if (placeholder) deleteShot(doc, placeholder);
  }
  return { sequences: cut.sequences.length - merged, merged, shots, rejected };
}
