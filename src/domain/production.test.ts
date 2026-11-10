import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { calendarIcs, calendarItems, itemsOn, productionItems } from './calendar';
import { createProjectDoc } from './factory';
import {
  addDependency,
  addPhase,
  addTask,
  allTasks,
  applyTemplate,
  daysBetween,
  dependencyCandidates,
  durationDays,
  findTask,
  formatFrDate,
  heldBy,
  isHeld,
  isLate,
  isPinned,
  moveTask,
  normalizeProduction,
  parseFrDate,
  phaseDays,
  pinnedBy,
  phaseSpan,
  placePhase,
  placeTask,
  removePhase,
  removeTask,
  setDone,
  setDuration,
  setLinked,
  setTaskDates,
  shootingRange,
  syncProduction,
  type Production,
} from './production';
import { assignShots, updateDay } from './schedule';
import { migrate } from './serialize';
import type { ProjectDoc } from './types';

const blank = () => createProjectDoc({ title: 'Film', format: 'fiction' });

/** Trois étapes enchaînées A → B → C et un jalon J après C. */
function chain(): ProjectDoc {
  const doc = blank();
  doc.production = {
    phases: [
      {
        id: 'p1',
        name: 'Préparation',
        tasks: [
          { id: 'a', name: 'A', start: '2027-01-04', end: '2027-01-08' },
          { id: 'b', name: 'B', start: '2027-01-11', end: '2027-01-15', after: ['a'] },
        ],
      },
      {
        id: 'p2',
        name: 'Suite',
        tasks: [
          { id: 'c', name: 'C', start: '2027-01-18', end: '2027-01-19', after: ['b'] },
          { id: 'j', name: 'J', start: '2027-01-19', end: '2027-01-19', milestone: true, after: ['c'] },
        ],
      },
    ],
  };
  return doc;
}

const task = (doc: ProjectDoc, id: string) => findTask(doc.production, id)!.task;
const dates = (doc: ProjectDoc, id: string) => [task(doc, id).start, task(doc, id).end];

describe('dates du calendrier de production', () => {
  it('lit et écrit les dates jj/mm/aaaa', () => {
    expect(formatFrDate('2027-03-12')).toBe('12/03/2027');
    expect(formatFrDate('nope')).toBe('');
    expect(parseFrDate('12/03/2027')).toBe('2027-03-12');
    expect(parseFrDate(' 1.4.27 ')).toBe('2027-04-01');
    expect(parseFrDate('5-6', '2028-01-01')).toBe('2028-06-05');
    expect(parseFrDate('31/02/2027')).toBeUndefined();
    expect(parseFrDate('29/02/2028')).toBe('2028-02-29');
    expect(parseFrDate('demain')).toBeUndefined();
  });

  it('dérive les durées : bornes comprises, zéro pour un jalon', () => {
    expect(daysBetween('2027-01-04', '2027-01-08')).toBe(4);
    expect(daysBetween('2027-03-27', '2027-03-29')).toBe(2);
    expect(durationDays({ start: '2027-01-04', end: '2027-01-08' })).toBe(5);
    expect(durationDays({ start: '2027-01-04', end: '2027-01-04', milestone: true })).toBe(0);
    const [prep, suite] = chain().production!.phases;
    expect(phaseDays(prep)).toBe(12);
    expect(phaseDays({ ...suite, tasks: suite.tasks.filter((t) => t.milestone) })).toBe(0);
    expect(phaseDays({ ...suite, tasks: [] })).toBeUndefined();
  });
});

