import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { shownComments, type CommentMarks } from '../../domain/comments';
import { useProjectStore } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { openComment, patchDraft, useCommentsUi } from './commentsUi';
import s from './Comments.module.css';

const path = (pts: Array<[number, number]>) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join(' ');

/**
 * Tracés sur la page (entourer, souligner, flécher) : ceux des commentaires de la version courante,
 * et, pendant l'écriture d'un commentaire, de quoi en tracer. Posé dans le conteneur de la page,
 * en coordonnées sans zoom : un tracé reste là où il a été fait.
 */
export function MarkLayer({ surface }: { surface: CommentMarks['surface'] }) {
  const doc = useProjectStore((st) => st.doc);
  const drawing = useCommentsUi((u) => u.drawing === surface);
  const draft = useCommentsUi((u) => u.draft);
  const svg = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState<Array<[number, number]> | null>(null);
  // Le trait en cours vit aussi hors du rendu : des événements rapprochés ne lisent pas un état périmé.
  const liveRef = useRef<Array<[number, number]> | null>(null);
  // Échap quitte le tracé : la bulle et son brouillon reviennent tels quels.
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      useCommentsUi.setState({ drawing: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing]);
  if (!doc) return null;
  const shown = shownComments(doc).filter((x) => !x.from && !x.c.resolved && x.c.marks?.surface === surface);
  const mine = draft.marks?.surface === surface ? draft.marks.paths : [];
  if (!drawing && !shown.length && !mine.length) return null;

  const at = (e: React.PointerEvent): [number, number] => {
    const el = svg.current!;
    const r = el.getBoundingClientRect();
    const k = r.width / (el.clientWidth || r.width) || 1;
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
  };
  const finish = () => {
    const pts = liveRef.current;
    if (!pts) return;
    liveRef.current = null;
    const cur = useCommentsUi.getState().draft.marks;
    if (pts.length > 1) patchDraft({ marks: { surface, paths: [...(cur?.surface === surface ? cur.paths : []), path(pts)] } });
    setLive(null);
  };
  return (
    <>
      <svg ref={svg} className={[s.marks, drawing ? s.marksDrawing : ''].join(' ')} data-testid={`marks-${surface}`}
        onPointerDown={(e) => {
          if (!drawing) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          liveRef.current = [at(e)];
          setLive(liveRef.current);
        }}
        onPointerMove={(e) => {
          if (!liveRef.current) return;
          liveRef.current = [...liveRef.current, at(e)];
          setLive(liveRef.current);
        }}
        onPointerUp={finish}
        // Geste interrompu (paume, geste du système) : le trait est clos, le suivant ne s'y raccorde pas.
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      >
        {shown.map((x) =>
          x.c.marks!.paths.map((d, i) => (
            <path
              key={`${x.c.id}-${i}`}
              d={d}
              className={s.markPath}
              onClick={(e) => {
                if (drawing) return;
                openComment(x.anchor, e.clientX, e.clientY);
              }}
            >
              <title>{`${x.c.author} : ${x.c.text}`}</title>
            </path>
          )),
        )}
        {mine.map((d, i) => (
          <path key={`draft-${i}`} d={d} className={[s.markPath, s.markDraft].join(' ')} />
        ))}
        {live && <path d={path(live)} className={[s.markPath, s.markDraft].join(' ')} />}
      </svg>
      {/* Hors du conteneur mis à l'échelle (le fixed y resterait relatif aux pages) et hors de <main>
          (masqué pour l'invité en lecture seule). */}
      {drawing && createPortal(
        <div className={s.drawBar} role="toolbar" aria-label="Tracés" data-view>
          <Button variant="ghost" size="sm" onClick={() => patchDraft({ marks: undefined })} disabled={!mine.length}>
            Effacer
          </Button>
          <Button variant="primary" size="sm" onClick={() => useCommentsUi.setState({ drawing: null })} data-testid="marks-done">
            Terminer
          </Button>
        </div>,
        document.body,
      )}
    </>
  );
}
