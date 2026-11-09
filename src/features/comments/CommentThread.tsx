import { useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { deleteComment, deleteReply, replyComment, setResolved, type ReviewComment } from '../../domain/comments';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { asComment, useCanComment, useShare } from '../../store/share';
import { AttachButtons, Attachments } from './Attachments';
import { authorName, useCommentsUi } from './commentsUi';
import s from './Comments.module.css';

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Un commentaire et ses réponses. Repris d'une version précédente, il porte le nom de sa version ;
 * une réponse écrite dans une autre version aussi (« V1 » soulève, « en V2 » répond).
 * L'auteur du projet peut le marquer réglé ou le retirer.
 */
export function CommentThread({ c, from }: { c: ReviewComment; from?: string }) {
  const owner = useShare((st) => st.role !== 'guest');
  const canComment = useCanComment();
  const versions = useProjectStore((st) => st.doc?.versions);
  const nameOf = (id?: string) => versions?.find((v) => v.id === id)?.name;
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const send = () => {
    if (!reply.trim() && !files.length) return;
    asComment(() => mutateDoc((d) => replyComment(d, c.id, authorName(), reply, files)));
    setReply('');
    setFiles([]);
  };
  return (
    <article className={[s.thread, c.resolved ? s.resolved : ''].join(' ')} data-testid="comment">
      <header>
        <b>{c.author}</b>
        {from && <span className={s.tag}>{from}</span>}
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
      {c.text && <p>{c.text}</p>}
      <Attachments keys={c.attachments} />
      {c.marks?.paths.length ? <span className={s.note}>{c.marks.paths.length} tracé{c.marks.paths.length > 1 ? 's' : ''} sur la page</span> : null}
      {c.replies.map((r) => {
        const v = r.versionId && r.versionId !== c.versionId ? nameOf(r.versionId) : undefined;
        return (
          <div key={r.id} className={s.reply} data-testid="comment-reply-item">
            <header>
              <b>{r.author}</b>
              {v && <span className={s.tag}>en {v}</span>}
              <time>{when.format(new Date(r.at))}</time>
              {owner && (
                <span className={s.tools}>
                  <button type="button" aria-label="Supprimer la réponse" onClick={() => mutateDoc((d) => deleteReply(d, c.id, r.id))}>
                    <Trash2 size={12} strokeWidth={1.4} />
                  </button>
                </span>
              )}
            </header>
            {r.text && <p>{r.text}</p>}
            <Attachments keys={r.attachments} />
          </div>
        );
      })}
      {canComment && (
        <>
          <Attachments keys={files} onRemove={(k) => setFiles(files.filter((x) => x !== k))} />
          <form
            className={[s.replyForm, s.replyRow].join(' ')}
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Répondre…" aria-label="Répondre" data-testid="comment-reply" />
            <AttachButtons
              onSketch={() => useCommentsUi.setState({ sketch: { target: 'reply', id: c.id, onDone: (k) => setFiles((f) => [...f, k]) } })}
              onAdd={(k) => setFiles((f) => [...f, k])}
            />
          </form>
        </>
      )}
    </article>
  );
}
