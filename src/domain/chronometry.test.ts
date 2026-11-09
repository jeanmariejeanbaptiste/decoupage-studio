import { describe, expect, it } from 'vitest';
import { blockSeconds, chronoAt, chronoOf, printedText } from './chronometry';
import type { SBlock } from './screenplay';

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
