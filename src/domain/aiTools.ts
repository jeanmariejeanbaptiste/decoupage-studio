/**
 * Outils de l'assistant IA : ce que le modèle peut lire et modifier dans le projet. Indépendants du
 * fournisseur (Anthropic, OpenAI, Gemini…) : schémas JSON, puis exécution sur un brouillon du projet.
 * Toutes les modifications d'une réponse forment une seule étape d'annulation (voir features/assistant).
 */
import { shotNumberLabel } from './numbering';
import { addBreakdownItems, breakdownCategories, breakdownLabel, breakdownOf } from './breakdown';
import { applyFormat } from './factory';
import { scenesOf, shiftAnchors } from './fountain';
import { formatFocal } from './focal';
import { addCharacter, addSequence, addShot, applyScenarioEdit, deleteShot, linkAction, setSequenceSummary } from './ops';
import { carryOutline, insertEntry, moveEntry, outlineMeasures, outlineOf, outlineSequences, plotName, plotsOf, sequenceSummary, setHeading, setOutlineTag, setPhrase, type OutlineSequence, type SourceEdit } from './outline';
import { mmss } from './chronometry';
import { stepLabel } from './truby';
import { setSequenceDecorByName } from './registry';
import { fold } from './text';
import { formatTc } from './timecode';
import { computeTiming } from './timing';
import { renderTokens } from './tokens';
import type { CharacterKind, Effect, ID, IntExt, ProjectDoc, ProjectFormat, ShotStatus } from './types';
import { ANGLES, MOVEMENTS, SHOT_VALUES, isZoom, matchVocab } from './vocabulary';

export interface ToolDef {
  name: string;
  description: string;
  /** Schéma JSON des arguments (objet). */
  schema: Record<string, unknown>;
  /** L'outil modifie le projet. */
  writes: boolean;
}

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const strList = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', additionalProperties: false, properties, required });

const SHOT_FIELDS = {
  subject: str('Personnage ou objet cadré'),
  value: str(`Valeur de cadre : ${SHOT_VALUES.map((v) => v.short).join(', ')}`),
  angle: strList(`Axe et hauteur : ${ANGLES.map((a) => a.short).join(', ')}`),
  movement: strList(`Mouvements : ${MOVEMENTS.map((m) => m.short).join(', ')} (vide = fixe)`),
  focal: int('Focale en mm'),
  focal_to: int('Focale d’arrivée en mm (zoom seulement)'),
  action: str('Action couverte par le plan'),
  sound: str('Son (IN, OFF, musique…)'),
  notes: str('Notes image, raccords'),
  status: { type: 'string', enum: ['à tourner', 'tourné', 'abandonné'] },
};

