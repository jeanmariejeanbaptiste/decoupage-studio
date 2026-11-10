import { useEffect, useMemo, useRef, useState } from 'react';
import { outlineMeasures, setPhrase } from '../../domain/outline';
import { findSequence, panelRows, type PanelRow } from '../../domain/outlinePanel';
import { applyScenarioEdit } from '../../domain/ops';
import { headingNumbers } from '../../domain/screenplay';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useRevisionMarks } from '../versions/useRevisionMarks';
import { useScriptUi, type ScriptEditorApi } from './ScriptEditor';
import s from './SequencesPanel.module.css';

interface Props {
  doc: ProjectDoc;
  /** Éditeur ouvert (ou `null`) : aller à une séquence, enregistrer avant d'écrire, garder le curseur. */
  api: React.RefObject<ScriptEditorApi | null>;
  /** Séquence du curseur ; par défaut, celle de l'éditeur. */
  activeN?: number;
  readOnly?: boolean;
  /** Clic sur un en-tête ; par défaut, l'éditeur va à la séquence (`api.scrollTo`). */
  onPick?: (n: number) => void;
}

type Seq = Extract<PanelRow, { kind: 'sequence' }>;

/**
 * Onglet Séquences du panneau de Texte : une ligne par séquence (numéro, en-tête, page) et sa phrase,
 * modifiable sur place. Tout est lu dans le texte enregistré (`doc.scenario`).
 */
export function SequencesPanel({ doc, api, activeN, readOnly = false, onPick }: Props) {
  const source = doc.scenario ?? '';
  const measures = outlineMeasures(doc);
  const rows = useMemo(() => panelRows(source, (n) => measures.byN.get(n)?.page), [source, measures]);
  const marks = useRevisionMarks(doc);
  const from = marks ? doc.versions?.find((v) => v.id === doc.versions?.find((x) => x.id === doc.activeVersionId)?.from)?.name : undefined;
  const editorN = useScriptUi((u) => (u.activeHeading ? headingNumbers(u.blocks).get(u.activeHeading) : undefined));
  const current = activeN ?? editorN;
  const [editing, setEditing] = useState<string | null>(null);

  if (!rows.some((r) => r.kind === 'sequence')) return <p className={s.empty}>Aucune séquence</p>;

  const pick = (n: number) => {
    if (onPick) return onPick(n);
    const { blocks } = useScriptUi.getState();
    const id = [...headingNumbers(blocks)].find(([, k]) => k === n)?.[0];
    if (id) api.current?.scrollTo(id);
  };

  /** Écrit la phrase dans le texte, en une seule étape d'annulation ; `false` si la séquence a disparu. */
  const save = (row: Seq, text: string): boolean => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t === row.phrase.trim()) return true;
    api.current?.flush();
    const src = useProjectStore.getState().doc?.scenario ?? '';
    const n = findSequence(src, row.n, row.heading, row.rank);
    if (n === undefined) return false;
    const edit = setPhrase(src, n, t);
    if (edit.source === src) return true;
    api.current?.expectExternal(edit.map, edit.source);
    mutateDoc((d) => applyScenarioEdit(d, edit));
    return true;
  };

  return (
    <ol className={s.list} data-testid="sequences-panel">
      {rows.map((r) =>
        r.kind === 'part' ? (
          <li key={r.key} className={s.part}>
            {r.title}
          </li>
        ) : (
          <li key={r.key} className={[s.seq, r.n === current ? s.current : ''].join(' ')} aria-current={r.n === current || undefined} data-testid="sequences-row">
            <button type="button" className={s.head} onClick={() => pick(r.n)}>
              <span className={s.n}>
                {marks?.get(r.n - 1) && (
                  <i className={s.rev} title={marks.get(r.n - 1) === 'new' ? `Nouvelle depuis ${from}` : `Modifiée depuis ${from}`} data-testid="revision-mark">
                    *
                  </i>
                )}
                {r.n}
              </span>
              <span className={s.h}>{r.heading}</span>
              {r.page !== undefined && <span className={s.p}>{r.page}</span>}
            </button>
            {editing === r.key ? (
              <PhraseField
                initial={r.phrase}
                label={`Phrase de la séquence ${r.n}`}
                onDone={(text) => {
                  const ok = text === null || save(r, text);
                  if (ok) setEditing(null);
                  return ok;
                }}
              />
            ) : readOnly ? (
              r.phrase && <p className={s.phrase}>{r.phrase}</p>
            ) : (
              <button type="button" className={[s.phrase, s.phraseBtn].join(' ')} aria-label={`Phrase de la séquence ${r.n}`} onClick={() => setEditing(r.key)} data-testid="sequences-phrase">
                {r.phrase}
              </button>
            )}
          </li>
        ),
      )}
    </ol>
  );
}

/** Édition de la phrase : Entrée valide, Échap annule ; quitter le champ valide (rien ne se perd). */
function PhraseField({ initial, label, onDone }: { initial: string; label: string; onDone: (text: string | null) => boolean }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = onDone(text);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [v]);
  return (
    <textarea
      ref={ref}
      className={[s.phrase, s.field].join(' ')}
      aria-label={label}
      rows={1}
      value={v}
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(v);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(v)}
      data-testid="sequences-phrase-field"
    />
  );
}
