import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { addComment } from '../domain/comments';
import { mutateDoc, mutateOutsideHistory, redo, undo, useProjectStore } from './projectStore';

describe('modifications hors historique', () => {
  it('des retours relevés ne vident pas « Rétablir », et annuler ne les défait pas', () => {
    useProjectStore.getState().loadDoc(buildFiction());
    const doc = () => useProjectStore.getState().doc!;
    const seqId = doc().project.sequenceIds[0];
    mutateDoc((d) => void (d.project.title = 'Titre modifié'));
    undo();
    expect(useProjectStore.temporal.getState().futureStates).toHaveLength(1);
    const changed = mutateOutsideHistory((d) => void addComment(d, { kind: 'sequence', seqId }, 'Nina', 'Relevé dans Drive'));
    expect(changed).toBe(true);
    expect(useProjectStore.temporal.getState().futureStates).toHaveLength(1);
    redo();
    expect(doc().project.title).toBe('Titre modifié');
    expect(doc().comments?.map((c) => c.text)).toEqual(['Relevé dans Drive']);
    undo();
    expect(doc().comments?.map((c) => c.text)).toEqual(['Relevé dans Drive']);
    expect(mutateOutsideHistory(() => undefined)).toBe(false);
  });
});
