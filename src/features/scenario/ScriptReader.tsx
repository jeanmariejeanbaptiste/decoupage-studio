import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { matchSequence, parseFountain, sceneAt, scenesOf, shiftAnchors, type ScriptElement } from '../../domain/fountain';
import { sequenceHeading } from '../../domain/numbering';
import { createShotsFromSelection, passageInsertText, placePassageReplies, sentencesOf, splitByScene } from '../../domain/scriptToShot';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { useScriptCapture } from '../grid/scriptCapture';
import s from './ScriptReader.module.css';

/** Marque-page : fin du dernier passage mis dans le découpage, gardée par projet dans ce navigateur. */
const useResume = create<{ pid?: string; pos?: number }>(() => ({}));
const resumeKey = (pid: string) => `ds-resume:${pid}`;
function storedResume(pid: string): number | undefined {
  try {
    const v = Number(localStorage.getItem(resumeKey(pid)));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}
export function rememberPassage(end: number) {
  const pid = useProjectStore.getState().doc?.project.id;
  if (!pid) return;
  try {
    localStorage.setItem(resumeKey(pid), String(end));
  } catch {
    /* stockage indisponible : le marque-page vaut pour la session */
  }
  useResume.setState({ pid, pos: end });
}

/**
 * Crée un plan à partir d'un passage du scénario : en mode lié, directement dans la séquence de la
 * scène (créée au besoin) ; en mode libre, après le choix de la séquence dans un menu.
 */
export function addPassageAsShot(start: number, end: number, at: { x: number; y: number }) {
  const doc = useProjectStore.getState().doc;
  const source = doc?.scenario ?? '';
  if (!doc || end <= start) return;
  const dialogueShown = doc.project.settings.gridColumns.includes('dialogue');
  rememberPassage(end);
  // Pas de message : le plan apparaît aussitôt dans le découpage (et la liste de l'onglet Scénario).
  const done = (shotIds: ID[] | undefined) => void shotIds;

  // Mode lié, ou sélection à cheval sur plusieurs scènes : chaque morceau va dans la séquence de sa scène.
  if ((doc.project.settings.scenarioLink ?? 'auto') === 'auto' || splitByScene(source, start, end).length > 1) {
    done(mutateDoc((d) => createShotsFromSelection(d, source, start, end, { dialogueShown })));
    return;
  }
  const sc = sceneAt(scenesOf(source), start);
  const suggested = sc ? matchSequence(doc, sc) : undefined;
  const ids = suggested ? [suggested, ...doc.project.sequenceIds.filter((id) => id !== suggested)] : doc.project.sequenceIds;
  const items = ids.map((id) => ({
    label: `Dans ${sequenceHeading(doc, id)}${id === suggested ? ' (suggérée)' : ''}`,
    action: () => done(mutateDoc((d) => createShotsFromSelection(d, source, start, end, { dialogueShown, seqId: id }))),
  }));
  items.push({ label: 'Dans une nouvelle séquence', action: () => done(mutateDoc((d) => createShotsFromSelection(d, source, start, end, { dialogueShown }))) });
  useUi.getState().set({ menu: { x: at.x, y: at.y, items } });
}

/** Position absolue dans le scénario d'un point de sélection (nœud texte d'un segment repéré). */
function offsetOf(node: Node, offset: number): number | null {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const host = el?.closest<HTMLElement>('[data-o]');
  if (host) return Number(host.dataset.o) + (node.nodeType === Node.TEXT_NODE ? offset : 0);
  if (!el || node.nodeType === Node.TEXT_NODE) return null;
  // Point posé entre deux enfants d'un conteneur (phrase, paragraphe) : on prend le segment voisin.
  const before = el.childNodes[offset - 1];
  const prev = before instanceof Element ? [...before.querySelectorAll<HTMLElement>('[data-o]')].pop() ?? (before.matches('[data-o]') ? (before as HTMLElement) : null) : null;
  if (prev) return Number(prev.dataset.o) + (prev.textContent?.length ?? 0);
  const after = el.childNodes[offset];
  const next = after instanceof Element ? (after.matches('[data-o]') ? (after as HTMLElement) : after.querySelector<HTMLElement>('[data-o]')) : null;
  return next ? Number(next.dataset.o) : null;
}

/**
 * Scénario mis en page et actif : au survol d'une phrase, un « + » discret à sa fin l'ajoute au
 * découpage ; une sélection libre fait apparaître un « + » au-dessus de sa fin.
 * Avec `capture` (panneau du découpage) et une cellule Action ouverte en saisie, le texte choisi
 * (sélection, ou flèche d'une phrase) va dans cette cellule au lieu de créer un plan.
 */
export function ScriptReader({ doc, source, className, capture }: { doc: ProjectDoc; source: string; className?: string; capture?: boolean }) {
  const elements = useMemo(() => parseFountain(source), [source]);
  const sentences = useMemo(() => sentencesOf(source, elements), [source, elements]);
  const root = useRef<HTMLDivElement>(null);

  // Lecteur du panneau : la cellule Action ouverte en saisie le sait (filet tourné vers lui).
  useEffect(() => {
    if (!capture) return;
    useScriptCapture.setState({ reader: true });
    return () => useScriptCapture.setState({ reader: false, holding: false });
  }, [capture]);
  const capturing = useScriptCapture((c) => !!capture && !!c.target);
  // Marque-page : à l'ouverture, le lecteur revient au dernier passage découpé (bref éclairage) ; un
  // petit signet dans la marge le situe ensuite d'un coup d'œil.
  const pid = doc.project.id;
  const live = useResume((r) => (r.pid === pid ? r.pos : undefined));
  const resume = live ?? storedResume(pid);
  const [mark, setMark] = useState<number | null>(null);
  const segAt = (pos: number) => {
    const all = root.current ? [...root.current.querySelectorAll<HTMLElement>('[data-o]')] : [];
    let hit: HTMLElement | null = null;
    for (const el of all) if (Number(el.dataset.o) < pos) hit = el;
    return hit;
  };
  useLayoutEffect(() => {
    const el = resume ? segAt(resume) : null;
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add(s.resumeFlash);
    const t = window.setTimeout(() => el.classList.remove(s.resumeFlash), 1800);
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const place = () => {
      const el = resume && root.current ? segAt(resume) : null;
      if (!el || !root.current) return setMark(null);
      const rects = el.getClientRects();
      const last = rects[rects.length - 1];
      setMark(last ? last.top - root.current.getBoundingClientRect().top : null);
    };
    place();
    const ro = new ResizeObserver(place);
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, [resume, source]);
  const pour = (start: number, end: number) => {
    const t = useScriptCapture.getState().target;
    if (!t) return false;
    const text = passageInsertText(doc, source, start, end);
    if (text) {
      // Les répliques du passage vont où les range la création d'un plan (Sujet, Dialogue ou Son).
      mutateDoc((d) => void placePassageReplies(d, t.shotId, source, start, end, { dialogueShown: d.project.settings.gridColumns.includes('dialogue') }));
      t.insert(text, { start, end });
      rememberPassage(end);
    } else t.refocus();
    return true;
  };

  const seg = (text: string, o: number, key: string | number) => (
    <span key={key} data-o={o}>
      {text}
    </span>
  );

  // Rendu : répliques groupées (nom, didascalie, texte), actions découpées en phrases.
  const blocks: ReactNode[] = [];
  // Numéro de séquence en marge, comme à l'impression : hors du texte (la sélection n'en tient pas compte).
  let headingNo = 0;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    // Page de garde (« Title: », « Credit: »…) : elle a son propre éditeur, le lecteur ne la montre pas.
    if (el.type === 'title') continue;
    if (el.type === 'character') {
      const group: ScriptElement[] = [el];
      while (elements[i + 1] && (elements[i + 1].type === 'dialogue' || elements[i + 1].type === 'parenthetical')) group.push(elements[++i]);
      blocks.push(
        <div key={el.start} className={s.reply} data-testid="script-reply">
          {group.map((g) => (
            <p key={g.start} className={s[`el_${g.type}`]}>
              {seg(g.text, g.start, 0)}
            </p>
          ))}
        </div>,
      );
      continue;
    }
    if (el.type === 'action' || el.type === 'centered') {
      const parts: ReactNode[] = [];
      let pos = el.start;
      for (const sn of sentences) {
        if (sn.kind !== 'action' || sn.start < el.start || sn.end > el.end) continue;
        if (sn.start > pos) parts.push(seg(source.slice(pos, sn.start), pos, `g${pos}`));
        parts.push(
          <span key={sn.start} data-testid="script-sentence">
            {seg(source.slice(sn.start, sn.end), sn.start, 0)}
          </span>,
        );
        pos = sn.end;
      }
      if (pos < el.end) parts.push(seg(source.slice(pos, el.end), pos, `g${pos}`));
      blocks.push(
        <p key={el.start} className={s[`el_${el.type}`]}>
          {parts}
        </p>,
      );
      continue;
    }
    blocks.push(
      <p key={el.start} className={s[`el_${el.type}`]} data-n={el.type === 'heading' ? ++headingNo : undefined}>
        {seg(el.text, el.start, 0)}
      </p>,
    );
  }

  // Sélection relâchée : le passage devient aussitôt un plan (ou part dans l'action en saisie).
  const onMouseUp = (e: { clientX: number; clientY: number }) => {
    const started = root.current?.dataset.selecting !== undefined;
    if (root.current) delete root.current.dataset.selecting;
    if (!started) return;
    const sl = window.getSelection();
    const held = capture && useScriptCapture.getState().holding ? useScriptCapture.getState().target : null;
    const range = sl && !sl.isCollapsed && sl.rangeCount && root.current ? sl.getRangeAt(0) : null;
    const inside = !!range && !!root.current?.contains(range.commonAncestorContainer);
    const a = inside ? offsetOf(range.startContainer, range.startOffset) : null;
    const b = inside ? offsetOf(range.endContainer, range.endOffset) : null;
    const ok = a !== null && b !== null && b > a;
    if (held) {
      if (ok) {
        pour(a, b);
        window.getSelection()?.removeAllRanges();
      } else held.refocus();
      return;
    }
    if (!ok) return;
    addPassageAsShot(a, b, { x: e.clientX, y: e.clientY });
    window.getSelection()?.removeAllRanges();
  };

  // Relâcher la souris un peu hors du texte (marge du panneau) doit aussi faire apparaître le « + ».
  const upRef = useRef(onMouseUp);
  upRef.current = onMouseUp;
  useEffect(() => {
    const up = (e: globalThis.MouseEvent) => upRef.current(e);
    document.addEventListener('mouseup', up);
    return () => document.removeEventListener('mouseup', up);
  }, []);

  return (
    <div
      ref={root}
      className={[s.reader, className].join(' ')}
      data-capturing={capturing || undefined}
      // Le bouton enfoncé ici n'abandonne pas la saisie de la cellule : elle attend la sélection.
      onMouseDownCapture={(e) => {
        if (e.button !== 0 || (e.target as Element).closest('button')) return;
        // Sélection commencée ici : elle seule, une fois relâchée, crée le plan.
        if (root.current) root.current.dataset.selecting = '';
        if (capture && useScriptCapture.getState().target) useScriptCapture.setState({ holding: true });
      }}
      data-testid="script-reader"
    >
      {blocks.length === 0 && <p className={s.muted}>Le scénario est vide.</p>}
      {mark !== null && (
        <svg className={s.bookmark} style={{ top: mark }} width="8" height="13" viewBox="0 0 8 13" aria-label="Dernier passage découpé" data-testid="script-bookmark">
          <path d="M0.5 0.5h7v11.5L4 9.2 0.5 12z" />
        </svg>
      )}
      {blocks}
    </div>
  );
}

/** Enregistre le texte du scénario et recale les ancres des passages déjà liés au découpage. */
export function commitScenario(text: string) {
  if (text === (useProjectStore.getState().doc?.scenario ?? '')) return;
  mutateDoc((d) => {
    shiftAnchors(d, d.scenario ?? '', text);
    d.scenario = text;
  });
}

/** Interrupteur « liés à leur séquence / séquence au choix » pour les passages ajoutés au découpage. */
export function LinkModeToggle({ doc }: { doc: ProjectDoc }) {
  const auto = (doc.project.settings.scenarioLink ?? 'auto') === 'auto';
  return (
    <label className={s.linkMode} data-edit>
      <input
        type="checkbox"
        checked={auto}
        onChange={(e) => mutateDoc((d) => void (d.project.settings.scenarioLink = e.target.checked ? 'auto' : 'free'))}
        data-testid="scenario-link-mode"
      />
      Ranger dans sa séquence
    </label>
  );
}
