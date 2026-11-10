/**
 * Écritures du Séquencier : chacune est une seule mutation du projet (une étape d'annulation), qui
 * passe par une `SourceEdit` du domaine et `applyScenarioEdit` (ancres, commentaires, découpage).
 */
import { scenarioHref } from '../../../app/router';
import {
  insertEntry,
  insertPart,
  moveEntry,
  nextPlotKey,
  outlineOf,
  outlineSequences,
  plotsInUse,
  plotsOf,
  removeEntry,
  removePart,
  sequenceScenes,
  setHeading,
  setOutlineTag,
  setPhrase,
  type SourceEdit,
} from '../../../domain/outline';
import { applyScenarioEdit } from '../../../domain/ops';
import type { ProjectDoc } from '../../../domain/types';
import { mutateDoc, useProjectStore } from '../../../store/projectStore';
import { ask } from '../../../ui/dialogStore';
import { partIndexAt, renamePart as renamePartEdit, stepMove, type Move } from './outlineModel';
import { setActive, setEditing, useOutlineUi } from './outlineUi';

const docNow = () => useProjectStore.getState().doc;

/** Applique une modification calculée sur le texte courant ; une erreur (séquence disparue) n'écrit rien. */
function edit(make: (source: string) => SourceEdit, opts: { reorderCut?: boolean } = {}): boolean {
  let done = false;
  mutateDoc((d) => {
    let e: SourceEdit;
    try {
      e = make(d.scenario ?? '');
    } catch {
      return;
    }
    applyScenarioEdit(d, e, opts);
    done = true;
  });
  return done;
}

export const commitPhrase = (n: number, phrase: string) => {
  const it = outlineSequences(docNow()?.scenario ?? '').find((x) => x.n === n);
  if (!it || it.phrase === phrase.replace(/\s+/g, ' ').trim()) return;
  edit((s) => setPhrase(s, n, phrase));
};

export const commitHeading = (n: number, h: { intExt?: string; location: string; effect?: string }) => edit((s) => setHeading(s, n, h));

export const setStep = (n: number, step: number | null) => edit((s) => setOutlineTag(s, n, { step }));

export const setPlot = (n: number, plot: string) => edit((s) => setOutlineTag(s, n, { plot }));

/** Nouvelle séquence (en fin de texte, ou après N) ; renvoie son numéro. */
export function addEntry(after: number | 'end', e: { intExt?: string; location: string; effect?: string; phrase?: string }): number | undefined {
  let n: number | undefined;
  edit((s) => {
    const r = insertEntry(s, after, e);
    n = r.n;
    return r;
  });
  return n;
}

/** Déplace la séquence N ; la ligne active la suit. Le découpage suit s'il suivait déjà le texte. */
export function moveTo(n: number, m: Move): void {
  const before = docNow()?.scenario ?? '';
  if (!edit((s) => moveEntry(s, n, m.to, { edge: m.edge }), { reorderCut: true })) return;
  if ((docNow()?.scenario ?? '') !== before) setActive(m.to);
}

export function moveStep(n: number, dir: -1 | 1): void {
  const m = stepMove(outlineOf(docNow()?.scenario ?? ''), n, dir);
  if (m) moveTo(n, m);
}

export function addPart(beforeN: number): void {
  const source = docNow()?.scenario ?? '';
  if (!edit((s) => insertPart(s, beforeN, 'Nouvelle partie'))) return;
  const items = outlineOf(docNow()?.scenario ?? '');
  const seq = items.find((x) => x.kind === 'sequence' && x.n === beforeN);
  const k = seq ? items.indexOf(seq) : items.length;
  const part = items.slice(0, k).filter((x) => x.kind === 'part').length - 1;
  if (source !== docNow()?.scenario && part >= 0) setEditing({ part, field: 'part' });
}

export const renamePart = (index: number, title: string) =>
  edit((s) => {
    const part = outlineOf(s).filter((x) => x.kind === 'part')[index];
    if (!part) throw new Error('Partie introuvable.');
    return renamePartEdit(s, part, title);
  });

export const deletePart = (index: number) => edit((s) => removePart(s, index));

export { partIndexAt };

/** Supprime une séquence du texte ; demande d'abord si elle a un corps ou des plans liés. */
export async function deleteEntry(doc: ProjectDoc, n: number): Promise<void> {
  const it = outlineSequences(doc.scenario ?? '').find((x) => x.n === n);
  if (!it) return;
  const seqId = [...sequenceScenes(doc)].find(([, k]) => k === n)?.[0];
  const shots = seqId ? (doc.sequences[seqId]?.shotIds.length ?? 0) : 0;
  if (it.hasBody || shots > 0) {
    const r = await ask({ title: `Supprimer la séquence ${n} et son texte ?`, confirmLabel: 'Supprimer', danger: true });
    if (!r.ok) return;
  }
  if (!edit((s) => removeEntry(s, n))) return;
  const total = outlineSequences(docNow()?.scenario ?? '').length;
  const { active } = useOutlineUi.getState();
  if (active !== null) setActive(total ? Math.min(active, total) : null);
}

/** Ouvre le Texte à l'en-tête de la séquence N (entrée d'historique : Précédent ramène ici). */
export function writeSequence(n: number): void {
  window.location.hash = scenarioHref('script', { seq: n });
}

// --- Intrigues ---------------------------------------------------------------------------------

/** Les intrigues du projet, écrites (la valeur par défaut devient explicite à la première retouche). */
const ownPlots = (d: ProjectDoc) => (d.plots = d.plots?.length ? d.plots : plotsOf(d).map((p) => ({ ...p })));

export function addPlot(): string | undefined {
  return mutateDoc((d) => {
    const key = nextPlotKey(d);
    if (!key) return undefined;
    ownPlots(d).push({ key, name: `Intrigue ${key}` });
    return key;
  });
}

export function renamePlot(key: string, name: string): void {
  const t = name.replace(/\s+/g, ' ').trim();
  const cur = plotsOf(docNow() ?? { plots: undefined }).find((p) => p.key === key);
  if (!t || cur?.name === t) return;
  mutateDoc((d) => {
    const list = ownPlots(d);
    const p = list.find((x) => x.key === key);
    if (p) p.name = t;
    else list.push({ key, name: t });
  });
}

export function removePlot(key: string): void {
  mutateDoc((d) => {
    if (plotsInUse(d).has(key)) return;
    const list = ownPlots(d).filter((p) => p.key !== key);
    d.plots = list;
  });
}
