/**
 * Relecture en ligne : l'instantané publié dans Google Drive pour les relecteurs. Il ne contient que
 * ce qui sert à relire la version publiée — scénario, séquences, plans, actions, réglages d'affichage
 * du découpage, noms des personnages et des décors, images du storyboard, commentaires — et rien
 * de la préparation (lieux et contacts, plan de travail, feuilles de service, calendrier, matériel,
 * recherche, dépouillement, note d'intention, plans au sol, piste audio, réglages privés).
 */
import { commentAttachments, type ReviewComment } from './comments';
import { defaultSettings } from './factory';
import type { Interview } from './interview';
import { migrate, ProjectFileError, type MediaEntry } from './serialize';
import { SCHEMA_VERSION, type Character, type ColumnKey, type Decor, type ID, type ProjectDoc, type ProjectSettings, type Sequence, type Shot } from './types';
import type { ProjectVersion } from './versions';

export const REVIEW_FORMAT = 'decoupage-studio-review';
export const REVIEW_SCHEMA = 1;

/** Ce que le projet de l'auteur retient de sa relecture en ligne. */
export interface ReviewPublication {
  /** Fichier publié (dans le Drive de l'auteur) : le même d'une publication à l'autre. */
  fileId: string;
  resourceKey?: string;
  /** Version du film publiée. */
  publishedVersionId: ID;
  publishedAt: string;
  /** Lien arrêté : le fichier reste, plus personne ne l'ouvre. */
  stopped?: boolean;
  /** Commentaires Drive retirés ici : jamais réimportés. */
  dismissed?: string[];
}

export interface ReviewSnapshot {
  format: typeof REVIEW_FORMAT;
  schemaVersion: number;
  publishedAt: string;
  versionId?: ID;
  doc: ProjectDoc;
  /** Images (storyboard de la version publiée, pièces jointes des commentaires), en base 64. */
  media: Record<string, MediaEntry>;
  /** Commentaires Drive retirés par l'auteur. */
  dismissed?: string[];
}

/** Réglages d'affichage du découpage et du minutage (rien de privé). */
const SETTINGS_KEYS = [
  'tcMode',
  'tcModeChosen',
  'tcGranularity',
  'scriptChrono',
  'dialogueWordsPerSecond',
  'actionWordsPerSecond',
  'minActionSeconds',
  'sensor',
  'cropFactor',
  'fps',
  'labelStyle',
  'shotCodeFormat',
  'exportTheme',
  'exportColumns',
  'gridColumns',
  'neverMerge',
  'exportPaper',
  'exportInkSaver',
  'exportNoMerge',
  'exportSmart',
  'exportOrientation',
  'storyboardAspect',
  'storyboardPerRow',
  'exportFooter',
] as const satisfies ReadonlyArray<keyof ProjectSettings>;

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function displaySettings(doc: ProjectDoc): ProjectSettings {
  const src = doc.project.settings;
  const out = defaultSettings(doc.project.format) as unknown as Record<string, unknown>;
  for (const k of SETTINGS_KEYS) if (src[k] !== undefined) out[k] = copy(src[k]);
  // Minutage calé sur une piste : sa durée seulement, ni le son ni son nom.
  if (src.audioTrack) out.audioTrack = { name: '', durationSec: src.audioTrack.durationSec };
  return out as unknown as ProjectSettings;
}

/** Champs des colonnes facultatives : publiés seulement si la colonne s'affiche (tableau ou export). */
const COLUMN_FIELDS = ['notes', 'sound', 'light', 'aperture', 'shootingDay', 'status'] as const satisfies ReadonlyArray<keyof Shot & ColumnKey>;

/**
 * Plan tel qu'il se relit : l'image affichée du storyboard, sans l'original ni le dessin modifiable,
 * et sans ce que ses colonnes masquées gardent (notes, jour de tournage, statut…).
 */
