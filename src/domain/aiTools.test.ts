import { describe, expect, it } from 'vitest';
import { produceWithPatches, applyPatches, enablePatches } from 'immer';
import { buildFiction } from '../../seed/fiction';
import { AI_TOOLS, runAiTool } from './aiTools';
import { checkInvariants } from './ops';
import type { ProjectDoc } from './types';

enablePatches();

const run = (doc: ProjectDoc, name: string, input: unknown) => {
  let out = runAiTool(doc, name, {});
  const [next] = produceWithPatches(doc, (d) => {
    out = runAiTool(d as ProjectDoc, name, input);
  });
  return { doc: next, out };
};

describe('outils de l’assistant', () => {
  it('chaque outil a un schéma objet', () => {
    for (const t of AI_TOOLS) expect((t.schema as { type: string }).type).toBe('object');
  });

  it('lit le projet et une séquence', () => {
    const doc = buildFiction();
    const p = JSON.parse(runAiTool(doc, 'get_project', {}).result);
    expect(p.sequences).toHaveLength(3);
    const seq = JSON.parse(runAiTool(doc, 'get_sequence', { sequence: 1 }).result);
    expect(seq.shots[0].shot).toBe(1);
    expect(runAiTool(doc, 'get_sequence', { sequence: 9 }).isError).toBe(true);
  });

  it('ajoute des plans liés, dans le vocabulaire, sans casser les invariants', () => {
    const doc = buildFiction();
    const before = doc.sequences[doc.project.sequenceIds[1]].shotIds.length;
    const { doc: next, out } = run(doc, 'add_shots', {
      sequence: 2,
      after_shot: 1,
      shots: [
        { subject: 'Léa', value: 'gros plan', angle: ['3/4 face'], movement: ['fixe'], focal: 85, action: 'Léa hésite.' },
        { subject: 'Guichetier', value: 'Rapproché', angle: ['Face'], focal: 50, link_with_previous: true },
      ],
    });
    expect(out.isError).toBeFalsy();
    expect(out.change).toMatch(/2 plans ajoutés à la séquence 2/);
    const seq = next.sequences[next.project.sequenceIds[1]];
    expect(seq.shotIds.length).toBe(before + 2);
    const a = next.shots[seq.shotIds[1]];
    const b = next.shots[seq.shotIds[2]];
    expect(a.value).toBe('Gros plan');
    expect(a.movement).toEqual([]);
    expect(b.actionBlockId).toBe(a.actionBlockId);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('modifie, supprime, dépouille, écrit le scénario', () => {
    let doc = buildFiction();
    doc = run(doc, 'update_shot', { sequence: 1, shot: 1, value: 'Plan d’ensemble', focal: 18 }).doc;
    expect(doc.shots[doc.sequences[doc.project.sequenceIds[0]].shotIds[0]].focal.from).toBe(18);
    const n = doc.sequences[doc.project.sequenceIds[0]].shotIds.length;
    doc = run(doc, 'delete_shots', { sequence: 1, shots: [1] }).doc;
    expect(doc.sequences[doc.project.sequenceIds[0]].shotIds.length).toBe(n - 1);
    doc = run(doc, 'add_breakdown_items', { sequence: 1, category: 'accessoires', items: ['Valise', 'Ticket'] }).doc;
    expect(doc.breakdown?.[doc.project.sequenceIds[0]]?.accessoires).toEqual(['Valise', 'Ticket']);
    const before = doc.scenario ?? '';
    doc = run(doc, 'write_scenario', { text: 'EXT. QUAI - NUIT\n\nLe train part.' }).doc;
    expect(doc.scenario).toBe(`${before.trimEnd()}\n\nEXT. QUAI - NUIT\n\nLe train part.\n`);
    expect(checkInvariants(doc)).toEqual([]);
  });

  it('les modifications s’appliquent en un seul lot de correctifs', () => {
    const base = buildFiction();
    const [next, patches] = produceWithPatches(base, (d) => {
      runAiTool(d as ProjectDoc, 'add_sequence', { label: 'Quai', int_ext: 'EXT', effect: 'NUIT' });
    });
    const replay = applyPatches(base, patches);
    expect(replay.project.sequenceIds).toEqual(next.project.sequenceIds);
    expect(replay.sequences[replay.project.sequenceIds[3]].label).toBe('QUAI');
  });
});
