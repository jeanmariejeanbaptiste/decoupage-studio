import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent as RClipboardEvent, type KeyboardEvent as RKeyboardEvent } from 'react';
import { create } from 'zustand';
import { createPortal } from 'react-dom';
import {
  BLOCK_LABELS,
  EFFECT_WORDS,
  HEADING_PREFIXES,
  blockLabel,
  blocksFromSource,
  caretToSource,
  cycleType,
  headingNumbers,
  insertBlockAfter,
  insertText,
  isEmptyBlock,
  locationsOf,
  mergeWithNext,
  mergeWithPrevious,
  parseTitlePage,
  rangeText,
  replaceRange,
  serialize,
  setBlockText,
  setBlockType,
  removeBlocks,
  setTitlePage,
  sourceToCaret,
  speakersOf,
  splitBlock,
  type BlockType,
  type Caret,
  type Edit,
  type SBlock,
  type ScriptDoc,
  type Span,
  TITLE_FIELDS,
} from '../../domain/screenplay';
import { titleFromBlocks } from '../../domain/scenarioImport';
import { SCRIPT_COLUMNS, SCRIPT_PAGE, emphasisRuns, paginateItems, plainText, scriptOutline, setHighlight, titlePageLines, type HighlightColor, type OutlineItem } from '../../domain/scriptLayout';
import { blockTypeDigit } from '../../domain/shortcuts';
import { fold } from '../../domain/text';
import type { ID, ProjectDoc } from '../../domain/types';
import { undo as appUndo, redo as appRedo } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import m from '../../ui/Modal.module.css';
import { commitScenario } from './ScriptReader';
import s from './ScriptEditor.module.css';

/**
 * Géométrie de la page à l'écran : celle du modèle imprimé (A4, Courier Prime 12 pt, interligne
 * 12,1 pt, 58 lignes), convertie en pixels CSS (96 par pouce). L'écran montre les pages de l'export.
 */
/**
 * Un point vaut un peu moins de 4/3 de pixel : une ligne (12,1 pt) fait alors 16 pixels tout rond.
 * Hauteurs entières : les positions ne dérivent pas d'une page à l'autre, même sur un long scénario.
 */
const LINE = 16;
const PT = LINE / SCRIPT_PAGE.lineH;
/** Du haut d'une ligne à sa ligne de base : demi-interligne (négatif) plus le jambage haut de Courier Prime. */
const BASELINE_IN_LINE = (SCRIPT_PAGE.lineH - (2300 / 2048) * SCRIPT_PAGE.fontSize) / 2 + (1600 / 2048) * SCRIPT_PAGE.fontSize;
const PAGE_H = Math.round(SCRIPT_PAGE.h * PT);
const TOP = Math.round((SCRIPT_PAGE.firstBaseline - BASELINE_IN_LINE) * PT);
export const PAGE = {
  w: Math.round(SCRIPT_PAGE.w * PT),
  h: PAGE_H,
  top: TOP,
  bottom: PAGE_H - TOP - SCRIPT_PAGE.lines * LINE,
  left: SCRIPT_COLUMNS.action.x * PT,
  right: (SCRIPT_PAGE.w - SCRIPT_PAGE.right) * PT,
  gap: 28,
};
const COMMIT_DELAY = 700;

/** Ce que le scénario imprimé ignore prend tout de même sa place à l'écran, comme une action. */
const pageType = (t: BlockType): BlockType => (t === 'note' || t === 'section' || t === 'synopsis' ? 'action' : t);

interface EditorLayout {
  margins: Record<string, number>;
  /** Feuille de chaque bloc (0 = la première, page de titre comprise). */
  pageOf: Record<string, number>;
  /** Feuilles à l'écran, page de titre comprise. */
  pages: number;
  /** 1 s'il y a une page de titre (elle n'est ni numérotée ni comptée, comme à l'impression). */
  offset: number;
}

/**
 * Pagination de l'éditeur : les règles de l'export (`paginateItems`), appliquées aux hauteurs
 * mesurées des blocs. Chaque bloc reçoit l'espace au-dessus de lui, saut de page compris.
 */
function editorLayout(items: ReadonlyArray<{ id: string; type: BlockType; h: number }>): EditorLayout {
  const margins: Record<string, number> = {};
  const pageOf: Record<string, number> = {};
  const title = items[0]?.type === 'title' ? items[0] : undefined;
  const rest = title ? items.slice(1) : items;
  const offset = title ? 1 : 0;
  if (title) {
    margins[title.id] = 0;
    pageOf[title.id] = 0;
  }
  // Lignes occupées : arrondi au-dessus (un caractère d'une police de secours peut grandir une ligne de
  // quelques pixels) ; la position du bloc suivant part de la hauteur réelle, jamais d'une hauteur supposée.
  const lines = (h: number) => Math.max(1, Math.ceil((h - 0.5) / LINE));
  // Hauteur réelle, saut de page compris (son filet mesure un pixel).
  const height = (it: { type: BlockType; h: number }) => it.h;
  const { at, pages } = paginateItems(rest.map((it) => ({ id: it.id, type: pageType(it.type), lines: it.type === 'pagebreak' ? 0 : lines(it.h) })));
  const yOf = (p: { page: number; row: number }) => (p.page + offset) * (PAGE.h + PAGE.gap) + p.row * LINE;
  // Bas du bloc précédent, dans le repère du texte (sans la marge haute de la première page).
  let bottom = title ? SCRIPT_PAGE.lines * LINE : 0;
  for (const it of rest) {
    const p = at.get(it.id) ?? { page: 0, row: 0 };
    pageOf[it.id] = p.page + offset;
    const y = yOf(p);
    margins[it.id] = Math.max(0, y - bottom);
    bottom = y + height(it);
  }
  return { margins, pageOf, pages: pages + offset, offset };
}

// --- État partagé avec la barre d'outils et le panneau latéral -------------------------------

export type { OutlineItem };

interface ScriptUi {
  /** Bloc et position du curseur (minutage). */
  caret: { id: string; offset: number } | null;
  activeType: BlockType | null;
  /** Sélection dans la source (pour « Créer un plan »). */
  selection: { start: number; end: number } | null;
  outline: OutlineItem[];
  pages: number;
  activeHeading: string | null;
  blocks: readonly SBlock[];
}

export const useScriptUi = create<ScriptUi>(() => ({ caret: null, activeType: null, selection: null, outline: [], pages: 1, activeHeading: null, blocks: [] }));

