import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFiction } from '../../../seed/fiction';
import { decorLocation } from '../../domain/locations';
import { undo, useProjectStore } from '../../store/projectStore';
import { useDialog } from '../../ui/dialogStore';
import { CharacterFacts } from './CharacterFacts';
import { DecorFacts } from './DecorFacts';

const doc = () => useProjectStore.getState().doc!;
const byName = (n: string) => Object.values(doc().characters).find((c) => c.name === n)!.id;

afterEach(cleanup);

describe('fiche d’un personnage : nature et fusion', () => {
  it('change la nature ; fusionne après confirmation, annulable', async () => {
    useProjectStore.getState().loadDoc(buildFiction());
    const guichetier = byName('Guichetier');
    const view = () => <CharacterFacts doc={doc()} characterId={guichetier} />;
    const { rerender } = render(view());
    fireEvent.change(screen.getByLabelText('Nature'), { target: { value: 'figurant' } });
    expect(doc().characters[guichetier].kind).toBe('figurant');
    rerender(view());

    // Refusée : rien ne change.
    fireEvent.change(screen.getByLabelText('Fusionner Guichetier dans…'), { target: { value: byName('Marc') } });
    expect(useDialog.getState().current?.title).toBe('Fusionner « Guichetier » dans « Marc » ?');
    await act(async () => useDialog.getState().close(false, false));
    expect(doc().characters[guichetier]).toBeDefined();

    const marc = byName('Marc');
    fireEvent.change(screen.getByLabelText('Fusionner Guichetier dans…'), { target: { value: marc } });
    await act(async () => useDialog.getState().close(true, false));
    expect(doc().characters[guichetier]).toBeUndefined();
    expect(doc().characters[marc].aliases).toContain('Guichetier');
    undo();
    expect(doc().characters[guichetier].name).toBe('Guichetier');
  });
});

describe('fiche d’un décor : lieu de tournage', () => {
  it('nom du lieu, accès, contact et INT / EXT, appliqués en quittant le champ', () => {
    useProjectStore.getState().loadDoc(buildFiction());
    const id = Object.values(doc().decors).find((d) => d.name === 'PARVIS DE LA GARE')!.id;
    render(<DecorFacts doc={doc()} decorId={id} />);
    const access = screen.getByLabelText('Accès');
    fireEvent.change(access, { target: { value: 'Entrée rue de Dunkerque' } });
    expect(decorLocation(doc().decors[id]).access).toBeUndefined();
    fireEvent.blur(access);
    expect(decorLocation(doc().decors[id]).access).toBe('Entrée rue de Dunkerque');
    fireEvent.change(screen.getByLabelText('Contact'), { target: { value: 'Régie 06 00 00 00 00' } });
    fireEvent.keyDown(screen.getByLabelText('Contact'), { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('Lieu de tournage'), { target: { value: 'Gare du Nord' } });
    // Démonté sans quitter le champ : rien ne se perd.
    cleanup();
    expect(decorLocation(doc().decors[id])).toMatchObject({ name: 'Gare du Nord', access: 'Entrée rue de Dunkerque' });
    render(<DecorFacts doc={doc()} decorId={id} />);
    fireEvent.change(screen.getByLabelText('Intérieur ou extérieur'), { target: { value: 'INT/EXT' } });
    expect(doc().decors[id].intExt).toBe('INT/EXT');
  });
});
