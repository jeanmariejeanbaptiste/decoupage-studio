import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { matchSequence, parseFountain, sceneAt, scenesOf, shiftAnchors, type ScriptElement } from '../../domain/fountain';
import { sequenceHeading } from '../../domain/numbering';
import { createShotsFromSelection, sentencesOf, splitByScene } from '../../domain/scriptToShot';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import s from './ScriptReader.module.css';

/**
 * Crée un plan à partir d'un passage du scénario : en mode lié, directement dans la séquence de la
 * scène (créée au besoin) ; en mode libre, après le choix de la séquence dans un menu.
 */
export function addPassageAsShot(start: number, end: number, at: { x: number; y: number }) {
  const doc = useProjectStore.getState().doc;
  const source = doc?.scenario ?? '';
  if (!doc || end <= start) return;
  const dialogueShown = doc.project.settings.gridColumns.includes('dialogue');
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
 */
export function ScriptReader({ doc, source, className }: { doc: ProjectDoc; source: string; className?: string }) {
  const elements = useMemo(() => parseFountain(source), [source]);
  const sentences = useMemo(() => sentencesOf(source, elements), [source, elements]);
  const anchors = useMemo(
    () =>
      Object.values(doc.blocks)
        .map((b) => b.scenarioAnchor)
        .filter((a): a is { start: number; end: number } => !!a && a.end > a.start),
    [doc.blocks],
  );
  const linked = (a: number, b: number) => anchors.some((x) => a < x.end && b > x.start);
  const root = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ start: number; end: number; x: number; y: number } | null>(null);

  const plus = (start: number, end: number, label: string) => (
    <button
      type="button"
      className={s.plus}
      aria-label={label}
      title="Ajouter au découpage"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => addPassageAsShot(start, end, { x: e.clientX, y: e.clientY })}
      data-testid="script-plus"
    />
  );

  const seg = (text: string, o: number, key: string | number) => (
    <span key={key} data-o={o}>
      {text}
    </span>
  );

  // Rendu : répliques groupées (nom, didascalie, texte), actions découpées en phrases.
  const blocks: ReactNode[] = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    // Page de garde (« Title: », « Credit: »…) : elle a son propre éditeur, le lecteur ne la montre pas.
    if (el.type === 'title') continue;
    if (el.type === 'character') {
      const group: ScriptElement[] = [el];
      while (elements[i + 1] && (elements[i + 1].type === 'dialogue' || elements[i + 1].type === 'parenthetical')) group.push(elements[++i]);
      const end = group[group.length - 1].end;
      blocks.push(
        <div key={el.start} className={[s.reply, linked(el.start, end) ? s.linked : ''].join(' ')} data-testid="script-reply">
          {group.map((g) => (
            <p key={g.start} className={s[`el_${g.type}`]}>
              {seg(g.text, g.start, 0)}
            </p>
          ))}
          {plus(el.start, end, `Ajouter la réplique de ${el.text} au découpage`)}
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
          <span key={sn.start} className={[s.sentence, linked(sn.start, sn.end) ? s.linked : ''].join(' ')} data-testid="script-sentence">
            {seg(source.slice(sn.start, sn.end), sn.start, 0)}
            {plus(sn.start, sn.end, `Ajouter « ${source.slice(sn.start, sn.end).slice(0, 40)} » au découpage`)}
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
      <p key={el.start} className={s[`el_${el.type}`]}>
        {seg(el.text, el.start, 0)}
      </p>,
    );
  }

  // Le « + » suit la sélection : dès qu'elle disparaît (clic ailleurs, Échap…), il disparaît aussi.
  const hasSel = !!sel;
  useEffect(() => {
    if (!hasSel) return;
    const check = () => {
      const sl = window.getSelection();
      if (!sl || sl.isCollapsed || !sl.rangeCount || !root.current?.contains(sl.getRangeAt(0).commonAncestorContainer)) setSel(null);
    };
    document.addEventListener('selectionchange', check);
    return () => document.removeEventListener('selectionchange', check);
  }, [hasSel]);

  const onMouseUp = (e: { clientX: number; clientY: number }) => {
    const sl = window.getSelection();
    if (!sl || sl.isCollapsed || !sl.rangeCount || !root.current) return setSel(null);
    const r = sl.getRangeAt(0);
    if (!root.current.contains(r.commonAncestorContainer)) return setSel(null);
    const a = offsetOf(r.startContainer, r.startOffset);
    const b = offsetOf(r.endContainer, r.endOffset);
    if (a === null || b === null || b <= a) return setSel(null);
    // Le « + » apparaît au ras du curseur, là où la sélection a été relâchée.
    const box = root.current.getBoundingClientRect();
    setSel({ start: a, end: b, x: e.clientX - box.left + root.current.scrollLeft, y: e.clientY - box.top + root.current.scrollTop });
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
    <div ref={root} className={[s.reader, className].join(' ')} data-testid="script-reader">
      {blocks.length === 0 && <p className={s.muted}>Le scénario est vide.</p>}
      {blocks}
      {sel && (
        <button
          type="button"
          className={s.selPlus}
          style={{ left: sel.x, top: sel.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            addPassageAsShot(sel.start, sel.end, { x: e.clientX, y: e.clientY });
            window.getSelection()?.removeAllRanges();
            setSel(null);
          }}
          title="Ajouter la sélection au découpage"
          aria-label="Ajouter la sélection au découpage"
          data-testid="script-selection-plus"
        />
      )}
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
