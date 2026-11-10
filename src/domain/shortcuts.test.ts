import { describe, expect, it } from 'vitest';
import { comboFromEvent, conflictOf, DEFAULT_SHORTCUTS, formatCombo, isBrowserReserved, isReserved, matchesCombo, resolveShortcuts } from './shortcuts';

const ev = (key: string, o: Partial<{ code: string; meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key,
  code: o.code,
  metaKey: !!o.meta,
  ctrlKey: !!o.ctrl,
  shiftKey: !!o.shift,
  altKey: !!o.alt,
});

describe('raccourcis', () => {
  it('lit la combinaison d’un évènement', () => {
    expect(comboFromEvent(ev('z', { code: 'KeyZ', meta: true }))).toBe('Mod+Z');
    expect(comboFromEvent(ev('Z', { code: 'KeyZ', ctrl: true, shift: true }))).toBe('Mod+Shift+Z');
    expect(comboFromEvent(ev('∂', { code: 'KeyD', alt: true }))).toBe('Alt+D');
    expect(comboFromEvent(ev('Enter', { code: 'Enter', meta: true, shift: true }))).toBe('Mod+Shift+Enter');
    expect(comboFromEvent(ev('ArrowUp', { alt: true }))).toBe('Alt+ArrowUp');
    expect(comboFromEvent(ev('?', { code: 'Comma', shift: true }))).toBe('?');
    expect(comboFromEvent(ev('Shift', { shift: true }))).toBeNull();
    // AZERTY : la touche marquée Z est à la place du W d'un clavier QWERTY.
    expect(comboFromEvent(ev('z', { code: 'KeyW', meta: true }))).toBe('Mod+Z');
    expect(comboFromEvent(ev('&', { code: 'Digit1', ctrl: true }))).toBe('Mod+1');
  });

  it('reconnaît les raccourcis par défaut', () => {
    expect(matchesCombo(ev('s', { code: 'KeyS', ctrl: true }), DEFAULT_SHORTCUTS.save)).toBe(true);
    expect(matchesCombo(ev('s', { code: 'KeyS', ctrl: true, shift: true }), DEFAULT_SHORTCUTS.save)).toBe(false);
  });

  it('affiche en symboles', () => {
    expect(formatCombo('Mod+Shift+Enter')).toBe('⌘⇧↵');
    expect(formatCombo('Alt+Shift+ArrowUp')).toBe('⌥⇧↑');
    expect(formatCombo('?')).toBe('?');
  });

  it('fusionne les personnalisations et repère les conflits', () => {
    const m = resolveShortcuts({ duplicate: 'Mod+J', unknown: 'Mod+Q' } as Record<string, string>);
    expect(m.duplicate).toBe('Mod+J');
    expect(m.save).toBe('Mod+S');
    expect(conflictOf(m, 'newShot', 'Mod+J')?.id).toBe('duplicate');
    expect(conflictOf(m, 'duplicate', 'Mod+J')).toBeUndefined();
  });

  it('réserve les touches de saisie', () => {
    expect(isReserved('ArrowUp')).toBe(true);
    expect(isReserved('A')).toBe(true);
    expect(isReserved('Mod+C')).toBe(true);
    expect(isReserved('Mod+J')).toBe(false);
    expect(isReserved('Alt+ArrowUp')).toBe(false);
  });

  it('refuse les combinaisons gardées par le navigateur', () => {
    for (const c of ['Mod+W', 'Mod+T', 'Mod+N', 'Mod+Q', 'Mod+L', 'Mod+R', 'Mod+Shift+T', 'Mod+Shift+N', 'Mod+Shift+W', 'Mod+Tab']) expect(isBrowserReserved(c)).toBe(true);
    for (const c of ['Mod+D', 'Mod+Shift+D', 'Alt+W', 'W', 'Mod+Enter']) expect(isBrowserReserved(c)).toBe(false);
  });
});

describe('type de paragraphe du scénario au clavier', () => {
  it('Mac : ⌃ + chiffre ; ⌥ + chiffre reste libre pour taper « » ’ [ {', async () => {
    const { blockTypeDigit, blockTypeKey } = await import('./shortcuts');
    const key = (code: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>>) => ({ key: '', code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
    expect(blockTypeDigit(key('Digit7', { altKey: true }), true)).toBeNull();
    expect(blockTypeDigit(key('Digit3', { ctrlKey: true }), true)).toBe(3);
    expect(blockTypeDigit(key('Digit3', { altKey: true }), false)).toBe(3);
    expect(blockTypeDigit(key('Digit3', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(blockTypeDigit(key('Digit9', { ctrlKey: true }), true)).toBeNull();
    expect(blockTypeKey(2, true)).toBe('⌃2');
    expect(blockTypeKey(2, false)).toBe('Alt+2');
  });
});