export interface ScriptEditorApi {
  flush: () => void;
  setType: (t: BlockType) => void;
  scrollTo: (blockId: string) => void;
  focus: () => void;
  /** Position dans la source d'un point du texte (pour placer un menu). */
  selectionRect: () => DOMRect | null;
  /** Ouvre la page de titre (créée si besoin). */
  editTitle: () => void;
  /** Montre un passage (positions dans la source) et renvoie sa place à l'écran. */
  revealSource: (start: number, end: number) => DOMRect | null;
  /** Gras (« ** »), italique (« * ») ou souligné (« _ ») sur la sélection, ou le mot sous le curseur. */
  emphasis: (mark: '**' | '*' | '_') => void;
  /** Surlignage de révision de la sélection (ou du mot) ; `undefined` le retire. */
  highlight: (color: HighlightColor | undefined) => void;
}

// --- Lecture et écriture du DOM ----------------------------------------------------------------

const lengthOf = (n: Node): number => (n.nodeType === Node.TEXT_NODE ? (n.nodeValue ?? '').length : n.nodeName === 'BR' ? 1 : Array.from(n.childNodes).reduce((k, c) => k + lengthOf(c), 0));

function readText(el: HTMLElement): string {
  let out = '';
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) out += c.nodeValue ?? '';
      else if (c.nodeName === 'BR') out += '\n';
      else if (c.nodeType === Node.ELEMENT_NODE) {
        if (/^(DIV|P)$/.test(c.nodeName) && out && !out.endsWith('\n')) out += '\n';
        walk(c);
      }
    }
  };
  walk(el);
  return out.replace(/\n$/, '').replace(/\u00a0/g, ' ');
}

function writeText(el: HTMLElement, text: string) {
  // Emphase Fountain affichée en place : marques gardées dans le texte (invisibles), le reste stylé.
  if (/[*_\\]|\[\[/.test(text)) {
    el.textContent = '';
    for (const r of emphasisRuns(text)) {
      if (!r.mark && !r.bold && !r.italic && !r.underline && !r.highlight) {
        el.appendChild(document.createTextNode(r.text));
        continue;
      }
      const span = document.createElement('span');
      span.textContent = r.text;
      if (r.mark) span.className = s.mk;
      else {
        if (r.bold) span.style.fontWeight = '700';
        if (r.italic) span.style.fontStyle = 'italic';
        if (r.underline) span.style.textDecoration = 'underline';
        if (r.highlight) span.className = s[`hl_${r.highlight}`] ?? '';
      }
      el.appendChild(span);
    }
  } else el.textContent = text;
  // Un bloc vide (ou qui finit par un retour) garde une ligne où poser le curseur.
  if (text === '' || text.endsWith('\n')) el.appendChild(document.createElement('br'));
}

const blockElOf = (node: Node | null): HTMLElement | null => {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>('[data-bid]') ?? null;
};

function offsetIn(el: HTMLElement, node: Node, offset: number): number {
  if (node === el || !el.contains(node)) {
    let k = 0;
    for (let i = 0; i < offset && i < el.childNodes.length; i++) k += lengthOf(el.childNodes[i]);
    return Math.min(k, readText(el).length);
  }
  let count = 0;
  let done = false;
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (done) return;
      if (c === node) {
        if (c.nodeType === Node.TEXT_NODE) count += offset;
        else for (let i = 0; i < offset && i < c.childNodes.length; i++) count += lengthOf(c.childNodes[i]);
        done = true;
        return;
      }
      if (c.contains(node) && c.nodeType === Node.ELEMENT_NODE) {
        walk(c);
        return;
      }
      count += lengthOf(c);
    }
  };
  walk(el);
  return Math.min(count, readText(el).length);
}

function pointAt(el: HTMLElement, offset: number): [Node, number] {
  let rem = offset;
  let lastText: Node | null = null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.nodeValue ?? '').length;
      if (rem <= len) return [n, rem];
      rem -= len;
      lastText = n;
    } else if (n.nodeName === 'BR') {
      const parent = n.parentNode!;
      const idx = Array.prototype.indexOf.call(parent.childNodes, n) as number;
      if (rem === 0) return [parent, idx];
      rem -= 1;
      if (rem === 0) return [parent, idx + 1];
    }
  }
  return lastText ? [lastText, (lastText.nodeValue ?? '').length] : [el, 0];
}

function caretFromPoint(root: HTMLElement, node: Node, offset: number, side: 'start' | 'end'): Caret | null {
  let el = blockElOf(node);
  let off: number;
  if (!el || !root.contains(el)) {
    // Point posé entre deux blocs (sélection de tout le texte, clic dans une marge).
    const kids = Array.from(root.querySelectorAll<HTMLElement>('[data-bid]'));
    if (!kids.length) return null;
    if (node === root) el = side === 'start' ? (kids[Math.min(offset, kids.length - 1)] ?? kids[0]) : (kids[Math.max(0, offset - 1)] ?? kids[kids.length - 1]);
    else el = side === 'start' ? kids[0] : kids[kids.length - 1];
    off = side === 'start' && node === root ? 0 : readText(el).length;
    if (side === 'start' && node !== root) off = 0;
    return { id: el.dataset.bid!, offset: off };
  }
  return { id: el.dataset.bid!, offset: offsetIn(el, node, offset) };
}

interface Sel {
  start: Caret;
  end: Caret;
  collapsed: boolean;
}

function readSelection(root: HTMLElement): Sel | null {
  const sl = window.getSelection();
  if (!sl || !sl.rangeCount) return null;
  const r = sl.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const start = caretFromPoint(root, r.startContainer, r.startOffset, 'start');
  const end = caretFromPoint(root, r.endContainer, r.endOffset, 'end');
  if (!start || !end) return null;
  return { start, end, collapsed: r.collapsed };
}

/**
 * Sélection qui finit au tout début d'un bloc suivant (triple clic, glissé jusqu'au bout de la ligne) :
 * elle s'arrête à la fin du bloc précédent. Effacer une réplique ne doit pas avaler le paragraphe d'après.
 */
function tidySelection(sel: Sel): Sel {
  if (sel.start.id === sel.end.id || sel.end.offset > 0) return sel;
  const el = document.querySelector<HTMLElement>(`[data-bid="${sel.end.id}"]`);
  const prev = el?.previousElementSibling as HTMLElement | null;
  if (!prev?.dataset.bid) return sel;
  const end = { id: prev.dataset.bid, offset: readText(prev).length };
  // Seul le saut de paragraphe était sélectionné : l'effacer joint bien les deux blocs.
  if (end.id === sel.start.id && end.offset <= sel.start.offset) return sel;
  return { start: sel.start, end, collapsed: false };
}

