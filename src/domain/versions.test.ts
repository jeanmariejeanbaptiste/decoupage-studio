import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { addBreakdownItems, breakdownOf } from './breakdown';
import { alignScenes } from './sceneAlign';
import { reviseScenario, revisionSummary } from './revision';
import { clearScenario, clearedOf, restoreScenario, compareVersions, createVersion, deleteVersion, ensureVersions, nextVersionName, revisedScenes, switchVersion } from './versions';

const V1 = `INT. GARE — HALL - JOUR

Le hall bruisse, les annonces se succèdent. Léa traverse le hall en tirant une valise cabossée.

INT. GARE — CONSIGNE - JOUR

Léa pose la valise sur le comptoir.

GUICHETIER
C'est pour combien de temps ?

EXT. PARVIS DE LA GARE - NUIT

Marc attend sous la pluie, une cigarette éteinte aux lèvres.
`;

describe('rapprochement des scènes', () => {
  it('scène insérée, en-tête retouché, réplique réécrite : chacun retrouve la sienne', () => {
    const v2 = `INT. GARE — HALL - JOUR

Le hall bruisse, les annonces se succèdent. Léa traverse le hall en tirant une valise cabossée.

INT. TRAIN - JOUR

Un contrôleur passe.

INT. GARE — CONSIGNE AUTOMATIQUE - JOUR

Léa pose la valise sur le comptoir.

GUICHETIER
C'est pour longtemps ?

EXT. PARVIS DE LA GARE - NUIT

Marc attend sous la pluie, une cigarette éteinte aux lèvres.
`;
    const al = alignScenes(V1, v2);
    expect(al.matches.map((m) => [m.from, m.to])).toEqual([
      [0, 0],
      [1, 2],
      [2, 3],
    ]);
    expect(al.added).toEqual([1]);
    expect(al.removed).toEqual([]);
    expect(al.matches.find((m) => m.to === 0)?.same).toBe(true);
    expect(al.matches.find((m) => m.to === 2)?.same).toBe(false);
  });

  it('une renumérotation des en-têtes n’est pas une modification', () => {
    const numbered = V1.replace('INT. GARE — HALL', '1. INT. GARE — HALL').replace('EXT. PARVIS DE LA GARE - NUIT', 'EXT. PARVIS DE LA GARE - NUIT 3');
    const al = alignScenes(V1, numbered);
    expect(al.matches.every((m) => m.same)).toBe(true);
  });

  it('scènes déplacées et scène supprimée', () => {
    const scenes = V1.split(/\n(?=(?:INT|EXT)\.)/);
    const v2 = [scenes[2], scenes[0]].join('\n');
    const al = alignScenes(V1, v2);
    expect(al.matches.map((m) => [m.from, m.to]).sort()).toEqual([
      [0, 1],
      [2, 0],
    ]);
    expect(al.removed).toEqual([1]);
  });
});

