import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { useLocation } from '../../app/router';
import { mmss } from '../../domain/chronometry';
import {
  diffItems,
  diffScripts,
  readable,
  type BlockDiff,
  type DiffStats,
  type SceneDiff,
  type Seg,
} from '../../domain/scriptDiff';
import { foldLabel, movedLabel, summaryLines } from '../../domain/scriptDiffLayout';
import { SCRIPT_PAGE, blankLinesBefore } from '../../domain/scriptLayout';
import type { BlockType } from '../../domain/screenplay';
import type { ProjectDoc } from '../../domain/types';
import { comparableVersions, comparisonPair, versionText } from '../../domain/versions';
import { downloadBlob } from '../../store/persistence';
import { useCanCopy, useReadOnly } from '../../store/share';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { PAGE } from '../scenario/ScriptEditor';
import { compareClosed, leaveCompare, openSequenceInEditor, setCompared } from './compareUi';
import s from './ComparePage.module.css';

const LINE = 16;
const PT = LINE / SCRIPT_PAGE.lineH;

const ONLY_KEY = 'ds-compare-only';
const savedOnly = () => {
  try {
    return localStorage.getItem(ONLY_KEY) === '1';
  } catch {
    return false;
  }
};

/** Morceau d'un bloc modifié : chaque mot marqué, les espaces non (une fin de ligne ne se souligne pas). */
function SegView({ seg }: { seg: Seg }) {
  if (seg.op === 'eq') return <>{seg.text}</>;
  const Mark = seg.op === 'add' ? 'ins' : 'del';
  return (
    <>
      {seg.text.split(/(\s+)/).map((w, k) => (k % 2 || !w ? w : <Mark key={k}>{w}</Mark>))}
    </>
  );
}

interface SceneProps {
  sc: SceneDiff;
  index: number;
  /** Numéros des points de passage, par bloc. */
  stops?: Map<number, number>;
  /** Type du bloc précédent (espacement), pour la première ligne de la séquence. */
  prev?: BlockType;
  onOpen?: (n: number) => void;
}

/** Une séquence : blocs aux colonnes du scénario, marques sans couleur. */
const SceneView = memo(function SceneView({ sc, index, stops, prev, onOpen }: SceneProps) {
  let before = prev;
  return (
    <section className={s.scene} data-scene={index} data-status={sc.status} data-testid="compare-scene">
      {sc.blocks.map((b: BlockDiff, bi) => {
        const gap = before ? blankLinesBefore(before, b.type) : 0;
        before = b.type;
        const head = bi === 0 && b.type === 'heading' && !sc.prelude;
        const n = head ? (sc.after ?? sc.before) : undefined;
        const stop = stops?.get(bi);
        const body =
          b.op === 'mod'
            ? readable(b.segs).map((x, k) => <SegView key={k} seg={x} />)
            : b.segs.map((x) => x.text).join('');
        return (
          <div
            key={bi}
            className={[s.b, s[`t_${b.type}`], s[`op_${b.op}`]].join(' ')}
            style={gap ? { marginTop: gap * LINE } : undefined}
            data-n={n}
            data-stop={stop}
            data-op={b.op}
          >
            {head && sc.moved && sc.before ? <span className={s.moved}>{movedLabel(sc.before)}</span> : null}
            {head && onOpen && sc.after ? (
              <button
                type="button"
                className={s.open}
                onClick={() => onOpen(sc.after!)}
                title="Ouvrir dans l’éditeur"
                data-view
              >
                {body}
              </button>
            ) : (
              body
            )}
          </div>
        );
      })}
    </section>
  );
});

/** Plus proche ancêtre qui défile (la zone principale de l'application). */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  return null;
}