function reviewShot(sh: Shot, shown: ReadonlySet<ColumnKey>): Shot {
  const out = copy(sh);
  for (const k of COLUMN_FIELDS) {
    if (shown.has(k)) continue;
    if (k === 'status') out.status = 'à tourner';
    else delete out[k];
  }
  const frame = <F extends { blobKey?: string; baseKey?: string; sketch?: unknown; baseFit?: unknown; baseCrop?: unknown; sketchAspect?: unknown }>(f: F): F => {
    delete f.baseKey;
    delete f.sketch;
    delete f.baseFit;
    delete f.baseCrop;
    delete f.sketchAspect;
    return f;
  };
  if (out.storyboard) out.storyboard = frame(out.storyboard);
  if (out.keyframes) out.keyframes = out.keyframes.map(frame);
  return out;
}

/** Interview : ce qu'il faut pour numéroter et décrire ses plans (pas les questions, ni les lieux). */
function reviewInterview(itw: Interview | undefined): Interview | undefined {
  if (!itw) return undefined;
  return {
    questions: [],
    subjects: itw.subjects.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      setups: (s.setups ?? []).map((st) => ({
        id: st.id,
        name: st.name,
        eyeline: st.eyeline,
        cameras: st.cameras.map((c) => ({ id: c.id, name: c.name, value: c.value, angle: c.angle, focal: c.focal })),
        place: '',
        background: '',
        light: '',
        sound: '',
        ...(st.sequenceId ? { sequenceId: st.sequenceId } : {}),
      })),
    })),
  };
}

/** Versions publiées : la courante et les précédentes ; une version plus récente reste privée. */
export function publishedVersions(doc: ProjectDoc): ProjectVersion[] {
  const list = doc.versions ?? [];
  const at = list.findIndex((v) => v.id === doc.activeVersionId);
  return at < 0 ? [] : list.slice(0, at + 1);
}

/** Version d'un commentaire (ceux d'avant les versions comptent pour la première). */
const versionOfComment = (doc: ProjectDoc, c: { versionId?: ID }) => c.versionId ?? doc.versions?.[0]?.id;

/** Passage retrouvé par sa citation dans un texte, au plus près de sa place d'origine. */
export function locateQuote(text: string, quote: string, near: number): { start: number; end: number } | null {
  const q = quote.trim();
  if (!q) return null;
  let best: { start: number; end: number } | null = null;
  const consider = (start: number, end: number) => {
    if (!best || Math.abs(start - near) < Math.abs(best.start - near)) best = { start, end };
  };
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) consider(i, i + q.length);
  if (best) return best;
  // Citation saisie espaces réduits (retours à la ligne du texte) : on la cherche espaces souples.
  const words = q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.join('').length > 2000) return null;
  const re = new RegExp(words.join('\\s+'), 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) consider(m.index, m.index + m[0].length);
  return best;
}

const norm = (x: string) => x.replace(/\s+/g, ' ').trim();

const spaces = (x: string) => x.replace(/[^\n]/g, ' ');

/**
 * Scénario sans ses aides à l'écriture, qui ne s'impriment jamais : notes « [[…]] » (pas les marques
 * de surlignage « [[=couleur]] »), passages écartés « /* … *\/ », parties « # » et résumés « = ».
 * Leur texte devient des espaces : les positions (passages commentés, ancres des séquences) restent.
 */
