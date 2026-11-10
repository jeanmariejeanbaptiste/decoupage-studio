import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Minus,
  Plus,
  RemoveFormatting,
  SeparatorHorizontal,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from 'lucide-react';
import { INDENT_STEP_CM, LINE_SPACINGS, PARAGRAPH_STYLES, RICH_FONTS, RICH_SIZES, sanitizeRich, type ParagraphStyle } from '../../domain/richText';
import { countWords } from '../../domain/text';
import { getBlob, putBlob } from '../../store/db';
import { registerFlush } from '../../store/persistence';
import s from './RichEditor.module.css';

/** Géométrie de la page à l'écran : A4, marges de 25 mm (comme Word). */
const MM = 96 / 25.4;
export const NOTE_PAGE = { w: 210 * MM, h: 297 * MM, margin: 25 * MM, gap: 24 };
const CONTENT_H = NOTE_PAGE.h - 2 * NOTE_PAGE.margin;
const JUMP = 2 * NOTE_PAGE.margin + NOTE_PAGE.gap;
const COMMIT_DELAY = 600;
const IC = { size: 15, strokeWidth: 1.25 } as const;

interface Props {
  html: string;
  projectId: string;
  readOnly?: boolean;
  onChange: (html: string) => void;
  /** Pages de la note telles qu'à l'écran (pour l'export). */
  onLayout?: (pages: number) => void;
  /** Élément éditable (pour l'export page par page). */
  editorRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** Bouton d'export, au bout du ruban. */
  trail?: React.ReactNode;
}

interface Snapshot {
  html: string;
  sel: [number, number] | null;
}

/** Unités de pagination : les blocs, et chaque élément d'une liste. */
function units(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const c of Array.from(root.children) as HTMLElement[]) {
    if (c.tagName === 'UL' || c.tagName === 'OL') out.push(...(Array.from(c.children) as HTMLElement[]).filter((x) => x.tagName === 'LI'));
    else out.push(c);
  }
  return out;
}

/** Sélecteur CSS d'une unité, depuis la racine (la pagination ne touche pas au texte). */
function selectorOf(root: HTMLElement, u: HTMLElement): string {
  const nth = (el: Element) => Array.prototype.indexOf.call(el.parentElement!.children, el) + 1;
  return u.parentElement === root ? `> :nth-child(${nth(u)})` : `> :nth-child(${nth(u.parentElement!)}) > :nth-child(${nth(u)})`;
}