export const AI_TOOLS: readonly ToolDef[] = [
  {
    name: 'get_project',
    description: 'Vue d’ensemble du projet : format, minutage, séquences numérotées (avec nombre de plans), personnages, décors. À appeler d’abord.',
    schema: obj({}, []),
    writes: false,
  },
  {
    name: 'get_sequence',
    description: 'Détail d’une séquence du découpage : plans numérotés avec sujet, valeur, angle, mouvement, focale, action, son, durée.',
    schema: obj({ sequence: int('Numéro de la séquence (1 = première)') }, ['sequence']),
    writes: false,
  },
  {
    name: 'get_scenario',
    description: 'Texte du scénario (syntaxe Fountain), en entier ou pour une séquence.',
    schema: obj({ scene: int('Numéro de la séquence du scénario (facultatif : tout le scénario sinon)') }, []),
    writes: false,
  },
  {
    name: 'get_breakdown',
    description: 'Dépouillement d’une séquence : éléments par catégorie (accessoires, costumes…).',
    schema: obj({ sequence: int('Numéro de la séquence') }, ['sequence']),
    writes: false,
  },
  {
    name: 'add_sequence',
    description: 'Ajoute une séquence au découpage (sans plan). Renvoie son numéro.',
    schema: obj(
      {
        label: str('Libellé (lieu), en capitales'),
        int_ext: { type: 'string', enum: ['INT', 'EXT', 'INT/EXT'] },
        effect: { type: 'string', enum: ['JOUR', 'NUIT', 'AUBE', 'CRÉPUSCULE'] },
        summary: str('Résumé'),
        after: int('Placer après cette séquence (0 = en tête ; absent = à la fin)'),
      },
      ['label'],
    ),
    writes: true,
  },
  {
    name: 'update_sequence',
    description: 'Modifie une séquence (libellé, intérieur/extérieur, effet, résumé, durée estimée).',
    schema: obj(
      {
        sequence: int('Numéro de la séquence'),
        label: str('Libellé'),
        int_ext: { type: 'string', enum: ['INT', 'EXT', 'INT/EXT'] },
        effect: { type: 'string', enum: ['JOUR', 'NUIT', 'AUBE', 'CRÉPUSCULE'] },
        summary: str('Résumé'),
        estimated_seconds: int('Durée estimée en secondes'),
      },
      ['sequence'],
    ),
    writes: true,
  },
  {
    name: 'add_shots',
    description:
      'Ajoute des plans à une séquence, dans l’ordre, après un plan donné (sinon en fin de séquence). Des plans consécutifs qui couvrent la même action peuvent la partager (link_with_previous).',
    schema: obj(
      {
        sequence: int('Numéro de la séquence'),
        after_shot: int('Insérer après ce plan (0 = en tête)'),
        shots: {
          type: 'array',
          items: obj({ ...SHOT_FIELDS, link_with_previous: { type: 'boolean', description: 'Partage l’action du plan précédent (couverture)' } }, []),
        },
      },
      ['sequence', 'shots'],
    ),
    writes: true,
  },
  {
    name: 'update_shot',
    description: 'Modifie un plan existant ; seuls les champs fournis changent.',
    schema: obj({ sequence: int('Numéro de la séquence'), shot: int('Numéro du plan dans la séquence'), ...SHOT_FIELDS }, ['sequence', 'shot']),
    writes: true,
  },
  {
    name: 'delete_shots',
    description: 'Supprime des plans d’une séquence.',
    schema: obj({ sequence: int('Numéro de la séquence'), shots: { type: 'array', items: { type: 'integer' }, description: 'Numéros des plans' } }, ['sequence', 'shots']),
    writes: true,
  },
  {
    name: 'add_breakdown_items',
    description: 'Ajoute des éléments au dépouillement d’une séquence, dans une catégorie (accessoires, costumes, maquillage, effets, vehicules, figurants…).',
    schema: obj({ sequence: int('Numéro de la séquence'), category: str('Catégorie'), items: strList('Éléments') }, ['sequence', 'category', 'items']),
    writes: true,
  },
  {
    name: 'add_character',
    description: 'Crée la fiche d’un personnage.',
    schema: obj({ name: str('Nom'), kind: { type: 'string', enum: ['principal', 'secondaire', 'figurant', 'silhouette', 'voix off'] }, actor: str('Comédien ou comédienne') }, ['name']),
    writes: true,
  },
  {
    name: 'get_outline',
    description:
      'Séquencier du scénario (numéros du texte, distincts de ceux du découpage) : pour chaque séquence, en-tête, phrase (action essentielle en une ligne), étape de Truby (1 à 22), intrigue (lettre), page imprimée et durée ; les parties ; les intrigues du projet.',
    schema: obj({}, []),
    writes: false,
  },
  {
    name: 'set_outline_entry',
    description: 'Modifie une séquence du séquencier : phrase, étape de Truby (0 = aucune), intrigue (lettre A à Z), lieu, moment, intérieur/extérieur. Seuls les champs fournis changent.',
    schema: obj(
      {
        n: int('Numéro de la séquence dans le scénario'),
        phrase: str('Action essentielle en une phrase (vide = retirée)'),
        step: int('Étape de Truby, 1 à 22 (0 = aucune)'),
        plot: str('Intrigue : une lettre, A à Z'),
        int_ext: { type: 'string', enum: ['INT', 'EXT', 'INT/EXT'] },
        location: str('Lieu'),
        effect: str('Moment (JOUR, NUIT, AUBE, CRÉPUSCULE, MATIN, SOIR…)'),
      },
      ['n'],
    ),
    writes: true,
  },
  {
    name: 'add_outline_entry',
    description: 'Ajoute une séquence au scénario depuis le séquencier : en-tête et phrase, après une séquence donnée (absent = à la fin). Renvoie son numéro.',
    schema: obj(
      {
        after: int('Placer après cette séquence du scénario (0 = en tête ; absent = à la fin)'),
        int_ext: { type: 'string', enum: ['INT', 'EXT', 'INT/EXT'] },
        location: str('Lieu'),
        effect: str('Moment'),
        phrase: str('Action essentielle en une phrase'),
        step: int('Étape de Truby, 1 à 22'),
        plot: str('Intrigue : une lettre, A à Z'),
      },
      ['location'],
    ),
    writes: true,
  },
  {
    name: 'move_outline_entry',
    description: 'Déplace une séquence du scénario (son texte entier) pour qu’elle devienne la séquence « to ». Les parties restent en place ; le découpage suit s’il suivait déjà le texte.',
    schema: obj({ from: int('Numéro actuel de la séquence'), to: int('Numéro voulu') }, ['from', 'to']),
    writes: true,
  },
  {
    name: 'write_scenario',
    description:
      'Écrit dans le scénario, en syntaxe Fountain (en-têtes « INT. LIEU - JOUR », noms en capitales au-dessus des répliques) : à la fin, ou à la place d’une séquence existante.',
    schema: obj({ text: str('Texte Fountain'), replace_scene: int('Numéro de la séquence à remplacer (absent = ajout à la fin)') }, ['text']),
    writes: true,
  },
  {
    name: 'set_format',
    description: 'Change le format du projet (fiction, clip, institutionnel) ; le minutage suit.',
    schema: obj({ format: { type: 'string', enum: ['fiction', 'clip', 'institutionnel'] } }, ['format']),
    writes: true,
  },
];

