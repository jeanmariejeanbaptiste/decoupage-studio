import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { buildFiction } from '../../seed/fiction';
import { addShot, checkInvariants, deleteShot } from './ops';
import { apply, diff, type Op } from './patch';
import type { ProjectDoc } from './types';

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

describe('listes d’identifiants à plusieurs', () => {
  const R = (d: unknown) => d as Record<string, unknown>;
  it('insertions et retraits plutôt que la liste entière', () => {
    const a = { q: { shotIds: ['s1', 's2', 's3'] } };
    const b = { q: { shotIds: ['s1', 'n', 's3', 'm'] } };
    const ops = diff(a, b, [], [], { idLists: true });
    expect(ops).toEqual([
      { p: ['q', 'shotIds'], rm: 's2' },
      { p: ['q', 'shotIds'], ins: 'n', after: 's1' },
      { p: ['q', 'shotIds'], ins: 'm', after: 's3' },
    ]);
    expect(produce(a, (d) => apply(R(d), ops))).toEqual(b);
    // Ordre changé : la liste entière, comme avant.
    expect(diff(a, { q: { shotIds: ['s3', 's1', 's2'] } }, [], [], { idLists: true })).toEqual([{ p: ['q', 'shotIds'], v: ['s3', 's1', 's2'] }]);
    // Sans l'option, et hors des listes d'identifiants : inchangé.
    expect(diff(a, b)).toEqual([{ p: ['q', 'shotIds'], v: b.q.shotIds }]);
    expect(diff({ angle: ['Face'] }, { angle: ['Face', 'Dos'] }, [], [], { idLists: true })).toEqual([{ p: ['angle'], v: ['Face', 'Dos'] }]);
  });

  it('deux plans ajoutés en même temps à la même séquence : aucun perdu, les deux côtés identiques', () => {
    const base = buildFiction();
    const seqId = base.project.sequenceIds[1];
    const host = produce(base, (d) => void addShot(d as ProjectDoc, seqId, { init: { subject: 'Hôte' } }));
    const guest = produce(base, (d) => void addShot(d as ProjectDoc, seqId, { init: { subject: 'Invité' } }));
    // L'invité envoie ses insertions ; l'hôte, sa liste entière (il fait foi).
    const fromGuest = diff(base, guest, [], [], { idLists: true });
    const fromHost = diff(base, host);
    const host2 = produce(host, (d) => apply(R(d), fromGuest));
    // Écho de l'hôte : les listes fusionnées, entières, à tous (l'émetteur compris).
    const echo: Op[] = [{ p: ['sequences', seqId, 'shotIds'], v: host2.sequences[seqId].shotIds }];
    const guest2 = produce(guest, (d) => apply(R(d), [...fromHost, ...echo]));
    expect(host2.sequences[seqId].shotIds).toHaveLength(base.sequences[seqId].shotIds.length + 2);
    expect(guest2.sequences[seqId].shotIds).toEqual(host2.sequences[seqId].shotIds);
    expect(checkInvariants(host2)).toEqual([]);
    expect(checkInvariants(guest2)).toEqual([]);
  });

  it('plan retiré d’un côté pendant qu’un autre est ajouté de l’autre', () => {
    const base = buildFiction();
    const seqId = base.project.sequenceIds[0];
    const host = produce(base, (d) => void deleteShot(d as ProjectDoc, base.sequences[seqId].shotIds[0]));
    const guest = produce(base, (d) => void addShot(d as ProjectDoc, seqId, { init: { subject: 'Invité' } }));
    const host2 = produce(host, (d) => apply(R(d), diff(base, guest, [], [], { idLists: true })));
    expect(host2.sequences[seqId].shotIds).toHaveLength(base.sequences[seqId].shotIds.length);
    expect(checkInvariants(host2)).toEqual([]);
  });

  it('un chemin reçu ne touche jamais aux prototypes', () => {
    const target = { comments: [] as unknown[] };
    apply(R(target), [
      { p: ['comments', '__proto__', 'polluted'], v: 1 },
      { p: ['__proto__', 'polluted'], v: 1 },
      { p: ['constructor', 'prototype', 'polluted'], v: 1 },
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(([] as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
});
