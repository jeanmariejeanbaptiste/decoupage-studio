/**
 * Nouveau texte du scénario (version suivante, réimport) : le découpage suit sans rien perdre.
 * Chaque scène nouvelle est rapprochée de son ancienne (`sceneAlign.ts`) :
 * - scène reprise : sa séquence la suit (ancre, libellé, INT/EXT et moment s'ils n'avaient pas été
 *   retouchés à la main) ; plans, dépouillement, plan au sol, jours de tournage restent attachés ;
 * - scène neuve : une séquence est créée à sa place si le découpage suivait déjà le scénario
 *   (au moins la moitié des scènes y étaient), sinon rien n'est imposé ;
 * - scène disparue : sa séquence reste au découpage, détachée du texte, et elle est signalée ;
 * - scènes déplacées : les séquences reprennent l'ordre du scénario, sans bouger les autres.
 * Les passages liés aux plans sont retrouvés d'abord dans leur scène, puis dans tout le texte.
 */
import { matchSequence } from './fountain';
import { addSequence } from './ops';
import { setSequenceDecorByName } from './registry';
import { alignScenes } from './sceneAlign';
import { fold } from './text';
import type { ID, ProjectDoc } from './types';

export interface RevisionReport {
  /** Scènes reprises (dont `changed` modifiées). */
  kept: number;
  changed: number;
  /** Scènes neuves, et séquences créées pour elles. */
  added: number;
  created: number;
  /** Scènes disparues, et leurs séquences gardées au découpage. */
  removed: number;
  orphans: ID[];
  /** Passages liés aux plans retrouvés, et perdus (le plan reste, sans lien). */
  relinked: number;
  dropped: number;
}

