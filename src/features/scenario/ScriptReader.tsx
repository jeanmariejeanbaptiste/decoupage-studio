import { useMemo, useRef, useState, type ReactNode } from 'react';
import { matchSequence, parseFountain, sceneAt, scenesOf, shiftAnchors, type ScriptElement } from '../../domain/fountain';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import { createShotFromPassage, sentencesOf } from '../../domain/scriptToShot';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { goToShot } from '../registry/RegistryPage';
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
  const done = (shotId: ID | undefined) => {
    const after = useProjectStore.getState().doc;
    if (shotId && after)
      useUi.getState().toast({ message: `Plan ${shotCode(after, shotId)} ajouté au découpage.`, actionLabel: 'Voir', action: () => goToShot(useProjectStore.getState().doc!, shotId) });
  };
  if ((doc.project.settings.scenarioLink ?? 'auto') === 'auto') {
    done(mutateDoc((d) => createShotFromPassage(d, source, start, end, { dialogueShown })));
    return;
  }
  const sc = sceneAt(scenesOf(source), start);
  const suggested = sc ? matchSequence(doc, sc) : undefined;
  const ids = suggested ? [suggested, ...doc.project.sequenceIds.filter((id) => id !== suggested)] : doc.project.sequenceIds;
  const items = ids.map((id) => ({
    label: `Dans ${sequenceHeading(doc, id)}${id === suggested ? ' (suggérée)' : ''}`,
    action: () => done(mutateDoc((d) => createShotFromPassage(d, source, start, end, { dialogueShown, seqId: id }))),
  }));
  items.push({ label: 'Dans une nouvelle séquence', action: () => done(mutateDoc((d) => createShotFromPassage(d, source, start, end, { dialogueShown }))) });
  useUi.getState().set({ menu: { x: at.x, y: at.y, items } });
}

/** Position absolue dans le scénario d'un point de sélection (nœud texte d'un segment repéré). */
function offsetOf(node: Node, offset: number): number | null {
  const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest<HTMLElement>('[data-o]');
  if (!el) return null;
  return Number(el.dataset.o) + (node.nodeType === Node.TEXT_NODE ? offset : 0);
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

  const onMouseUp = () => {
    const sl = window.getSelection();
    if (!sl || sl.isCollapsed || !sl.rangeCount || !root.current) return setSel(null);
    const r = sl.getRangeAt(0);
    if (!root.current.contains(r.commonAncestorContainer)) return setSel(null);
    const a = offsetOf(r.startContainer, r.startOffset);
    const b = offsetOf(r.endContainer, r.endOffset);
    if (a === null || b === null || b <= a) return setSel(null);
    const rect = r.getBoundingClientRect();
    const box = root.current.getBoundingClientRect();
    setSel({ start: a, end: b, x: rect.right - box.left, y: rect.top - box.top });
  };

  return (
    <div ref={root} className={[s.reader, className].join(' ')} onMouseUp={onMouseUp} data-testid="script-reader">
      {elements.length === 0 && <p className={s.muted}>Le scénario est vide.</p>}
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
  mutateDoc((d) => {
    shiftAnchors(d, d.scenario ?? '', text);
    d.scenario = text;
  });
}

/** Interrupteur « liés à leur séquence / séquence au choix » pour les passages ajoutés au découpage. */
export function LinkModeToggle({ doc }: { doc: ProjectDoc }) {
  const auto = (doc.project.settings.scenarioLink ?? 'auto') === 'auto';
  return (
    <label className={s.linkMode} title="Lié : chaque passage va dans la séquence de sa scène (créée au besoin). Libre : vous choisissez la séquence à chaque ajout.">
      <input
        type="checkbox"
        checked={auto}
        onChange={(e) => mutateDoc((d) => void (d.project.settings.scenarioLink = e.target.checked ? 'auto' : 'free'))}
        data-testid="scenario-link-mode"
      />
      Ranger dans la séquence de la scène
    </label>
  );
}
