import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { defaultSettings } from './factory';
import { blockDuration, computeGap, computeTiming, formatGap, gapLevel, orderedBlockIds, previewDuration, shotTcLabel } from './timing';
import { linkAction } from './ops';

const settings = defaultSettings('fiction');

describe('durées', () => {
  it('blockDuration applique coefficients et minimum', () => {
    expect(blockDuration({ text: 'un deux trois quatre' }, settings)).toBe(2);
    expect(blockDuration({ text: 'a b c d e f g h i j k l' }, settings)).toBe(6);
    expect(blockDuration({ text: '', dialogue: Array(25).fill('mot').join(' ') }, settings)).toBe(10);
    expect(blockDuration({ text: 'x', overrideSec: 12.4 }, settings)).toBe(12);
    expect(blockDuration({ text: '' }, settings)).toBe(2);
  });
  it('aperçu des réglages', () => {
    expect(previewDuration('a b c d e f g h i j k l', settings)).toEqual({ words: 12, sec: 6 });
    expect(previewDuration('a b c d e', settings, true)).toEqual({ words: 5, sec: 2 });
  });
  it('seuils d’écart', () => {
    expect(gapLevel(10)).toBe('ok');
    expect(gapLevel(-24)).toBe('warn');
    expect(gapLevel(26)).toBe('bad');
    expect(computeGap(30, undefined)).toBeUndefined();
    expect(computeGap(30, 0)).toBeUndefined();
    expect(computeGap(36, 30)).toEqual({ sec: 6, pct: 20, level: 'warn' });
    expect(formatGap({ sec: 6, pct: 20, level: 'warn' })).toBe('+0:06 (+20 %)');
    expect(formatGap({ sec: -6, pct: -20, level: 'warn' })).toBe('−0:06 (−20 %)');
    expect(formatGap({ sec: 0, pct: 0, level: 'ok' })).toBe('±0:00 (±0 %)');
  });
});

describe('minutage cumulatif (fiction)', () => {
  const doc = buildFiction();
  const t = computeTiming(doc);
  const [s1, s2, s3] = doc.project.sequenceIds;
  it('enchaîne les plages in – out', () => {
    const a = t.sequences.get(s1)!;
    const b = t.sequences.get(s2)!;
    const c = t.sequences.get(s3)!;
    expect(a.range.in).toBe(0);
    expect(b.range.in).toBe(a.range.out);
    expect(c.range.in).toBe(b.range.out);
    expect(t.totalSec).toBe(c.range.out);
    expect(a.label).toMatch(/^0:00 - 0:\d\d$/);
    expect(t.totalEstimatedSec).toBe(50);
    expect([...t.sequences.values()].map((x) => x.gap?.level)).toEqual(['ok', 'warn', 'bad']);
    expect(t.totalGap).toBeDefined();
  });
  it('une action couverte par plusieurs plans ne compte qu’une fois', () => {
    const before = t.sequences.get(s1)!.durationSec;
    const blocks = orderedBlockIds(doc, s1).map((id) => t.blocks.get(id)!.durationSec);
    expect(before).toBe(blocks.reduce((x, y) => x + y, 0));
    expect(orderedBlockIds(doc, s1)).toHaveLength(2);
    expect(orderedBlockIds(doc, 'absent')).toEqual([]);
  });
  it('lier deux actions ne double pas le temps', () => {
    const linked = produce(doc, (d) => void linkAction(d, d.sequences[s1].shotIds.slice(0, 2)));
    const lt = computeTiming(linked);
    expect(lt.sequences.get(s1)!.durationSec).toBeLessThanOrEqual(t.sequences.get(s1)!.durationSec);
  });
  it('granularité séquence vs action et override manuel', () => {
    const shot = doc.sequences[s2].shotIds[0];
    expect(shotTcLabel(doc, t, shot)).toBe(t.sequences.get(s2)!.label);
    const byAction = produce(doc, (d) => {
      d.project.settings.tcGranularity = 'action';
    });
    const ta = computeTiming(byAction);
    expect(shotTcLabel(byAction, ta, shot)).toBe(ta.blocks.get(byAction.shots[shot].actionBlockId)!.label);
    const manual = produce(doc, (d) => {
      d.sequences[s2].overrideSec = 90;
    });
    const tm = computeTiming(manual);
    expect(tm.sequences.get(s2)).toMatchObject({ durationSec: 90, manual: true });
    expect(tm.sequences.get(s3)!.range.in).toBe(tm.sequences.get(s1)!.durationSec + 90);
    expect(shotTcLabel(doc, t, 'absent')).toBe('');
  });
});

describe('minutage piste (clip)', () => {
  const doc = buildRav3();
  const t = computeTiming(doc);
  it('total = durée de la piste, couverture 100 % avec TOUT', () => {
    expect(t.trackSec).toBe(181);
    expect(t.totalSec).toBe(181);
    expect(t.coveragePct).toBe(100);
  });
  it('couverture partielle sans TOUT', () => {
    const partial = produce(doc, (d) => {
      for (const b of Object.values(d.blocks)) if (b.tc?.all) b.tc = { in: 0, out: 10 };
      d.project.settings.audioTrack = undefined;
    });
    const tp = computeTiming(partial);
    expect(tp.trackSec).toBe(181);
    // 0:00–1:16 (0–76) + 1:34–3:01 (94–181) = 76 + 87 = 163 / 181
    expect(tp.coveragePct).toBeCloseTo((163 / 181) * 100, 5);
  });
  it('plage de séquence et TOUT', () => {
    const s2 = doc.project.sequenceIds[1];
    expect(t.sequences.get(s2)!.durationSec).toBe(181);
    const s4 = doc.project.sequenceIds[3];
    expect(t.sequences.get(s4)!.label).toBe('0:20 - 0:36');
    const allTout = produce(doc, (d) => {
      for (const b of Object.values(d.blocks)) if (b.sequenceId === s2) b.tc = { all: true };
    });
    expect(computeTiming(allTout).sequences.get(s2)!.label).toBe('TOUT');
  });
});
