import { useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { deleteComment, deleteReply, replyComment, setResolved, type ReviewComment } from '../../domain/comments';
import { mutateDoc } from '../../store/projectStore';
import { asComment, useShare } from '../../store/share';
import { authorName } from './commentsUi';
import s from './Comments.module.css';

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Un commentaire et ses réponses ; l'auteur du projet peut y répondre, le marquer réglé ou le retirer. */
export function CommentThread({ c }: { c: ReviewComment }) {
  const owner = useShare((st) => st.role !== 'guest');
  const [reply, setReply] = useState('');
  const send = () => {
    if (!reply.trim()) return;
    asComment(() => mutateDoc((d) => replyComment(d, c.id, authorName(), reply)));
    setReply('');
  };
  return (
    <article className={[s.thread, c.resolved ? s.resolved : ''].join(' ')} data-testid="comment">
      <header>
        <b>{c.author}</b>
        <time>{when.format(new Date(c.at))}</time>
        {owner && (
          <span className={s.tools}>
            <button type="button" aria-label={c.resolved ? 'Rouvrir' : 'Marquer comme réglé'} title={c.resolved ? 'Rouvrir' : 'Réglé'} aria-pressed={!!c.resolved} onClick={() => mutateDoc((d) => setResolved(d, c.id, !c.resolved))}>
              <Check size={13} strokeWidth={1.5} />
            </button>
            <button type="button" aria-label="Supprimer le commentaire" title="Supprimer" onClick={() => mutateDoc((d) => deleteComment(d, c.id))} data-testid="comment-delete">
              <Trash2 size={13} strokeWidth={1.4} />
            </button>
          </span>
        )}
      </header>
      <p>{c.text}</p>
      {c.replies.map((r) => (
        <div key={r.id} className={s.reply}>
          <header>
            <b>{r.author}</b>
            <time>{when.format(new Date(r.at))}</time>
            {owner && (
              <span className={s.tools}>
                <button type="button" aria-label="Supprimer la réponse" onClick={() => mutateDoc((d) => deleteReply(d, c.id, r.id))}>
                  <Trash2 size={12} strokeWidth={1.4} />
                </button>
              </span>
            )}
          </header>
          <p>{r.text}</p>
        </div>
      ))}
      <form
        className={s.replyForm}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Répondre…" aria-label="Répondre" data-testid="comment-reply" />
      </form>
    </article>
  );
}