/** Résumé chiffré : séquences, mots, pages et durée (de la référence à la version lue). */
function Summary({ st }: { st: DiffStats }) {
  const seq = [
    st.added && `${st.added} ajoutée${st.added > 1 ? 's' : ''}`,
    st.removed && `${st.removed} retirée${st.removed > 1 ? 's' : ''}`,
    st.changed && `${st.changed} modifiée${st.changed > 1 ? 's' : ''}`,
    st.moved && `${st.moved} déplacée${st.moved > 1 ? 's' : ''}`,
  ].filter(Boolean);
  return (
    <dl className={s.summary} data-testid="compare-summary">
      <div>
        <dt>Séquences</dt>
        <dd>{seq.length ? seq.join(' · ') : 'aucun changement'}</dd>
      </div>
      <div>
        <dt>Mots</dt>
        <dd>
          +{st.wordsAdded} <span className={s.sep}>/</span> −{st.wordsRemoved}
        </dd>
      </div>
      <div>
        <dt>Pages</dt>
        <dd>
          {st.before.pages} → {st.after.pages}
        </dd>
      </div>
      <div>
        <dt>Durée</dt>
        <dd>
          {mmss(st.before.seconds)} → {mmss(st.after.seconds)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Comparaison de deux versions du scénario : le texte entier d'une version, ce qui a changé depuis
 * l'autre marqué (sans couleur). Lecture seule, pour tous (invités et relecteurs compris).
 */
export function ComparePage({ doc }: { doc: ProjectDoc }) {
  const { params } = useLocation();
  // Invité ou relecteur : les versions publiées seulement (une version plus récente reste privée).
  const guest = useReadOnly();
  const pair = comparisonPair(doc, params.get('compare'), guest);
  const canCopy = useCanCopy();
  const [only, setOnlyState] = useState(savedOnly);
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
  const setOnly = (on: boolean) => {
    setOnlyState(on);
    setUnfolded(new Set());
    try {
      localStorage.setItem(ONLY_KEY, on ? '1' : '0');
    } catch {
      /* choix valable pour la session */
    }
  };
  const textA = pair ? (versionText(doc, pair.a) ?? '') : '';
  const textB = pair ? (versionText(doc, pair.b) ?? '') : '';
  const chrono = doc.project.settings.scriptChrono;
  const diff = useMemo(() => diffScripts(textB, textA, chrono), [textA, textB, chrono]);
  const items = useMemo(() => {
    const raw = diffItems(diff, only);
    // Lignes repliées rouvertes : leurs séquences reprennent leur place.
    return raw.flatMap((it) =>
      it.kind === 'fold' && unfolded.has(it.scenes[0])
        ? it.scenes.map((index) => ({ kind: 'scene' as const, index }))
        : [it],
    );
  }, [diff, only, unfolded]);
  const stops = useMemo(() => {
    const out = new Map<number, Map<number, number>>();
    diff.changes.forEach((c, k) => {
      const m = out.get(c.scene) ?? new Map<number, number>();
      m.set(c.block, k);
      out.set(c.scene, m);
    });
    return out;
  }, [diff]);

  const versions = comparableVersions(doc, guest);
  const nameOf = (id: string) => versions.find((v) => v.id === id)?.name ?? '';
  const editable = !!pair && pair.a === doc.activeVersionId;

  const bar = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  /** Va au changement suivant ou précédent, d'après ce qui est à l'écran (le défilement à la main compte). */
  const step = (dir: 1 | -1) => {
    const root = sheet.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-stop]'));
    const top = (bar.current?.getBoundingClientRect().bottom ?? 0) + 24;
    // Changement atteint encore à l'écran : on part de lui (la fin du texte ne remonte pas jusqu'en haut).
    const cur = root.querySelector<HTMLElement>('[data-current]');
    const r = cur?.getBoundingClientRect();
    const k = cur && r && r.bottom > top - 24 && r.top < window.innerHeight ? els.indexOf(cur) : -1;
    const target =
      k >= 0
        ? els[k + dir]
        : dir > 0
          ? els.find((e) => e.getBoundingClientRect().top > top + 2)
          : [...els].reverse().find((e) => e.getBoundingClientRect().top < top - 2);
    if (!target) return;
    const sc = scroller(root);
    if (sc) sc.scrollBy({ top: target.getBoundingClientRect().top - top });
    else window.scrollBy({ top: target.getBoundingClientRect().top - top });
    root.querySelector('[data-current]')?.removeAttribute('data-current');
    target.setAttribute('data-current', '');
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'j' || e.key === 'J') stepRef.current(1);
      else if (e.key === 'k' || e.key === 'K') stepRef.current(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => {
      window.removeEventListener('keydown', on);
      compareClosed();
    };
  }, []);

  const exportPdf = async () => {
    if (!pair) return;
    try {
      const { comparePdf } = await import('./compareExport');
      const header = [
        `Comparaison : ${nameOf(pair.a)} avec ${nameOf(pair.b)}`,
        ...summaryLines(diff.stats, nameOf(pair.a), nameOf(pair.b)),
      ];
      const blob = await comparePdf(diff, diffItems(diff, only), header, {
        title: doc.project.title || 'Scénario',
      });
      downloadBlob(blob, `${doc.project.title || 'scenario'}-${nameOf(pair.a)}-${nameOf(pair.b)}.pdf`);
    } catch (e) {
      useUi.getState().toast({ message: (e as Error).message || 'L’export a échoué.', tone: 'warn' });
    }
  };

  const pick = (which: 'a' | 'b', id: string) => {
    if (!pair) return;
    const other = which === 'a' ? pair.b : pair.a;
    // Même version des deux côtés : les deux listes s'échangent.
    const [a, b] = which === 'a' ? [id, id === other ? pair.a : other] : [id === other ? pair.b : other, id];
    setUnfolded(new Set());
    setCompared(a, b);
  };

  // Type du dernier bloc affiché avant chaque séquence (espacement entre séquences).
  let prevType: BlockType | undefined;
  return (
    <div className={['page page--wide', s.page].join(' ')} data-view data-testid="compare-page">
      <header className={s.toolbar} ref={bar}>
        <div className={s.tools}>
          <Button
            variant="icon"
            icon={<ArrowLeft size={16} strokeWidth={1.25} />}
            onClick={leaveCompare}
            aria-label="Retour"
            title="Retour"
            data-testid="compare-back"
          />
          {pair && (
            <span className={s.pair}>
              <label>
                <span>Comparer</span>
                <select
                  value={pair.a}
                  onChange={(e) => pick('a', e.target.value)}
                  aria-label="Version lue"
                  data-testid="compare-a"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>avec</span>
                <select
                  value={pair.b}
                  onChange={(e) => pick('b', e.target.value)}
                  aria-label="Version de référence"
                  data-testid="compare-b"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            </span>
          )}
        </div>
        <div className={s.tools}>
          <button
            type="button"
            className={[s.toggle, only ? s.on : ''].join(' ')}
            aria-pressed={only}
            onClick={() => setOnly(!only)}
            data-testid="compare-only"
          >
            Seulement les changements
          </button>
          <Button
            variant="icon"
            icon={<ChevronUp size={16} strokeWidth={1.25} />}
            onClick={() => step(-1)}
            disabled={!diff.changes.length}
            aria-label="Changement précédent (K)"
            title="Changement précédent (K)"
            data-testid="compare-prev"
          />
          <Button
            variant="icon"
            icon={<ChevronDown size={16} strokeWidth={1.25} />}
            onClick={() => step(1)}
            disabled={!diff.changes.length}
            aria-label="Changement suivant (J)"
            title="Changement suivant (J)"
            data-testid="compare-next"
          />
          {canCopy && (
            <Button
              variant="icon"
              icon={<Download size={16} strokeWidth={1.25} />}
              onClick={exportPdf}
              disabled={!pair}
              aria-label="Exporter en PDF"
              title="Exporter en PDF"
              data-testid="compare-export"
            />
          )}
        </div>
      </header>
      {pair ? (
        <>
          <Summary st={diff.stats} />
          <div
            className={s.sheet}
            ref={sheet}
            style={
              {
                ['--pt' as string]: `${PT}px`,
                width: PAGE.w,
                paddingLeft: PAGE.left,
                paddingRight: PAGE.right,
              } as CSSProperties
            }
            data-testid="compare-sheet"
          >
            {!items.length && <p className={s.empty}>Aucun texte.</p>}
            {items.map((it) => {
              if (it.kind === 'fold') {
                const gap = prevType ? 2 : 0;
                prevType = 'heading';
                return (
                  <button
                    key={`f${it.scenes[0]}`}
                    type="button"
                    className={s.fold}
                    style={gap ? { marginTop: gap * LINE } : undefined}
                    onClick={() => setUnfolded(new Set([...unfolded, it.scenes[0]]))}
                    data-view
                    data-testid="compare-fold"
                  >
                    {foldLabel(it.from, it.to, it.scenes.length)}
                  </button>
                );
              }
              const sc = diff.scenes[it.index];
              const prev = prevType;
              prevType = sc.blocks[sc.blocks.length - 1]?.type ?? prevType;
              return (
                <SceneView
                  key={it.index}
                  sc={sc}
                  index={it.index}
                  stops={stops.get(it.index)}
                  prev={prev}
                  onOpen={editable ? openSequenceInEditor : undefined}
                />
              );
            })}
          </div>
        </>
      ) : (
        <p className={s.empty}>Une seule version : rien à comparer.</p>
      )}
    </div>
  );
}
