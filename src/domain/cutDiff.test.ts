import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { clearCut, cutDiff } from './cutDiff';
import { addShot, deleteSequence, deleteShot } from './ops';
import { createVersion } from './versions';

describe('comparaison du découpage entre versions', () => {
  it('plans ajoutés, retirés, modifiés champ par champ', () => {
    let doc = buildFiction();
    doc = produce(doc, (d) => void createVersion(d));
    const [v1, v2] = doc.versions!.map((v) => v.id);
    doc = produce(doc, (d) => {
      const s1 = d.project.sequenceIds[0];
      const [a, b] = d.sequences[s1].shotIds;
      d.shots[a].value = 'Gros plan';
      deleteShot(d, b);
      addShot(d, s1, { init: { subject: 'Valise' } });
    });
    const diff = cutDiff(doc, v1, v2);
    expect(diff).toHaveLength(1);
    const st = diff[0].shots.map((s) => s.status).sort();
    expect(st).toEqual(['added', 'changed', 'removed']);
    const changed = diff[0].shots.find((s) => s.status === 'changed')!;
    expect(changed.fields).toEqual([{ label: 'Valeur', before: 'Général', after: 'Gros plan' }]);
    expect(cutDiff(doc, v2, v2)).toEqual([]);
  });
  it('effacer le découpage : toutes les séquences de la version courante', () => {
    const doc = produce(buildFiction(), (d) => void clearCut(d, deleteSequence));
    expect(doc.project.sequenceIds).toEqual([]);
    expect(Object.keys(doc.shots)).toHaveLength(0);
  });
});
