/**
 * Versions du film (V1, V2…) : une ligne commune au scénario et au découpage.
 *
 * Ce qui change d'une version à l'autre — le texte du scénario et le découpage (séquences, plans,
 * actions) — est propre à chaque version ; tout le reste (personnages, décors, dépouillement, plans
 * au sol, plan de travail, interview, note d'intention, réglages) est commun.
 *
 * Une nouvelle version part d'une copie exacte de la version courante, avec les mêmes identifiants :
 * ce qui y reste garde tout ce qui s'y rattache (dépouillement, plans au sol, jours de tournage…) ;
 * seul ce qu'on ajoute est neuf. Ce qu'on retire n'est pas effacé : la version précédente le garde,
 * et les données de préparation qui s'y rattachent restent dans le projet, prêtes si on y revient.
 * La version courante vit dans le projet lui-même ; les autres sont rangées à côté, figées.
 */
import { newId } from './factory';
import { adoptUnversionedComments } from './comments';
import { scenesOf } from './fountain';
import { alignScenes } from './sceneAlign';
import type { ActionBlock, ID, ProjectDoc, Sequence, Shot } from './types';

/** Ce qui est propre à une version. */
export interface VersionSlice {
  scenario?: string;
  sequenceIds: ID[];
  sequences: Record<ID, Sequence>;
  shots: Record<ID, Shot>;
  blocks: Record<ID, ActionBlock>;
}

export interface ProjectVersion {
  id: ID;
  name: string;
  createdAt: string;
  /** Version d'origine (celle qu'on a copiée). */
  from?: ID;
  /** Contenu figé ; absent pour la version courante, qui vit dans le projet. */
  slice?: VersionSlice;
}

/** Copie profonde (lit aussi à travers un brouillon immer, que structuredClone refuse). */
const deepCopy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function sliceOf(doc: ProjectDoc): VersionSlice {
  return deepCopy({ scenario: doc.scenario, sequenceIds: doc.project.sequenceIds, sequences: doc.sequences, shots: doc.shots, blocks: doc.blocks });
}

function applySlice(doc: ProjectDoc, s: VersionSlice): void {
  const c = deepCopy(s);
  doc.scenario = c.scenario;
  doc.project.sequenceIds = c.sequenceIds;
  doc.sequences = c.sequences;
  doc.shots = c.shots;
  doc.blocks = c.blocks;
}

/** Versions du projet (la première est créée au besoin, au nom de la version affichée jusqu'ici). */
export function ensureVersions(doc: ProjectDoc): ProjectVersion[] {
  if (!doc.versions?.length) {
    const id = newId();
    doc.versions = [{ id, name: doc.project.version?.trim() || 'V1', createdAt: doc.project.createdAt ?? new Date().toISOString() }];
    doc.activeVersionId = id;
    adoptUnversionedComments(doc, id);
  }
  if (!doc.versions.some((v) => v.id === doc.activeVersionId)) doc.activeVersionId = doc.versions.find((v) => !v.slice)?.id ?? doc.versions[doc.versions.length - 1].id;
  return doc.versions;
}

export const activeVersion = (doc: ProjectDoc): ProjectVersion | undefined => doc.versions?.find((v) => v.id === doc.activeVersionId);

/** « V3 » après V1 et V2 ; « V2 » après « Version de tournage ». */
export function nextVersionName(names: readonly string[]): string {
  const n = Math.max(names.length, ...names.map((x) => Number(/(\d+)\s*$/.exec(x)?.[1] ?? 0)));
  return `V${n + 1}`;
}

/** Nouvelle version, copie de la courante (mêmes identifiants), qui devient la courante. */
export function createVersion(doc: ProjectDoc, name?: string): ID {
  const list = ensureVersions(doc);
  const current = activeVersion(doc)!;
  current.slice = sliceOf(doc);
  const v: ProjectVersion = { id: newId(), name: name?.trim() || nextVersionName(list.map((x) => x.name)), createdAt: new Date().toISOString(), from: current.id };
  list.push(v);
  doc.activeVersionId = v.id;
  doc.project.version = v.name;
  return v.id;
}

/** Passe à une autre version : la courante est rangée telle quelle, l'autre est remise en place. */
export function switchVersion(doc: ProjectDoc, id: ID): void {
  const list = ensureVersions(doc);
  const target = list.find((v) => v.id === id);
  const current = activeVersion(doc);
  if (!target || !current || target.id === current.id || !target.slice) return;
  current.slice = sliceOf(doc);
  applySlice(doc, target.slice);
  target.slice = undefined;
  doc.activeVersionId = target.id;
  doc.project.version = target.name;
}

export function renameVersion(doc: ProjectDoc, id: ID, name: string): void {
  const v = ensureVersions(doc).find((x) => x.id === id);
  if (!v || !name.trim()) return;
  v.name = name.trim();
  if (v.id === doc.activeVersionId) doc.project.version = v.name;
}

/** Supprime une version rangée (jamais la courante ni la dernière). */
export function deleteVersion(doc: ProjectDoc, id: ID): void {
  const list = ensureVersions(doc);
  if (list.length < 2 || id === doc.activeVersionId) return;
  doc.versions = list.filter((v) => v.id !== id).map((v) => (v.from === id ? { ...v, from: list.find((x) => x.id === id)?.from } : v));
}

export interface VersionDiff {
  /** Séquences de la version courante absentes de l'autre. */
  added: ID[];
  /** Séquences de l'autre version absentes de la courante. */
  removed: ID[];
  /** Séquences communes dont le texte ou le découpage a changé. */
  changed: ID[];
}

