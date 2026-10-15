import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Download, FilePlus2, FileUp, ScrollText, SquarePen } from 'lucide-react';
import { navigate } from '../../app/router';
import { parseFountain, sceneAt, scenesOf, shiftAnchors, splitSelection, syncScenario, type ScriptElement } from '../../domain/fountain';
import { shotCode } from '../../domain/numbering';
import { addShot } from '../../domain/ops';
import type { ID, ProjectDoc } from '../../domain/types';
import { downloadBlob, pickFile } from '../../store/persistence';
import { mutateDoc, undo, useProjectStore } from '../../store/projectStore';
import { ask } from '../../ui/dialogStore';
import { readScenarioFile } from './readScenarioFile';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { goToShot } from '../registry/RegistryPage';
import s from './ScenarioPage.module.css';

const SYNC_DELAY = 900;

interface Mark {
  start: number;
  end: number;
  blockId: ID;
  color: string;
}

/** Applique le texte au projet : recale les ancres puis synchronise séquences et personnages. */
function commitScenario(text: string) {
  mutateDoc((d) => {
    shiftAnchors(d, d.scenario ?? '', text);
    syncScenario(d, text);
  });
}

export function ScenarioPage({ doc }: { doc: ProjectDoc }) {
  const [text, setText] = useState(doc.scenario ?? '');
  const [mode, setMode] = useState<'edit' | 'page'>('edit');
  const [hoverBlock, setHoverBlock] = useState<ID | null>(null);
  const [caretBlock, setCaretBlock] = useState<ID | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const toast = useUi((u) => u.toast);
  const setUi = useUi((u) => u.set);

  // Rechargement quand on change de projet.
  useEffect(() => setText(doc.scenario ?? ''), [doc.project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // En quittant la page, le texte en attente est appliqué.
  const latest = useRef(text);
  latest.current = text;
  useEffect(
    () => () => {
      if (latest.current !== (useProjectStore.getState().doc?.scenario ?? '')) commitScenario(latest.current);
    },
    [],
  );

  // Analyse automatique, débouncée.
  useEffect(() => {
    if (text === (useProjectStore.getState().doc?.scenario ?? '')) return;
    const t = setTimeout(() => commitScenario(text), SYNC_DELAY);
    return () => clearTimeout(t);
  }, [text]);

  const elements = useMemo(() => parseFountain(text), [text]);
  const scenes = useMemo(() => scenesOf(text, elements), [text, elements]);
  const marks: Mark[] = useMemo(() => {
    const out: Mark[] = [];
    for (const seqId of doc.project.sequenceIds) {
      const seq = doc.sequences[seqId];
      for (const bId of seq?.actionBlockIds ?? []) {
        const a = doc.blocks[bId]?.scenarioAnchor;
        if (a && a.end > a.start) out.push({ start: a.start, end: a.end, blockId: bId, color: seq.color ?? 'var(--rust)' });
      }
    }
    return out.sort((x, y) => x.start - y.start);
  }, [doc]);

  const flush = () => {
    if (text !== (useProjectStore.getState().doc?.scenario ?? '')) commitScenario(text);
  };

  const createShot = (start: number, end: number) => {
    if (end <= start) {
      toast({ message: 'Sélectionnez d’abord un passage du scénario.', tone: 'warn' });
      return;
    }
    flush();
    const sc = sceneAt(scenesOf(text), start);
    if (!sc) {
      toast({ message: 'Le passage doit se trouver sous un en-tête de séquence (INT. / EXT.).', tone: 'warn' });
      return;
    }
    const split = splitSelection(elements, start, end);
    const shotId = mutateDoc((d) => {
      const seqId = d.project.sequenceIds[sc.index];
      if (!seqId) return undefined;
      return addShot(d, seqId, {
        init: { subject: split.speakers[0] ?? '' },
        action: { text: split.action || (split.dialogue ? '' : text.slice(start, end).trim()), dialogue: split.dialogue || undefined, scenarioAnchor: { start, end } },
      });
    });
    const after = useProjectStore.getState().doc;
    if (shotId && after) {
      toast({ message: `Plan ${shotCode(after, shotId)} créé avec cette action.`, actionLabel: 'Voir dans la grille', action: () => goToShot(useProjectStore.getState().doc!, shotId) });
    }
  };

  const onContextMenu = (e: MouseEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = ta;
    if (b <= a) return;
    e.preventDefault();
    setUi({ menu: { x: e.clientX, y: e.clientY, items: [{ label: 'Créer un plan avec cette action', action: () => createShot(a, b) }] } });
  };

  const onCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    setCaretBlock(marks.find((m) => pos >= m.start && pos <= m.end)?.blockId ?? null);
  };

  const importFile = async () => {
    const f = await pickFile('.fountain,.txt,.spmd,.md,.markdown,.pdf,.docx,.doc,text/plain,application/pdf', false);
    if (!f) return;
    if (text.trim()) {
      const r = await ask({ title: 'Remplacer le scénario actuel ?', body: `Le texte de « ${f.name} » remplacera le scénario en cours (annulable).`, confirmLabel: 'Remplacer' });
      if (!r.ok) return;
    }
    try {
      toast({ message: `Lecture de « ${f.name} »…` });
      const content = await readScenarioFile(f);
      setText(content);
      commitScenario(content);
      const n = scenesOf(content).length;
      toast({ message: `Scénario importé : ${n} séquence${n > 1 ? 's' : ''} détectée${n > 1 ? 's' : ''}.`, actionLabel: 'Annuler', action: undo });
    } catch (e) {
      toast({ message: (e as Error).message || 'Ce fichier n’a pas pu être lu.', tone: 'warn' });
    }
  };

  const highlighted = hoverBlock ?? caretBlock;
  const nScenes = scenes.length;

  return (
    <div className="page page--wide">
      <header className="page-head">
        <div>
          <p className="page-kicker">Étape 2 · Scénario</p>
          <h1 className="page-title">
            {nScenes ? (
              <>
                Le scénario en <em>{nScenes}</em> séquence{nScenes > 1 ? 's' : ''}
              </>
            ) : (
              'Le scénario'
            )}
          </h1>
        </div>
        <div className={s.toolbar}>
          <div className={s.seg} role="radiogroup" aria-label="Affichage du scénario">
            <button type="button" role="radio" aria-checked={mode === 'edit'} className={mode === 'edit' ? s.on : ''} onClick={() => setMode('edit')}>
              <SquarePen size={14} strokeWidth={1.25} /> Fountain
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'page'}
              className={mode === 'page' ? s.on : ''}
              onClick={() => {
                flush();
                setMode('page');
              }}
            >
              <ScrollText size={14} strokeWidth={1.25} /> Page
            </button>
          </div>
          <Button
            icon={<FilePlus2 size={15} strokeWidth={1.25} />}
            onClick={() => {
              const ta = taRef.current;
              if (ta) createShot(ta.selectionStart, ta.selectionEnd);
            }}
            disabled={mode !== 'edit'}
            title="Créer un plan avec le passage sélectionné (aussi au clic droit)"
            data-testid="create-shot-from-selection"
          >
            Créer un plan
          </Button>
          <Button variant="outline" icon={<FileUp size={15} strokeWidth={1.25} />} onClick={importFile}>
            Importer (PDF, Word, MD…)
          </Button>
          <Button
            variant="outline"
            icon={<Download size={15} strokeWidth={1.25} />}
            onClick={() => downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${doc.project.title || 'scenario'}.fountain`)}
            disabled={!text.trim()}
          >
            .fountain
          </Button>
        </div>
      </header>

      <div className={s.layout}>
        <div className={['card', s.paper].join(' ')}>
          {mode === 'edit' ? (
            <Editor text={text} onChange={setText} marks={marks} highlighted={highlighted} taRef={taRef} onContextMenu={onContextMenu} onCaret={onCaret} onBlur={flush} />
          ) : (
            <ScriptPage elements={elements} marks={marks} highlighted={highlighted} onHover={setHoverBlock} />
          )}
        </div>
        <aside className={s.side} aria-label="Séquences et plans liés">
          <div className={s.sideHead}>
            <Hand>plans liés au scénario</Hand>
            <Button variant="outline" size="sm" onClick={() => navigate('grid')}>
              Ouvrir le découpage
            </Button>
          </div>
          {scenes.length === 0 && <p className={s.muted}>Écrivez un en-tête (INT. LIEU - JOUR) pour créer une séquence.</p>}
          {scenes.map((sc) => {
            const seqId = doc.project.sequenceIds[sc.index];
            const seq = seqId ? doc.sequences[seqId] : undefined;
            return (
              <section key={sc.index} className={s.scene}>
                <h3>
                  {sc.index + 1}, {sc.location.toUpperCase()}
                  <span>{[sc.intExt, sc.effect].filter(Boolean).join(' · ')}</span>
                </h3>
                <ul>
                  {(seq?.shotIds ?? []).map((id) => {
                    const shot = doc.shots[id];
                    const block = doc.blocks[shot.actionBlockId];
                    const linked = !!block?.scenarioAnchor;
                    return (
                      <li
                        key={id}
                        className={[linked ? s.linked : '', highlighted && shot.actionBlockId === highlighted ? s.hot : ''].join(' ')}
                        onMouseEnter={() => linked && setHoverBlock(shot.actionBlockId)}
                        onMouseLeave={() => setHoverBlock(null)}
                        data-testid="scenario-shot"
                      >
                        <button type="button" onClick={() => goToShot(doc, id)}>
                          {shotCode(doc, id)}
                        </button>
                        <span className={s.what}>
                          {[shot.subject, shot.value].filter(Boolean).join(' · ') || '—'}
                          <em>{block?.text || block?.dialogue}</em>
                        </span>
                      </li>
                    );
                  })}
                  {seq && seq.shotIds.length === 0 && <li className={s.muted}>Aucun plan : sélectionnez un passage puis « Créer un plan ».</li>}
                </ul>
              </section>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

function Editor({
  text,
  onChange,
  marks,
  highlighted,
  taRef,
  onContextMenu,
  onCaret,
  onBlur,
}: {
  text: string;
  onChange: (t: string) => void;
  marks: Mark[];
  highlighted: ID | null;
  taRef: React.RefObject<HTMLTextAreaElement>;
  onContextMenu: (e: MouseEvent<HTMLTextAreaElement>) => void;
  onCaret: () => void;
  onBlur: () => void;
}) {
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.max(480, ta.scrollHeight)}px`;
  }, [text, taRef]);

  // Fond de surlignage : même typographie que la zone de saisie, texte transparent.
  const parts: Array<{ text: string; mark?: Mark }> = [];
  let pos = 0;
  for (const m of marks) {
    const a = Math.max(pos, Math.min(m.start, text.length));
    const b = Math.min(m.end, text.length);
    if (b <= a) continue;
    if (a > pos) parts.push({ text: text.slice(pos, a) });
    parts.push({ text: text.slice(a, b), mark: m });
    pos = b;
  }
  parts.push({ text: text.slice(pos) + '\n' });

  return (
    <div className={s.editor}>
      <div className={s.backdrop} aria-hidden="true">
        {parts.map((p, i) =>
          p.mark ? (
            <mark key={i} className={p.mark.blockId === highlighted ? s.markHot : s.mark} style={{ ['--mark' as string]: p.mark.color }}>
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>
      <textarea
        ref={taRef}
        className={s.textarea}
        value={text}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onContextMenu={onContextMenu}
        onSelect={onCaret}
        onBlur={onBlur}
        aria-label="Scénario (syntaxe Fountain)"
        placeholder={'INT. CHAMBRE - JOUR\n\nLéa, assise sur le lit, regarde l’affiche.\n\nLÉA\n(murmurant)\nUn jour, ce sera moi.'}
        data-testid="scenario-editor"
      />
    </div>
  );
}

function ScriptPage({ elements, marks, highlighted, onHover }: { elements: ScriptElement[]; marks: Mark[]; highlighted: ID | null; onHover: (id: ID | null) => void }) {
  const markOf = (el: ScriptElement) => marks.find((m) => el.start < m.end && el.end > m.start);
  return (
    <div className={s.script} data-testid="scenario-page">
      {elements.length === 0 && <p className={s.muted}>Le scénario est vide.</p>}
      {elements.map((el, i) => {
        const m = markOf(el);
        return (
          <p
            key={i}
            className={[s[`el_${el.type}`], m ? (m.blockId === highlighted ? s.markHot : s.mark) : ''].join(' ')}
            style={m ? { ['--mark' as string]: m.color } : undefined}
            onMouseEnter={() => m && onHover(m.blockId)}
            onMouseLeave={() => m && onHover(null)}
          >
            {el.text}
          </p>
        );
      })}
    </div>
  );
}