describe('versions', () => {
  it('une version nouvelle garde tout ; on passe de l’une à l’autre sans rien perdre', () => {
    const doc = produce(buildFiction(), (d) => {
      const [s1] = d.project.sequenceIds;
      addBreakdownItems(d, s1, 'accessoires', ['Valise']);
      ensureVersions(d);
    });
    const s1 = doc.project.sequenceIds[0];
    const v1 = doc.activeVersionId!;
    const after = produce(doc, (d) => {
      createVersion(d);
      // En V2 : une séquence en moins, un plan retouché.
      d.project.sequenceIds = d.project.sequenceIds.slice(0, 2);
      d.shots[d.sequences[s1].shotIds[0]].subject = 'Hall vide';
    });
    expect(after.project.version).toBe('V2');
    expect(breakdownOf(after, s1).accessoires).toEqual(['Valise']);
    const diff = compareVersions(after, v1)!;
    expect(diff.removed).toHaveLength(1);
    expect(diff.changed).toEqual([s1]);
    const back = produce(after, (d) => switchVersion(d, v1));
    expect(back.project.sequenceIds).toHaveLength(3);
    expect(back.shots[back.sequences[s1].shotIds[0]].subject).not.toBe('Hall vide');
    expect(back.project.version).toBe('V1');
    const again = produce(back, (d) => switchVersion(d, d.versions!.find((v) => v.name === 'V2')!.id));
    expect(again.project.sequenceIds).toHaveLength(2);
    expect(again.shots[again.sequences[s1].shotIds[0]].subject).toBe('Hall vide');
    // Supprimer une version rangée, jamais la courante.
    const cut = produce(again, (d) => {
      deleteVersion(d, d.activeVersionId!);
      deleteVersion(d, v1);
    });
    expect(cut.versions!.map((v) => v.name)).toEqual(['V2']);
    // Version publiée pour la relecture en ligne : elle reste tant que la relecture existe.
    const pub = produce(again, (d) => {
      d.review = { fileId: 'file123456', publishedVersionId: v1, publishedAt: '2026-11-09T10:00:00Z' };
      deleteVersion(d, v1);
    });
    expect(pub.versions!.map((v) => v.name)).toEqual(['V1', 'V2']);
  });

  it('supprimer une séquence dans la V2 ne retire pas la préparation que la V1 garde', async () => {
    const { deleteSequence } = await import('./ops');
    const doc = produce(buildFiction(), (d) => {
      addBreakdownItems(d, d.project.sequenceIds[2], 'effets', ['Pluie']);
      createVersion(d);
      deleteSequence(d, d.project.sequenceIds[2]);
    });
    const s3 = doc.versions![0].slice!.sequenceIds[2];
    expect(breakdownOf(doc, s3).effets).toEqual(['Pluie']);
    // Sans autre version, elle part avec la séquence.
    const solo = produce(buildFiction(), (d) => {
      addBreakdownItems(d, d.project.sequenceIds[2], 'effets', ['Pluie']);
      deleteSequence(d, d.project.sequenceIds[2]);
    });
    expect(Object.keys(solo.breakdown ?? {})).not.toContain(s3);
  });

  it('nom suivant', () => {
    expect(nextVersionName(['V1', 'V2'])).toBe('V3');
    expect(nextVersionName(['Version de tournage'])).toBe('V2');
  });

  it('nouveau texte : séquences reprises, nouvelle insérée à sa place, marques de révision', () => {
    const doc = produce(buildFiction(), (d) => {
      ensureVersions(d);
      createVersion(d);
    });
    const ids = doc.project.sequenceIds;
    const src = doc.scenario!;
    const second = src.indexOf('INT. GARE — CONSIGNE');
    const next = `${src.slice(0, second)}INT. TRAIN - JOUR\n\nUn contrôleur passe dans le couloir.\n\n${src.slice(second).replace('Léa pose la valise sur le comptoir.', 'Léa pose sa valise sur le comptoir, essoufflée.')}`;
    let summary = '';
    const out = produce(doc, (d) => {
      summary = revisionSummary(reviseScenario(d, next));
    });
    expect(summary).toContain('3 séquences reprises dont 1 modifiée');
    expect(summary).toContain('1 nouvelle, ajoutée au découpage');
    expect(out.project.sequenceIds).toHaveLength(4);
    expect(out.project.sequenceIds[0]).toBe(ids[0]);
    expect(out.project.sequenceIds[2]).toBe(ids[1]);
    expect(out.sequences[out.project.sequenceIds[1]].label).toBe('TRAIN');
    // Les passages liés aux plans suivent.
    for (const b of Object.values(out.blocks)) if (b.scenarioAnchor) expect(out.scenario!.slice(b.scenarioAnchor.start, b.scenarioAnchor.end).length).toBeGreaterThan(0);
    const marks = revisedScenes(out)!;
    expect(marks.get(1)).toBe('new');
    expect(marks.get(2)).toBe('changed');
    expect(marks.has(0)).toBe(false);
  });

  it('effacer le scénario : cette version ou toutes ; le découpage reste ; le texte se rétablit avec ses liens', () => {
    const doc = produce(buildFiction(), (d) => void createVersion(d));
    const text = doc.scenario!;
    const seq = doc.project.sequenceIds[0];
    const one = produce(doc, (d) => clearScenario(d, 'current'));
    expect(one.scenario).toBe('');
    expect(one.project.sequenceIds).toHaveLength(3);
    expect(one.sequences[seq].scenarioAnchor).toBeUndefined();
    expect(one.versions![0].slice!.scenario).toBe(text);
    expect(clearedOf(one)?.text).toBe(text);
    const back = produce(one, (d) => void restoreScenario(d));
    expect(back.scenario).toBe(text);
    expect(back.sequences[seq].scenarioAnchor).toEqual(doc.sequences[seq].scenarioAnchor);
    const all = produce(doc, (d) => clearScenario(d, 'all'));
    expect(all.versions![0].slice!.scenario).toBe('');
    expect(all.clearedScenarios).toHaveLength(2);
  });
});
