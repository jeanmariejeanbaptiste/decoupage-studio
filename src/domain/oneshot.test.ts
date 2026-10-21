import { checkInvariants } from './ops';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { addBeat, beatColumnText, formatOneShotDuration, moveBeat, oneShotTiming, removeBeat, toggleOneShot, updateBeat } from './oneshot';

describe('plan-séquence', () => {
  it('convertit un plan, gère ses temps et revient en plan simple', () => {
    const doc = buildRav3();
    const id = doc.project.sequenceIds.map((s) => doc.sequences[s].shotIds[0])[0];
    const ps = produce(doc, (d) => {
      toggleOneShot(d, id);
      const [b1, b2] = d.shots[id].oneShot!.beats;
      updateBeat(d, id, b2.id, { value: 'GP', subject: 'Affiche', minSec: 10, maxSec: 20 });
      updateBeat(d, id, b1.id, { minSec: 30 });
      addBeat(d, id);
      moveBeat(d, id, b2.id, 1);
      removeBeat(d, id, d.shots[id].oneShot!.beats[1].id);
    });
    const beats = ps.shots[id].oneShot!.beats;
    expect(beats).toHaveLength(2);
    expect(beats[0].value).toBe(doc.shots[id].value);
    expect(beatColumnText(beats, 'subject')).toBe(`T1 ${doc.shots[id].subject}\nT2 Affiche`);
    const back = produce(ps, (d) => toggleOneShot(d, id));
    expect(back.shots[id].oneShot).toBeUndefined();
  });

  it('additionne les fourchettes et estime la dispersion', () => {
    const t = oneShotTiming([
      { id: 'a', value: '', subject: '', angle: '', movement: '', minSec: 30 },
      { id: 'b', value: '', subject: '', angle: '', movement: '', minSec: 10, maxSec: 22 },
      { id: 'c', value: '', subject: '', angle: '', movement: '', minSec: 20, maxSec: 32 },
    ]);
    expect([t.min, t.max, t.expected]).toEqual([60, 84, 72]);
    expect(t.sd).toBeCloseTo(Math.sqrt(2 * (144 / 12)), 6);
    expect(t.beats[2]).toEqual({ startMin: 40, startMax: 52, endMin: 60, endMax: 84 });
    expect(formatOneShotDuration(t)).toBe('1:00 – 1:24 (≈ 1:12 ± 0:05)');
  });
});

describe('plan-séquence isolé', async () => {
  const { sequenceMerges } = await import('./rows');
  const { computeTiming } = await import('./timing');
  it('ne fusionne aucune cellule avec les plans voisins (sauf la séquence)', () => {
    const doc = buildRav3();
    const seqId = doc.project.sequenceIds[0];
    const id = doc.sequences[seqId].shotIds[1];
    const ps = produce(doc, (d) => toggleOneShot(d, id));
    const cols = ps.project.settings.exportColumns;
    const { merges, rows } = sequenceMerges(ps, computeTiming(ps), seqId, cols);
    for (const c of cols) {
      const spans = merges.get(c) ?? [];
      const crossing = spans.some((m) => m.startRow <= 1 && m.startRow + m.span > 1 && m.span > 1);
      expect([c, crossing]).toEqual([c, c === 'sequence']);
    }
    expect(rows[1].cells.number).toBe('2');
    // Son action lui est propre, les invariants du document tiennent.
    const blockOf = (sid: string) => ps.shots[sid].actionBlockId;
    const ids = ps.sequences[seqId].shotIds;
    expect(ids.filter((x) => blockOf(x) === blockOf(id))).toEqual([id]);
    expect(checkInvariants(ps)).toEqual([]);
  });
});
