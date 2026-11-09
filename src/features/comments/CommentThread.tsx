import { useRef, useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { deleteComment, deleteReply, replyComment, setResolved, type ReviewComment } from '../../domain/comments';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { deleteDriveItem, editDriveItem, isMine, sendDriveItem, useReview, type DriveItem } from '../../store/review';
import { asComment, useCanComment, useDriveReview, useShare } from '../../store/share';
import { AttachButtons, Attachments } from './Attachments';
import { authorName, useCommentsUi } from './commentsUi';
import s from './Comments.module.css';

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Relecture en ligne : où en est l'envoi d'un commentaire (rien une fois arrivé). */
function SendState({ item }: { item: DriveItem }) {
  const st = useReview((r) => r.pending[item.reply ?? item.comment]);
  if (st === 'sending') return <span className={s.note}>Envoi…</span>;
  if (st === 'failed')
    return (
      <span className={s.note} data-testid="comment-unsent">
        Non envoyé —{' '}
        <button type="button" className={s.retry} onClick={() => sendDriveItem(item)}>
          Réessayer
        </button>
      </span>
    );
  return null;
}

/** Outils du relecteur sur ce qu'il a écrit : corriger, retirer. */
function OwnTools({ item, onEdit, small }: { item: DriveItem; onEdit: () => void; small?: boolean }) {
  const size = small ? 12 : 13;
  return (
    <span className={s.tools}>
      <button type="button" aria-label="Corriger" title="Corriger" onClick={onEdit} data-testid="comment-edit">
        <Pencil size={size} strokeWidth={1.4} />
      </button>
      <button type="button" aria-label="Retirer" title="Retirer" onClick={() => deleteDriveItem(item)} data-testid="comment-delete">
        <Trash2 size={size} strokeWidth={1.4} />
      </button>
    </span>
  );
}

/** Texte d'un commentaire, ou sa correction en cours. */
function Body({ text, editing, onDone }: { text: string; editing: boolean; onDone: (next: string | null) => void }) {
  const [value, setValue] = useState(text);
  // Une seule issue : Entrée, Échap ou sortie du champ.
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  if (!editing) return text ? <p>{text}</p> : null;
  return (
    <form
      className={s.replyForm}
      onSubmit={(e) => {
        e.preventDefault();
        finish(value);
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            finish(null);
          }
        }}
        onBlur={() => finish(value)}
        aria-label="Corriger le commentaire"
        data-testid="comment-edit-text"
      />
    </form>
  );
}

/**
 * Un commentaire et ses réponses. Repris d'une version précédente, il porte le nom de sa version ;
 * une réponse écrite dans une autre version aussi (« V1 » soulève, « en V2 » répond).
 * L'auteur du projet peut le marquer réglé ou le retirer ; un relecteur en ligne, corriger ou retirer
 * ce qu'il a écrit.
 */
export function CommentThread({ c, from }: { c: ReviewComment; from?: string }) {
  const owner = useShare((st) => st.role !== 'guest');
  const drive = useDriveReview();
  const mine = useReview((st) => st.mine);
  const pending = useReview((st) => st.pending);
  const canComment = useCanComment();
  const versions = useProjectStore((st) => st.doc?.versions);
  const nameOf = (id?: string) => versions?.find((v) => v.id === id)?.name;
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const own = (x: { id: string; remoteId?: string }) => drive && isMine({ mine, pending }, x);
  const send = () => {
    if (!reply.trim() && !files.length) return;
    let rid: string | undefined;
    asComment(() => void (rid = mutateDoc((d) => replyComment(d, c.id, authorName(), reply, files))));
    if (rid && drive) sendDriveItem({ comment: c.id, reply: rid });
    setReply('');
    setFiles([]);
  };
  const finishEdit = (item: DriveItem) => (next: string | null) => {
    setEditing(null);
    if (next !== null) editDriveItem(item, next);
  };
  const item: DriveItem = { comment: c.id };
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
        {own(c) && editing !== c.id && <OwnTools item={item} onEdit={() => setEditing(c.id)} />}
      </header>
      <Body key={`${c.id}-${editing === c.id}`} text={c.text} editing={editing === c.id} onDone={finishEdit(item)} />
      {drive && <SendState item={item} />}
      <Attachments keys={c.attachments} />
      {c.marks?.paths.length ? <span className={s.note}>{c.marks.paths.length} tracé{c.marks.paths.length > 1 ? 's' : ''} sur la page</span> : null}
      {c.replies.map((r) => {
        const v = r.versionId && r.versionId !== c.versionId ? nameOf(r.versionId) : undefined;
        const ri: DriveItem = { comment: c.id, reply: r.id };
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
              {own(r) && editing !== r.id && <OwnTools item={ri} small onEdit={() => setEditing(r.id)} />}
            </header>
            <Body key={`${r.id}-${editing === r.id}`} text={r.text} editing={editing === r.id} onDone={finishEdit(ri)} />
            {drive && <SendState item={ri} />}
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