/** Texte d'une séquence (passage du scénario s'il est lié, sinon libellé, actions et plans). */
function fingerprint(s: VersionSlice, seqId: ID): string {
  const seq = s.sequences[seqId];
  if (!seq) return '';
  const a = seq.scenarioAnchor;
  const passage = a && s.scenario ? s.scenario.slice(a.start, a.end) : '';
  const cut = seq.shotIds.map((id) => {
    const sh = s.shots[id];
    const b = sh ? s.blocks[sh.actionBlockId] : undefined;
    return sh ? [sh.subject, sh.value, sh.angle.join('/'), sh.movement.join('/'), b?.text, b?.dialogue].join('|') : '';
  });
  return [seq.label, seq.intExt, seq.effect, passage, ...cut].join('\n');
}

/** Ce qui distingue la version courante d'une autre : séquences ajoutées, retirées, modifiées. */
export function compareVersions(doc: ProjectDoc, otherId: ID): VersionDiff | null {
  const other = doc.versions?.find((v) => v.id === otherId)?.slice;
  if (!other) return null;
  const cur = sliceOf(doc);
  const a = new Set(cur.sequenceIds);
  const b = new Set(other.sequenceIds);
  return {
    added: cur.sequenceIds.filter((id) => !b.has(id)),
    removed: other.sequenceIds.filter((id) => !a.has(id)),
    changed: cur.sequenceIds.filter((id) => b.has(id) && fingerprint(cur, id) !== fingerprint(other, id)),
  };
}

/** Nombre de scènes du scénario d'une version (pour la liste des versions). */
export function versionScenes(doc: ProjectDoc, v: ProjectVersion): number {
  return scenesOf((v.slice ? v.slice.scenario : doc.scenario) ?? '').length;
}

/** Tout ce que gardent les versions rangées (pour ne jamais perdre une image du storyboard). */
export function storedShots(doc: ProjectDoc): Shot[] {
  return (doc.versions ?? []).flatMap((v) => Object.values(v.slice?.shots ?? {}));
}

/**
 * Marques de révision : scènes de la version courante neuves ou modifiées depuis la version dont
 * elle est partie (par indice de scène dans le scénario courant). Rien sans version d'origine.
 */
export function revisedScenes(doc: ProjectDoc): Map<number, 'new' | 'changed'> | null {
  const cur = activeVersion(doc);
  const from = cur?.from ? doc.versions?.find((v) => v.id === cur.from) : undefined;
  if (!from?.slice) return null;
  const al = alignScenes(from.slice.scenario ?? '', doc.scenario ?? '');
  const out = new Map<number, 'new' | 'changed'>();
  for (const k of al.added) out.set(k, 'new');
  for (const m of al.matches) if (!m.same) out.set(m.to, 'changed');
  return out;
}

/** Texte effacé mis de côté (un par version), pour le rétablir même après un rechargement. */
export interface ClearedScenario {
  versionId?: ID;
  text: string;
  at: string;
  /** Liens au texte des séquences et des actions, rendus au rétablissement. */
  anchors?: Record<ID, { start: number; end: number }>;
}

/**
 * Efface le texte du scénario de la version courante, ou de toutes. Le découpage, ses plans et la
 * préparation restent (seuls leurs liens au texte tombent) ; le texte effacé est mis de côté.
 */
export function clearScenario(doc: ProjectDoc, scope: 'current' | 'all'): void {
  const keep: ClearedScenario[] = [];
  const at = new Date().toISOString();
  const strip = (s: { scenario?: string; sequences: Record<ID, Sequence>; blocks: Record<ID, ActionBlock> }, versionId?: ID) => {
    const anchors: Record<ID, { start: number; end: number }> = {};
    for (const o of [...Object.values(s.sequences), ...Object.values(s.blocks)])
      if (o.scenarioAnchor) {
        anchors[o.id] = { ...o.scenarioAnchor };
        delete o.scenarioAnchor;
      }
    if (s.scenario?.trim()) keep.push({ versionId, text: s.scenario, at, anchors });
    s.scenario = '';
  };
  strip(doc, doc.activeVersionId);
  if (scope === 'all') for (const v of doc.versions ?? []) if (v.slice) strip(v.slice, v.id);
  const ids = new Set(keep.map((k) => k.versionId));
  doc.clearedScenarios = [...(doc.clearedScenarios ?? []).filter((c) => !ids.has(c.versionId)), ...keep];
}

/** Texte effacé de la version courante, s'il peut être rétabli (la version est restée vide). */
export function clearedOf(doc: ProjectDoc): ClearedScenario | undefined {
  if ((doc.scenario ?? '').trim()) return undefined;
  return doc.clearedScenarios?.find((c) => c.versionId === doc.activeVersionId);
}

/** Rétablit le texte effacé de la version courante (les passages liés se retrouvent par leur texte). */
export function restoreScenario(doc: ProjectDoc): boolean {
  const c = clearedOf(doc);
  if (!c) return false;
  doc.scenario = c.text;
  for (const [id, a] of Object.entries(c.anchors ?? {})) {
    const o = doc.sequences[id] ?? doc.blocks[id];
    if (o && !o.scenarioAnchor) o.scenarioAnchor = a;
  }
  doc.clearedScenarios = doc.clearedScenarios!.filter((x) => x !== c);
  return true;
}