export const AI_SYSTEM = `Tu es l’assistant de Découpage Studio, l’outil de préparation de tournage d’un réalisateur. Tu réponds en français, avec concision.
Tu peux lire le projet et le modifier avec les outils fournis : découpage technique (séquences et plans), scénario (Fountain), dépouillement, personnages.
Règles :
- Avant de modifier, lis ce qu’il faut (get_project, puis get_sequence ou get_scenario). Les numéros de séquence et de plan sont toujours ceux du moment : relis après une insertion.
- Vocabulaire du cadre : valeurs, axes et hauteurs, mouvements tels que listés dans les outils ; focales en millimètres.
- Le séquencier (get_outline) lit le scénario : une phrase par séquence, étape de Truby et intrigue ; ses numéros sont ceux du texte.
- Ne supprime rien sans demande explicite.
- Après tes modifications, résume en une ou deux phrases ce que tu as fait (l’utilisateur peut tout annuler d’un clic).`;

// --- Exécution ---------------------------------------------------------------------------------

export interface ToolOutcome {
  /** Texte renvoyé au modèle (JSON ou message). */
  result: string;
  isError?: boolean;
  /** Résumé lisible d'une modification, pour l'utilisateur. */
  change?: string;
}

const asInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
const asStr = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
const asList = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : undefined);

function seqIdAt(doc: ProjectDoc, n: unknown): ID {
  const i = asInt(n);
  const id = i !== undefined ? doc.project.sequenceIds[i - 1] : undefined;
  if (!id) throw new Error(`Séquence ${String(n)} introuvable (le projet en compte ${doc.project.sequenceIds.length}).`);
  return id;
}

function shotIdAt(doc: ProjectDoc, seqId: ID, n: unknown): ID {
  const i = asInt(n);
  const id = i !== undefined ? doc.sequences[seqId].shotIds[i - 1] : undefined;
  if (!id) throw new Error(`Plan ${String(n)} introuvable dans cette séquence (${doc.sequences[seqId].shotIds.length} plans).`);
  return id;
}

/** Numéro d'une séquence du séquencier (texte du scénario). */
function outlineN(doc: ProjectDoc, n: unknown): number {
  const i = asInt(n);
  const count = outlineOf(doc.scenario ?? '').filter((x) => x.kind === 'sequence').length;
  if (i === undefined || i < 1 || i > count) throw new Error(`Séquence ${String(n)} introuvable dans le scénario (${count} séquences).`);
  return i;
}