describe('cascade des dépendances', () => {
  it('pousse les successeurs quand une étape s’allonge, sans jamais les avancer', () => {
    const doc = produce(chain(), (d) => setTaskDates(d, 'a', '2027-01-04', '2027-01-12'));
    expect(dates(doc, 'b')).toEqual(['2027-01-13', '2027-01-17']);
    expect(dates(doc, 'c')).toEqual(['2027-01-18', '2027-01-19']);
    expect(dates(doc, 'j')).toEqual(['2027-01-19', '2027-01-19']);
    // Raccourcir A ne ramène pas B en arrière.
    const back = produce(doc, (d) => setTaskDates(d, 'a', '2027-01-04', '2027-01-05'));
    expect(dates(back, 'b')).toEqual(['2027-01-13', '2027-01-17']);
  });

  it('propage en chaîne jusqu’au jalon, qui tombe le dernier jour de son prédécesseur', () => {
    const doc = produce(chain(), (d) => moveTask(d, 'b', 7));
    expect(dates(doc, 'b')).toEqual(['2027-01-18', '2027-01-22']);
    expect(dates(doc, 'c')).toEqual(['2027-01-23', '2027-01-24']);
    expect(dates(doc, 'j')).toEqual(['2027-01-24', '2027-01-24']);
  });

  it('ne place jamais une étape avant la fin de ses prédécesseurs (durée gardée)', () => {
    const doc = produce(chain(), (d) => moveTask(d, 'b', -10));
    expect(dates(doc, 'b')).toEqual(['2027-01-09', '2027-01-13']);
    // Après un jalon : le lendemain.
    const after = produce(chain(), (d) => {
      const id = addTask(d.production!, 'p2', { name: 'Après J', afterId: 'j' })!;
      addDependency(d, id, 'j');
      setTaskDates(d, id, '2027-01-02', '2027-01-03');
    });
    const t = allTasks(after.production).find((r) => r.task.name === 'Après J')!.task;
    expect([t.start, t.end]).toEqual(['2027-01-20', '2027-01-21']);
  });

  it('règle la durée au clavier ; un jalon garde un seul jour', () => {
    const doc = produce(chain(), (d) => {
      setDuration(d, 'c', 4);
      setTaskDates(d, 'j', '2027-02-01', '2027-02-09');
    });
    expect(dates(doc, 'c')).toEqual(['2027-01-18', '2027-01-21']);
    expect(dates(doc, 'j')).toEqual(['2027-02-01', '2027-02-01']);
    // Fin avant le début : ramenée au début.
    const odd = produce(chain(), (d) => setTaskDates(d, 'a', '2027-01-04', '2027-01-01'));
    expect(dates(odd, 'a')).toEqual(['2027-01-04', '2027-01-04']);
  });

  it('refuse les boucles et propose seulement des prédécesseurs possibles', () => {
    const doc = chain();
    expect(produce(doc, (d) => void expect(addDependency(d, 'a', 'c')).toBe(false)).production).toEqual(doc.production);
    expect(dependencyCandidates(doc.production!, 'a').map((r) => r.task.id)).toEqual([]);
    expect(dependencyCandidates(doc.production!, 'c').map((r) => r.task.id)).toEqual(['a', 'b']);
    const linked = produce(doc, (d) => void addDependency(d, 'c', 'a'));
    expect(task(linked, 'c').after).toEqual(['b', 'a']);
  });

  it('ajouter une dépendance pousse l’élément après son nouveau prédécesseur', () => {
    const doc = produce(chain(), (d) => {
      const id = addTask(d.production!, 'p1', { name: 'Libre', today: '2027-01-01' })!;
      setTaskDates(d, id, '2027-01-01', '2027-01-03');
      addDependency(d, id, 'b');
    });
    const t = allTasks(doc.production).find((r) => r.task.name === 'Libre')!.task;
    expect([t.start, t.end]).toEqual(['2027-01-16', '2027-01-18']);
  });
});

