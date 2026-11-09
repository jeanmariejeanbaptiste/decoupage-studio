import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { addComment, commentsOf } from '../../domain/comments';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { asComment, useCanComment } from '../../store/share';
import { Button } from '../../ui/Button';
import { CommentThread } from './CommentThread';
import { authorName, closeComment, sameAnchor, useCommentsUi } from './commentsUi';
import s from './Comments.module.css';

/** Bulle d'un endroit commenté : ses commentaires, et de quoi en écrire un. */
export function CommentPopover() {
  const pop = useCommentsUi((u) => u.popover);
  const doc = useProjectStore((st) => st.doc);
  const canComment = useCanComment();
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => setText(''), [pop?.anchor]);
  useLayoutEffect(() => {
    if (!pop || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(pop.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(pop.y + 6, window.innerHeight - r.height - 8)) });
  }, [pop, doc]);
  useEffect(() => {
    if (!pop) return;
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !(e.target as Element).closest?.('[data-comment-trigger]') && closeComment();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeComment();
    window.addEventListener('mousedown', out);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', out);
      window.removeEventListener('keydown', esc);
    };
  }, [pop]);

  if (!pop || !doc) return null;
  const threads = commentsOf(doc).filter((c) => sameAnchor(c.anchor, pop.anchor));
  const send = () => {
    if (!text.trim()) return;
    asComment(() => mutateDoc((d) => void addComment(d, pop.anchor, authorName(), text)));
    setText('');
  };
  return (
    <div ref={box} className={s.popover} style={pos} role="dialog" aria-label="Commentaires" data-testid="comment-popover">
      <button type="button" className={s.close} aria-label="Fermer" onClick={closeComment}>
        <X size={14} strokeWidth={1.4} />
      </button>
      {pop.anchor.kind === 'script' && pop.anchor.quote && <blockquote className={s.quote}>{pop.anchor.quote}</blockquote>}
      {threads.map((c) => (
        <CommentThread key={c.id} c={c} />
      ))}
      {canComment && !threads.length && (
        <form
          className={s.compose}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Commenter…"
            aria-label="Nouveau commentaire"
            data-testid="comment-text"
          />
          <Button size="sm" variant="primary" type="submit" disabled={!text.trim()} data-testid="comment-send">
            Envoyer
          </Button>
        </form>
      )}
    </div>
  );
}