/** Étape et intrigue demandées (0 ou vide : retirées). */
function outlineTag(input: Record<string, unknown>): { step?: number | null; plot?: string | null } {
  const out: { step?: number | null; plot?: string | null } = {};
  const step = asInt(input.step);
  if (step !== undefined) {
    if (step < 0 || step > 22) throw new Error('Étape de Truby : de 1 à 22 (0 = aucune).');
    out.step = step || null;
  }
  const plot = asStr(input.plot);
  if (plot !== undefined) {
    const k = plot.toUpperCase();
    if (k && !/^[A-Z]$/.test(k)) throw new Error('Intrigue : une lettre, de A à Z.');
    out.plot = k || null;
  }
  return out;
}

/** Terme du vocabulaire si reconnu, sinon le texte libre (comme dans la grille). */
const vocabOr = (t: string, entries: typeof SHOT_VALUES) => matchVocab(t, entries)?.short ?? t;

function shotPatch(input: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  const subject = asStr(input.subject);
  if (subject !== undefined) p.subject = subject;
  const value = asStr(input.value);
  if (value !== undefined) p.value = value ? vocabOr(value, SHOT_VALUES) : '';
  const angle = asList(input.angle);
  if (angle) p.angle = angle.map((a) => vocabOr(a, ANGLES));
  const movement = asList(input.movement);
  if (movement) p.movement = movement.filter((m) => fold(m) !== 'fixe').map((m) => vocabOr(m, MOVEMENTS));
  const focal = asInt(input.focal);
  const to = asInt(input.focal_to);
  if (focal !== undefined || to !== undefined) p.focal = { from: focal && focal > 0 ? focal : undefined, to: to && to > 0 ? to : undefined };
  for (const k of ['sound', 'notes'] as const) {
    const v = asStr(input[k]);
    if (v !== undefined) p[k] = v || undefined;
  }
  const status = asStr(input.status);
  if (status === 'à tourner' || status === 'tourné' || status === 'abandonné') p.status = status as ShotStatus;
  return p;
}

function describeSequence(doc: ProjectDoc, seqId: ID) {
  const timing = computeTiming(doc);
  const seq = doc.sequences[seqId];
  return {
    sequence: doc.project.sequenceIds.indexOf(seqId) + 1,
    label: seq.label,
    int_ext: seq.intExt ?? null,
    effect: seq.effect ?? null,
    summary: sequenceSummary(doc, seqId) ?? null,
    estimated: seq.estimatedSec !== undefined ? formatTc(seq.estimatedSec) : null,
    computed: formatTc(timing.sequences.get(seqId)?.durationSec ?? 0),
    shots: seq.shotIds.map((id, i) => {
      const sh = doc.shots[id];
      const b = doc.blocks[sh.actionBlockId];
      const shared = seq.shotIds.filter((x) => doc.shots[x]?.actionBlockId === sh.actionBlockId).length > 1;
      const label = shotNumberLabel(doc, id);
      return {
        shot: i + 1,
        number_shown: label !== String(i + 1) ? label : undefined,
        interview: sh.interview ? 'plan d’une caméra d’interview : réglé dans la fiche d’interview, non modifiable ici' : undefined,
        subject: sh.subject,
        value: sh.value,
        angle: renderTokens(sh.angle),
        movement: renderTokens(sh.movement, sh.movementSep) || 'Fixe',
        focal: formatFocal(sh.focal, isZoom(sh.movement)),
        action: b?.text ?? '',
        dialogue: b?.dialogue || undefined,
        action_shared_with_other_shots: shared || undefined,
        sound: sh.sound || undefined,
        notes: sh.notes || undefined,
        status: sh.status,
      };
    }),
  };
}

