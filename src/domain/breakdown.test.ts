import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { addBreakdownItems, breakdownOf, breakdownSuggestions, derivedBreakdown, detectInText, removeBreakdownItem } from './breakdown';

describe('dépouillement', () => {
  it('détecte accessoires, costumes, maquillage, effets et véhicules', () => {
    expect(detectInText('Elle prend l’affiche et enlève ses lunettes ; il pleut, un taxi passe. Rouge à lèvres, robe.')).toEqual({
      accessoires: ['Affiche', 'Lunettes'],
      costumes: ['Robe'],
      maquillage: ['Rouge à lèvres'],
      effets: ['Pluie'],
      vehicules: ['Taxi'],
    });
    expect(detectInText('Une cigarette éteinte aux lèvres, sous la pluie.').accessoires).toEqual(['Cigarette']);
    expect(detectInText('Il élit domicile')).toEqual({});
  });

  it('dérive personnages, figurants et matériel du découpage', () => {
    const doc = buildRav3();
    const loge = doc.project.sequenceIds[3];
    const d = derivedBreakdown(doc, loge);
    expect(d.personnages).toEqual(['Vedette']);
    expect(d.lumiere).toContain('Projecteurs effet nuit');
    const withMaq = produce(doc, (x) => {
      x.sequences[loge].characterIds.push(Object.values(x.characters).find((c) => c.name === 'Maquilleuse')!.id);
    });
    expect(derivedBreakdown(withMaq, loge).figurants).toEqual(['Maquilleuse']);
  });

  it('propose les suggestions absentes et les ajoute en un clic', () => {
    const doc = buildFiction();
    const parvis = doc.project.sequenceIds[2];
    expect(breakdownSuggestions(doc, parvis)).toMatchObject({ accessoires: ['Cigarette'], effets: ['Pluie'] });
    const next = produce(doc, (d) => {
      addBreakdownItems(d, parvis, 'accessoires', ['Cigarette', 'cigarette', ' ', 'Briquet']);
      addBreakdownItems(d, parvis, 'effets', ['Pluie']);
      removeBreakdownItem(d, parvis, 'accessoires', 'Briquet');
      removeBreakdownItem(d, 'absent', 'accessoires', 'x');
    });
    expect(breakdownOf(next, parvis)).toEqual({ accessoires: ['Cigarette'], effets: ['Pluie'] });
    expect(breakdownSuggestions(next, parvis)).toEqual({});
    expect(breakdownSuggestions(next, 'absent')).toEqual({});
    expect(breakdownOf(doc, parvis)).toEqual({});
  });
});

describe('catégories ajoutées', async () => {
  const { produce } = await import('immer');
  const { buildRav3 } = await import('../../seed/rav3');
  const { breakdownCategories, breakdownLabel, addBreakdownItems, breakdownOf } = await import('./breakdown');
  const { aggregateEquipment, equipmentCategories } = await import('./equipment');
  it('ajoute une catégorie de dépouillement et un poste de matériel', () => {
    const doc = produce(buildRav3(), (d) => {
      d.breakdownExtra = ['Animaux'];
      d.equipmentExtra = ['Régie'];
      addBreakdownItems(d, d.project.sequenceIds[0], 'perso:Animaux', ['Chien']);
      d.manualEquipment.push({ id: 'm1', category: 'Régie', label: 'Barnum', shotIds: [] });
    });
    expect(breakdownCategories(doc).at(-1)).toBe('perso:Animaux');
    expect(breakdownLabel('perso:Animaux')).toBe('Animaux');
    expect(breakdownOf(doc, doc.project.sequenceIds[0])['perso:Animaux']).toEqual(['Chien']);
    expect(equipmentCategories(doc)).toEqual(['Image', 'Machinerie', 'Lumière', 'Son', 'Régie']);
    expect(aggregateEquipment(doc)['Régie'].map((l) => l.label)).toEqual(['Barnum']);
  });
});
