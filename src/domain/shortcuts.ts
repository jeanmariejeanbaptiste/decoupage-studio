/**
 * Raccourcis clavier personnalisables. Une combinaison s'écrit « Mod+Shift+Enter » : Mod vaut ⌘ sur
 * Mac et Ctrl ailleurs, les lettres et chiffres d'après la lettre de la touche (AZERTY compris),
 * les autres touches d'après leur nom (Enter, ArrowUp, Backspace…).
 */

export type ShortcutId =
  | 'save'
  | 'palette'
  | 'help'
  | 'undo'
  | 'redo'
  | 'newShot'
  | 'newSequence'
  | 'duplicate'
  | 'deleteShot'
  | 'fillDown'
  | 'moveShotUp'
  | 'moveShotDown'
  | 'moveSequenceUp'
  | 'moveSequenceDown';

export interface ShortcutDef {
  id: ShortcutId;
  group: 'Général' | 'Découpage';
  label: string;
  combo: string;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'save', group: 'Général', label: 'Enregistrer le fichier', combo: 'Mod+S' },
  { id: 'palette', group: 'Général', label: 'Palette de commandes', combo: 'Mod+K' },
  { id: 'help', group: 'Général', label: 'Aide des raccourcis', combo: '?' },
  { id: 'undo', group: 'Général', label: 'Annuler', combo: 'Mod+Z' },
  { id: 'redo', group: 'Général', label: 'Rétablir', combo: 'Mod+Shift+Z' },
  { id: 'newShot', group: 'Découpage', label: 'Nouveau plan', combo: 'Mod+Enter' },
  { id: 'newSequence', group: 'Découpage', label: 'Nouvelle séquence', combo: 'Mod+Shift+Enter' },
  { id: 'duplicate', group: 'Découpage', label: 'Dupliquer le plan', combo: 'Mod+D' },
  { id: 'deleteShot', group: 'Découpage', label: 'Supprimer le plan', combo: 'Mod+Backspace' },
  { id: 'fillDown', group: 'Découpage', label: 'Recopier vers le bas', combo: 'Mod+Shift+ArrowDown' },
  { id: 'moveShotUp', group: 'Découpage', label: 'Monter le plan', combo: 'Alt+ArrowUp' },
  { id: 'moveShotDown', group: 'Découpage', label: 'Descendre le plan', combo: 'Alt+ArrowDown' },
  { id: 'moveSequenceUp', group: 'Découpage', label: 'Monter la séquence', combo: 'Alt+Shift+ArrowUp' },
  { id: 'moveSequenceDown', group: 'Découpage', label: 'Descendre la séquence', combo: 'Alt+Shift+ArrowDown' },
];

export type ShortcutMap = Record<ShortcutId, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = Object.fromEntries(SHORTCUTS.map((d) => [d.id, d.combo])) as ShortcutMap;

/** Applique les personnalisations valides par-dessus les raccourcis par défaut. */
export function resolveShortcuts(overrides: Partial<Record<string, string>> | null | undefined): ShortcutMap {
  const out = { ...DEFAULT_SHORTCUTS };
  for (const d of SHORTCUTS) {
    const v = overrides?.[d.id];
    if (typeof v === 'string' && v) out[d.id] = v;
  }
  return out;
}

const MODIFIERS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'OS', 'Fn']);

export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Combinaison d'un évènement clavier ; null pour une touche de modification seule. */
export function comboFromEvent(e: KeyLike): string | null {
  if (MODIFIERS.has(e.key)) return null;
  const mod = e.metaKey || e.ctrlKey;
  let key = e.key;
  // La lettre affichée sur la touche fait foi (AZERTY : ⌘Z est bien ⌘Z). La position physique ne
  // sert que lorsque ⌥ ou ⇧ transforment la touche en un autre signe (⌥D → « ∂ », ⇧1 → « 1 » / « ! »).
  const phys = /^Key([A-Z])$/.exec(e.code ?? '') ?? /^Digit(\d)$/.exec(e.code ?? '');
  if (/^[a-z0-9]$/i.test(key)) key = key.toUpperCase();
  else if (phys && (mod || e.altKey)) key = phys[1];
  else if (key.length === 1) {
    key = key.toUpperCase();
    // Signe tapé seul (« ? », « / »…) : ⇧ fait partie du caractère, on ne l'exige pas.
    if (!mod && !e.altKey && !/[A-Z0-9]/.test(key)) return key === ' ' ? 'Space' : key;
  }
  if (key === ' ') key = 'Space';
  const parts: string[] = [];
  if (mod) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function matchesCombo(e: KeyLike, combo: string): boolean {
  return comboFromEvent(e) === combo;
}

const KEY_GLYPH: Record<string, string> = {
  Enter: '↵',
  Backspace: '⌫',
  Delete: '⌦',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Échap',
  Tab: '⇥',
  Space: 'Espace',
};

/** Affichage compact : « Mod+Shift+Enter » → « ⌘⇧↵ ». */
export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((p) => (p === 'Mod' ? '⌘' : p === 'Shift' ? '⇧' : p === 'Alt' ? '⌥' : (KEY_GLYPH[p] ?? p)))
    .join('');
}

/** Action déjà associée à cette combinaison, hors celle qu'on modifie. */
export function conflictOf(map: ShortcutMap, id: ShortcutId, combo: string): ShortcutDef | undefined {
  return SHORTCUTS.find((d) => d.id !== id && map[d.id] === combo);
}

/** Combinaisons qu'on ne peut pas réattribuer : elles servent à la saisie dans la grille. */
export function isReserved(combo: string): boolean {
  return /^(Shift\+)?(Arrow(Up|Down|Left|Right)|Tab|Enter|Escape|Backspace|Delete|F2)$/.test(combo) || /^(Shift\+)?[A-Z0-9]$/.test(combo) || /^Mod\+[CVX]$/.test(combo);
}
