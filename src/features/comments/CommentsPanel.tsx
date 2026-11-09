import { useState } from 'react';
import { X } from 'lucide-react';
import { COLUMN_DEFS } from '../../domain/columns';
import { commentsOf, type ReviewComment } from '../../domain/comments';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import type { ProjectDoc } from '../../domain/types';
import { switchVersion } from '../../domain/versions';
import { navigate } from '../../app/router';
import { flushEditors } from '../../store/persistence';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { CommentThread } from './CommentThread';
import { closeCommentsPanel, focusComment, useCommentsUi } from './commentsUi';
import s from './Comments.module.css';

/** Où porte un commentaire, en clair. */
function placeOf(doc: ProjectDoc, c: ReviewComment): string {
  const a = c.anchor;
  if (a.kind === 'script') return `Scénario · « ${a.quote.length > 70 ? `${a.quote.slice(0, 70)}…` : a.quote} »`;
  if (a.kind === 'sequence') return doc.sequences[a.seqId] ? `Découpage · séquence ${sequenceHeading(doc, a.seqId)}` : 'Découpage · séquence';
  const col = a.col ? ` · ${COLUMN_DEFS[a.col]?.label.toLocaleLowerCase('fr') ?? a.col}` : '';
  return doc.shots[a.shotId] ? `Découpage · plan ${shotCode(doc, a.shotId)}${col}` : `Découpage · plan${col}`;
}

/** Commentaires d'une version : les lire, y répondre, les régler ou les retirer, et aller les voir. */
export function CommentsPanel() {
  const panel = useCommentsUi((u) => u.panel);
  const doc = useProjectStore((st) => st.doc);
  const [all, setAll] = useState(false);
  if (panel === null || !doc) return null;
  const versionId = panel || doc.activeVersionId;
  const version = doc.versions?.find((v) => v.id === versionId);
  const list = commentsOf(doc, versionId);
  const shown = all ? list : list.filter((c) => !c.resolved);
  const go = (c: ReviewComment) => {
    flushEditors();
    if (versionId && versionId !== doc.activeVersionId) mutateDoc((d) => switchVersion(d, versionId));
    if (c.anchor.kind === 'script') navigate('scenario');
    else {
      useUi.getState().set({ printView: true, editing: null });
      navigate('grid');
    }
    focusComment(c.anchor);
  };
  return (
    <div className={s.backdrop} onMouseDown={closeCommentsPanel}>
      <aside className={s.panel} role="dialog" aria-label="Commentaires" onMouseDown={(e) => e.stopPropagation()} data-testid="comments-panel">
        <header className={s.panelHead}>
          <h2>Commentaires{version ? ` · ${version.name}` : ''}</h2>
          <button type="button" className={s.close} aria-label="Fermer" onClick={closeCommentsPanel}>
            <X size={15} strokeWidth={1.4} />
          </button>
        </header>
        <div className={s.filter} role="radiogroup" aria-label="Afficher">
          <button type="button" role="radio" aria-checked={!all} className={!all ? s.on : ''} onClick={() => setAll(false)}>
            À traiter · {list.filter((c) => !c.resolved).length}
          </button>
          <button type="button" role="radio" aria-checked={all} className={all ? s.on : ''} onClick={() => setAll(true)}>
            Tous · {list.length}
          </button>
        </div>
        {shown.length ? (
          <ul className={s.list}>
            {shown.map((c) => (
              <li key={c.id}>
                <button type="button" className={s.place} onClick={() => go(c)} title="Voir à sa place">
                  {placeOf(doc, c)}
                </button>
                <CommentThread c={c} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.empty}>Aucun commentaire.</p>
        )}
      </aside>
    </div>
  );
}
