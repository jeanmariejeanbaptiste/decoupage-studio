import { useRef } from 'react';
import { ImagePlus, PenTool, X } from 'lucide-react';
import { putBlob } from '../../store/db';
import { useProjectStore } from '../../store/projectStore';
import { openable, useBlob } from '../../ui/useBlobUrl';
import s from './Comments.module.css';

function Thumb({ k, onRemove }: { k: string; onRemove?: () => void }) {
  const { url, type } = useBlob(k);
  return (
    <span className={s.thumb}>
      {url && openable(type) ? (
        // Ouvert en grand dans un onglet : seulement une image matricielle (un SVG s'y exécuterait).
        <a href={url} target="_blank" rel="noreferrer" title="Ouvrir en grand">
          <img src={url} alt="" />
        </a>
      ) : url ? (
        <img src={url} alt="" />
      ) : (
        <i />
      )}
      {onRemove && (
        <button type="button" aria-label="Retirer" onClick={onRemove}>
          <X size={11} strokeWidth={1.6} />
        </button>
      )}
    </span>
  );
}

/** Schémas et images joints à un commentaire ou une réponse. */
export function Attachments({ keys, onRemove }: { keys?: readonly string[]; onRemove?: (k: string) => void }) {
  if (!keys?.length) return null;
  return (
    <div className={s.thumbs} data-testid="comment-attachments">
      {keys.map((k) => (
        <Thumb key={k} k={k} onRemove={onRemove ? () => onRemove(k) : undefined} />
      ))}
    </div>
  );
}

/** Joindre : un schéma dessiné à main levée, ou une image (capture, photo, croquis scanné). */
export function AttachButtons({ onSketch, onAdd }: { onSketch: () => void; onAdd: (key: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <span className={s.attach}>
      <button type="button" onClick={onSketch} aria-label="Dessiner un schéma" title="Dessiner un schéma" data-testid="comment-sketch">
        <PenTool size={14} strokeWidth={1.4} />
      </button>
      <button type="button" onClick={() => file.current?.click()} aria-label="Joindre une image" title="Joindre une image">
        <ImagePlus size={14} strokeWidth={1.4} />
      </button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        data-testid="comment-image"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          const pid = useProjectStore.getState().doc?.project.id;
          if (f && pid) onAdd(await putBlob(pid, f.name, f));
        }}
      />
    </span>
  );
}
