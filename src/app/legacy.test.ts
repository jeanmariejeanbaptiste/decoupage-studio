import { describe, expect, it } from 'vitest';
import { legacyHash } from './legacy';

describe('anciennes adresses', () => {
  it('le registre mène au découpage, sans son onglet, avec les autres paramètres', () => {
    expect(legacyHash('#/registry')).toBe('#/grid');
    expect(legacyHash('#registry')).toBe('#/grid');
    expect(legacyHash('#/registry?tab=characters')).toBe('#/grid');
    expect(legacyHash('#/registry?seed=rav3&tab=shots')).toBe('#/grid?seed=rav3');
  });
  it('les autres adresses ne changent pas', () => {
    for (const h of ['', '#/', '#/grid', '#/registryx', '#/scenario?x=registry']) expect(legacyHash(h)).toBeNull();
  });
});