export function reviseScenario(doc: ProjectDoc, after: string): RevisionReport {
  const before = doc.scenario ?? '';
  const al = alignScenes(before, after);
  // Séquence de chaque scène ancienne (ancre d'abord, sinon même lieu encore libre).
  const seqOfOld = new Map<number, ID>();
  const taken = new Set<ID>();
  al.oldScenes.forEach((sc, k) => {
    const id = matchSequence(doc, sc);
    if (id && !taken.has(id)) {
      seqOfOld.set(k, id);
      taken.add(id);
    }
  });
  // Le découpage suivait le scénario (au moins la moitié des scènes), et le nouveau texte est bien sa
  // suite (au moins une scène reconnue) : les scènes neuves y entrent. Un texte sans rapport n'y touche pas.
  const followed = al.oldScenes.length > 0 && seqOfOld.size * 2 >= al.oldScenes.length && al.matches.length > 0;
  // Passages liés aux plans, relevés avant de bouger les ancres.
  const sceneIndexAt = (pos: number) => al.oldScenes.findIndex((s) => pos >= s.start && pos < s.end);
  const linked = Object.values(doc.blocks)
    .filter((b) => b.scenarioAnchor)
    .map((b) => ({ b, text: before.slice(b.scenarioAnchor!.start, b.scenarioAnchor!.end), scene: sceneIndexAt(b.scenarioAnchor!.start) }));

  const report: RevisionReport = { kept: al.matches.length, changed: al.matches.filter((m) => !m.same).length, added: al.added.length, created: 0, removed: al.removed.length, orphans: [], relinked: 0, dropped: 0 };
  const seqOfNew = new Map<number, ID>();
  for (const m of al.matches) {
    const seqId = seqOfOld.get(m.from);
    if (!seqId) continue;
    const seq = doc.sequences[seqId];
    const was = al.oldScenes[m.from];
    const now = al.newScenes[m.to];
    seq.scenarioAnchor = { start: now.start, end: now.end };
    if (fold(seq.label ?? '') === fold(was.location) && fold(was.location) !== fold(now.location)) {
      seq.label = now.location.toLocaleUpperCase('fr');
      setSequenceDecorByName(doc, seqId, now.location);
    }
    if (now.intExt && seq.intExt === was.intExt) seq.intExt = now.intExt;
    if (now.effect && seq.effect === was.effect) seq.effect = now.effect;
    seqOfNew.set(m.to, seqId);
  }
  for (const k of al.removed) {
    const seqId = seqOfOld.get(k);
    if (!seqId) continue;
    delete doc.sequences[seqId].scenarioAnchor;
    report.orphans.push(seqId);
  }
  // Scènes neuves : à leur place, si le découpage suivait le scénario.
  if (followed)
    for (const k of al.added) {
      let rank = 0;
      for (let p = k - 1; p >= 0; p--) {
        const prev = seqOfNew.get(p);
        if (prev) {
          rank = doc.project.sequenceIds.indexOf(prev) + 1;
          break;
        }
      }
      const sc = al.newScenes[k];
      const seqId = addSequence(doc, rank, {}, false);
      const seq = doc.sequences[seqId];
      seq.label = sc.location.toLocaleUpperCase('fr');
      seq.intExt = sc.intExt ?? seq.intExt;
      seq.effect = sc.effect ?? seq.effect;
      seq.scenarioAnchor = { start: sc.start, end: sc.end };
      setSequenceDecorByName(doc, seqId, sc.location);
      seqOfNew.set(k, seqId);
      report.created++;
    }
  // Ordre du scénario : les places tenues par des séquences de scènes reçoivent ces séquences dans le
  // nouvel ordre ; les séquences hors scénario ne bougent pas.
  const sceneOf = new Map([...seqOfNew].map(([k, id]) => [id, k]));
  const ids = doc.project.sequenceIds;
  const inScenes = ids.filter((id) => sceneOf.has(id)).sort((a, b) => sceneOf.get(a)! - sceneOf.get(b)!);
  let q = 0;
  doc.project.sequenceIds = ids.map((id) => (sceneOf.has(id) ? inScenes[q++] : id));
  // Passages des plans : dans leur scène reprise d'abord, puis n'importe où, au plus près.
  const newOfOld = new Map(al.matches.map((m) => [m.from, m.to]));
  for (const { b, text, scene } of linked) {
    if (!text.trim()) {
      delete b.scenarioAnchor;
      report.dropped++;
      continue;
    }
    const target = newOfOld.has(scene) ? al.newScenes[newOfOld.get(scene)!] : undefined;
    let at = target ? after.slice(target.start, target.end).indexOf(text) : -1;
    if (at >= 0) at += target!.start;
    else {
      const expect = before.length ? (b.scenarioAnchor!.start / before.length) * after.length : 0;
      for (let i = after.indexOf(text); i >= 0; i = after.indexOf(text, i + 1)) if (at < 0 || Math.abs(i - expect) < Math.abs(at - expect)) at = i;
    }
    if (at < 0) {
      delete b.scenarioAnchor;
      report.dropped++;
    } else {
      b.scenarioAnchor = { start: at, end: at + text.length };
      report.relinked++;
    }
  }
  doc.scenario = after;
  return report;
}

/** Résumé lisible d'une révision. */
export function revisionSummary(r: RevisionReport): string {
  const pl = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const parts = [`${pl(r.kept, 'séquence reprise', 'séquences reprises')}${r.changed ? ` dont ${pl(r.changed, 'modifiée', 'modifiées')}` : ''}`];
  if (r.added) parts.push(r.created ? `${pl(r.added, 'nouvelle', 'nouvelles')}, ajoutée${r.added > 1 ? 's' : ''} au découpage` : pl(r.added, 'nouvelle', 'nouvelles'));
  if (r.removed) parts.push(`${pl(r.removed, 'retirée du scénario', 'retirées du scénario')}${r.orphans.length ? ', gardée' + (r.orphans.length > 1 ? 's' : '') + ' au découpage' : ''}`);
  if (r.dropped) parts.push(`${pl(r.dropped, 'passage lié introuvable', 'passages liés introuvables')}`);
  return parts.join(' · ');
}
