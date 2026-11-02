import { describe, expect, it } from 'vitest';
import { comboFromEvent, conflictOf, DEFAULT_SHORTCUTS, formatCombo, isReserved, matchesCombo, resolveShortcuts } from './shortcuts';

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
});
