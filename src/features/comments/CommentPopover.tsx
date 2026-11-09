import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Circle, X } from 'lucide-react';
import { addComment, shownComments } from '../../domain/comments';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { asComment, useCanComment } from '../../store/share';
import { Button } from '../../ui/Button';
import { AttachButtons, Attachments } from './Attachments';
import { CommentThread } from './CommentThread';
import { authorName, closeComment, patchDraft, resetDraft, sameAnchor, useCommentsUi } from './commentsUi';
import s from './Comments.module.css';

/**
 * Bulle d'un endroit commenté : ses commentaires (ceux des versions précédentes compris), et de quoi
 * en écrire un — texte, schéma dessiné, image, tracés directement sur la page.
 */
export function CommentPopover() {
  const pop = useCommentsUi((u) => u.popover);
  const draft = useCommentsUi((u) => u.draft);
  const drawing = useCommentsUi((u) => u.drawing);
  const doc = useProjectStore((st) => st.doc);
  const canComment = useCanComment();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!pop || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(pop.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(pop.y + 6, window.innerHeight - r.height - 8)) });
  }, [pop, doc, drawing]);
  useEffect(() => {
    if (!pop || drawing) return;
    const out = (e: MouseEvent) => {
      const t = e.target as Element;
      if (box.current?.contains(t) || t.closest?.('[data-comment-trigger], [data-testid="sketch-pad"]')) return;
      closeComment();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !useCommentsUi.getState().sketch && closeComment();
    window.addEventListener('mousedown', out);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', out);
      window.removeEventListener('keydown', esc);
    };
  }, [pop, drawing]);

  if (!pop || !doc || drawing) return null;
  const threads = shownComments(doc).filter((x) => sameAnchor(x.anchor, pop.anchor));
  const surface = pop.anchor.kind === 'script' ? 'script' : 'cut';
  const marks = draft.marks?.paths.length ?? 0;
  const ready = !!draft.text.trim() || draft.attachments.length > 0 || marks > 0;
  const send = () => {
    if (!ready) return;
    asComment(() => mutateDoc((d) => void addComment(d, pop.anchor, authorName(), draft.text, { attachments: draft.attachments, marks: draft.marks })));
    resetDraft();
  };
  return (
    <div ref={box} className={s.popover} style={pos} role="dialog" aria-label="Commentaires" data-testid="comment-popover">
      <button type="button" className={s.close} aria-label="Fermer" onClick={closeComment}>
        <X size={14} strokeWidth={1.4} />
      </button>
      {pop.anchor.kind === 'script' && pop.anchor.quote && <blockquote className={s.quote}>{pop.anchor.quote}</blockquote>}
      {threads.map((x) => (
        <CommentThread key={x.c.id} c={x.c} from={x.from ? doc.versions?.find((v) => v.id === x.from)?.name : undefined} />
      ))}
      {canComment && (
        <form
          className={s.compose}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            autoFocus={!threads.length}
            rows={2}
            value={draft.text}
            onChange={(e) => patchDraft({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={threads.length ? 'Autre commentaire…' : 'Commenter…'}
            aria-label="Nouveau commentaire"
            data-testid="comment-text"
          />
          <Attachments keys={draft.attachments} onRemove={(k) => patchDraft({ attachments: draft.attachments.filter((x) => x !== k) })} />
          <div className={s.composeBar}>
            <AttachButtons onSketch={() => useCommentsUi.setState({ sketch: { target: 'draft' } })} onAdd={(k) => patchDraft({ attachments: [...draft.attachments, k] })} />
            <span className={s.attach}>
              <button type="button" onClick={() => useCommentsUi.setState({ drawing: surface })} aria-label="Entourer sur la page" title="Entourer sur la page" data-testid="comment-draw">
                <Circle size={14} strokeWidth={1.4} />
              </button>
            </span>
            {marks > 0 && (
              <span className={s.chip}>
                {marks} tracé{marks > 1 ? 's' : ''}
                <button type="button" aria-label="Retirer les tracés" onClick={() => patchDraft({ marks: undefined })}>
                  <X size={11} strokeWidth={1.6} />
                </button>
              </span>
            )}
            <span className={s.grow} />
            <Button size="sm" variant="primary" type="submit" disabled={!ready} data-testid="comment-send">
              Envoyer
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
