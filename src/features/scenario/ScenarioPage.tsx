import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Download, FilePlus2, FileUp, ListTree, ScrollText, SquarePen } from 'lucide-react';
import { navigate } from '../../app/router';
import { importScenes, matchSequence, parseFountain, sceneAt, scenesOf, shiftAnchors, splitSelection, type ScriptElement } from '../../domain/fountain';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import { addSequence, addShot } from '../../domain/ops';
import { setSequenceDecorByName } from '../../domain/registry';
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

/** Enregistre le texte (indicatif) et recale les ancres des passages liés ; le découpage n'est pas modifié. */
function commitScenario(text: string) {
  mutateDoc((d) => {
    shiftAnchors(d, d.scenario ?? '', text);
    d.scenario = text;
  });
}

export function ScenarioPage({ doc }: { doc: ProjectDoc }) {
  const [text, setText] = useState(doc.scenario ?? '');
  const [mode, setMode] = useState<'edit' | 'page' | 'cut'>('edit');
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

  /** Crée le plan dans la séquence choisie (menu), jamais par déduction silencieuse. */
  const createShot = (start: number, end: number, at?: { x: number; y: number }) => {
    if (end <= start) {
      toast({ message: 'Sélectionnez d’abord un passage du scénario.', tone: 'warn' });
      return;
    }
    flush();
    const current = useProjectStore.getState().doc;
    if (!current) return;
    const sc = sceneAt(scenesOf(text), start);
    const split = splitSelection(elements, start, end);
    const make = (seqId: ID | 'new') => {
      const shotId = mutateDoc((d) => {
        let target = seqId;
        if (target === 'new') {
          target = addSequence(d, undefined, {}, false);
          const seq = d.sequences[target];
          seq.label = (sc?.location ?? 'NOUVELLE SÉQUENCE').toUpperCase();
          seq.intExt = sc?.intExt ?? seq.intExt;
          seq.effect = sc?.effect ?? seq.effect;
          if (sc) setSequenceDecorByName(d, target, sc.location);
        }
        return addShot(d, target, {
          init: { subject: split.speakers[0] ?? '' },
          action: { text: split.action || (split.dialogue ? '' : text.slice(start, end).trim()), dialogue: split.dialogue || undefined, scenarioAnchor: { start, end } },
        });
      });
      const after = useProjectStore.getState().doc;
      if (shotId && after) toast({ message: `Plan ${shotCode(after, shotId)} créé avec cette action.`, actionLabel: 'Voir dans la grille', action: () => goToShot(useProjectStore.getState().doc!, shotId) });
    };
    const suggested = sc ? matchSequence(current, sc) : undefined;
    const ids = suggested ? [suggested, ...current.project.sequenceIds.filter((id) => id !== suggested)] : current.project.sequenceIds;
    const items = ids.map((id) => ({ label: `Créer le plan dans ${sequenceHeading(current, id)}${id === suggested ? ' (suggérée)' : ''}`, action: () => make(id) }));
    items.push({ label: `Créer le plan dans une nouvelle séquence${sc ? ` « ${sc.location.toUpperCase()} »` : ''}`, action: () => make('new') });
    const pos = at ?? { x: window.innerWidth / 2, y: 160 };
    setUi({ menu: { x: pos.x, y: pos.y, items } });
  };

  const onContextMenu = (e: MouseEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = ta;
    if (b <= a) return;
    e.preventDefault();
    createShot(a, b, { x: e.clientX, y: e.clientY });
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
      toast({ message: `Scénario importé : ${n} séquence${n > 1 ? 's' : ''} détectée${n > 1 ? 's' : ''}. Le découpage n’est pas modifié.`, actionLabel: 'Annuler', action: undo });
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
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'cut'}
              className={mode === 'cut' ? s.on : ''}
              title="Le découpage technique mis en forme comme un scénario (lecture seule)"
              onClick={() => {
                flush();
                setMode('cut');
              }}
            >
              <ListTree size={14} strokeWidth={1.25} /> Découpage
            </button>
          </div>
          <Button
            icon={<FilePlus2 size={15} strokeWidth={1.25} />}
            onClick={(e) => {
              const ta = taRef.current;
              const r = e.currentTarget.getBoundingClientRect();
              if (ta) createShot(ta.selectionStart, ta.selectionEnd, { x: r.left, y: r.bottom + 4 });
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
          {mode === 'cut' ? (
            <CutView doc={doc} />
          ) : mode === 'edit' ? (
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
          {scenes.some((sc) => !matchSequence(doc, sc)) && (
            <button
              type="button"
              className={s.quiet}
              data-testid="import-scenes"
              title="Ajoute à la fin du découpage les séquences du scénario qui n’y figurent pas encore (rien n’est modifié ni réordonné)"
              onClick={() => {
                flush();
                const r = mutateDoc((d) => importScenes(d, latest.current));
                if (r) toast({ message: `${r.sequences} séquence${r.sequences > 1 ? 's' : ''} et ${r.characters} personnage${r.characters > 1 ? 's' : ''} ajouté${r.sequences + r.characters > 1 ? 's' : ''} au découpage.`, actionLabel: 'Annuler', action: undo });
              }}
            >
              + Ajouter au découpage les {scenes.filter((sc) => !matchSequence(doc, sc)).length} séquence(s) absente(s)
            </button>
          )}
          {doc.project.sequenceIds.length === 0 && <p className={s.muted}>Le découpage est vide : sélectionnez un passage puis « Créer un plan ».</p>}
          {doc.project.sequenceIds.map((seqId) => {
            const seq = doc.sequences[seqId];
            return (
              <section key={seqId} className={s.scene}>
                <h3>
                  {sequenceHeading(doc, seqId)}
                  <span>{[seq?.intExt, seq?.effect].filter(Boolean).join(' · ')}</span>
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

/** Le découpage mis en forme comme un scénario : lecture seule, toujours à jour. */
function CutView({ doc }: { doc: ProjectDoc }) {
  return (
    <div className={s.cut} data-testid="scenario-cut">
      <p className={s.muted}>Version découpage, en lecture seule : elle reflète le découpage technique et ne se modifie pas ici.</p>
      {doc.project.sequenceIds.map((seqId) => {
        const seq = doc.sequences[seqId];
        return (
          <section key={seqId}>
            <h3>
              {doc.project.sequenceIds.indexOf(seqId) + 1}. {[seq?.intExt, seq?.label, seq?.effect].filter(Boolean).join(' – ')}
            </h3>
            {(seq?.actionBlockIds ?? []).map((bId) => {
              const b = doc.blocks[bId];
              const shots = (seq?.shotIds ?? []).filter((id) => doc.shots[id]?.actionBlockId === bId);
              if (!b) return null;
              return (
                <div key={bId} className={s.cutBlock}>
                  <span className={s.cutShots}>{shots.map((id) => shotCode(doc, id)).join(', ')}</span>
                  {b.text && <p>{b.text}</p>}
                  {b.dialogue && <p className={s.cutDialogue}>{b.dialogue}</p>}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