function placeCaret(root: HTMLElement, c: Caret, focus = true) {
  const el = root.querySelector<HTMLElement>(`[data-bid="${c.id}"]`);
  if (!el) return;
  const [node, off] = pointAt(el, c.offset);
  const sl = window.getSelection();
  if (!sl) return;
  if (focus && document.activeElement !== root) root.focus({ preventScroll: true });
  sl.collapse(node, off);
  // Le bloc reste visible (Entrée en bas d'écran, annuler…).
  const r = el.getBoundingClientRect();
  const scroller = root.closest<HTMLElement>('[data-scroll]') ?? document.scrollingElement;
  if (scroller && (r.bottom > window.innerHeight - 40 || r.top < 80)) el.scrollIntoView({ block: 'nearest' });
}

function domRange(root: HTMLElement, a: Caret, b: Caret): Range | null {
  const ea = root.querySelector<HTMLElement>(`[data-bid="${a.id}"]`);
  const eb = root.querySelector<HTMLElement>(`[data-bid="${b.id}"]`);
  if (!ea || !eb) return null;
  const r = document.createRange();
  const [na, oa] = pointAt(ea, a.offset);
  const [nb, ob] = pointAt(eb, b.offset);
  try {
    r.setStart(na, oa);
    r.setEnd(nb, ob);
  } catch {
    return null;
  }
  return r;
}

// --- Bloc ----------------------------------------------------------------------------------------

/** Éléments des blocs, tenus par React : de quoi remettre en place ce que le navigateur aurait retiré. */
type Register = (id: string, el: HTMLDivElement | null) => void;

const Block = memo(function Block({ b, mt, n, reg }: { b: SBlock; mt?: number; n?: number; reg: Register }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      reg(b.id, el);
    },
    [b.id, reg],
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Texte changé ailleurs, ou emphase tout juste fermée à la frappe : on redessine le bloc.
    const styled = el.querySelector('span') !== null;
    const wants = /[*_]|\[\[/.test(b.text) && emphasisRuns(b.text).some((r) => r.mark);
    if (readText(el) !== b.text || styled !== wants) {
      const sel = window.getSelection();
      const caret = sel && sel.rangeCount && el.contains(sel.anchorNode) ? offsetIn(el, sel.anchorNode!, sel.anchorOffset) : null;
      writeText(el, b.text);
      if (caret !== null && sel) {
        const [node, off] = pointAt(el, caret);
        sel.collapse(node, off);
      }
    }
  }, [b.text]);
  return <div ref={setRef} data-bid={b.id} data-type={b.type} data-n={n} data-empty={isEmptyBlock(b) || undefined} className={[s.b, s[`t_${b.type}`]].join(' ')} style={mt === undefined ? undefined : { marginTop: mt }} />;
});

/** Page de titre : celle de l'export, ligne pour ligne ; non modifiable dans le texte (un clic ouvre ses champs). */
const TitleBlock = memo(function TitleBlock({ b, mt, paged, onEdit, reg }: { b: SBlock; mt?: number; paged: boolean; onEdit?: () => void; reg: Register }) {
  const setRef = useCallback((el: HTMLDivElement | null) => reg(b.id, el), [b.id, reg]);
  const f = parseTitlePage(b.text);
  const lines = titlePageLines({ ...f, Title: f.Title || 'Sans titre' }, false);
  return (
    <div
      ref={setRef}
      data-bid={b.id}
      data-type="title"
      contentEditable={false}
      className={[s.b, s.t_title, onEdit ? s.titleEditable : ''].join(' ')}
      style={{ marginTop: mt, height: paged ? SCRIPT_PAGE.lines * LINE : undefined }}
      onClick={onEdit}
      title={onEdit ? 'Modifier la page de titre' : undefined}
      data-testid="title-page"
    >
      {lines.map((l, i) => (
        <span
          key={i}
          className={[s.tpLine, l.blockId === 'title:Title' ? s.tpTitle : '', l.align === 'center' ? s.tpCenter : ''].join(' ')}
          style={paged ? { top: l.row * LINE } : undefined}
        >
          {plainText(l.text)}
        </span>
      ))}
    </div>
  );
});

function TitleDialog({ initial, onSave, onClose }: { initial: Record<string, string>; onSave: (f: Record<string, string>) => void; onClose: () => void }) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(TITLE_FIELDS.map(([k]) => [k, initial[k] ?? ''])));
  return (
    <div className={m.backdrop} onMouseDown={onClose}>
      <form
        className={[m.modal, s.titleDialog].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label="Page de garde"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          // Les autres champs éventuels (Fountain) sont conservés.
          onSave({ ...initial, ...f });
        }}
      >
        <h2 className={m.title}>Page de garde</h2>
        <div className={s.tdBody}>
          <div className={s.tdFields}>
            {TITLE_FIELDS.map(([k, label], i) => (
              <label key={k} className={s.tdField}>
                <span>{label}</span>
                {k === 'Contact' ? (
                  <textarea rows={3} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                ) : (
                  <input value={f[k]} autoFocus={i === 0} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                )}
              </label>
            ))}
          </div>
          {/* La page telle qu'à l'impression : titre et crédits au centre, contact en bas à gauche, date en bas à droite. */}
          <div className={s.tdSheet} aria-hidden="true">
            <div className={s.tdCenter}>
              <p className={s.tdTitle}>{(f.Title || 'Sans titre').toLocaleUpperCase('fr')}</p>
              {f.Credit && <p>{f.Credit}</p>}
              {f.Author && <p>{f.Author}</p>}
              {f.Source && <p>{f.Source}</p>}
            </div>
            <p className={s.tdContact}>{f.Contact}</p>
            <p className={s.tdDate}>{f['Draft date']}</p>
          </div>
        </div>
        <div className={m.actions}>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" data-testid="title-save">
            Valider
          </Button>
        </div>
      </form>
    </div>
  );
}

// --- Autocomplétion ----------------------------------------------------------------------------

