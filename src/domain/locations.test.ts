import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { callSheetDocument, registryDocument } from './documents';
import { decorsCsv } from './exports';
import { decorLocation, migrateDecorLocations, setDecorLocation } from './locations';
import { dayItinerary, updateDay } from './schedule';
import { migrate } from './serialize';

describe('lieux de tournage distincts des décors', () => {
  const base = buildFiction();
  const [s1] = base.project.sequenceIds;
  const decorId = base.sequences[s1].decorId!;

  it('lit l’ancienne adresse tant qu’elle n’est pas migrée, puis la migre', () => {
    const old = produce(base, (d) => {
      d.decors[decorId].address = ' 3 quai Voltaire ';
      delete d.decors[decorId].location;
    });
    expect(decorLocation(old.decors[decorId])).toEqual({ address: '3 quai Voltaire' });
    expect(decorLocation(undefined)).toEqual({});
    const migrated = produce(old, (d) => migrateDecorLocations(d));
    expect(migrated.decors[decorId].address).toBeUndefined();
    expect(migrated.decors[decorId].location).toEqual({ address: '3 quai Voltaire' });
    // À l'ouverture d'un projet (fichier ou stockage local), la migration est faite.
    expect(migrate(old).decors[decorId].location).toEqual({ address: '3 quai Voltaire' });
    const blank = produce(old, (d) => {
      d.decors[decorId].address = '  ';
      migrateDecorLocations(d);
    });
    expect(blank.decors[decorId].location).toBeUndefined();
  });

  it('modifie le lieu champ par champ ; un champ vidé disparaît', () => {
    const next = produce(base, (d) => {
      d.decors[decorId].address = 'ancienne';
      setDecorLocation(d, decorId, { name: 'Lycée Voltaire', access: 'Parking rue Sedaine' });
      setDecorLocation(d, decorId, { contact: 'M. Roux 06 12 34 56 78', address: '101 avenue de la République' });
      setDecorLocation(d, 'absent', { name: 'x' });
    });
    expect(next.decors[decorId].address).toBeUndefined();
    expect(decorLocation(next.decors[decorId])).toEqual({ name: 'Lycée Voltaire', address: '101 avenue de la République', access: 'Parking rue Sedaine', contact: 'M. Roux 06 12 34 56 78' });
    const cleared = produce(next, (d) => {
      for (const k of ['name', 'address', 'access', 'contact'] as const) setDecorLocation(d, decorId, { [k]: '' });
    });
    expect(cleared.decors[decorId].location).toBeUndefined();
  });

  it('repris par le déroulé, la feuille de service, le registre et le CSV', () => {
    const next = produce(base, (d) => {
      for (const id of d.sequences[s1].shotIds) d.shots[id].shootingDay = 1;
      setDecorLocation(d, decorId, { name: 'Lycée Voltaire', address: '101 avenue de la République', access: 'Parking rue Sedaine', contact: 'M. Roux' });
    });
    expect(dayItinerary(next, 1)[0].address).toBe('101 avenue de la République');
    const sheet = callSheetDocument(next, 1).html;
    expect(sheet).toContain('<b>Lycée Voltaire</b><br>101 avenue de la République<br><span class="muted">Accès : Parking rue Sedaine</span><br><span class="muted">Contact : M. Roux</span>');
    // L'adresse propre au jour remplace celle du lieu, le reste demeure.
    const dayAddr = produce(next, (d) => updateDay(d, 1, { addresses: { [decorId]: 'Gymnase' } }));
    expect(callSheetDocument(dayAddr, 1).html).toContain('<b>Lycée Voltaire</b><br>Gymnase<br>');
    expect(registryDocument(next).html).toContain('<th>Lieu de tournage</th>');
    expect(decorsCsv(next)).toContain('Lycée Voltaire;101 avenue de la République;Parking rue Sedaine;M. Roux');
  });
});
