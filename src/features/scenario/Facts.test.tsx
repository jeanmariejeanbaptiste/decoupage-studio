import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFiction } from '../../../seed/fiction';
import { decorLocation } from '../../domain/locations';
import { undo, useProjectStore } from '../../store/projectStore';
import { useDialog } from '../../ui/dialogStore';
import { CharacterFacts } from './CharacterFacts';
import { DecorFacts } from './DecorFacts';
import { OrphanFiches } from './OrphanFiches';
import { addCharacter } from '../../domain/ops';
import { addDecor } from '../../domain/registry';
import { mutateDoc } from '../../store/projectStore';

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

describe('supprimer une fiche', () => {
  it('utilisée : confirmée, puis annulable ; inutilisée : sans question', async () => {
    useProjectStore.getState().loadDoc(buildFiction());
    const marc = byName('Marc');
    const { rerender } = render(<CharacterFacts doc={doc()} characterId={marc} />);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la fiche Marc' }));
    expect(useDialog.getState().current?.body).toMatch(/^Présent dans 1 séquence/);
    await act(async () => useDialog.getState().close(true, false));
    expect(doc().characters[marc]).toBeUndefined();
    undo();
    expect(doc().characters[marc].name).toBe('Marc');
    const quai = mutateDoc((d) => addDecor(d, { name: 'Quai 4' }))!;
    rerender(<DecorFacts doc={doc()} decorId={quai} />);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la fiche Quai 4' }));
    expect(useDialog.getState().current).toBeNull();
    expect(doc().decors[quai]).toBeUndefined();
  });
});

describe('fiches hors du texte', () => {
  it('listées sous le panneau, avec renommer, champs, nature et suppression', () => {
    useProjectStore.getState().loadDoc(buildFiction());
    const { rerender } = render(<OrphanFiches doc={doc()} kind="characters" />);
    expect(screen.queryByTestId('orphan-characters')).toBeNull();
    const id = mutateDoc((d) => addCharacter(d, { name: 'Voyageuse', kind: 'figurant' }))!;
    rerender(<OrphanFiches doc={doc()} kind="characters" />);
    fireEvent.click(screen.getByRole('button', { name: /Voyageuse/ }));
    fireEvent.change(screen.getByLabelText('Interprète'), { target: { value: 'Nina Roy' } });
    fireEvent.blur(screen.getByLabelText('Interprète'));
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Voyageuse pressée' } });
    fireEvent.blur(screen.getByLabelText('Nom'));
    expect(doc().characters[id]).toMatchObject({ name: 'Voyageuse pressée', actor: 'Nina Roy', aliases: ['Voyageuse'] });
    rerender(<OrphanFiches doc={doc()} kind="characters" />);
    fireEvent.change(screen.getByLabelText('Nature'), { target: { value: 'silhouette' } });
    expect(doc().characters[id].kind).toBe('silhouette');
    rerender(<OrphanFiches doc={doc()} kind="characters" />);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la fiche Voyageuse pressée' }));
    expect(doc().characters[id]).toBeUndefined();
    rerender(<OrphanFiches doc={doc()} kind="characters" />);
    expect(screen.queryByTestId('orphan-characters')).toBeNull();
  });

  it('décors : adresse et lieu de tournage', () => {
    useProjectStore.getState().loadDoc(buildFiction());
    const id = mutateDoc((d) => addDecor(d, { name: 'Quai 4' }))!;
    render(<OrphanFiches doc={doc()} kind="decors" />);
    fireEvent.click(screen.getByRole('button', { name: /Quai 4/ }));
    fireEvent.change(screen.getByLabelText('Adresse de tournage'), { target: { value: '18 rue de Dunkerque' } });
    fireEvent.blur(screen.getByLabelText('Adresse de tournage'));
    expect(decorLocation(doc().decors[id]).address).toBe('18 rue de Dunkerque');
    expect(screen.getByLabelText('Accès')).toBeTruthy();
  });
});
