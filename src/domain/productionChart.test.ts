import { describe, expect, it } from 'vitest';
import { barGeometry, chartRange, dependencyLinks, ganttRows, monthLabel, nextZoom, productionSvgPages, timeScale } from './productionChart';
import type { Production } from './production';

const plan: Production = {
  phases: [
    {
      id: 'p1',
      name: 'Préparation',
      tasks: [
        { id: 'a', name: 'Repérages', start: '2027-01-04', end: '2027-01-08' },
        { id: 'm', name: 'Fin', start: '2027-01-08', end: '2027-01-08', milestone: true, after: ['a'] },
      ],
    },
    { id: 'p2', name: 'Tournage', tasks: [{ id: 'b', name: 'Tournage', start: '2027-01-09', end: '2027-01-20', after: ['m'], done: true }] },
  ],
};

describe('frise du calendrier de production', () => {
  it('passe d’un zoom à l’autre sans dépasser les bornes', () => {
    expect(nextZoom('months', 1)).toBe('weeks');
    expect(nextZoom('weeks', 1)).toBe('weeks');
    expect(nextZoom('months', -1)).toBe('quarters');
    expect(nextZoom('quarters', -1)).toBe('quarters');
  });

  it('couvre tout le calendrier et aujourd’hui, en mois entiers', () => {
    expect(chartRange(plan, '2027-01-10', 14)).toEqual({ from: '2026-12-01', to: '2027-02-28' });
    expect(chartRange(plan, '2026-10-15', 14)).toEqual({ from: '2026-10-01', to: '2027-02-28' });
    expect(chartRange(undefined, '2026-11-09', 30)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('découpe l’échelle en années, mois et semaines ISO', () => {
    const sc = timeScale('2026-12-01', '2027-01-31', 10);
    expect(sc.days).toBe(62);
    expect(sc.width).toBe(620);
    expect(sc.years.map((y) => [y.label, y.x, y.w])).toEqual([
      ['2026', 0, 310],
      ['2027', 310, 310],
    ]);
    expect(sc.months.map((m) => m.label)).toEqual(['décembre', 'janvier']);
    // Première semaine rognée au 1er décembre (un mardi) : S49.
    expect(sc.weeks[0]).toMatchObject({ label: 'S49', x: 0, w: 60 });
    expect(sc.weeks[5]).toMatchObject({ label: 'S1', x: 340, w: 70 });
    expect(monthLabel('2027-02-01', 40)).toBe('févr.');
    expect(monthLabel('2027-02-01', 12)).toBe('F');
    expect(timeScale('2027-01-04', '2027-03-28', 2).weeks.map((w) => w.label).slice(0, 4)).toEqual(['1', '', '3', '']);
  });

  it('place barres et jalons, et trace les dépendances en coude', () => {
    const sc = { from: '2027-01-01', dayWidth: 10 };
    expect(barGeometry(sc, plan.phases[0].tasks[0])).toEqual({ x: 30, w: 50 });
    expect(barGeometry(sc, plan.phases[0].tasks[1])).toEqual({ x: 75, w: 0 });
    const rows = ganttRows(plan);
    expect(rows.map((r) => (r.type === 'phase' ? r.phase.name : r.task.id))).toEqual(['Préparation', 'a', 'm', 'Tournage', 'b']);
    expect(ganttRows(plan, new Set(['p1'])).map((r) => r.type)).toEqual(['phase', 'phase', 'task']);
    const links = dependencyLinks(rows, sc, 30);
    expect(links.map((l) => l.key)).toEqual(['a>m', 'm>b']);
    // Le jalon colle à la fin de A : la flèche fait un détour.
    expect(links[0].path).toBe('M80,45 H86 V60 H61 V75 H69');
    expect(links.every((l) => !l.late)).toBe(true);
    // Phase repliée : pas de flèche vers des lignes cachées.
    expect(dependencyLinks(ganttRows(plan, new Set(['p2'])), sc, 30).map((l) => l.key)).toEqual(['a>m']);
  });

  it('rend des pages imprimables sans couleur', () => {
    const pages = productionSvgPages(plan, '2027-01-10', { rowsPerPage: 3 });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Repérages');
    expect(pages[0]).toContain('04/01/2027');
    expect(pages[1]).toContain('text-decoration="line-through"');
    for (const svg of pages) for (const c of svg.match(/#[0-9a-f]{6}/gi) ?? []) expect(c.slice(1, 3) === c.slice(3, 5) || Math.abs(parseInt(c.slice(1, 3), 16) - parseInt(c.slice(5, 7), 16)) < 20).toBe(true);
    expect(productionSvgPages({ phases: [] }, '2027-01-10')).toEqual([]);
  });
});