function suggestionsFor(b: SBlock | undefined, offset: number, blocks: readonly SBlock[], doc: ProjectDoc): string[] {
  if (!b || offset !== b.text.length) return [];
  const t = b.text;
  const f = fold(t);
  if (b.type === 'character') {
    if (!f) return [];
    const names = new Set<string>([...speakersOf(blocks), ...Object.values(doc.characters).map((c) => c.name.toLocaleUpperCase('fr'))]);
    return [...names].filter((n) => fold(n).startsWith(f) && fold(n) !== f).slice(0, 6);
  }
  if (b.type === 'heading') {
    const up = t.toLocaleUpperCase('fr');
    const prefix = /^(INT\.\/EXT\.|INT\.|EXT\.)\s*/.exec(up);
    if (!prefix) return f ? HEADING_PREFIXES.filter((p) => fold(p).startsWith(f) && fold(p) !== f).map((p) => p) : [...HEADING_PREFIXES];
    const rest = up.slice(prefix[0].length);
    const dash = /\s[-–—]\s*([^-–—]*)$/.exec(rest);
    if (dash) {
      const w = fold(dash[1]);
      return EFFECT_WORDS.filter((e) => fold(e).startsWith(w) && fold(e) !== w).map((e) => up.slice(0, up.length - dash[1].length) + e);
    }
    if (!rest.trim()) return [];
    const places = new Set<string>([...locationsOf(blocks), ...Object.values(doc.decors).map((d) => d.name.toLocaleUpperCase('fr'))]);
    return [...places].filter((p) => fold(p).startsWith(fold(rest)) && fold(p) !== fold(rest)).slice(0, 6).map((p) => prefix[0] + p);
  }
  return [];
}

// --- Éditeur ---------------------------------------------------------------------------------

interface Props {
  doc: ProjectDoc;
  readOnly?: boolean;
  /** Passages liés au découpage (ancres des actions) et passage à mettre en avant. */
  anchors: ReadonlyArray<{ id: ID; start: number; end: number }>;
  hot?: ID | null;
  onCaretAnchor?: (id: ID | null) => void;
  apiRef?: React.MutableRefObject<ScriptEditorApi | null>;
  paged?: boolean;
  /** Passages commentés (relecture) ; un clic dessus ouvre leur bulle. */
  comments?: ReadonlyArray<{ id: ID; start: number; end: number }>;
  onComment?: (id: ID, rect: DOMRect) => void;
}

type Snapshot = { doc: ScriptDoc; caret: Caret | null };

