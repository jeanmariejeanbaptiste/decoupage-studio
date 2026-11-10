/**
 * La phrase du séquencier (ligne « = » et sa note) ne s'imprime jamais : ni la durée, ni la
 * comparaison des versions, ni la mise en page (PDF, Word, images), ni les comptes ne changent.
 */
import { describe, expect, it } from 'vitest';
import { chronoOf, chronoTimeline } from './chronometry';
import { outlineSequences, setOutlineTag, setPhrase } from './outline';
import { blocksFromSource, scriptStats } from './screenplay';
import { diffScripts } from './scriptDiff';
import { layoutScript, NOT_PRINTED, printLines, scriptOutline } from './scriptLayout';
import { characterReports, sceneReports } from './scriptReports';
import completFountain from './__fixtures__/kit/modele-complet.fountain?raw';

const BASE = `INT. GARE - JOUR

Léa entre dans la gare, une valise à la main.

LÉA
Un billet pour Lyon.

EXT. QUAI - NUIT

Le train part sans elle.
`;

const WITH = setOutlineTag(setPhrase(setPhrase(BASE, 1, 'Léa arrive à la gare et achète un billet.').source, 2, 'Le train part.').source, 1, { step: 4, plot: 'B' }).source;

const printed = (src: string) =>
  layoutScript(blocksFromSource(src).blocks)
    .pages.map((p) => printLines(p).map((l) => `${l.x}|${l.y}|${l.runs.map((r) => r.text).join("")}`))
    .flat();

describe('phrase du séquencier, jamais imprimée', () => {
  it('le texte de travail porte bien phrases et note', () => {
    expect(WITH).toContain('= Léa arrive à la gare et achète un billet. [[ds:etape=4;intrigue=B]]');
    expect(WITH).toContain('= Le train part.');
  });

  it('même mise en page (PDF, images), même pagination', () => {
    expect(printed(WITH)).toEqual(printed(BASE));
    expect(scriptOutline(blocksFromSource(WITH).blocks)).toMatchObject({ pages: scriptOutline(blocksFromSource(BASE).blocks).pages });
    let big = completFountain;
    const count = outlineSequences(big).length;
    for (let n = count; n >= 1; n--) big = setOutlineTag(setPhrase(big, n, 'Une phrase de séquencier assez longue pour compter si elle était imprimée.').source, n, { step: 3 }).source;
    expect(count).toBeGreaterThan(10);
    expect(outlineSequences(big).filter((x) => x.phrase && x.step === 3)).toHaveLength(count);
    expect(printed(big)).toEqual(printed(completFountain));
  });

  it('mêmes paragraphes pour le Word (blocs imprimés)', () => {
    const paras = (src: string) =>
      blocksFromSource(src)
        .blocks.filter((b) => b.type !== 'title' && !NOT_PRINTED.has(b.type))
        .map((b) => `${b.type}:${b.text}`);
    expect(paras(WITH)).toEqual(paras(BASE));
  });

  it('même durée, par chacune des trois méthodes', () => {
    for (const method of ['pages', 'characters', 'configurable'] as const) {
      const c = chronoOf({ method });
      expect(chronoTimeline(blocksFromSource(WITH).blocks, c).total).toBeCloseTo(chronoTimeline(blocksFromSource(BASE).blocks, c).total);
    }
  });

  it('la comparaison ne voit aucun changement', () => {
    const d = diffScripts(BASE, WITH);
    expect(d.scenes.every((s) => s.status === 'same')).toBe(true);
    expect(d.stats).toMatchObject({ added: 0, removed: 0, changed: 0, wordsAdded: 0, wordsRemoved: 0 });
    expect(d.stats.after.pages).toBe(d.stats.before.pages);
    expect(d.stats.after.seconds).toBeCloseTo(d.stats.before.seconds);
  });

  it('mêmes rapports et statistiques (durées, répliques, personnages)', () => {
    const a = sceneReports(blocksFromSource(BASE).blocks);
    const b = sceneReports(blocksFromSource(WITH).blocks);
    expect(b.map((s) => [s.n, s.heading, s.durationSec, s.actionSec, s.dialogueSec, [...s.present]])).toEqual(a.map((s) => [s.n, s.heading, s.durationSec, s.actionSec, s.dialogueSec, [...s.present]]));
    expect(characterReports(b)).toEqual(characterReports(a));
    const sa = scriptStats(blocksFromSource(BASE).blocks);
    const sb = scriptStats(blocksFromSource(WITH).blocks);
    expect({ ...sb, words: 0 }).toEqual({ ...sa, words: 0 });
  });
});
