import { isEditable, setCellText } from './cells';
import { ALL_COLUMNS, COLUMN_DEFS } from './columns';
import { parseHeading } from './fountain';
import { addSequence, addShot } from './ops';
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
  return `CONSIGNES DE FORMAT — DÉCOUPAGE STUDIO (import automatique)

Tu convertis un découpage technique de film (tableau, PDF, photo, texte) en un fichier lu par une machine. Le moindre écart de format fait échouer l'import. Tu ne prends AUCUNE liberté de mise en forme.

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

/** Ajoute le découpage lu à la fin du projet. Renvoie ce qui a été créé. */
export function applyCut(doc: ProjectDoc, cut: ParsedCut): { sequences: number; shots: number; rejected: number } {
  let shots = 0;
  let rejected = 0;
  for (const s of cut.sequences) {
    const h = parseHeading(s.heading);
    const seqId: ID = addSequence(doc, undefined, {}, false);
    const seq = doc.sequences[seqId];
    seq.label = (h.location || s.heading).toUpperCase();
    seq.intExt = h.intExt ?? seq.intExt;
    seq.effect = h.effect ?? seq.effect;
    if (!s.rows.length) addShot(doc, seqId);
    for (const row of s.rows) {
      const id = addShot(doc, seqId);
      shots++;
      for (const [k, v] of Object.entries(row) as [ColumnKey, string][]) if (!setCellText(doc, id, k, v)) rejected++;
    }
  }
  return { sequences: cut.sequences.length, shots, rejected };
}
