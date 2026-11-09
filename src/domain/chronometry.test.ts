import { describe, expect, it } from 'vitest';
import { blockSeconds, chronoAt, chronoOf, chronoTimeline, printedText } from './chronometry';
import { blocksFromSource, type SBlock } from './screenplay';
import { layoutScript, scriptOutline } from './scriptLayout';
import { sceneReports } from './scriptReports';

const B = (type: SBlock['type'], text: string, id = Math.random().toString(36)): SBlock => ({ id, type, text });

describe('minutage du scénario (méthodes de KIT)', () => {
  const blocks = [B('heading', 'INT. GARE - JOUR', 'h'), B('action', 'A'.repeat(100), 'a'), B('character', 'LÉA'), B('dialogue', 'B'.repeat(50), 'd'), B('note', 'jamais compté')];

  it('par pages : les lignes sur 58, à N secondes la page', () => {
    const s = blockSeconds(blocks, chronoOf({ pageSec: 58 }));
    expect(s[0]).toBeCloseTo(1);
    expect(s[4]).toBe(0);
    expect(s.reduce((a, b) => a + b, 0)).toBeGreaterThan(5);
  });

  it('par caractères : 1000 caractères valent 60 s, espaces exclues par défaut', () => {
    const c = chronoOf({ method: 'characters' });
    expect(blockSeconds([B('action', 'x'.repeat(500))], c)[0]).toBeCloseTo(30);
    expect(blockSeconds([B('action', 'ab cd')], c)[0]).toBeCloseTo(0.24);
    expect(blockSeconds([B('action', 'ab cd')], chronoOf({ method: 'characters', spaces: true }))[0]).toBeCloseTo(0.3);
  });

  it('par type : forfait + tranches de 50 caractères ; personnage, didascalie, transition à zéro', () => {
    const s = blockSeconds(blocks, chronoOf({ method: 'configurable' }));
    expect(s[0]).toBeCloseTo(2);
    expect(s[1]).toBeCloseTo(1 + 2 * 1.5);
    expect(s[2]).toBe(0);
    expect(s[3]).toBeCloseTo(2 + 2.4);
  });

  it('les marques d’emphase et de surlignage ne comptent pas', () => {
    expect(printedText('**gras** et [[=jaune]]jaune[[=]]')).toBe('gras et jaune');
    const c = chronoOf({ method: 'characters', spaces: true });
    expect(blockSeconds([B('action', '**ab**')], c)[0]).toBeCloseTo(blockSeconds([B('action', 'ab')], c)[0]);
  });

  it('au curseur : somme des blocs précédents et part du bloc courant', () => {
    const c = chronoOf({ method: 'configurable' });
    const r = chronoAt(blocks, c, { id: 'a', offset: 50 });
    expect(r.total).toBe(Math.round(2 + 4 + 4.4));
    expect(r.at).toBe(Math.round(2 + 4 / 2));
  });
});

describe('minutage sur la mise en page imprimée', () => {
  // 30 séquences, chacune avec une note qui ne s'imprime pas, après une ouverture.
  const scene = (k: number, note: boolean) =>
    `INT. LIEU ${k} - JOUR\n\n${note ? `[[${'Une note de travail assez longue pour tenir plusieurs lignes à l’écran. '.repeat(4)}]]\n\n` : ''}${'Une action qui occupe quelques lignes de la page imprimée, sans rien de particulier. '.repeat(3)}\n\nLÉA\nUne réplique.\n\n`;
  const src = (note: boolean) => `> FONDU D’OUVERTURE :\n\nUne ouverture avant la première séquence.\n\n${Array.from({ length: 30 }, (_, k) => scene(k + 1, note)).join('')}`;
  const plain = blocksFromSource(src(false)).blocks;
  const noted = blocksFromSource(src(true)).blocks;

  it('par pages : les notes ne changent ni la durée, ni les pages, ni la page des séquences', () => {
    expect(noted.some((b) => b.type === 'note')).toBe(true);
    const c = chronoOf({});
    const t = chronoTimeline(noted, c);
    expect(t.total).toBeCloseTo(chronoTimeline(plain, c).total);
    const pages = layoutScript(noted).pages;
    expect(pages.length).toBeGreaterThan(5);
    // Durée : les pages pleines, puis la part de la dernière.
    const last = pages[pages.length - 1].lines;
    expect(t.total).toBeCloseTo((pages.length - 1 + (last[last.length - 1].row + 1) / 58) * 60);
    const o = scriptOutline(noted);
    expect(o.pages).toBe(pages.length);
    expect(o.items.map((x) => x.page)).toEqual(scriptOutline(plain).items.map((x) => x.page));
    expect(o.items[29]).toMatchObject({ n: 30, page: pages.length });
  });

  it('au curseur : la ligne imprimée qui le contient ; les parts des blocs font le total', () => {
    const c = chronoOf({});
    const t = chronoTimeline(noted, c);
    expect(t.secs.reduce((a, b) => a + b, 0)).toBeCloseTo(t.total);
    expect(t.secs[noted.findIndex((b) => b.type === 'note')]).toBe(0);
    const i = noted.findIndex((b) => b.type === 'action' && b.text.startsWith('Une action'));
    const action = noted[i];
    expect(t.at({ id: action.id, offset: 0 })).toBeCloseTo(t.start[i]);
    expect(t.at({ id: action.id, offset: action.text.length })!).toBeGreaterThan(t.start[i]);
    expect(t.at({ id: 'absent', offset: 0 })).toBeNull();
    expect(t.at(null)).toBeNull();
    expect(chronoTimeline([], c).total).toBe(0);
  });

  it('les séquences des rapports et la durée totale concordent, ouverture comprise', () => {
    for (const method of ['pages', 'characters', 'configurable'] as const) {
      const c = chronoOf({ method });
      const t = chronoTimeline(noted, c);
      const scenes = sceneReports(noted, [], c);
      const opening = t.start[noted.findIndex((b) => b.type === 'heading')];
      expect(opening).toBeGreaterThan(0);
      expect(opening + scenes.reduce((n, sc) => n + sc.durationSec, 0)).toBeCloseTo(t.total);
    }
  });
});
