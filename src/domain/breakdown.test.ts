import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { addBreakdownItems, addedCharacters, breakdownOf, breakdownSuggestions, derivedBreakdown, detectInText, migrateBreakdownCharacters, removeBreakdownItem } from './breakdown';
import { breakdownIndex } from './breakdownReport';
import { characterStats } from './registry';
import { createVersion } from './versions';

describe('dépouillement : personnages et figurants renvoient au registre', () => {
  const base = buildFiction();
  const [s1, , s3] = base.project.sequenceIds;
  const idOf = (doc: typeof base, n: string) => Object.values(doc.characters).find((c) => c.name === n)?.id;

  it('une fiche existante (nom ou alias) est rattachée à la séquence, une nouvelle est créée', () => {
    const doc = produce(base, (d) => {
      addBreakdownItems(d, s1, 'personnages', ['marc']);
      addBreakdownItems(d, s1, 'figurants', ['VOYAGEUSE PRESSÉE']);
    });
    expect(doc.breakdown?.[s1]?.personnages).toBeUndefined();
    expect(doc.sequences[s1].characterIds).toContain(idOf(doc, 'Marc'));
    const extra = idOf(doc, 'Voyageuse Pressée')!;
    expect(doc.characters[extra].kind).toBe('figurant');
    expect(characterStats(doc).get(idOf(doc, 'Marc')!)!.sequenceIds).toContain(s1);
    expect(derivedBreakdown(doc, s1).figurants).toEqual(['Voyageuse Pressée']);
    expect(addedCharacters(doc, s1)).toEqual({ personnages: ['Marc'], figurants: ['Voyageuse Pressée'] });
    // Saisi ici : retirable, et compté une fois dans les rapports.
    const marc = breakdownIndex(doc).filter((e) => e.item === 'Marc');
    expect(marc).toHaveLength(1);
    expect(marc[0].manualSeqIds).toEqual([s1]);
    // Un renommage suit : un seul élément.
    const renamed = produce(doc, (d) => void (d.characters[idOf(d, 'Marc')!].name = 'Marco'));
    expect(breakdownIndex(renamed).filter((e) => e.cat === 'personnages').map((e) => e.item)).not.toContain('Marc');
    const removed = produce(doc, (d) => removeBreakdownItem(d, s1, 'personnages', 'Marc'));
    expect(removed.sequences[s1].characterIds).not.toContain(idOf(doc, 'Marc'));
  });

  it('un personnage que nomment les plans ne se retire pas de la séquence', () => {
    const lea = idOf(base, 'Léa')!;
    const doc = produce(base, (d) => {
      addBreakdownItems(d, s1, 'personnages', ['Léa']);
      removeBreakdownItem(d, s1, 'personnages', 'Léa');
    });
    expect(doc.sequences[s1].characterIds).not.toContain(lea);
    expect(derivedBreakdown(doc, s1).personnages).toContain('Léa');
    expect(addedCharacters(doc, s1).personnages).toEqual([]);
  });

  it('migre les noms rangés en texte, versions rangées comprises', () => {
    const doc = produce(base, (d) => {
      d.breakdown = { [s3]: { personnages: ['Marc', 'Inconnu'], accessoires: ['Valise'] } };
      createVersion(d);
      migrateBreakdownCharacters(d);
    });
    const inconnu = idOf(doc, 'Inconnu')!;
    expect(inconnu).toBeDefined();
    expect(doc.breakdown?.[s3]).toEqual({ accessoires: ['Valise'] });
    expect(doc.sequences[s3].characterIds).toContain(inconnu);
    expect(doc.versions![0].slice!.sequences[s3].characterIds).toContain(inconnu);
    // Marc, déjà nommé par un plan de la séquence 3, n'y est pas ajouté une seconde fois.
    expect(doc.sequences[s3].characterIds).not.toContain(idOf(doc, 'Marc'));
  });
});

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

describe('détection : faux positifs écartés', () => {
  it('« en train de », « Ève lit », « elle livre », « feu rouge » ne sont pas des éléments', async () => {
    const { detectInText } = await import('./breakdown');
    expect(detectInText('Elle est en train de chanter. Ève lit. Elle livre le colis au feu rouge.')).toEqual({});
    expect(detectInText('Il pose un livre sur le lit, prend le train.')).toEqual({ accessoires: ['Livre', 'Lit'], vehicules: ['Train'] });
  });
});

