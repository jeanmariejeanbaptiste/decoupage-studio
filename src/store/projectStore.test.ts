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

describe('annuler, rétablir', () => {
  it('la date du projet suit l’heure du geste, sans jamais reculer', () => {
    const doc = buildFiction();
    doc.project.updatedAt = '2026-01-01T00:00:00.000Z';
    useProjectStore.getState().loadDoc(doc);
    const at = () => useProjectStore.getState().doc!.project.updatedAt;
    mutateDoc((d) => void (d.project.title = 'Modifié'));
    const edited = at();
    undo();
    expect(useProjectStore.getState().doc!.project.title).toBe(doc.project.title);
    expect(at() >= edited).toBe(true);
    // La date n'entre pas dans l'historique : rétablir reste possible, une seule fois.
    expect(useProjectStore.temporal.getState().futureStates).toHaveLength(1);
    redo();
    expect(useProjectStore.getState().doc!.project.title).toBe('Modifié');
    expect(at() >= edited).toBe(true);
    expect(useProjectStore.temporal.getState().pastStates).toHaveLength(1);
  });
});
