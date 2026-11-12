import { isEditable, setCellText } from './cells';
import { ALL_COLUMNS, COLUMN_DEFS } from './columns';
import { parseHeading } from './fountain';
import { addSequence, addShot } from './ops';
import { fold } from './text';
import type { ColumnKey, ID, ProjectDoc } from './types';

/**
 * Découpage écrit par une IA externe (Claude, ChatGPT, Gemini…), à partir d'un découpage fait ailleurs.
 *
 * L'outil donne des consignes strictes, calculées sur les colonnes du projet : l'IA répond par un
 * fichier Markdown (une section par séquence, un tableau par séquence). Le fichier est lu tel quel,
 * vérifié, puis ajouté au découpage en une seule opération (annulable).
 */

export const CUT_HEADER = '# DECOUPAGE DECOUPAGE-STUDIO v1';

/** Colonnes que l'IA remplit : celles du projet qui s'écrivent (ni séquence, ni numéro, ni TC calculé). */
export function aiColumns(cols: readonly ColumnKey[]): ColumnKey[] {
  return cols.filter((c) => isEditable(c) && c !== 'sequence' && c !== 'number' && c !== 'tc');
}

/** Consignes complètes à copier pour l'IA externe. */
export function aiCutInstructions(cols: readonly ColumnKey[]): string {
  const keys = aiColumns(cols);
  const labels = keys.map((c) => COLUMN_DEFS[c].label);
  const head = `| ${labels.join(' | ')} |`;
  const sep = `|${keys.map(() => '---').join('|')}|`;
  const example = `| ${keys.map((c) => EXAMPLE[c] ?? '').join(' | ')} |`;
  return `Tu convertis un découpage technique de film (tableau, PDF, photo, texte…) au format exact de Découpage Studio.

RÉPONSE ATTENDUE
- Un seul fichier Markdown nommé decoupage.md, sans aucun texte avant ni après.
- Première ligne, exactement : ${CUT_HEADER}

STRUCTURE
- Une section par séquence, dans l'ordre du film. Titre de section, exactement : ## INT. LIEU - JOUR (ou EXT., INT./EXT. ; JOUR, NUIT, SOIR, AUBE…).
- Sous chaque titre, un seul tableau Markdown : un plan par ligne, dans l'ordre de tournage du montage.
- En-tête du tableau, exactement, colonnes dans cet ordre :
${head}
${sep}

RÈGLES
- Une cellule inconnue reste vide. N'invente rien qui ne figure pas dans le document source.
- Pas de numéro de séquence ni de numéro de plan : ils sont calculés par l'outil.
- Retour à la ligne dans une cellule : <br>. Barre verticale dans un texte : \\|.
${keys.includes('value') ? '- Valeur : Très gros plan, Gros plan, Plan rapproché, Plan moyen, Plan américain, Plan large, Plan d’ensemble, Insert.\n' : ''}${keys.includes('focal') ? '- Focale : en millimètres, « 35mm ».\n' : ''}${keys.includes('shotDuration') ? '- Durée : en secondes, « 12 ».\n' : ''}
EXEMPLE
${CUT_HEADER}

## INT. CUISINE - JOUR
${head}
${sep}
${example}
`;
}

const EXAMPLE: Partial<Record<ColumnKey, string>> = {
  subject: 'Léa',
  value: 'Plan rapproché',
  angle: 'Face',
  movement: 'Fixe',
  focal: '50mm',
  action: 'Léa pose sa tasse et regarde la fenêtre.',
  sound: 'Pluie',
  shotDuration: '6',
};

export interface ParsedCut {
  sequences: { heading: string; rows: Partial<Record<ColumnKey, string>>[] }[];
  /** Problèmes relevés (ligne par ligne), sans bloquer ce qui se lit. */
  warnings: string[];
}

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
    if (!line.startsWith('|')) continue;
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
    const row: Partial<Record<ColumnKey, string>> = {};
    header.forEach((k, j) => {
      if (k && cs[j]) row[k] = cs[j];
    });
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