describe('structure', () => {
  it('ajoute étapes et jalons à la suite, renomme, coche, supprime avec ses dépendances', () => {
    const doc = produce(chain(), (d) => {
      const plan = d.production!;
      const id = addTask(plan, 'p1', { afterId: 'a' })!;
      expect(findTask(plan, id)!.task).toMatchObject({ name: 'Nouvelle étape', start: '2027-01-09', end: '2027-01-13' });
      expect(plan.phases[0].tasks.map((t) => t.id)).toEqual(['a', id, 'b']);
      const m = addTask(plan, 'p1', { milestone: true })!;
      expect(findTask(plan, m)!.task).toMatchObject({ name: 'Nouveau jalon', start: '2027-01-15', end: '2027-01-15', milestone: true });
      setDone(plan, 'a', true);
      removeTask(plan, 'b');
    });
    expect(task(doc, 'a').done).toBe(true);
    expect(findTask(doc.production, 'b')).toBeUndefined();
    expect(task(doc, 'c').after).toBeUndefined();
    const empty = produce(doc, (d) => removePhase(d.production!, 'p1'));
    expect(empty.production!.phases.map((p) => p.id)).toEqual(['p2']);
  });

  it('réordonne les lignes du tableau, d’une phase à l’autre', () => {
    const doc = produce(chain(), (d) => {
      const plan = d.production!;
      placeTask(plan, 'a', 'p1', 2);
      expect(plan.phases[0].tasks.map((t) => t.id)).toEqual(['b', 'a']);
      placeTask(plan, 'j', 'p1', 0);
      expect(plan.phases[0].tasks.map((t) => t.id)).toEqual(['j', 'b', 'a']);
      expect(plan.phases[1].tasks.map((t) => t.id)).toEqual(['c']);
      const p3 = addPhase(plan, 'Diffusion');
      placePhase(plan, p3, 0);
      expect(plan.phases.map((p) => p.name)).toEqual(['Diffusion', 'Préparation', 'Suite']);
      placePhase(plan, p3, 3);
      expect(plan.phases.map((p) => p.name)).toEqual(['Préparation', 'Suite', 'Diffusion']);
    });
    // L'ordre ne change pas les dates.
    expect(dates(doc, 'a')).toEqual(['2027-01-04', '2027-01-08']);
    expect(phaseSpan(doc.production!.phases[0])).toEqual({ start: '2027-01-04', end: '2027-01-19' });
  });
});

/** Plan de travail daté : deux jours de tournage. */
function withShooting(doc: ProjectDoc, first: string, last: string): ProjectDoc {
  const ids = doc.project.sequenceIds;
  return produce(doc, (d) => {
    assignShots(d, d.sequences[ids[0]].shotIds, 1);
    assignShots(d, d.sequences[ids[1]].shotIds, 2);
    updateDay(d, 1, { date: first });
    updateDay(d, 2, { date: last });
  });
}

/** Plan de travail de `n` jours, sans date : la séquence i au jour i. */
function schedule(doc: ProjectDoc, n: number): ProjectDoc {
  const ids = doc.project.sequenceIds;
  return produce(doc, (d) => {
    for (let i = 0; i < n; i++) assignShots(d, d.sequences[ids[i]].shotIds, i + 1);
  });
}

/** Dépendances non respectées : « successeur < prédécesseur ». */
function lateLinks(doc: ProjectDoc): string[] {
  const all = allTasks(doc.production).map((r) => r.task);
  return all.flatMap((t) => (t.after ?? []).map((p) => all.find((x) => x.id === p)!).filter((p) => isLate(t, p)).map((p) => `${t.name} < ${p.name}`));
}