/** Exécute un outil sur le brouillon du projet. Les erreurs sont renvoyées au modèle, pas levées. */
export function runAiTool(doc: ProjectDoc, name: string, raw: unknown): ToolOutcome {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'get_project': {
        const timing = computeTiming(doc);
        return {
          result: JSON.stringify({
            title: doc.project.title,
            format: doc.project.format,
            timing_mode: doc.project.settings.tcMode,
            total: formatTc(timing.totalSec),
            sequences: doc.project.sequenceIds.map((id, i) => ({
              sequence: i + 1,
              label: doc.sequences[id].label,
              int_ext: doc.sequences[id].intExt ?? null,
              effect: doc.sequences[id].effect ?? null,
              shots: doc.sequences[id].shotIds.length,
            })),
            characters: Object.values(doc.characters).map((c) => ({ name: c.name, kind: c.kind })),
            decors: Object.values(doc.decors).map((d) => d.name),
            scenario_scenes: scenesOf(doc.scenario ?? '').length,
            breakdown_categories: breakdownCategories(doc).map(breakdownLabel),
          }),
        };
      }
      case 'get_sequence':
        return { result: JSON.stringify(describeSequence(doc, seqIdAt(doc, input.sequence))) };
      case 'get_scenario': {
        const src = doc.scenario ?? '';
        const n = asInt(input.scene);
        if (n === undefined) return { result: src || '(scénario vide)' };
        const sc = outlineSequences(src)[n - 1];
        if (!sc) return { result: `Séquence ${n} introuvable.`, isError: true };
        return { result: src.slice(sc.start, sc.end) };
      }
      case 'get_breakdown': {
        const seqId = seqIdAt(doc, input.sequence);
        const b = breakdownOf(doc, seqId);
        return { result: JSON.stringify(Object.fromEntries(breakdownCategories(doc).map((c) => [breakdownLabel(c), b[c] ?? []]))) };
      }
      case 'add_sequence': {
        const label = asStr(input.label);
        if (!label) throw new Error('Libellé manquant.');
        const after = asInt(input.after);
        const index = after === undefined ? undefined : Math.max(0, Math.min(after, doc.project.sequenceIds.length));
        const id = addSequence(doc, index, { label: label.toLocaleUpperCase('fr'), intExt: asStr(input.int_ext) as IntExt | undefined, effect: asStr(input.effect) as Effect | undefined, summary: asStr(input.summary) || undefined }, false);
        setSequenceDecorByName(doc, id, label);
        const n = doc.project.sequenceIds.indexOf(id) + 1;
        return { result: JSON.stringify({ sequence: n }), change: `Séquence ${n} ajoutée (${label.toLocaleUpperCase('fr')})` };
      }
      case 'update_sequence': {
        const seqId = seqIdAt(doc, input.sequence);
        const seq = doc.sequences[seqId];
        const label = asStr(input.label);
        if (label) {
          seq.label = label.toLocaleUpperCase('fr');
          setSequenceDecorByName(doc, seqId, label);
        }
        const ie = asStr(input.int_ext);
        if (ie === 'INT' || ie === 'EXT' || ie === 'INT/EXT') seq.intExt = ie;
        const ef = asStr(input.effect);
        if (ef === 'JOUR' || ef === 'NUIT' || ef === 'AUBE' || ef === 'CRÉPUSCULE') seq.effect = ef;
        const sum = asStr(input.summary);
        if (sum !== undefined) setSequenceSummary(doc, seqId, sum);
        const est = asInt(input.estimated_seconds);
        if (est !== undefined && est >= 0) seq.estimatedSec = est;
        return { result: 'ok', change: `Séquence ${input.sequence} modifiée` };
      }
      case 'add_shots': {
        const seqId = seqIdAt(doc, input.sequence);
        const list = Array.isArray(input.shots) ? input.shots : [];
        if (!list.length) throw new Error('Aucun plan fourni.');
        const seq = doc.sequences[seqId];
        const after = asInt(input.after_shot);
        let index = after === undefined ? seq.shotIds.length : Math.max(0, Math.min(after, seq.shotIds.length));
        let prev: ID | undefined = index > 0 ? seq.shotIds[index - 1] : undefined;
        const created: ID[] = [];
        for (const rawShot of list.slice(0, 60)) {
          const s = (rawShot && typeof rawShot === 'object' ? rawShot : {}) as Record<string, unknown>;
          const link = s.link_with_previous === true && prev;
          const patch = shotPatch(s);
          const id = addShot(doc, seqId, {
            index,
            blockId: link ? doc.shots[prev!].actionBlockId : undefined,
            action: { text: asStr(s.action) ?? '' },
            init: patch,
          });
          if (link) linkAction(doc, [prev!, id]);
          created.push(id);
          prev = id;
          index = doc.sequences[seqId].shotIds.indexOf(id) + 1;
        }
        const n = doc.project.sequenceIds.indexOf(seqId) + 1;
        const nums = created.map((id) => doc.sequences[seqId].shotIds.indexOf(id) + 1);
        return { result: JSON.stringify({ added_shots: nums }), change: `${created.length} plan${created.length > 1 ? 's' : ''} ajouté${created.length > 1 ? 's' : ''} à la séquence ${n}` };
      }
      case 'update_shot': {
        const seqId = seqIdAt(doc, input.sequence);
        const shotId = shotIdAt(doc, seqId, input.shot);
        const shot = doc.shots[shotId];
        if (shot.interview) throw new Error('Ce plan vient de la fiche d’interview : il se modifie dans la fiche (vue Interview), pas ici.');
        Object.assign(shot, shotPatch(input));
        const action = asStr(input.action);
        if (action !== undefined && doc.blocks[shot.actionBlockId]) doc.blocks[shot.actionBlockId].text = action;
        return { result: 'ok', change: `Plan ${input.sequence}.${input.shot} modifié` };
      }
      case 'delete_shots': {
        const seqId = seqIdAt(doc, input.sequence);
        const ids = (Array.isArray(input.shots) ? input.shots : []).map((n) => shotIdAt(doc, seqId, n));
        for (const id of ids) deleteShot(doc, id);
        return { result: 'ok', change: `${ids.length} plan${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''} (séquence ${input.sequence})` };
      }
      case 'add_breakdown_items': {
        const seqId = seqIdAt(doc, input.sequence);
        const wanted = fold(asStr(input.category) ?? '');
        const cat = breakdownCategories(doc).find((c) => fold(c) === wanted || fold(breakdownLabel(c)) === wanted || fold(breakdownLabel(c)).startsWith(wanted));
        if (!cat) throw new Error(`Catégorie inconnue. Catégories : ${breakdownCategories(doc).map(breakdownLabel).join(', ')}.`);
        const items = asList(input.items) ?? [];
        addBreakdownItems(doc, seqId, cat, items);
        return { result: 'ok', change: `Dépouillement : ${items.length} élément${items.length > 1 ? 's' : ''} (${breakdownLabel(cat).toLowerCase()}, séquence ${input.sequence})` };
      }
      case 'add_character': {
        const name = asStr(input.name);
        if (!name) throw new Error('Nom manquant.');
        if (Object.values(doc.characters).some((c) => fold(c.name) === fold(name))) return { result: 'Ce personnage existe déjà.' };
        const kind = asStr(input.kind) as CharacterKind | undefined;
        addCharacter(doc, { name, kind: kind ?? 'secondaire', actor: asStr(input.actor) || undefined });
        return { result: 'ok', change: `Personnage ${name} créé` };
      }
      case 'get_outline': {
        const m = outlineMeasures(doc);
        const items = outlineOf(doc.scenario ?? '');
        return {
          result: JSON.stringify({
            sequences: items.filter((x): x is OutlineSequence => x.kind === 'sequence').map((x) => ({
              n: x.n,
              heading: x.heading,
              phrase: x.phrase,
              step: x.step ?? null,
              step_label: x.step !== undefined ? stepLabel(x.step) : null,
              plot: x.plot,
              page: m.byN.get(x.n)?.page ?? null,
              duration: mmss(m.byN.get(x.n)?.sec ?? 0),
            })),
            parts: items.flatMap((x, i) => (x.kind === 'part' ? [{ title: x.title, before: items.slice(i).find((y): y is OutlineSequence => y.kind === 'sequence')?.n ?? null }] : [])),
            plots: plotsOf(doc).map((p) => ({ key: p.key, name: p.name })),
          }),
        };
      }
      case 'set_outline_entry': {
        // Tout est lu et préparé d'abord : une entrée refusée n'écrit rien.
        const n = outlineN(doc, input.n);
        const tag = outlineTag(input);
        const ie = asStr(input.int_ext);
        const location = asStr(input.location);
        const effect = asStr(input.effect);
        const phrase = asStr(input.phrase);
        const edits: SourceEdit[] = [];
        const changed: string[] = [];
        let src = doc.scenario ?? '';
        const push = (e: SourceEdit, what: string) => {
          edits.push(e);
          src = e.source;
          changed.push(what);
        };
        if (ie !== undefined || location || effect !== undefined) {
          const h: { intExt?: string; location?: string; effect?: string } = {};
          if (ie !== undefined) h.intExt = ie;
          if (location) h.location = location;
          if (effect !== undefined) h.effect = effect;
          push(setHeading(src, n, h), 'en-tête');
        }
        if (phrase !== undefined) push(setPhrase(src, n, phrase), 'phrase');
        if (Object.keys(tag).length) {
          const what = [...('step' in tag ? ['étape'] : []), ...('plot' in tag ? [`intrigue (${plotName(doc, tag.plot ?? 'A')})`] : [])].join(', ');
          push(setOutlineTag(src, n, tag), what);
        }
        if (!changed.length) throw new Error('Rien à modifier.');
        for (const e of edits) applyScenarioEdit(doc, e);
        return { result: 'ok', change: `Séquencier, séquence ${n} : ${changed.join(', ')}` };
      }
      case 'add_outline_entry': {
        const location = asStr(input.location);
        if (!location) throw new Error('Lieu manquant.');
        const after = asInt(input.after);
        const tag = outlineTag(input);
        const edit = insertEntry(doc.scenario ?? '', after === undefined ? 'end' : Math.max(0, after), {
          intExt: asStr(input.int_ext),
          location,
          effect: asStr(input.effect),
          phrase: asStr(input.phrase) ?? '',
          step: tag.step ?? undefined,
          plot: tag.plot ?? undefined,
        });
        applyScenarioEdit(doc, edit);
        return { result: JSON.stringify({ n: edit.n }), change: `Séquencier : séquence ${edit.n} ajoutée (${location.toLocaleUpperCase('fr')})` };
      }
      case 'move_outline_entry': {
        const from = outlineN(doc, input.from);
        const to = outlineN(doc, input.to);
        if (from === to) return { result: 'ok' };
        applyScenarioEdit(doc, moveEntry(doc.scenario ?? '', from, to), { reorderCut: true });
        return { result: 'ok', change: `Séquencier : séquence ${from} déplacée en ${to}` };
      }
      case 'write_scenario': {
        const text = (asStr(input.text) ?? '').replace(/\r\n?/g, '\n');
        if (!text) throw new Error('Texte vide.');
        const src = doc.scenario ?? '';
        const n = asInt(input.replace_scene);
        if (n !== undefined) {
          // Numéros du séquencier (en-têtes vides ignorés) ; la scène entière, ligne d'en-tête comprise (« .CUISINE »).
          const sc = outlineSequences(src)[n - 1];
          if (!sc) throw new Error(`Séquence ${n} introuvable.`);
          const rest = src.slice(sc.end).replace(/^\n+/, '');
          const next = carryOutline(src, src.slice(0, sc.start) + text.replace(/\n*$/, rest ? '\n\n' : '\n') + rest);
          shiftAnchors(doc, src, next);
          doc.scenario = next;
          return { result: 'ok', change: `Séquence ${n} du scénario réécrite` };
        }
        const next = src.trimEnd() ? `${src.trimEnd()}\n\n${text}\n` : `${text}\n`;
        shiftAnchors(doc, src, next);
        doc.scenario = next;
        return { result: 'ok', change: 'Scénario complété' };
      }
      case 'set_format': {
        const f = asStr(input.format) as ProjectFormat | undefined;
        if (f !== 'fiction' && f !== 'clip' && f !== 'institutionnel') throw new Error('Format inconnu.');
        applyFormat(doc, f);
        return { result: 'ok', change: `Format : ${f}` };
      }
      default:
        return { result: `Outil inconnu : ${name}`, isError: true };
    }
  } catch (e) {
    return { result: (e as Error).message, isError: true };
  }
}
