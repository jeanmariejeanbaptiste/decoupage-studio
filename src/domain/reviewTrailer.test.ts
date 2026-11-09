import { describe, expect, it } from 'vitest';
import { cleanRef, decodeComment, driveKey, driveRefOf, encodeComment } from './reviewTrailer';

describe('traîne ds:1 des commentaires Drive', () => {
  it('une phrase lisible, puis la traîne ; aller-retour sans perte', () => {
    const payload = { i: 'abc123', v: 'v1', a: { kind: 'shot' as const, shotId: 's1', col: 'value' as const } };
    const content = encodeComment('Plutôt un plan large ?\nOu un ensemble.', payload);
    expect(content.startsWith('Plutôt un plan large ?\nOu un ensemble.\n\nds:1 {')).toBe(true);
    expect(content.split('\n').at(-1)).toMatch(/^ds:1 \{[^\n]+\}$/);
    expect(decodeComment(content)).toEqual({ text: 'Plutôt un plan large ?\nOu un ensemble.', payload });
  });

  it('texte vide : une phrase de repère, rendue vide au décodage', () => {
    const content = encodeComment('  ', { m: { surface: 'cut', paths: ['M0 0 L10 10'] } });
    expect(content.startsWith('Tracés sur la page.')).toBe(true);
    const d = decodeComment(content);
    expect(d.text).toBe('');
    expect(d.payload?.m?.paths).toEqual(['M0 0 L10 10']);
    expect(encodeComment('', { f: [{ id: 'file123456' }] }).startsWith('Image jointe.')).toBe(true);
  });

  it('sans traîne, ou traîne illisible : le texte seul', () => {
    expect(decodeComment('Écrit dans Drive')).toEqual({ text: 'Écrit dans Drive', payload: null });
    expect(decodeComment('Texte\n\nds:1 {pas du json')).toEqual({ text: 'Texte\n\nds:1 {pas du json', payload: null });
    expect(decodeComment('Texte\n\nds:1 [1,2]').payload).toBeNull();
    // Le mot « ds:1 » au milieu d'une ligne n'est pas une traîne.
    expect(decodeComment('voir ds:1 {"a":1}').payload).toBeNull();
    expect(decodeComment('ds:1 {"e":1}')).toEqual({ text: '', payload: { e: 1 } });
  });

  it('clés locales des images jointes depuis Drive', () => {
    expect(driveKey({ id: 'abcdef123', rk: '0-xyz123' })).toBe('drive:abcdef123~0-xyz123');
    expect(driveRefOf('drive:abcdef123~0-xyz123')).toEqual({ id: 'abcdef123', rk: '0-xyz123' });
    expect(driveRefOf('drive:abcdef123')).toEqual({ id: 'abcdef123' });
    expect(driveRefOf('p1:uuid')).toBeNull();
    expect(driveRefOf('drive:../../x')).toBeNull();
    expect(cleanRef({ id: 'abc/../def' })).toBeNull();
    expect(cleanRef({ id: 'abcdef123', rk: 'bad key' })).toEqual({ id: 'abcdef123' });
  });
});