export function ScriptEditor({ doc, readOnly = false, anchors, hot, onCaretAnchor, apiRef, paged = true, comments, onComment }: Props) {
  const external = doc.scenario ?? '';
  const [sdoc, setSdoc] = useState<ScriptDoc>(() => withOneBlock(blocksFromSource(external)));
  const sdocRef = useRef(sdoc);
  sdocRef.current = sdoc;
  const ser = useMemo(() => serialize(sdoc), [sdoc]);
  const serRef = useRef(ser);
  serRef.current = ser;
  const synced = useRef(external);
  const root = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<Caret | null>(null);
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const lastTyping = useRef<{ id: string; at: number } | null>(null);
  const composing = useRef(false);
  const blockEls = useRef(new Map<string, HTMLDivElement>());
  const register = useCallback<Register>((id, el) => {
    if (el) blockEls.current.set(id, el);
    else blockEls.current.delete(id);
  }, []);
  const [layout, setLayout] = useState<EditorLayout>({ margins: {}, pageOf: {}, pages: 1, offset: 0 });
  // Police chargée après le premier rendu : les hauteurs changent, la pagination est refaite.
  const [, setFontTick] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const on = () => setFontTick((t) => t + 1);
    fonts.addEventListener?.('loadingdone', on);
    void fonts.ready.then(on);
    return () => fonts.removeEventListener?.('loadingdone', on);
  }, []);
  const [active, setActive] = useState<{ id: string; offset: number; top: number; left: number; height: number } | null>(null);
  const [pick, setPick] = useState(0);
  const [acClosed, setAcClosed] = useState<string | null>(null);
  const [titleOpen, setTitleOpen] = useState(false);
  const titleFound = useMemo(() => (titleOpen ? titleFromBlocks(sdocRef.current.blocks) : null), [titleOpen]);

  // --- Enregistrement (débouncé) et rechargement quand le scénario change ailleurs ---
  const flush = useCallback(() => {
    const src = serRef.current.source;
    if (src === synced.current) return;
    synced.current = src;
    commitScenario(src);
  }, []);

  useEffect(() => {
    if (ser.source === synced.current) return;
    const t = setTimeout(flush, COMMIT_DELAY);
    return () => clearTimeout(t);
  }, [ser.source, flush]);

  useEffect(() => {
    if (external === synced.current) return;
    synced.current = external;
    if (external === serRef.current.source) return;
    setSdoc(withOneBlock(blocksFromSource(external)));
    undoStack.current = [];
    redoStack.current = [];
  }, [external]);

  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush();
    };
  }, [flush]);

  // --- Modifications ---
  const currentCaret = (): Caret | null => (root.current ? (readSelection(root.current)?.start ?? null) : null);

  const snapshot = (kind: 'type' | 'struct', id?: string) => {
    const now = Date.now();
    if (kind === 'type' && lastTyping.current && lastTyping.current.id === id && now - lastTyping.current.at < 1500) {
      lastTyping.current.at = now;
      return;
    }
    undoStack.current.push({ doc: sdocRef.current, caret: currentCaret() });
    if (undoStack.current.length > 400) undoStack.current.shift();
    redoStack.current = [];
    lastTyping.current = kind === 'type' && id ? { id, at: now } : null;
  };

  const apply = (e: Edit | null) => {
    // Rien de changé (Entrée sur une ligne vide…) : ni étape d'annulation, ni curseur à replacer plus tard.
    if (!e || e.doc === sdocRef.current) return;
    snapshot('struct');
    const next = withOneBlock(e.doc);
    sdocRef.current = next;
    setSdoc(next);
    pendingCaret.current = next.blocks.some((b) => b.id === e.caret.id) ? e.caret : { id: next.blocks[0].id, offset: 0 };
  };

  /** Ajoute ou retire une marque d'emphase autour de la sélection (bloc par bloc), ou du mot courant. */
  const toggleEmphasis = (mark: '**' | '*' | '_') => {
    const el = root.current;
    if (readOnly || !el) return;
    const sel = readSelection(el);
    if (!sel) return;
    const blocks = sdocRef.current.blocks;
    const ia = blocks.findIndex((b) => b.id === sel.start.id);
    const ib = blocks.findIndex((b) => b.id === sel.end.id);
    if (ia < 0 || ib < 0) return;
    const [from, to] = ia <= ib ? [sel.start, sel.end] : [sel.end, sel.start];
    let next = sdocRef.current;
    let caret: Caret = to;
    for (let i = Math.min(ia, ib); i <= Math.max(ia, ib); i++) {
      const b = blocks[i];
      if (b.type === 'title' || b.type === 'pagebreak') continue;
      let a = b.id === from.id ? from.offset : 0;
      let z = b.id === to.id ? to.offset : b.text.length;
      if (a === z) {
        // Rien de sélectionné : le mot sous le curseur.
        while (a > 0 && /[\p{L}\p{N}'’-]/u.test(b.text[a - 1])) a--;
        while (z < b.text.length && /[\p{L}\p{N}'’-]/u.test(b.text[z])) z++;
        if (a === z) continue;
      }
      const t = b.text;
      const wrapped = t.slice(a - mark.length, a) === mark && t.slice(z, z + mark.length) === mark && (mark !== '*' || (t[a - 2] !== '*' && t[z + 1] !== '*'));
      const text = wrapped ? t.slice(0, a - mark.length) + t.slice(a, z) + t.slice(z + mark.length) : t.slice(0, a) + mark + t.slice(a, z) + mark + t.slice(z);
      next = setBlockText(next, b.id, text);
      if (b.id === to.id) caret = { id: b.id, offset: wrapped ? z - mark.length : z + 2 * mark.length };
    }
    apply({ doc: next, caret });
  };

  /** Sélection courante, bloc par bloc (le mot sous le curseur si rien n'est sélectionné). */
  const selectedRanges = (): Array<{ b: SBlock; a: number; z: number; last: boolean }> => {
    const el = root.current;
    if (!el) return [];
    const sel = readSelection(el);
    if (!sel) return [];
    const blocks = sdocRef.current.blocks;
    const ia = blocks.findIndex((b) => b.id === sel.start.id);
    const ib = blocks.findIndex((b) => b.id === sel.end.id);
    if (ia < 0 || ib < 0) return [];
    const [from, to] = ia <= ib ? [sel.start, sel.end] : [sel.end, sel.start];
    const out: Array<{ b: SBlock; a: number; z: number; last: boolean }> = [];
    for (let i = Math.min(ia, ib); i <= Math.max(ia, ib); i++) {
      const b = blocks[i];
      if (b.type === 'title' || b.type === 'pagebreak') continue;
      let a = b.id === from.id ? from.offset : 0;
      let z = b.id === to.id ? to.offset : b.text.length;
      if (a === z) {
        while (a > 0 && /[\p{L}\p{N}'’-]/u.test(b.text[a - 1])) a--;
        while (z < b.text.length && /[\p{L}\p{N}'’-]/u.test(b.text[z])) z++;
        if (a === z) continue;
      }
      out.push({ b, a, z, last: b.id === to.id });
    }
    return out;
  };

  const applyHighlight = (color: HighlightColor | undefined) => {
    if (readOnly) return;
    const ranges = selectedRanges();
    if (!ranges.length) return;
    let next = sdocRef.current;
    let caret: Caret | null = null;
    for (const { b, a, z, last } of ranges) {
      const r = setHighlight(b.text, a, z, color);
      next = setBlockText(next, b.id, r.text);
      if (last) caret = { id: b.id, offset: r.end };
    }
    apply({ doc: next, caret: caret ?? { id: ranges[ranges.length - 1].b.id, offset: 0 } });
  };

  const doUndo = () => {
    const prev = undoStack.current.pop();
    if (!prev) {
      flush();
      appUndo();
      return;
    }
    redoStack.current.push({ doc: sdocRef.current, caret: currentCaret() });
    lastTyping.current = null;
    setSdoc(prev.doc);
    pendingCaret.current = prev.caret;
  };
  const doRedo = () => {
    const nxt = redoStack.current.pop();
    if (!nxt) {
      flush();
      appRedo();
      return;
    }
    undoStack.current.push({ doc: sdocRef.current, caret: currentCaret() });
    lastTyping.current = null;
    setSdoc(nxt.doc);
    pendingCaret.current = nxt.caret;
  };

  const blockOf = (id: string) => sdocRef.current.blocks.find((b) => b.id === id);

  const setType = (t: BlockType) => {
    const c = currentCaret();
    const id = c?.id ?? active?.id;
    if (!id) return;
    const before = blockOf(id);
    const r = setBlockType(sdocRef.current, id, t);
    if (r.doc === sdocRef.current) return;
    const shift = before && before.type !== 'parenthetical' && t === 'parenthetical' ? 1 : before?.type === 'parenthetical' && t !== 'parenthetical' ? -1 : 0;
    apply({ doc: r.doc, caret: { id, offset: Math.max(0, Math.min(r.text.length, (c?.offset ?? r.text.length) + shift)) } });
  };

  // --- Synchronisation DOM → modèle après une frappe native ---
  const syncFromDom = () => {
    const el = root.current;
    if (!el) return;
    const sl = window.getSelection();
    const cur = sl?.anchorNode ? blockElOf(sl.anchorNode) : null;
    const targets = cur ? [cur, cur.previousElementSibling, cur.nextElementSibling] : Array.from(el.querySelectorAll<HTMLElement>('[data-bid]'));
    let next = sdocRef.current;
    for (const t of targets) {
      if (!(t instanceof HTMLElement) || !t.dataset.bid || t.dataset.type === 'title') continue;
      const text = readText(t);
      const b = next.blocks.find((x) => x.id === t.dataset.bid);
      if (b && b.text !== text) next = setBlockText(next, b.id, text);
    }
    if (next !== sdocRef.current) {
      sdocRef.current = next;
      setSdoc(next);
    }
    repairDom();
  };

  /**
   * Le navigateur ne doit jamais toucher à la structure (les entrées qui le pourraient sont interceptées) ;
   * s'il l'a fait quand même — bloc retiré, imbriqué, nœud tapé hors d'un bloc —, chaque bloc est remis à
   * sa place avec son texte. Sans cela, l'affichage et le texte divergent, puis la page tombe.
   */
  const repairDom = () => {
    const el = root.current;
    if (!el) return;
    const want = sdocRef.current.blocks.map((b) => blockEls.current.get(b.id)).filter((x): x is HTMLDivElement => !!x);
    const kids = el.childNodes;
    if (kids.length === want.length && want.every((x, i) => kids[i] === x)) return;
    const sl = window.getSelection();
    const anchor = sl?.anchorNode ? blockElOf(sl.anchorNode) : null;
    const caret = anchor && want.includes(anchor as HTMLDivElement) && sl?.anchorNode ? { id: anchor.dataset.bid!, offset: offsetIn(anchor, sl.anchorNode, sl.anchorOffset) } : null;
    want.forEach((x, i) => {
      if (kids[i] !== x) el.insertBefore(x, kids[i] ?? null);
    });
    const keep = new Set<Node>(want);
    for (const n of Array.from(kids)) if (!keep.has(n)) n.remove();
    for (const b of sdocRef.current.blocks) {
      const x = blockEls.current.get(b.id);
      if (!x || b.type === 'title') continue;
      for (const inner of Array.from(x.querySelectorAll('[data-bid]'))) inner.remove();
      if (readText(x) !== b.text) writeText(x, b.text);
    }
    if (caret) placeCaret(el, caret);
  };

  // --- Entrées interceptées : structure du texte (Entrée, retour arrière en début de bloc, sélection à cheval…) ---
  useEffect(() => {
    const el = root.current;
    if (!el || readOnly) return;
    const onBeforeInput = (e: InputEvent) => {
      const t = e.inputType;
      // Une frappe part de la position réelle du curseur : aucun placement en attente ne doit la déplacer ensuite.
      pendingCaret.current = null;
      if (t === 'historyUndo' || t === 'historyRedo') {
        e.preventDefault();
        if (t === 'historyUndo') doUndo();
        else doRedo();
        return;
      }
      if (/^format/.test(t) || t === 'insertFromDrop' || t === 'deleteByDrag' || t === 'insertFromPaste' || t === 'insertFromPasteAsQuotation' || t === 'insertLink') {
        e.preventDefault();
        return;
      }
      if (composing.current || t === 'insertCompositionText') return;
      const raw = readSelection(el);
      if (!raw) {
        e.preventDefault();
        return;
      }
      const sel = tidySelection(raw);
      const multi = sel.start.id !== sel.end.id;
      if (t === 'insertParagraph' || (t === 'insertLineBreak' && !allowsLines(blockOf(sel.start.id)?.type))) {
        e.preventDefault();
        let d = sdocRef.current;
        let c = sel.start;
        if (!sel.collapsed) {
          const r = replaceRange(d, sel.start, sel.end, '');
          d = r.doc;
          c = r.caret;
        }
        apply(splitBlock(d, c));
        return;
      }
      if (t === 'insertLineBreak') {
        e.preventDefault();
        const b = blockOf(sel.start.id);
        // Pas de ligne vide dans un bloc : un second retour crée un nouveau paragraphe.
        if (b && sel.collapsed && (b.text.slice(0, sel.start.offset).endsWith('\n') || sel.start.offset === 0)) return apply(splitBlock(sdocRef.current, sel.start));
        apply(replaceRange(sdocRef.current, sel.start, sel.end, '\n'));
        return;
      }
      // Sélection effacée ou remplacée : toujours dans le texte, jamais par le navigateur, qui emporte
      // volontiers le bloc entier quand la sélection le couvre (Safari surtout).
      if (multi || (!sel.collapsed && (t.startsWith('delete') || t === 'insertText'))) {
        e.preventDefault();
        const text = t.startsWith('insert') ? (e.data ?? e.dataTransfer?.getData('text/plain') ?? '') : '';
        apply(replaceRange(sdocRef.current, sel.start, sel.end, text));
        return;
      }
      if (t.startsWith('delete') && sel.collapsed) {
        const b = blockOf(sel.start.id);
        if (!b) return;
        const backward = t.includes('Backward');
        if (backward && sel.start.offset === 0) {
          e.preventDefault();
          apply(mergeWithPrevious(sdocRef.current, b.id));
          return;
        }
        if (!backward && sel.start.offset >= b.text.length) {
          e.preventDefault();
          apply(mergeWithNext(sdocRef.current, b.id));
          return;
        }
        // Ce que le navigateur s'apprête à effacer : s'il sort du bloc ou le vide, on l'efface nous-mêmes
        // (borné au bloc ; la jonction de deux blocs ne passe que par les cas ci-dessus).
        const target = e.getTargetRanges?.()[0];
        const ta = target ? caretFromPoint(el, target.startContainer, target.startOffset, 'start') : null;
        const tz = target ? caretFromPoint(el, target.endContainer, target.endOffset, 'end') : null;
        const a: Caret = ta ? (ta.id === b.id ? ta : { id: b.id, offset: 0 }) : backward ? { id: b.id, offset: sel.start.offset - 1 } : sel.start;
        const z: Caret = tz ? (tz.id === b.id ? tz : { id: b.id, offset: b.text.length }) : backward ? sel.start : { id: b.id, offset: sel.start.offset + 1 };
        const crosses = (ta && ta.id !== b.id) || (tz && tz.id !== b.id);
        if (crosses || (a.offset <= 0 && z.offset >= b.text.length)) {
          e.preventDefault();
          apply(replaceRange(sdocRef.current, a, z, ''));
          return;
        }
      }
      snapshot('type', sel.start.id);
    };
    const onCompStart = () => {
      composing.current = true;
      const sel = readSelection(el);
      if (sel) snapshot('type', sel.start.id);
    };
    const onCompEnd = () => {
      composing.current = false;
      syncFromDom();
    };
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('compositionstart', onCompStart);
    el.addEventListener('compositionend', onCompEnd);
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('compositionstart', onCompStart);
      el.removeEventListener('compositionend', onCompEnd);
    };
  });

  // --- Curseur et pagination, après chaque rendu (la mise en page ne dépend que des hauteurs : un seul passage de plus) ---
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (pendingCaret.current) {
      placeCaret(el, pendingCaret.current, !readOnly);
      pendingCaret.current = null;
    }
    if (!paged) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-bid]')).map((b) => ({ id: b.dataset.bid!, type: b.dataset.type as BlockType, h: b.offsetHeight }));
    const next = editorLayout(items);
    const same = next.pages === layout.pages && next.offset === layout.offset && items.every((it) => Math.abs((next.margins[it.id] ?? 0) - (layout.margins[it.id] ?? 0)) < 0.5);
    if (!same) setLayout(next);
  });

  // --- Suivi de la sélection : type du bloc courant, passage lié, sélection pour « Créer un plan » ---
  const updateActive = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const sel = readSelection(el);
    if (!sel) return;
    const bel = el.querySelector<HTMLElement>(`[data-bid="${sel.end.id}"]`);
    const b = blockOf(sel.end.id);
    setActive(bel && b ? { id: b.id, offset: sel.end.offset, top: bel.offsetTop, left: bel.offsetLeft, height: bel.offsetHeight } : null);
    const caret = b ? { id: b.id, offset: sel.end.offset } : null;
    if (JSON.stringify(useScriptUi.getState().caret) !== JSON.stringify(caret)) useScriptUi.setState({ caret });
    const { spans } = serRef.current;
    const a = caretToSource(sdocRef.current.blocks, spans, sel.start);
    const z = caretToSource(sdocRef.current.blocks, spans, sel.end);
    const range = !sel.collapsed && a !== null && z !== null && z > a ? { start: a, end: z } : null;
    const prev = useScriptUi.getState();
    if (prev.activeType !== (b?.type ?? null) || JSON.stringify(prev.selection) !== JSON.stringify(range)) useScriptUi.setState({ activeType: b?.type ?? null, selection: range });
    if (onCaretAnchor) {
      const pos = a ?? -1;
      onCaretAnchor(anchors.find((x) => pos >= x.start && pos <= x.end)?.id ?? null);
    }
  }, [anchors, onCaretAnchor]);

  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateActive);
    };
    document.addEventListener('selectionchange', on);
    return () => {
      document.removeEventListener('selectionchange', on);
      cancelAnimationFrame(raf);
    };
  }, [updateActive]);

  // Plan, sommaire et nombre de pages : partagés avec la barre d'outils et le panneau.
  const numbers = useMemo(() => headingNumbers(sdoc.blocks), [sdoc.blocks]);
  useEffect(() => {
    // Pages et numéros de page de l'impression (sans les notes, qui ne s'impriment pas), comme l'export
    // et les statistiques ; la page de titre ne compte pas.
    const { items, pages } = scriptOutline(sdoc.blocks);
    useScriptUi.setState({ outline: items, pages, blocks: sdoc.blocks });
  }, [sdoc.blocks]);
  useEffect(() => {
    const blocks = sdoc.blocks;
    const i = active ? blocks.findIndex((b) => b.id === active.id) : -1;
    let h: string | null = null;
    for (let k = i; k >= 0; k--) if (blocks[k].type === 'heading') {
      h = blocks[k].id;
      break;
    }
    if (useScriptUi.getState().activeHeading !== h) useScriptUi.setState({ activeHeading: h });
  }, [active, sdoc.blocks]);
  // En quittant l'éditeur, le sommaire et les statistiques restent (vue Découpage) ; la sélection, non.
  useEffect(() => () => useScriptUi.setState({ activeType: null, selection: null, activeHeading: null }), []);

  // --- Passages liés au découpage : surlignés sans toucher au texte (CSS Custom Highlight API) ---
  useLayoutEffect(() => {
    const el = root.current;
    const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!el || !reg || !HighlightCtor) return;
    const toRange = (a: { start: number; end: number }) => {
      const x = sourceToCaret(sdoc.blocks, ser.spans, a.start);
      const y = sourceToCaret(sdoc.blocks, ser.spans, a.end);
      return x && y ? domRange(el, x, y) : null;
    };
    const all = anchors.map(toRange).filter((r): r is Range => !!r);
    const hotRanges = anchors.filter((a) => a.id === hot).map(toRange).filter((r): r is Range => !!r);
    reg.set('ds-linked', new HighlightCtor(...all));
    reg.set('ds-linked-hot', new HighlightCtor(...hotRanges));
    reg.set('ds-comment', new HighlightCtor(...(comments ?? []).map((c) => toRange({ start: c.start, end: Math.max(c.end, c.start + 1) })).filter((r): r is Range => !!r)));
    return () => {
      reg.delete('ds-linked');
      reg.delete('ds-linked-hot');
      reg.delete('ds-comment');
    };
  }, [anchors, hot, ser, sdoc.blocks, layout, comments]);

  // Clic sur un passage commenté (sans sélection) : sa bulle s'ouvre.
  const onCommentClick = () => {
    const el = root.current;
    if (!el || !comments?.length || !onComment) return;
    const sel = readSelection(el);
    if (!sel || !sel.collapsed) return;
    const pos = caretToSource(sdocRef.current.blocks, serRef.current.spans, sel.start);
    if (pos === null) return;
    const hit = comments.find((c) => pos >= c.start && pos <= Math.max(c.end, c.start + 1));
    if (!hit) return;
    const sl = window.getSelection();
    const rect = sl?.rangeCount ? sl.getRangeAt(0).getBoundingClientRect() : el.getBoundingClientRect();
    onComment(hit.id, rect);
  };

  // --- API pour la barre d'outils ---
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      flush,
      setType,
      focus: () => root.current?.focus(),
      scrollTo: (id) => {
        const el = root.current?.querySelector<HTMLElement>(`[data-bid="${id}"]`);
        if (!el || !root.current) return;
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        placeCaret(root.current, { id, offset: 0 });
      },
      selectionRect: () => {
        const sl = window.getSelection();
        return sl && sl.rangeCount ? sl.getRangeAt(0).getBoundingClientRect() : null;
      },
      editTitle: () => !readOnly && setTitleOpen(true),
      revealSource: (start, end) => {
        const el = root.current;
        const x = sourceToCaret(sdocRef.current.blocks, serRef.current.spans, start);
        const y = sourceToCaret(sdocRef.current.blocks, serRef.current.spans, Math.max(start, end));
        const r = el && x && y ? domRange(el, x, y) : null;
        if (!r) return null;
        (r.startContainer.parentElement ?? el)?.scrollIntoView({ block: 'center' });
        return r.getBoundingClientRect();
      },
      emphasis: (mark) => toggleEmphasis(mark),
      highlight: (color) => applyHighlight(color),
    };
  });

  // --- Clavier ---
  const activeBlock = active ? sdoc.blocks.find((b) => b.id === active.id) : undefined;
  const sugg = useMemo(() => (activeBlock && !readOnly ? suggestionsFor(activeBlock, active?.offset ?? -1, sdoc.blocks, doc) : []), [activeBlock, active?.offset, sdoc.blocks, doc, readOnly]);
  const acKey = activeBlock ? `${activeBlock.id}:${activeBlock.text}` : '';
  const acOpen = sugg.length > 0 && acClosed !== acKey;
  useEffect(() => setPick(0), [acKey]);

  const acceptSuggestion = (v: string) => {
    if (!activeBlock) return;
    snapshot('struct');
    const next = setBlockText(sdocRef.current, activeBlock.id, v);
    sdocRef.current = next;
    setSdoc(next);
    pendingCaret.current = { id: activeBlock.id, offset: v.length };
  };

  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const mod = e.metaKey || e.ctrlKey;
    // ⌘B, ⌘I, ⌘U : gras, italique, souligné (marques Fountain, le navigateur ne met rien en forme).
    if (mod && !e.altKey && !e.shiftKey && /^[biu]$/i.test(e.key)) {
      e.preventDefault();
      toggleEmphasis(({ b: '**', i: '*', u: '_' } as const)[e.key.toLowerCase() as 'b' | 'i' | 'u']);
      return;
    }
    if (acOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : sugg.length - 1)) % sugg.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !mod) {
        e.preventDefault();
        acceptSuggestion(sugg[pick] ?? sugg[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAcClosed(acKey);
        return;
      }
    }
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      e.stopPropagation();
      doRedo();
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      const c = currentCaret();
      const b = c ? blockOf(c.id) : undefined;
      if (!b) return;
      // Tab en fin de réplique remplie : une didascalie s'ouvre à la suite.
      if (!e.shiftKey && b.type === 'dialogue' && c && c.offset === b.text.length && b.text.trim()) return apply(insertBlockAfter(sdocRef.current, b.id, 'parenthetical'));
      // Tab en fin d'action remplie : un personnage à la suite.
      if (!e.shiftKey && b.type === 'action' && c && c.offset === b.text.length && b.text.trim()) return apply(insertBlockAfter(sdocRef.current, b.id, 'character'));
      setType(cycleType(b.type, e.shiftKey ? -1 : 1));
      return;
    }
    // Type du bloc : ⌃1 … ⌃8 sur Mac (⌥ + chiffre y tape « » ’ [ {), Alt + 1 … 8 ailleurs.
    const digit = blockTypeDigit(e);
    if (digit) {
      e.preventDefault();
      const t = BLOCK_LABELS[digit - 1]?.[0];
      if (t) setType(t);
    }
  };

  const onPaste = (e: RClipboardEvent<HTMLDivElement>) => {
    if (readOnly || !root.current) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const sel = readSelection(root.current);
    if (!sel || !text) return;
    let d = sdocRef.current;
    let c = sel.start;
    if (!sel.collapsed) {
      const r = replaceRange(d, sel.start, sel.end, '');
      d = r.doc;
      c = r.caret;
    }
    apply(insertText(d, c, text));
  };

  const onCopy = (e: RClipboardEvent<HTMLDivElement>, cut = false) => {
    if (!root.current) return;
    const sel = readSelection(root.current);
    if (!sel || sel.collapsed) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', rangeText(sdocRef.current, sel.start, sel.end));
    if (cut && !readOnly) apply(replaceRange(sdocRef.current, sel.start, sel.end, ''));
  };

  const height = paged ? layout.pages * PAGE.h + (layout.pages - 1) * PAGE.gap : undefined;
  const label = activeBlock ? blockLabel(activeBlock.type) : '';

  return (
    <div className={[s.stack, paged ? s.paged : s.flow].join(' ')} style={{ ['--pt' as string]: `${PT}px`, ...(paged ? { height, width: PAGE.w } : {}) }} data-testid="script-stack">
      {paged && (
        <div className={s.sheets} aria-hidden="true">
          {Array.from({ length: layout.pages }, (_, i) => (
            <div key={i} className={s.sheet} style={{ top: i * (PAGE.h + PAGE.gap), height: PAGE.h }}>
              {i + 1 - layout.offset > 1 && <span className={s.pageNo}>{i + 1 - layout.offset}.</span>}
            </div>
          ))}
        </div>
      )}
      <div
        ref={root}
        className={s.editor}
        style={paged ? { padding: `${PAGE.top}px ${PAGE.right}px ${PAGE.bottom}px ${PAGE.left}px`, minHeight: height } : undefined}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck
        lang="fr"
        role="textbox"
        aria-multiline="true"
        aria-label="Scénario"
        data-testid="script-editor"
        onInput={() => !composing.current && syncFromDom()}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onBlur={flush}
        onDrop={(e) => e.preventDefault()}
        onMouseUp={onCommentClick}
      >
        {sdoc.blocks.map((b) =>
          b.type === 'title' ? (
            <TitleBlock key={b.id} reg={register} b={b} paged={paged} mt={paged ? (layout.margins[b.id] ?? 0) : undefined} onEdit={readOnly ? undefined : () => setTitleOpen(true)} />
          ) : (
            <Block key={b.id} reg={register} b={b} mt={paged ? (layout.margins[b.id] ?? 0) : undefined} n={numbers.get(b.id)} />
          ),
        )}
      </div>
      {active && !readOnly && label && (
        <span className={s.typeTag} style={{ top: active.top }} aria-hidden="true">
          {label}
        </span>
      )}
      {titleOpen &&
        createPortal(
        <TitleDialog
          initial={titleFound?.title ?? parseTitlePage(sdoc.blocks.find((b) => b.type === 'title')?.text ?? '')}
          onClose={() => setTitleOpen(false)}
          onSave={(f) => {
            setTitleOpen(false);
            // Lignes reconnues comme page de garde au début du texte : elles la deviennent.
            const base = titleFound ? removeBlocks(sdocRef.current, titleFound.ids) : sdocRef.current;
            const next = setTitlePage(base, f);
            if (next === sdocRef.current) return;
            const first = next.blocks.find((b) => b.type !== 'title') ?? next.blocks[0];
            apply({ doc: next, caret: { id: first.id, offset: 0 } });
          }}
        />,
          document.body,
        )}
      {acOpen && active && (
        <ul className={s.ac} style={{ top: active.top + active.height + 2, left: active.left }} role="listbox" aria-label="Suggestions">
          {sugg.map((v, i) => (
            <li key={v} role="option" aria-selected={i === pick} className={i === pick ? s.acOn : ''} onMouseDown={(e) => {
              e.preventDefault();
              acceptSuggestion(v);
            }}>
              {v}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const allowsLines = (t?: BlockType) => t === 'action' || t === 'dialogue' || t === 'title';

/** Il reste toujours un bloc où écrire. */
function withOneBlock(d: ScriptDoc): ScriptDoc {
  return d.blocks.length ? d : { ...d, blocks: [{ id: `b-first-${Date.now().toString(36)}`, type: 'heading', text: '' }] };
}

export type { Span };
