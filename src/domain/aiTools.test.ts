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

  it('séquencier : lit, écrit la phrase, l’étape et l’intrigue, ajoute et déplace', () => {
    let doc = buildFiction();
    const ids = doc.project.sequenceIds.slice();
    const read = (d: ProjectDoc) => JSON.parse(runAiTool(d, 'get_outline', {}).result);
    const o = read(doc);
    expect(o.sequences.map((x: { n: number; heading: string }) => [x.n, x.heading])).toEqual([
      [1, 'INT. GARE — HALL - JOUR'],
      [2, 'INT. GARE — CONSIGNE - JOUR'],
      [3, 'EXT. PARVIS DE LA GARE - NUIT'],
    ]);
    expect(o.sequences[0]).toMatchObject({ phrase: '', step: null, plot: 'A', page: 1 });
    expect(o.sequences[0].duration).toMatch(/^\d+:\d\d$/);
    expect(o.plots).toEqual([{ key: 'A', name: 'Intrigue principale' }]);

    const set = run(doc, 'set_outline_entry', { n: 2, phrase: 'Léa laisse la valise.', step: 4, plot: 'b' });
    expect(set.out.isError).toBeFalsy();
    doc = set.doc;
    expect(doc.scenario).toContain('INT. GARE — CONSIGNE - JOUR\n\n= Léa laisse la valise. [[ds:etape=4;intrigue=B]]\n\nLéa pose');
    expect(read(doc).sequences[1]).toMatchObject({ phrase: 'Léa laisse la valise.', step: 4, step_label: 'Événement déclencheur', plot: 'B' });
    // Le résumé de la séquence du découpage est cette phrase.
    expect(JSON.parse(runAiTool(doc, 'get_sequence', { sequence: 2 }).result).summary).toBe('Léa laisse la valise.');
    expect(run(doc, 'set_outline_entry', { n: 9, phrase: 'x' }).out.isError).toBe(true);
    expect(run(doc, 'set_outline_entry', { n: 1, step: 40 }).out.isError).toBe(true);

    const added = run(doc, 'add_outline_entry', { after: 1, int_ext: 'EXT', location: 'Quai', effect: 'JOUR', phrase: 'Le train entre en gare.' });
    expect(JSON.parse(added.out.result)).toEqual({ n: 2 });
    expect(read(added.doc).sequences.map((x: { heading: string }) => x.heading)[1]).toBe('EXT. QUAI - JOUR');
    expect(run(doc, 'add_outline_entry', { location: '' }).out.isError).toBe(true);

    const moved = run(doc, 'move_outline_entry', { from: 3, to: 1 });
    expect(read(moved.doc).sequences.map((x: { heading: string }) => x.heading)[0]).toBe('EXT. PARVIS DE LA GARE - NUIT');
    // Le découpage suivait le texte : il suit le déplacement.
    expect(moved.doc.project.sequenceIds).toEqual([ids[2], ids[0], ids[1]]);
    expect(checkInvariants(moved.doc)).toEqual([]);
  });

  it('update_sequence écrit le résumé dans le texte pour une séquence rapprochée, et write_scenario garde les phrases', () => {
    let doc = buildFiction();
    doc = run(doc, 'update_sequence', { sequence: 1, summary: 'Léa arrive.' }).doc;
    expect(doc.scenario).toContain('INT. GARE — HALL - JOUR\n\n= Léa arrive.\n');
    expect(doc.sequences[doc.project.sequenceIds[0]].summary).toBeUndefined();
    doc = run(doc, 'write_scenario', { text: 'INT. GARE — HALL - JOUR\n\nLe hall bruisse, les annonces se succèdent.\n\nLéa traverse le hall en tirant une valise cabossée dont une roue grince.', replace_scene: 1 }).doc;
    expect(doc.scenario).toContain('INT. GARE — HALL - JOUR\n\n= Léa arrive.\n\nLe hall bruisse');
    expect(doc.scenario).toContain('dont une roue grince.\n\nINT. GARE — CONSIGNE');
  });
});

describe('outils du séquencier (relecture)', () => {
  it('3. set_outline_entry refuse sans rien écrire quand une entrée est invalide', () => {
    const doc = buildFiction();
    for (const bad of [{ step: 99 }, { plot: 'AB' }, { n: 9 }]) {
      const { doc: next, out } = run(doc, 'set_outline_entry', { n: 1, location: 'HALL', phrase: 'Nouvelle phrase', ...bad });
      expect(out.isError).toBe(true);
      expect(next.scenario).toBe(doc.scenario);
    }
  });

  it('5. write_scenario numérote comme le séquencier et garde l’en-tête forcé', () => {
    const doc = buildFiction();
    doc.scenario = 'INT. A - JOUR\n\nAa.\n\n.\n\nvide\n\nINT. B - NUIT\n\nBb.\n\n.CUISINE\n\nCc.\n';
    expect(JSON.parse(runAiTool(doc, 'get_outline', {}).result).sequences.map((x: { heading: string }) => x.heading)).toEqual(['INT. A - JOUR', 'INT. B - NUIT', 'CUISINE']);
    expect(runAiTool(doc, 'get_scenario', { scene: 3 }).result.startsWith('.CUISINE')).toBe(true);
    const two = run(doc, 'write_scenario', { text: 'INT. B - NUIT\n\nBb réécrit.', replace_scene: 2 }).doc;
    expect(two.scenario).toBe('INT. A - JOUR\n\nAa.\n\n.\n\nvide\n\nINT. B - NUIT\n\nBb réécrit.\n\n.CUISINE\n\nCc.\n');
    const three = run(doc, 'write_scenario', { text: '.CUISINE\n\nCc réécrit.', replace_scene: 3 }).doc;
    expect(three.scenario).toBe('INT. A - JOUR\n\nAa.\n\n.\n\nvide\n\nINT. B - NUIT\n\nBb.\n\n.CUISINE\n\nCc réécrit.\n');
  });
});
