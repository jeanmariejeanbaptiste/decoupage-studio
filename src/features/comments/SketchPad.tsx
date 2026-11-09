import { useEffect, useRef, useState } from 'react';
import { Eraser, Undo2 } from 'lucide-react';
import { putBlob } from '../../store/db';
import { useProjectStore } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { patchDraft, useCommentsUi } from './commentsUi';
import s from './Comments.module.css';

const W = 640;
const H = 400;

/** Planche à dessin d'un schéma (trait noir sur blanc), joint en image au commentaire ou à la réponse. */
export function SketchPad() {
  const sketch = useCommentsUi((u) => u.sketch);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Array<Array<[number, number]>>>([]);
  const current = useRef<Array<[number, number]> | null>(null);

  useEffect(() => setStrokes([]), [sketch]);
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#111318';
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const st of strokes) {
      g.beginPath();
      st.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      if (st.length === 1) g.lineTo(st[0][0] + 0.1, st[0][1]);
      g.stroke();
    }
  }, [strokes, sketch]);

  if (!sketch) return null;
  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H] as [number, number];
  };
  const close = () => useCommentsUi.setState({ sketch: null });
  const done = async () => {
    const pid = useProjectStore.getState().doc?.project.id;
    const blob = await new Promise<Blob | null>((ok) => canvas.current?.toBlob(ok, 'image/png'));
    if (blob && pid && strokes.length) {
      const key = await putBlob(pid, 'schema.png', blob);
      if (sketch.target === 'draft') patchDraft({ attachments: [...useCommentsUi.getState().draft.attachments, key] });
      else sketch.onDone(key);
    }
    close();
  };
  return (
    <div className={s.backdrop} onMouseDown={close}>
      <div className={s.sketch} role="dialog" aria-label="Schéma" onMouseDown={(e) => e.stopPropagation()} data-testid="sketch-pad">
        <canvas
          ref={canvas}
          width={W}
          height={H}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            current.current = [at(e)];
            setStrokes((x) => [...x, current.current!]);
          }}
          onPointerMove={(e) => {
            if (!current.current) return;
            current.current.push(at(e));
            setStrokes((x) => [...x.slice(0, -1), [...current.current!]]);
          }}
          onPointerUp={() => void (current.current = null)}
        />
        <div className={s.sketchBar}>
          <button type="button" className={s.iconBtn} aria-label="Annuler le dernier trait" onClick={() => setStrokes((x) => x.slice(0, -1))} disabled={!strokes.length}>
            <Undo2 size={15} strokeWidth={1.4} />
          </button>
          <button type="button" className={s.iconBtn} aria-label="Tout effacer" onClick={() => setStrokes([])} disabled={!strokes.length}>
            <Eraser size={15} strokeWidth={1.4} />
          </button>
          <span className={s.grow} />
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => void done()} disabled={!strokes.length} data-testid="sketch-done">
            Joindre
          </Button>
        </div>
      </div>
    </div>
  );
}