describe('modèle et plan de travail', () => {
  it('crée le modèle à partir d’aujourd’hui, enchaîné et sans chevauchement interdit', () => {
    const doc = produce(blank(), (d) => applyTemplate(d, '2026-11-09'));
    const plan = doc.production!;
    expect(plan.phases.map((p) => p.name)).toEqual(['Développement', 'Préparation', 'Tournage', 'Postproduction', 'Diffusion']);
    expect(plan.phases[1].tasks.map((t) => t.name)).toEqual(['Repérages', 'Casting', 'Décors', 'Costumes', 'Maquillage et coiffure', 'Matériel']);
    expect(plan.phases[3].tasks.map((t) => `${t.name}${t.milestone ? ' ◆' : ''}`)).toEqual([
      'Montage image',
      'Version réalisateur ◆',
      'Montage définitif',
      'Étalonnage',
      'Montage son',
      'Mixage',
      'Image verrouillée ◆',
    ]);
    const all = allTasks(plan).map((r) => r.task);
    expect(all[0].start).toBe('2026-11-09');
    expect(all.find((t) => t.name === 'Scénario verrouillé')).toMatchObject({ milestone: true, start: '2026-12-06' });
    expect(all.find((t) => t.name === 'Repérages')!.start).toBe('2026-12-07');
    const shoot = all.find((t) => t.name === 'Tournage')!;
    expect(shoot.linked).toBe('schedule');
    // Chaque élément commence après la fin de ses prédécesseurs.
    for (const t of all)
      for (const p of t.after ?? []) {
        const pred = all.find((x) => x.id === p)!;
        expect(t.milestone ? t.start >= pred.end : t.start > pred.end).toBe(true);
      }
    // Un calendrier déjà rempli n'est pas remplacé.
    const again = produce(doc, (d) => applyTemplate(d, '2030-01-01'));
    expect(again).toBe(doc);
  });

  it('l’étape liée suit les jours de tournage datés et pousse la postproduction', () => {
    const base = produce(buildRav3(), (d) => applyTemplate(d, '2026-11-09'));
    const shootId = allTasks(base.production).find((r) => r.task.linked)!.task.id;
    const edit = allTasks(base.production).find((r) => r.task.name === 'Montage image')!.task;
    const dated = produce(withShooting(base, '2027-06-01', '2027-06-20'), (d) => syncProduction(d));
    expect(shootingRange(dated)).toEqual({ start: '2027-06-01', end: '2027-06-20', dated: 2, total: 2 });
    expect(dates(dated, shootId)).toEqual(['2027-06-01', '2027-06-20']);
    expect(task(dated, edit.id).start).toBe('2027-06-21');
    // Dates tenues par le plan de travail : non modifiables à la main.
    const tried = produce(dated, (d) => setTaskDates(d, shootId, '2027-01-01', '2027-01-05'));
    expect(dates(tried, shootId)).toEqual(['2027-06-01', '2027-06-20']);
    // Délier : l'étape garde ses dates et redevient libre.
    const free = produce(dated, (d) => setLinked(d, shootId, false));
    expect(task(free, shootId).linked).toBeUndefined();
    expect(produce(free, (d) => setTaskDates(d, shootId, '2027-06-02', '2027-06-20')).production).not.toEqual(free.production);
  });

  it('cale développement et préparation avant un tournage déjà daté', () => {
    const doc = produce(withShooting(buildRav3(), '2027-09-06', '2027-09-30'), (d) => applyTemplate(d, '2026-11-09'));
    const all = allTasks(doc.production).map((r) => r.task);
    const shoot = all.find((t) => t.linked)!;
    expect([shoot.start, shoot.end]).toEqual(['2027-09-06', '2027-09-30']);
    const prepEnd = doc.production!.phases[1].tasks.reduce((a, t) => (t.end > a ? t.end : a), '');
    expect(prepEnd).toBe('2027-09-05');
    // La postproduction s'enchaîne après lui.
    expect(all.find((t) => t.name === 'Montage image')!.start).toBe('2027-10-01');
    expect(lateLinks(doc)).toEqual([]);
  });

  it('construit le modèle autour d’un tournage proche : préparation avant, postproduction juste après', () => {
    const doc = produce(withShooting(buildRav3(), '2026-11-30', '2026-12-01'), (d) => applyTemplate(d, '2026-11-09'));
    const all = allTasks(doc.production).map((r) => r.task);
    const shoot = all.find((t) => t.linked)!;
    expect([shoot.start, shoot.end]).toEqual(['2026-11-30', '2026-12-01']);
    expect(all.find((t) => t.name === 'Montage image')!.start).toBe('2026-12-02');
    const prepEnd = doc.production!.phases[1].tasks.reduce((a, t) => (t.end > a ? t.end : a), '');
    expect(prepEnd).toBe('2026-11-29');
    // Développement commencé avant aujourd'hui : aucune dépendance enfreinte dès la création.
    expect(all[0].start < '2026-11-09').toBe(true);
    expect(lateLinks(doc)).toEqual([]);
  });

  it('date erronée puis corrigée dans le plan de travail : la postproduction revient', () => {
    const base = produce(schedule(buildRav3(), 3), (d) => applyTemplate(d, '2026-11-09'));
    const edit = () => allTasks(base.production).find((r) => r.task.name === 'Montage image')!.task.id;
    const dcp = () => allTasks(base.production).find((r) => r.task.name === 'Copie de diffusion')!.task.id;
    const mutate = (doc: ProjectDoc, date: string) =>
      produce(doc, (d) => {
        updateDay(d, 1, { date });
        syncProduction(d);
      });
    const good = mutate(base, '2027-03-01');
    const wrong = mutate(good, '2072-03-01');
    expect(task(wrong, edit()).start > '2072-03-01').toBe(true);
    const fixed = mutate(wrong, '2027-03-01');
    expect(fixed.production).toEqual(good.production);
    expect(task(fixed, dcp()).start < '2028-01-01').toBe(true);
  });

  it('plan de travail daté en partie, un jour erroné puis corrigé : le tournage retrouve sa durée prévue', () => {
    const base = produce(schedule(buildRav3(), 3), (d) => {
      applyTemplate(d, '2026-11-09');
      updateDay(d, 1, { date: '2027-03-01' });
      syncProduction(d);
    });
    const shootId = allTasks(base.production).find((r) => r.task.linked)!.task.id;
    const day2 = (doc: ProjectDoc, date: string) =>
      produce(doc, (d) => {
        updateDay(d, 2, { date });
        syncProduction(d);
      });
    const good = day2(base, '2027-03-02');
    expect(dates(good, shootId)).toEqual(['2027-03-01', '2027-03-25']);
    const wrong = day2(good, '2072-03-02');
    expect(dates(wrong, shootId)).toEqual(['2027-03-01', '2072-03-02']);
    const fixed = day2(wrong, '2027-03-02');
    expect(fixed.production).toEqual(good.production);
  });

  it('ne ramène que les éléments collés, jamais avant un autre prédécesseur', () => {
    const doc = produce(schedule(buildRav3(), 2), (d) => {
      d.production = {
        phases: [
          {
            id: 'p',
            name: 'Film',
            tasks: [
              { id: 's', name: 'Tournage', start: '2027-03-01', end: '2027-03-10', linked: 'schedule' },
              { id: 'o', name: 'Autre', start: '2027-03-01', end: '2027-03-08' },
              { id: 'm', name: 'Montage', start: '2027-03-11', end: '2027-03-20', after: ['s', 'o'] },
              { id: 'f', name: 'Libre', start: '2027-04-01', end: '2027-04-02', after: ['s'] },
            ],
          },
        ],
      };
      updateDay(d, 1, { date: '2027-03-01' });
      updateDay(d, 2, { date: '2027-03-02' });
      syncProduction(d);
    });
    // Le tournage raccourcit de huit jours : Montage revient, mais pas avant « Autre » ; « Libre » ne bouge pas.
    expect(dates(doc, 's')).toEqual(['2027-03-01', '2027-03-02']);
    expect(dates(doc, 'm')).toEqual(['2027-03-09', '2027-03-18']);
    expect(dates(doc, 'f')).toEqual(['2027-04-01', '2027-04-02']);
  });

  it('plan de travail daté en partie : le début suit, la durée prévue est gardée, la fin reste réglable', () => {
    const base = produce(schedule(buildRav3(), 3), (d) => applyTemplate(d, '2026-11-09'));
    const shootId = allTasks(base.production).find((r) => r.task.linked)!.task.id;
    const one = produce(base, (d) => {
      updateDay(d, 1, { date: '2027-03-01' });
      syncProduction(d);
    });
    expect(shootingRange(one)).toMatchObject({ dated: 1, total: 3 });
    // Tournage de 25 jours dans le modèle : il les garde.
    expect(dates(one, shootId)).toEqual(['2027-03-01', '2027-03-25']);
    expect(isPinned(one, task(one, shootId))).toBe(false);
    expect(isHeld(one, task(one, shootId))).toBe(true);
    expect(task(one, allTasks(one.production).find((r) => r.task.name === 'Montage image')!.task.id).start).toBe('2027-03-26');
    // La fin se règle, jamais en deçà des jours du plan de travail ; le début ne bouge pas.
    const shorter = produce(one, (d) => {
      setTaskDates(d, shootId, '2027-01-01', '2027-03-10');
      syncProduction(d);
    });
    expect(dates(shorter, shootId)).toEqual(['2027-03-01', '2027-03-10']);
    const tooShort = produce(one, (d) => setDuration(d, shootId, 1));
    expect(dates(tooShort, shootId)).toEqual(['2027-03-01', '2027-03-03']);
    // Tous les jours datés : l'étape les suit exactement et se fige.
    const all = produce(one, (d) => {
      updateDay(d, 2, { date: '2027-03-02' });
      updateDay(d, 3, { date: '2027-03-04' });
      syncProduction(d);
    });
    expect(dates(all, shootId)).toEqual(['2027-03-01', '2027-03-04']);
    expect(isPinned(all, task(all, shootId))).toBe(true);
    // Variantes d'après une étendue calculée une fois : mêmes réponses.
    for (const d of [one, all]) {
      const t = task(d, shootId);
      expect(pinnedBy(shootingRange(d), t)).toBe(isPinned(d, t));
      expect(heldBy(shootingRange(d), t)).toBe(isHeld(d, t));
    }
  });
});