describe('dépouillement : orthographe, casse et rangement', async () => {
  const { addCustomCategory, moveBreakdownItem, renameBreakdownItem, renameCustomCategory } = await import('./breakdown');
  const { breakdownCsv } = await import('./exports');
  const base = buildFiction();
  const [s1, s2, s3] = base.project.sequenceIds;

  it('retire un élément quelle que soit sa casse ou ses accents', () => {
    const doc = produce(base, (d) => {
      addBreakdownItems(d, s1, 'accessoires', ['valise', 'Écharpe']);
      removeBreakdownItem(d, s1, 'accessoires', 'Valise');
      removeBreakdownItem(d, s1, 'accessoires', 'echarpe');
    });
    expect(breakdownOf(doc, s1).accessoires).toEqual([]);
  });

  it('reprend la graphie déjà saisie dans une autre séquence', () => {
    const doc = produce(base, (d) => {
      addBreakdownItems(d, s1, 'accessoires', ['Valise']);
      addBreakdownItems(d, s2, 'accessoires', ['valise', 'Ticket']);
      addBreakdownItems(d, s2, 'costumes', ['valise']);
    });
    expect(breakdownOf(doc, s2).accessoires).toEqual(['Valise', 'Ticket']);
    // Une autre catégorie garde sa propre saisie.
    expect(breakdownOf(doc, s2).costumes).toEqual(['valise']);
  });

  it('change un élément de catégorie, sans doublon ; pas les personnages', () => {
    const doc = produce(base, (d) => {
      addBreakdownItems(d, s1, 'accessoires', ['Lunettes']);
      addBreakdownItems(d, s1, 'costumes', ['lunettes']);
      moveBreakdownItem(d, s1, 'accessoires', 'costumes', 'Lunettes');
      addBreakdownItems(d, s2, 'accessoires', ['Chapeau', 'Ticket']);
      moveBreakdownItem(d, s2, 'accessoires', 'costumes', 'chapeau');
      moveBreakdownItem(d, s2, 'accessoires', 'personnages', 'Ticket');
      moveBreakdownItem(d, s2, 'personnages', 'accessoires', 'Léa');
    });
    expect(breakdownOf(doc, s1)).toEqual({ accessoires: [], costumes: ['lunettes'] });
    expect(breakdownOf(doc, s2)).toEqual({ accessoires: ['Ticket'], costumes: ['Chapeau'] });
  });

  it('renomme un élément dans tout le film, en fusionnant avec un élément existant', () => {
    const doc = produce(base, (d) => {
      addBreakdownItems(d, s1, 'accessoires', ['Valize', 'Ticket']);
      addBreakdownItems(d, s2, 'accessoires', ['valize']);
      addBreakdownItems(d, s3, 'accessoires', ['Valise cabossée', 'Valize']);
      addBreakdownItems(d, s3, 'costumes', ['Valize']);
    });
    const next = produce(doc, (d) => void expect(renameBreakdownItem(d, 'accessoires', 'Valize', 'Valise cabossée')).toBe(3));
    expect(breakdownOf(next, s1).accessoires).toEqual(['Valise cabossée', 'Ticket']);
    expect(breakdownOf(next, s2).accessoires).toEqual(['Valise cabossée']);
    expect(breakdownOf(next, s3).accessoires).toEqual(['Valise cabossée']);
    expect(breakdownOf(next, s3).costumes).toEqual(['Valize']);
    expect(breakdownIndex(next).filter((e) => e.cat === 'accessoires' && e.item === 'Valise cabossée')[0].seqIds).toHaveLength(3);
    expect(produce(doc, (d) => void renameBreakdownItem(d, 'personnages', 'Léa', 'Lea'))).toBe(doc);
    expect(produce(doc, (d) => void renameBreakdownItem(d, 'accessoires', 'Valize', '  '))).toBe(doc);
  });

  it('une catégorie ajoutée ne double pas une catégorie existante', () => {
    const doc = produce(base, (d) => {
      expect(addCustomCategory(d, 'Son')).toBe('son');
      expect(addCustomCategory(d, 'décor')).toBe('perso:décor');
      expect(addCustomCategory(d, ' Décor ')).toBe('perso:décor');
      expect(addCustomCategory(d, 'maquillage, COIFFURE')).toBe('maquillage');
      expect(addCustomCategory(d, '')).toBeUndefined();
    });
    expect(doc.breakdownExtra).toEqual(['décor']);
  });

  it('renomme une catégorie ajoutée en gardant ses éléments, ou la fond dans une autre', () => {
    const doc = produce(base, (d) => {
      d.breakdownExtra = ['Animeaux', 'Bêtes'];
      addBreakdownItems(d, s1, 'perso:Animeaux', ['Chien']);
      addBreakdownItems(d, s2, 'perso:Animeaux', ['Chat']);
      addBreakdownItems(d, s2, 'perso:Bêtes', ['chat', 'Cheval']);
    });
    const renamed = produce(doc, (d) => void expect(renameCustomCategory(d, 'Animeaux', 'Animaux')).toBe('perso:Animaux'));
    expect(renamed.breakdownExtra).toEqual(['Animaux', 'Bêtes']);
    expect(breakdownOf(renamed, s1)).toEqual({ 'perso:Animaux': ['Chien'] });
    expect(breakdownOf(renamed, s2)['perso:Animeaux']).toBeUndefined();
    expect(breakdownCsv(renamed).split('\n')[0]).toContain('Animaux');
    const merged = produce(doc, (d) => void expect(renameCustomCategory(d, 'Animeaux', 'bêtes')).toBe('perso:Bêtes'));
    expect(merged.breakdownExtra).toEqual(['Bêtes']);
    expect(breakdownOf(merged, s2)['perso:Bêtes']).toEqual(['chat', 'Cheval']);
    expect(breakdownOf(merged, s1)['perso:Bêtes']).toEqual(['Chien']);
    // Vers une catégorie de base : refusé.
    expect(produce(doc, (d) => void expect(renameCustomCategory(d, 'Animeaux', 'Son')).toBeUndefined())).toBe(doc);
    expect(produce(doc, (d) => void renameCustomCategory(d, 'Animeaux', 'animeaux')).breakdownExtra).toEqual(['animeaux', 'Bêtes']);
  });
});