/** Position du curseur en caractères depuis le début (pour rétablir une sélection après une annulation). */
function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  try {
    r.setEnd(node, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

function pointAt(root: HTMLElement, pos: number): [Node, number] {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let rest = pos;
  let last: Node | null = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const len = (n.nodeValue ?? '').length;
    if (rest <= len) return [n, rest];
    rest -= len;
    last = n;
  }
  return last ? [last, (last.nodeValue ?? '').length] : [root, 0];
}

/** Blocs touchés par la sélection (paragraphes, titres, citations, éléments de liste). */
function selectedBlocks(root: HTMLElement): HTMLElement[] {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, blockquote, li'));
  const hit = blocks.filter((b) => range.intersectsNode(b));
  // Un élément de liste contient ses sous-listes : seul le plus profond compte.
  return hit.filter((b) => !hit.some((o) => o !== b && b.contains(o) && o.tagName === 'LI'));
}

/**
 * Éditeur de la note d'intention, à la manière d'un traitement de texte : pages A4 qui se
 * suivent, styles de paragraphe, police, corps, mise en forme des caractères, listes, retraits,
 * alignement, interligne, images et sauts de page ; barre d'état (page, mots, zoom).
 */
export function RichEditor({ html, projectId, readOnly = false, onChange, onLayout, editorRef, trail }: Props) {
  const root = useRef<HTMLDivElement | null>(null);
  // Dernier élément éditable, jamais remis à null : le démontage peut encore enregistrer la frappe.
  const lastEl = useRef<HTMLDivElement | null>(null);
  const styleEl = useRef<HTMLStyleElement>(null);
  const emitted = useRef(html);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const lastSnap = useRef(0);
  const savedRange = useRef<Range | null>(null);
  const imgUrls = useRef(new Map<string, string>());
  const loading = useRef(new Set<string>());
  const alive = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [words, setWords] = useState(0);
  const [zoom, setZoom] = useState(() => {
    try {
      return Number(localStorage.getItem('ds-note-zoom')) || 100;
    } catch {
      return 100;
    }
  });
  const [state, setState] = useState({ style: 'p' as ParagraphStyle, font: 'Inter Variable', size: '11', align: 'left', line: '', marks: {} as Record<string, boolean> });
  const margins = useRef(new Map<HTMLElement, number>());

  // --- Pagination : chaque bloc qui déborderait passe en haut de la page suivante ---
  const relayout = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const k = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
    const top0 = el.getBoundingClientRect().top / k + (parseFloat(getComputedStyle(el).paddingTop) || 0);
    const list = units(el);
    const rules: string[] = [];
    const next = new Map<HTMLElement, number>();
    let applied = 0;
    let pageStart = 0;
    let n = 1;
    let forced = false;
    let caretPage = 1;
    const sel = window.getSelection();
    const anchor = sel?.rangeCount && el.contains(sel.anchorNode) ? sel.anchorNode : null;
    for (const u of list) {
      const r = u.getBoundingClientRect();
      const own = margins.current.get(u) ?? 0;
      applied += own;
      // Position dans le texte continu (sans les sauts de page déjà posés).
      const top = r.top / k - top0 - applied;
      const bottom = top + r.height / k + (parseFloat(getComputedStyle(u).marginBottom) || 0);
      let jump = 0;
      if (u.tagName === 'HR' && u.classList.contains('page-break')) {
        forced = true;
      } else if ((forced || bottom - pageStart > CONTENT_H) && top > pageStart + 0.5) {
        jump = pageStart + CONTENT_H - top + JUMP;
        pageStart = top;
        n++;
        forced = false;
      } else forced = false;
      if (jump > 0) {
        next.set(u, jump);
        rules.push(`[data-note] ${selectorOf(el, u)} { margin-top: ${jump.toFixed(2)}px !important; }`);
      }
      if (anchor && u.contains(anchor)) caretPage = n;
    }
    margins.current = next;
    if (styleEl.current) styleEl.current.textContent = rules.join('\n');
    setPages(n);
    setPage(caretPage);
    onLayout?.(n);
  }, [onLayout]);

  // --- Contenu : posé une fois, puis seulement s'il change ailleurs (annulation globale, autre appareil) ---
  const resolveImages = useCallback(() => {
    const el = root.current;
    if (!el) return;
    for (const img of Array.from(el.querySelectorAll<HTMLImageElement>('img[data-blob]'))) {
      const key = img.dataset.blob!;
      const known = imgUrls.current.get(key);
      if (known) {
        if (img.getAttribute('src') !== known) img.src = known;
        continue;
      }
      // Une seule lecture par image ; aucune adresse créée si l'éditeur est déjà fermé.
      if (loading.current.has(key)) continue;
      loading.current.add(key);
      void getBlob(key).then((b) => {
        loading.current.delete(key);
        if (!b || !alive.current) return;
        const url = URL.createObjectURL(b);
        imgUrls.current.set(key, url);
        el.querySelectorAll<HTMLImageElement>(`img[data-blob="${CSS.escape(key)}"]`).forEach((i) => (i.src = url));
        relayout();
      });
    }
  }, [relayout]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (el.innerHTML && html === emitted.current) return;
    emitted.current = html;
    el.innerHTML = html || '<p><br></p>';
    // Contenu remplacé d'ailleurs : l'historique local ne s'applique plus.
    undo.current = [];
    redo.current = [];
    resolveImages();
    setWords(countWords(el.innerText));
    relayout();
  }, [html, resolveImages, relayout]);

  useEffect(() => {
    const urls = imgUrls.current;
    alive.current = true;
    return () => {
      alive.current = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  // Police chargée, fenêtre redimensionnée : la pagination suit.
  useEffect(() => {
    const on = () => relayout();
    document.fonts?.addEventListener?.('loadingdone', on);
    window.addEventListener('resize', on);
    return () => {
      document.fonts?.removeEventListener?.('loadingdone', on);
      window.removeEventListener('resize', on);
    };
  }, [relayout]);
  useLayoutEffect(relayout, [zoom, relayout]);

  // --- Enregistrement (différé pendant la frappe) ---
  const commitTimer = useRef<number | null>(null);
  const commit = useCallback(() => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = null;
    const el = root.current ?? lastEl.current;
    if (!el) return;
    const clean = sanitizeRich(el.innerHTML);
    if (clean === emitted.current) return;
    emitted.current = clean;
    onChange(clean);
  }, [onChange]);
  // Page quittée sans perte du focus (retour arrière, changement d'adresse) : la frappe en attente part aussi.
  // Seulement s'il y a une frappe en attente : une simple visite n'écrit rien dans le projet.
  const commitPending = useCallback(() => {
    if (commitTimer.current !== null) commit();
  }, [commit]);
  useEffect(() => () => commitPending(), [commitPending]);
  // ⌘S, fermeture de l'onglet : la frappe encore en attente part avec le projet.
  useEffect(() => registerFlush(commit), [commit]);
  const scheduleCommit = () => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(commit, COMMIT_DELAY);
  };

  // --- Annuler / rétablir : un historique propre à la note (frappe groupée, commandes une par une) ---
  const snapshot = (force = false) => {
    const el = root.current;
    if (!el) return;
    const now = Date.now();
    if (!force && now - lastSnap.current < 1200) return;
    lastSnap.current = now;
    const sel = window.getSelection();
    const range = sel?.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
    undo.current.push({ html: el.innerHTML, sel: range ? [textOffset(el, range.startContainer, range.startOffset), textOffset(el, range.endContainer, range.endOffset)] : null });
    if (undo.current.length > 200) undo.current.shift();
    redo.current = [];
  };
  const restore = (from: Snapshot[], to: Snapshot[]) => {
    const el = root.current;
    const snap = from.pop();
    if (!el || !snap) return;
    const sel = window.getSelection();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    to.push({ html: el.innerHTML, sel: range && el.contains(range.startContainer) ? [textOffset(el, range.startContainer, range.startOffset), textOffset(el, range.endContainer, range.endOffset)] : null });
    el.innerHTML = snap.html;
    resolveImages();
    if (snap.sel && sel) {
      const [a, ao] = pointAt(el, snap.sel[0]);
      const [b, bo] = pointAt(el, snap.sel[1]);
      const r = document.createRange();
      r.setStart(a, ao);
      r.setEnd(b, bo);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    lastSnap.current = 0;
    afterChange();
  };

  const afterChange = () => {
    const el = root.current;
    if (!el) return;
    setWords(countWords(el.innerText));
    relayout();
    refreshState();
    scheduleCommit();
  };

  // --- Sélection gardée pendant qu'on choisit dans une liste déroulante de la barre ---
  const keepRange = () => {
    const el = root.current;
    const sel = window.getSelection();
    if (el && sel?.rangeCount && el.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    const el = root.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const refreshState = useCallback(() => {
    const el = root.current;
    const sel = window.getSelection();
    if (!el || !sel?.rangeCount || !el.contains(sel.anchorNode)) return;
    keepRange();
    const node = sel.anchorNode!.nodeType === 3 ? sel.anchorNode!.parentElement! : (sel.anchorNode as HTMLElement);
    const block = node.closest('p, h1, h2, h3, h4, blockquote, li') as HTMLElement | null;
    const cs = getComputedStyle(node);
    const font = RICH_FONTS.find((f) => cs.fontFamily.replace(/["']/g, '').toLowerCase().startsWith(f.family.toLowerCase()))?.family ?? '';
    const pt = Math.round(((parseFloat(cs.fontSize) * 72) / 96) * 2) / 2;
    const marks: Record<string, boolean> = {};
    for (const c of ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript', 'insertUnorderedList', 'insertOrderedList']) {
      try {
        marks[c] = document.queryCommandState(c);
      } catch {
        marks[c] = false;
      }
    }
    const tag = (block?.tagName.toLowerCase() ?? 'p') as ParagraphStyle | 'li';
    const bcs = block ? getComputedStyle(block) : null;
    const lh = block?.style.lineHeight ?? '';
    setState({ style: tag === 'li' ? 'p' : tag, font, size: String(pt), align: bcs?.textAlign === 'start' ? 'left' : (bcs?.textAlign ?? 'left'), line: lh, marks });
    // Page du curseur.
    relayout();
  }, [relayout]);

  useEffect(() => {
    const on = () => {
      const el = root.current;
      const sel = window.getSelection();
      if (el && sel?.rangeCount && el.contains(sel.anchorNode)) refreshState();
    };
    document.addEventListener('selectionchange', on);
    return () => document.removeEventListener('selectionchange', on);
  }, [refreshState]);

  // --- Commandes ---
  const exec = (cmd: string, value?: string) => {
    restoreRange();
    snapshot(true);
    document.execCommand('styleWithCSS', false, cmd === 'hiliteColor' ? 'true' : 'false');
    document.execCommand(cmd, false, value);
    document.execCommand('styleWithCSS', false, 'false');
    normalize();
    afterChange();
  };

  /** Balises du navigateur ramenées au format de la note (polices, corps). */
  const normalize = () => {
    const el = root.current;
    if (!el) return;
    for (const f of Array.from(el.querySelectorAll('font'))) {
      const span = document.createElement('span');
      const face = f.getAttribute('face');
      if (face) span.style.fontFamily = `'${face}'`;
      const size = f.getAttribute('data-pt') ?? (f.getAttribute('size') ? { '1': '8', '2': '10', '3': '12', '4': '14', '5': '18', '6': '24', '7': '36' }[f.getAttribute('size')!] : null);
      if (size) span.style.fontSize = `${size}pt`;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    }
  };

  const setSize = (pt: string) => {
    restoreRange();
    snapshot(true);
    // Curseur seul : la frappe suivante prend le corps choisi (le navigateur, lui, poserait son plus grand corps).
    const sel = window.getSelection();
    if (sel?.rangeCount && sel.isCollapsed && root.current?.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      const span = document.createElement('span');
      span.style.fontSize = `${pt}pt`;
      const mark = document.createTextNode('\u200b');
      span.appendChild(mark);
      range.insertNode(span);
      const at = document.createRange();
      at.setStart(mark, 1);
      at.collapse(true);
      sel.removeAllRanges();
      sel.addRange(at);
      afterChange();
      return;
    }
    // Le navigateur ne connaît que 7 tailles : on pose la plus grande, puis on la remplace par le corps choisi.
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontSize', false, '7');
    const el = root.current;
    if (el) for (const f of Array.from(el.querySelectorAll('font[size="7"]'))) f.setAttribute('data-pt', pt);
    normalize();
    afterChange();
  };

  const setBlockStyle = (tag: ParagraphStyle) => exec('formatBlock', `<${tag}>`);

  const eachBlock = (fn: (b: HTMLElement) => void) => {
    const el = root.current;
    if (!el) return;
    restoreRange();
    snapshot(true);
    for (const b of selectedBlocks(el)) fn(b);
    afterChange();
  };
  const setLine = (v: string) => eachBlock((b) => (b.style.lineHeight = v));
  const indent = (dir: 1 | -1) => {
    const el = root.current;
    if (!el) return;
    const blocks = (restoreRange(), selectedBlocks(el));
    // Dans une liste : un niveau de plus ou de moins ; ailleurs : un cran de retrait (1,25 cm).
    if (blocks.length && blocks.every((b) => b.tagName === 'LI')) return exec(dir > 0 ? 'indent' : 'outdent');
    eachBlock((b) => {
      const cur = parseFloat(b.style.marginLeft) || 0;
      const next = Math.max(0, Math.round((cur + dir * INDENT_STEP_CM) * 100) / 100);
      b.style.marginLeft = next ? `${next}cm` : '';
    });
  };

  const insertImage = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const key = await putBlob(projectId, file.name, file);
    exec('insertHTML', `<img data-blob="${key}" alt="" style="width: 100%">`);
    resolveImages();
  };

  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) restore(redo.current, undo.current);
      else restore(undo.current, redo.current);
      return;
    }
    if (mod && !e.altKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      e.stopPropagation();
      restore(redo.current, undo.current);
      return;
    }
    // Saut de page : ⌘ Entrée, comme dans Word.
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      exec('insertHTML', '<hr class="page-break"><p><br></p>');
      return;
    }
    if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      snapshot(true);
      return;
    }
    if (!mod) snapshot();
  };

  const btn = (key: string, label: string, icon: React.ReactNode, on: () => void, active?: boolean) => (
    <button
      key={key}
      type="button"
      className={active ? s.on : ''}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      data-testid={`note-${key}`}
    >
      {icon}
    </button>
  );

  const setZoomKept = (z: number) => {
    const v = Math.max(50, Math.min(200, Math.round(z / 10) * 10));
    setZoom(v);
    try {
      localStorage.setItem('ds-note-zoom', String(v));
    } catch {
      /* stockage indisponible */
    }
  };

  const height = pages * NOTE_PAGE.h + (pages - 1) * NOTE_PAGE.gap;
  return (
    <div className={s.wrap}>
      {!readOnly && (
        <div className={s.ribbon} role="toolbar" aria-label="Mise en forme" onMouseDown={keepRange}>
          <select value={state.style} onChange={(e) => setBlockStyle(e.target.value as ParagraphStyle)} aria-label="Style" title="Style de paragraphe" className={s.selStyle} data-testid="note-style">
            {PARAGRAPH_STYLES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <select value={state.font} onChange={(e) => exec('fontName', e.target.value)} aria-label="Police" title="Police" className={s.selFont} data-testid="note-font">
            <option value="" disabled hidden>
              Police
            </option>
            {RICH_FONTS.map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: `'${f.family}'` }}>
                {f.label}
              </option>
            ))}
          </select>
          <select value={RICH_SIZES.map(String).includes(state.size) ? state.size : ''} onChange={(e) => setSize(e.target.value)} aria-label="Corps" title="Taille des caractères" className={s.selSize} data-testid="note-size">
            <option value="" disabled hidden>
              {state.size ? state.size.replace('.', ',') : 'Corps'}
            </option>
            {RICH_SIZES.map((z) => (
              <option key={z} value={String(z)}>
                {String(z).replace('.', ',')}
              </option>
            ))}
          </select>
          <span className={s.sep} />
          {btn('bold', 'Gras (⌘B)', <Bold {...IC} />, () => exec('bold'), state.marks.bold)}
          {btn('italic', 'Italique (⌘I)', <Italic {...IC} />, () => exec('italic'), state.marks.italic)}
          {btn('underline', 'Souligné (⌘U)', <Underline {...IC} />, () => exec('underline'), state.marks.underline)}
          {btn('strike', 'Barré', <Strikethrough {...IC} />, () => exec('strikeThrough'), state.marks.strikeThrough)}
          {btn('sub', 'Indice', <Subscript {...IC} />, () => exec('subscript'), state.marks.subscript)}
          {btn('sup', 'Exposant', <Superscript {...IC} />, () => exec('superscript'), state.marks.superscript)}
          {btn('highlight', 'Surligner', <Highlighter {...IC} />, () => exec('hiliteColor', 'rgba(17, 19, 24, 0.12)'))}
          {btn('clear', 'Effacer la mise en forme', <RemoveFormatting {...IC} />, () => exec('removeFormat'))}
          <span className={s.sep} />
          {btn('bullets', 'Liste à puces', <List {...IC} />, () => exec('insertUnorderedList'), state.marks.insertUnorderedList)}
          {btn('numbers', 'Liste numérotée', <ListOrdered {...IC} />, () => exec('insertOrderedList'), state.marks.insertOrderedList)}
          {btn('outdent', 'Diminuer le retrait', <IndentDecrease {...IC} />, () => indent(-1))}
          {btn('indent', 'Augmenter le retrait', <IndentIncrease {...IC} />, () => indent(1))}
          <span className={s.sep} />
          {btn('left', 'Aligner à gauche', <AlignLeft {...IC} />, () => exec('justifyLeft'), state.align === 'left')}
          {btn('center', 'Centrer', <AlignCenter {...IC} />, () => exec('justifyCenter'), state.align === 'center')}
          {btn('right', 'Aligner à droite', <AlignRight {...IC} />, () => exec('justifyRight'), state.align === 'right')}
          {btn('justify', 'Justifier', <AlignJustify {...IC} />, () => exec('justifyFull'), state.align === 'justify')}
          <select value={state.line} onChange={(e) => setLine(e.target.value)} aria-label="Interligne" title="Interligne" className={s.selLine} data-testid="note-line">
            <option value="">Interligne</option>
            {LINE_SPACINGS.map((l) => (
              <option key={l} value={String(l)}>
                {String(l).replace('.', ',')}
              </option>
            ))}
          </select>
          {/* Insertion et export : d'un seul tenant, à droite (ils passent à la ligne ensemble). */}
          <span className={s.tail}>
            {btn('image', 'Insérer une image', <ImagePlus {...IC} />, () => fileInput.current?.click())}
            {btn('pagebreak', 'Saut de page (⌘ Entrée)', <SeparatorHorizontal {...IC} />, () => exec('insertHTML', '<hr class="page-break"><p><br></p>'))}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void insertImage(f);
              }}
              data-testid="note-image-input"
            />
            {trail && <span className={s.trail}>{trail}</span>}
          </span>
        </div>
      )}
      {readOnly && trail && <div className={s.readTrail}>{trail}</div>}

      <div className={s.scroller}>
        <div className={s.stack} style={{ width: NOTE_PAGE.w, height, zoom: zoom / 100 }} data-testid="note-stack">
          <div className={s.sheets} aria-hidden="true">
            {Array.from({ length: pages }, (_, i) => (
              <div key={i} className={s.sheet} style={{ top: i * (NOTE_PAGE.h + NOTE_PAGE.gap), height: NOTE_PAGE.h }} />
            ))}
          </div>
          <style ref={styleEl} />
          <div
            ref={(el) => {
              root.current = el;
              if (el) lastEl.current = el;
              if (editorRef) editorRef.current = el;
            }}
            className={s.editor}
            style={{ padding: `${NOTE_PAGE.margin}px` }}
            contentEditable={!readOnly}
            suppressContentEditableWarning
            spellCheck
            lang="fr"
            role="textbox"
            aria-multiline="true"
            aria-label="Note d’intention"
            data-note
            data-testid="note-editor"
            onFocus={() => {
              // Entrée crée toujours un paragraphe (jamais un bloc sans style, après un titre par exemple).
              document.execCommand('defaultParagraphSeparator', false, 'p');
            }}
            onInput={afterChange}
            onKeyDown={readOnly ? undefined : onKeyDown}
            onBlur={commit}
            onPaste={(e) => {
              if (readOnly) return;
              // Collage : texte mis en forme nettoyé (aucun style étranger), ou texte brut.
              e.preventDefault();
              snapshot(true);
              const htmlData = e.clipboardData.getData('text/html');
              const text = e.clipboardData.getData('text/plain');
              if (htmlData) document.execCommand('insertHTML', false, sanitizeRich(htmlData));
              else document.execCommand('insertText', false, text);
              normalize();
              afterChange();
            }}
            onDrop={(e) => {
              const f = e.dataTransfer.files?.[0];
              if (readOnly || !f?.type.startsWith('image/')) return;
              e.preventDefault();
              void insertImage(f);
            }}
          />
        </div>
      </div>

      <footer className={s.status} aria-label="État du document">
        <span data-testid="note-pages">
          Page {page} sur {pages}
        </span>
        <span data-testid="note-words">
          {words} mot{words > 1 ? 's' : ''}
        </span>
        <span className={s.zoom}>
          <button type="button" onClick={() => setZoomKept(zoom - 10)} aria-label="Zoom arrière" title="Zoom arrière">
            <Minus size={13} strokeWidth={1.25} />
          </button>
          <input type="range" min={50} max={200} step={10} value={zoom} onChange={(e) => setZoomKept(Number(e.target.value))} aria-label="Zoom" />
          <button type="button" onClick={() => setZoomKept(zoom + 10)} aria-label="Zoom avant" title="Zoom avant">
            <Plus size={13} strokeWidth={1.25} />
          </button>
          <span className={s.zoomValue}>{zoom} %</span>
        </span>
      </footer>
    </div>
  );
}
