import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { apply, diff } from './patch';

describe('différences entre deux versions du projet', () => {
  const base = { project: { title: 'A', updatedAt: '1' }, shots: { s1: { subject: 'Léa', angle: ['Face'] }, s2: { subject: 'Marc', angle: [] } }, sequences: { q: { shotIds: ['s1', 's2'] } } };
  it('ne transmet que les champs modifiés', () => {
    const next = produce(base, (d) => {
      d.shots.s1.subject = 'Léa B';
      d.sequences.q.shotIds.reverse();
    });
    const ops = diff(base, next);
    expect(ops).toEqual([
      { p: ['shots', 's1', 'subject'], v: 'Léa B' },
      { p: ['sequences', 'q', 'shotIds'], v: ['s2', 's1'] },
    ]);
  });
  it('rejoue ajouts, suppressions et modifications à l’identique', () => {
    const next = produce(base, (d) => {
      (d.shots as Record<string, unknown>).s3 = { subject: 'Nina', angle: ['Dos'] };
      delete (d.shots as Record<string, unknown>).s2;
      d.project.title = 'B';
    });
    const copy = produce(base, (d) => apply(d as unknown as Record<string, unknown>, diff(base, next)));
    expect(copy).toEqual(next);
  });
  it('deux personnes qui modifient des champs différents ne s’écrasent pas', () => {
    const a = produce(base, (d) => void (d.shots.s1.subject = 'par A'));
    const b = produce(base, (d) => void (d.shots.s2.subject = 'par B'));
    const merged = produce(a, (d) => apply(d as unknown as Record<string, unknown>, diff(base, b)));
    expect(merged.shots.s1.subject).toBe('par A');
    expect(merged.shots.s2.subject).toBe('par B');
  });
});
