import { describe, expect, it } from 'vitest';
import { documentTitle } from './documentTitle';

describe('documentTitle', () => {
  it('nomme le projet et la page', () => {
    expect(documentTitle('scenario', 'La Consigne')).toBe('La Consigne — Scénario');
    expect(documentTitle('grid', 'La Consigne')).toBe('La Consigne — Découpage technique');
    expect(documentTitle('settings', 'La Consigne')).toBe('La Consigne — Paramètres');
    expect(documentTitle('print', 'La Consigne')).toBe('La Consigne — Découpage');
  });
  it('garde le nom de l’application à l’accueil et sans projet', () => {
    expect(documentTitle('home', 'La Consigne')).toBe('Découpage Studio');
    expect(documentTitle('grid', undefined)).toBe('Découpage Studio');
    expect(documentTitle('join', 'La Consigne')).toBe('Découpage Studio');
  });
});
