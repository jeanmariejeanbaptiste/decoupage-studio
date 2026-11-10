import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { addComment } from '../domain/comments';
import { mutateDoc, mutateOutsideHistory, redo, undo, useProjectStore } from './projectStore';
import { useUi } from './uiStore';

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

describe('toasts « Annuler »', () => {
  it('se ferment à la modification suivante, pour ne jamais annuler autre chose que leur action', () => {
    useProjectStore.getState().loadDoc(buildFiction());
    mutateDoc((d) => void (d.project.title = 'Répartition'));
    useUi.getState().toast({ message: 'Fait.', actionLabel: 'Annuler', action: undo });
    useUi.getState().toast({ message: 'Autre.' });
    expect(useUi.getState().toasts).toHaveLength(2);
    mutateDoc((d) => void (d.project.director = 'Nina'));
    expect(useUi.getState().toasts.map((t) => t.message)).toEqual(['Autre.']);
  });
});
