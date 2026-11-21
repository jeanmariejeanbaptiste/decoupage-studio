import { editableText, isEditable, setCellText } from './cells';
import { produce } from 'immer';
import { ALL_COLUMNS, COLUMN_DEFS } from './columns';
import { parseHeading } from './fountain';
import { addSequence, addShot, deleteShot } from './ops';
import { fold } from './text';
import { ANGLES, MOVEMENTS, SHOT_VALUES, matchVocab } from './vocabulary';
import { parseTokens } from './tokens';
import type { ColumnKey, ID, ProjectDoc } from './types';
import { exportCellText } from './rows';
import { sequenceNumber, shotCode } from './numbering';
import { computeTiming } from './timing';

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
      return `Angle : un ou plusieurs termes de cette liste, séparés par une virgule (gauche / droite : le côté vers lequel le sujet est tourné, vu de la caméra) :\n  ${list(ANGLES.filter((a) => !['profil', 'trois_quarts_face', 'trois_quarts_dos'].includes(a.key)))}`;
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
- Une livraison peut ne contenir qu'une partie du film :
  - nouveau morceau : ne renvoie que les nouveaux plans ; le logiciel les ajoute à la suite des séquences de même intitulé ;
  - nouvelle version d'une séquence déjà livrée (actions reformulées, plans corrigés) : renvoie la séquence ENTIÈRE, tous ses plans dans l'ordre, avec le même intitulé ; le logiciel met ses plans à jour en place.
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
  sequences: {
    heading: string;
    rows: Partial<Record<ColumnKey, string>>[];
    /** Colonnes du tableau importé. */
    columns: ColumnKey[];
    /** N° de chaque ligne, s'il y a une colonne N° (découpage copié d'ici). */
    codes?: (string | undefined)[];
  }[];
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
  let codeAt = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('```')) continue;
    if (/^##\s+/.test(line)) {
      cur = { heading: line.replace(/^##\s+/, '').trim(), rows: [], columns: [] };
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
      const keys = cs.map((c) => LABELS.get(fold(c)) ?? null);
      keys.forEach((k, j) => k === null && cs[j] && out.warnings.push(`Ligne ${i + 1} : colonne « ${cs[j]} » inconnue, ignorée.`));
      // N°, Séquence, TC : calculés par l'outil (présents dans un découpage copié d'ici), passés sans bruit.
      header = keys.map((k) => (k && isEditable(k) ? k : null));
      codeAt = keys.indexOf('number');
      if (codeAt >= 0) cur.codes = [];
      cur.columns = header.filter((k): k is ColumnKey => !!k);
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
    if (Object.keys(row).length) {
      cur.rows.push(row);
      cur.codes?.push(codeAt >= 0 ? cs[codeAt]?.trim() || undefined : undefined);
    }
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

/** Séquence du projet portant le même intitulé que celle importée. */
function sameSequence(doc: ProjectDoc, heading: string): ID | undefined {
  const h = parseHeading(heading);
  const label = (h.location || heading).toUpperCase();
  return doc.project.sequenceIds.find((id) => {
    const q = doc.sequences[id];
    return q && fold(q.label) === fold(label) && (q.intExt ?? null) === (h.intExt ?? null) && (q.effect ?? null) === (h.effect ?? null);
  });
}

/** Séquences importées qui existent déjà dans le projet avec des plans (et combien). */
export function cutOverlap(doc: ProjectDoc, cut: ParsedCut): number {
  return cut.sequences.filter((s) => {
    const id = sameSequence(doc, s.heading);
    return id && s.rows.length && doc.sequences[id].shotIds.some((sh) => !blankShot(doc, sh));
  }).length;
}

/**
 * Plan visé par chaque ligne en mise à jour. Avec une colonne N° qui correspond aux plans de la séquence,
 * chaque ligne retrouve son plan par son numéro (une ligne sautée ne décale rien ; un numéro inconnu
 * donne un plan ajouté). Sans N° reconnu : dans l'ordre. Les caméras d'interview ne sont jamais visées.
 */
function updateTargets(doc: ProjectDoc, seqId: ID, s: ParsedCut['sequences'][number]): (ID | undefined)[] {
  const own = doc.sequences[seqId].shotIds.filter((id) => !doc.shots[id]?.interview);
  const byCode = new Map(own.map((id) => [shotCode(doc, id), id]));
  const codes = s.codes ?? [];
  if (!codes.some((c) => c && byCode.has(c))) return own;
  const used = new Set<ID>();
  return s.rows.map((_, i) => {
    const id = codes[i] ? byCode.get(codes[i]!) : undefined;
    if (!id || used.has(id)) return undefined;
    used.add(id);
    return id;
  });
}

/**
 * Ajoute le découpage lu au projet. Une nouvelle séquence se place à la fin. Une séquence déjà présente
 * (même intitulé) reçoit les plans :
 * - `append` : à la suite des siens (un autre morceau du découpage) ;
 * - `update` : sur ses plans, retrouvés par leur N° (sinon dans l'ordre). Seules les cellules remplies
 *   changent ; images, dessins et préparation restent ; les plans en plus s'ajoutent, ceux en moins sont
 *   gardés. Rien n'est jamais supprimé.
 */
export function applyCut(doc: ProjectDoc, cut: ParsedCut, mode: 'append' | 'update' = 'append'): { sequences: number; merged: number; shots: number; updated: number; rejected: number } {
  let shots = 0;
  let updated = 0;
  let rejected = 0;
  let merged = 0;
  for (const s of cut.sequences) {
    const h = parseHeading(s.heading);
    const same = sameSequence(doc, s.heading);
    let seqId: ID;
    if (same) {
      seqId = same;
      merged++;
    } else {
      seqId = addSequence(doc, undefined, {}, false);
      const seq = doc.sequences[seqId];
      seq.label = (h.location || s.heading).toUpperCase();
      seq.intExt = h.intExt ?? seq.intExt;
      seq.effect = h.effect ?? seq.effect;
      if (!s.rows.length) addShot(doc, seqId);
    }
    // Séquence existante réduite à un plan vierge : il cède la place aux plans importés.
    const existing = [...doc.sequences[seqId].shotIds];
    const placeholder = same && s.rows.length && existing.length === 1 && blankShot(doc, existing[0]) ? existing[0] : null;
    const targets = same && mode === 'update' && !placeholder ? updateTargets(doc, seqId, s) : [];
    s.rows.forEach((row, i) => {
      const target = targets[i];
      const id = target ?? addShot(doc, seqId);
      if (target) updated++;
      else shots++;
      // Seules les cellules remplies s'écrivent : une cellule vide ne gomme jamais rien.
      for (const k of Object.keys(row) as ColumnKey[]) if (!setCellText(doc, id, k, row[k] ?? '')) rejected++;
    });
    if (placeholder) deleteShot(doc, placeholder);
  }
  return { sequences: cut.sequences.length - merged, merged, shots, updated, rejected };
}

/**
 * Le découpage en Markdown, pour une IA : la grammaire de l'import (en-tête, « ## » par séquence,
 * un tableau), plus la colonne N°. Rendu tel quel par l'IA, il se réimporte en « Mettre à jour ».
 */
export function cutToMarkdown(doc: ProjectDoc): string {
  const timing = computeTiming(doc);
  const cols = aiColumns(doc.project.settings.exportColumns);
  const esc = (t: string) => t.replace(/\|/g, '\\|').replace(/\n+/g, '<br>').trim();
  const head = `| N° | ${cols.map((c) => COLUMN_DEFS[c].label).join(' | ')} |`;
  const sep = `|${' --- |'.repeat(cols.length + 1)}`;
  const nShots = doc.project.sequenceIds.reduce((n, id) => n + (doc.sequences[id]?.shotIds.length ?? 0), 0);
  const out = [`# ${doc.project.title || 'Découpage'}`, '', `Découpage technique · ${doc.project.sequenceIds.length} séquences · ${nShots} plans`, '', CUT_HEADER];
  doc.project.sequenceIds.forEach((seqId) => {
    const seq = doc.sequences[seqId];
    if (!seq) return;
    const heading = [seq.intExt ? `${seq.intExt}.` : '', seq.label.toUpperCase(), seq.effect ? `- ${seq.effect}` : ''].filter(Boolean).join(' ');
    out.push('', `## ${sequenceNumber(doc, seqId)}. ${heading}`);
    if (!seq.shotIds.length) return;
    out.push('', head, sep);
    seq.shotIds.forEach((id, i) => {
      const shot = doc.shots[id];
      if (shot) out.push(`| ${shotCode(doc, id)} | ${cols.map((c) => esc(exportCellText(doc, timing, shot, c, i))).join(' | ')} |`);
    });
  });
  return `${out.join('\n')}\n`;
}

/** Ce que ferait une mise à jour, sans rien toucher : plans dont un texte change, plans ajoutés. */
export function updatePreview(doc: ProjectDoc, cut: ParsedCut): { changed: number; added: number } {
  let added = 0;
  const next = produce(doc, (d) => void (added = applyCut(d, cut, 'update').shots));
  const cols = [...new Set(cut.sequences.flatMap((s) => s.columns))];
  const changed = Object.keys(doc.shots).filter((id) => cols.some((c) => editableText(doc, id, c) !== editableText(next, id, c))).length;
  return { changed, added };
}