export function publicScript(text: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, spaces);
  out = out.replace(/\[\[(?!=)[\s\S]*?\]\]/g, (m, at: number) => {
    const before = out.slice(out.lastIndexOf('\n', at - 1) + 1, at);
    const nl = out.indexOf('\n', at + m.length);
    const after = out.slice(at + m.length, nl < 0 ? undefined : nl);
    // Note seule sur sa ligne : la ligne devient blanche ; dans une ligne, les crochets restent.
    return !before.trim() && !after.trim() ? spaces(m) : `[[${spaces(m.slice(2, -2))}]]`;
  });
  return out.replace(/^[^\S\n]*(#|=(?!==))[^\n]*/gm, spaces);
}

/**
 * Commentaires tels qu'ils partent chez les relecteurs : ceux des versions publiées seulement (un
 * commentaire d'une version plus récente citerait un texte qui n'est pas publié). Les passages de la
 * version publiée sont recalés sur son texte publié (l'auteur a pu continuer à l'écrire depuis).
 */
export function publishedComments(doc: ProjectDoc, snapshot: Pick<ProjectDoc, 'scenario' | 'activeVersionId' | 'versions'>): ReviewComment[] {
  const ids = new Set((snapshot.versions ?? []).map((v) => v.id));
  const text = snapshot.scenario ?? '';
  return (doc.comments ?? [])
    .filter((c) => {
      const v = versionOfComment(doc, c);
      return !ids.size || (v !== undefined && ids.has(v));
    })
    .map((c) => {
      const out = copy(c);
      const a = out.anchor;
      if (a.kind === 'script' && versionOfComment(doc, c) === snapshot.activeVersionId && norm(text.slice(a.start, a.end)) !== norm(a.quote)) {
        const found = locateQuote(text, a.quote, a.start);
        if (found) Object.assign(a, found);
        else {
          // Passage absent du texte publié (écrit depuis, ou dans une note) : rien de lui ne sort.
          a.end = a.start = Math.min(a.start, text.length);
          a.quote = '';
        }
      }
      return out;
    });
}

/** Le projet tel qu'il se relit (fonction pure) : la version courante de l'auteur, rien de privé. */
export function reviewDoc(doc: ProjectDoc): ProjectDoc {
  const p = doc.project;
  const versions = publishedVersions(doc).map((v): ProjectVersion => {
    const base: ProjectVersion = { id: v.id, name: v.name, createdAt: v.createdAt, ...(v.from ? { from: v.from } : {}) };
    // Versions précédentes : leur texte seul, pour retrouver leurs commentaires par citation.
    return v.id === doc.activeVersionId ? base : { ...base, slice: { scenario: publicScript(v.slice?.scenario ?? ''), sequenceIds: [], sequences: {}, shots: {}, blocks: {} } };
  });
  const st = p.settings;
  const shown = new Set<ColumnKey>([...(st.gridColumns ?? []), ...(st.exportColumns ?? [])]);
  const characters: Record<ID, Character> = {};
  for (const [id, c] of Object.entries(doc.characters)) characters[id] = { id, name: c.name, kind: c.kind, ...(c.color ? { color: c.color } : {}), ...(c.aliases?.length ? { aliases: [...c.aliases] } : {}) };
  const decors: Record<ID, Decor> = {};
  for (const [id, d] of Object.entries(doc.decors)) decors[id] = { id, name: d.name, ...(d.intExt ? { intExt: d.intExt } : {}) };
  const shots: Record<ID, Shot> = {};
  for (const [id, sh] of Object.entries(doc.shots)) shots[id] = reviewShot(sh, shown);
  // Séquences : sans le créneau de tournage (plan de travail).
  const sequences: Record<ID, Sequence> = {};
  for (const [id, sq] of Object.entries(doc.sequences)) {
    const out = copy(sq);
    delete out.slot;
    sequences[id] = out;
  }
  const out: ProjectDoc = {
    project: {
      id: p.id,
      schemaVersion: SCHEMA_VERSION,
      title: p.title,
      ...(p.director ? { director: p.director } : {}),
      version: p.version,
      format: p.format,
      settings: displaySettings(doc),
      sequenceIds: [...p.sequenceIds],
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    },
    sequences,
    shots,
    blocks: copy(doc.blocks),
    characters,
    decors,
    ignoredChecks: [],
    validatedSteps: [],
    customVocabulary: copy(doc.customVocabulary),
    manualEquipment: [],
    ...(doc.scenario !== undefined ? { scenario: publicScript(doc.scenario) } : {}),
    ...(doc.interview ? { interview: reviewInterview(doc.interview) } : {}),
    ...(versions.length ? { versions, activeVersionId: doc.activeVersionId } : {}),
  };
  out.comments = publishedComments(doc, out);
  return out;
}

/** Médias à joindre : images du storyboard de la version publiée, pièces jointes des commentaires. */
export function reviewMediaKeys(snapshotDoc: ProjectDoc): string[] {
  const keys = new Set<string>();
  for (const sh of Object.values(snapshotDoc.shots)) {
    if (sh.storyboard?.blobKey) keys.add(sh.storyboard.blobKey);
    for (const k of sh.keyframes ?? []) if (k.blobKey) keys.add(k.blobKey);
  }
  for (const k of commentAttachments(snapshotDoc)) keys.add(k);
  return [...keys];
}

const pickMedia = (doc: ProjectDoc, media: Record<string, MediaEntry>) => {
  const out: Record<string, MediaEntry> = {};
  for (const k of reviewMediaKeys(doc)) if (media[k]) out[k] = media[k];
  return out;
};

/** Instantané à publier : le projet relu et ses images (déjà réduites par l'appelant). */
export function reviewSnapshot(doc: ProjectDoc, media: Record<string, MediaEntry>, publishedAt = new Date().toISOString()): ReviewSnapshot {
  const d = reviewDoc(doc);
  return {
    format: REVIEW_FORMAT,
    schemaVersion: REVIEW_SCHEMA,
    publishedAt,
    ...(d.activeVersionId ? { versionId: d.activeVersionId } : {}),
    doc: d,
    media: pickMedia(d, media),
    ...(doc.review?.dismissed?.length ? { dismissed: [...doc.review.dismissed] } : {}),
  };
}

/**
 * Instantané déjà publié, commentaires remis à jour (réponses, réglés, retours importés) : seule la
 * partie commentaires change — le texte publié ne bouge que par une nouvelle publication.
 */
export function withComments(snap: ReviewSnapshot, doc: ProjectDoc, media: Record<string, MediaEntry>): ReviewSnapshot {
  const d: ProjectDoc = { ...snap.doc, comments: publishedComments(doc, snap.doc) };
  const keep = new Set(reviewMediaKeys(d));
  const out: Record<string, MediaEntry> = {};
  for (const k of keep) {
    const m = snap.media[k] ?? media[k];
    if (m) out[k] = m;
  }
  return { ...snap, doc: d, media: out, ...(doc.review?.dismissed?.length ? { dismissed: [...doc.review.dismissed] } : {}) };
}

/** Images reçues d'ailleurs : matricielles seulement (jamais un SVG ni un document qui s'exécute). */
export const RASTER_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Lit un instantané de relecture (vérifié, réparé comme un fichier de projet). */
export function parseReviewSnapshot(text: string): ReviewSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('Ce lien ne mène pas à une relecture.');
  }
  if (!isObject(raw) || raw.format !== REVIEW_FORMAT || !isObject(raw.doc)) throw new ProjectFileError('Ce lien ne mène pas à une relecture.');
  if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion > REVIEW_SCHEMA) throw new ProjectFileError('Cette relecture vient d’une version plus récente de l’application.');
  const doc = migrate(raw.doc as unknown as ProjectDoc);
  const media: Record<string, MediaEntry> = {};
  if (isObject(raw.media))
    for (const [k, m] of Object.entries(raw.media))
      if (isObject(m) && typeof m.type === 'string' && RASTER_TYPES.has(m.type) && typeof m.data === 'string') media[k] = { type: m.type, data: m.data };
  delete doc.review;
  // Commentaires abîmés écartés plutôt que de faire planter l'affichage.
  doc.comments = (Array.isArray(doc.comments) ? doc.comments : [])
    .filter((c) => isObject(c) && typeof c.id === 'string' && isObject(c.anchor))
    .map((c) => ({ ...c, text: String(c.text ?? ''), author: String(c.author ?? ''), replies: (Array.isArray(c.replies) ? c.replies : []).filter((r) => isObject(r) && typeof r.id === 'string') }));
  const versionId = doc.activeVersionId;
  const dismissed = Array.isArray(raw.dismissed) ? raw.dismissed.filter((x): x is string => typeof x === 'string') : [];
  return {
    format: REVIEW_FORMAT,
    schemaVersion: raw.schemaVersion,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : '',
    ...(versionId ? { versionId } : {}),
    doc,
    media,
    ...(dismissed.length ? { dismissed } : {}),
  };
}