describe('calendrier et fichier', () => {
  it('montre étapes et jalons dans le calendrier, après le tournage, et les exporte en .ics', () => {
    const doc = withShooting(produce(buildRav3(), (d) => applyTemplate(d, '2026-11-09')), '2027-06-01', '2027-06-20');
    const synced = produce(doc, (d) => syncProduction(d));
    const items = productionItems(synced);
    // L'étape liée n'y est pas : les jours de tournage datés le sont déjà.
    expect(items.some((it) => it.title === 'Tournage')).toBe(false);
    expect(productionItems(synced, { withLinked: true }).some((it) => it.title === 'Tournage')).toBe(true);
    const lock = items.find((it) => it.title === 'Scénario verrouillé')!;
    expect(lock).toMatchObject({ milestone: true, date: lock.endDate, source: 'production', group: 'Développement' });
    // Plan de travail daté en partie : l'étape liée ne couvre que ce qui suit le dernier jour daté.
    const partial = produce(synced, (d) => {
      updateDay(d, 2, { date: undefined });
      syncProduction(d);
    });
    const shoot = productionItems(partial).find((it) => it.title === 'Tournage');
    expect(shoot).toMatchObject({ date: '2027-06-02' });
    expect(shoot!.endDate > '2027-06-02').toBe(true);
    expect(itemsOn(calendarItems(partial), '2027-06-01').map((x) => x.title)).not.toContain('Tournage');
    // Tournage commencé pendant la préparation : le jour de tournage passe devant les étapes.
    const early = produce(withShooting(produce(buildRav3(), (d) => applyTemplate(d, '2026-11-09')), '2027-01-20', '2027-06-20'), (d) => syncProduction(d));
    const day = itemsOn(calendarItems(early), '2027-01-20').map((x) => x.source);
    expect(day[0]).toBe('shooting');
    expect(day.length).toBeGreaterThan(1);
    expect(day.slice(1).every((x) => x === 'production')).toBe(true);
    const ics = calendarIcs(items.slice(0, 3), 'Film', new Date('2026-11-09T08:00:00Z'));
    expect(ics).toContain(`UID:etape-${items[0].taskId}@decoupage-studio`);
    expect(ics).toContain('SUMMARY:◆ Scénario verrouillé\r\nCATEGORIES:Développement');
  });

  it('relit un fichier abîmé sans planter et recale l’étape liée', () => {
    const doc = withShooting(buildRav3(), '2027-06-01', '2027-06-03');
    const broken = {
      ...doc,
      production: {
        phases: [
          { id: 'p', name: 'Tournage', tasks: [{ id: 't', name: 'Tournage', start: '2027-01-01', end: '2026-01-01', linked: 'schedule', after: ['zz', 't'] }, { id: 'x', start: 'bientôt' }] },
          null,
        ],
      } as unknown as Production,
    };
    const out = migrate(broken);
    expect(out.production!.phases).toHaveLength(1);
    expect(out.production!.phases[0].tasks).toEqual([{ id: 't', name: 'Tournage', start: '2027-06-01', end: '2027-06-03', linked: 'schedule', planned: 1 }]);
    const gone = { ...doc, production: { phases: 'x' } as unknown as Production };
    normalizeProduction(gone);
    expect(gone.production).toBeUndefined();
  });

  it('rompt les boucles relues d’un fichier : les dates ne partent pas des siècles plus loin', () => {
    const doc = blank();
    doc.production = {
      phases: [
        {
          id: 'p',
          name: 'P',
          tasks: [
            { id: 'a', name: 'A', start: '2027-01-01T10:00', end: '2027-01-05', after: ['b'] },
            { id: 'b', name: 'B', start: '2027-01-06', end: '2027-01-08', after: ['a', 'a'] },
          ],
        },
      ],
    };
    const out = migrate(doc);
    const links = allTasks(out.production).flatMap((r) => (r.task.after ?? []).map((p) => `${r.task.id}<${p}`));
    expect(links).toEqual(['b<a']);
    expect(task(out, 'a').start).toBe('2027-01-01');
    const moved = produce(out, (d) => setTaskDates(d, 'a', '2027-01-02', '2027-01-06'));
    expect(dates(moved, 'b')).toEqual(['2027-01-07', '2027-01-09']);
    // Boucle laissée telle quelle (sans relecture) : la cascade s'arrête vite.
    const raw = blank();
    raw.production = structuredClone(doc.production);
    raw.production!.phases[0].tasks[0].start = '2027-01-01';
    const pushed = produce(raw, (d) => setTaskDates(d, 'a', '2027-01-02', '2027-01-06'));
    expect(task(pushed, 'a').start < '2028-01-01').toBe(true);
    expect(task(pushed, 'b').start < '2028-01-01').toBe(true);
  });

  it('relit une seule étape liée, jamais un jalon, et des identifiants uniques', () => {
    const doc = withShooting(buildRav3(), '2027-06-01', '2027-06-03');
    const broken = {
      ...doc,
      production: {
        phases: [
          {
            id: 'p',
            name: 'P',
            tasks: [
              { id: 'm', name: 'Jalon', start: '2027-01-01', end: '2027-01-01', milestone: true, linked: 'schedule' },
              { id: 's1', name: 'Tournage', start: '2027-02-01', end: '2027-02-10', linked: 'schedule', planned: 10 },
              { id: 's2', name: 'Autre', start: '2027-03-01', end: '2027-03-10', linked: 'schedule', planned: 10 },
              { id: 's1', name: 'Double', start: '2027-04-01', end: '2027-04-02' },
              { id: 'z', name: 'Z', start: '2027-04-01', end: '2027-04-02', linked: 'autre' },
            ],
          },
        ],
      } as unknown as Production,
    };
    const out = migrate(broken);
    const tasks = out.production!.phases[0].tasks;
    expect(tasks.map((t) => t.name)).toEqual(['Jalon', 'Tournage', 'Autre', 'Double', 'Z']);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(5);
    expect(tasks[1].id).toBe('s1');
    expect(tasks.filter((t) => t.linked).map((t) => t.id)).toEqual(['s1']);
    expect(tasks.find((t) => t.id === 's2')!.planned).toBeUndefined();
    expect(dates(out, 's1')[0]).toBe('2027-06-01');
  });

  it('refuse une date hors de la frise et plafonne la durée', () => {
    const doc = chain();
    expect(dates(produce(doc, (d) => setTaskDates(d, 'a', '2027-01-04', '2207-05-21')), 'a')).toEqual(['2027-01-04', '2027-01-08']);
    expect(dates(produce(doc, (d) => setTaskDates(d, 'a', '1901-01-01', '2027-01-08')), 'a')).toEqual(['2027-01-04', '2027-01-08']);
    const long = produce(doc, (d) => setDuration(d, 'a', 200_000));
    expect(durationDays(task(long, 'a'))).toBe(3650);
  });
});
