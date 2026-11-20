import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { aspectRatio } from '../../domain/aspect';
import { cropStyle, framesOf, setFrame } from '../../domain/keyframes';
import type { ProjectDoc, Shot } from '../../domain/types';
import { putBlob } from '../../store/db';
import { mutateDoc } from '../../store/projectStore';
import { useBlobUrl } from '../../ui/useBlobUrl';
import s from './Grid.module.css';

/**
 * Colonne « Storyboard » : la vignette du plan, posée d'un clic ou d'un glisser juste après l'action,
 * sans passer par le storyboard ni l'inspecteur.
 */
export function StoryboardCell({ doc, shot, label, readOnly }: { doc: ProjectDoc; shot: Shot; label: string; readOnly?: boolean }) {
  const frame = framesOf(shot)[0];
  const url = useBlobUrl(frame?.blobKey);
  const ratio = aspectRatio(doc.project.settings.storyboardAspect);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const put = async (f: File | undefined) => {
    if (!f?.type.startsWith('image/')) return;
    const key = await putBlob(doc.project.id, f.name, f);
    mutateDoc((d) => setFrame(d, shot.id, 0, { blobKey: key, baseKey: undefined, sketch: undefined, crop: undefined, fit: undefined, baseCrop: undefined, baseFit: undefined, sketchAspect: undefined }));
  };
  return (
    <div
      className={[s.sbCell, over ? s.sbOver : ''].join(' ')}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        if (readOnly || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void put(e.dataTransfer.files[0]);
      }}
    >
      {url ? (
        <button type="button" className={s.sbThumb} style={{ aspectRatio: String(ratio) }} onClick={() => !readOnly && input.current?.click()} aria-label={`Remplacer l’image du plan ${label}`} title="Remplacer l’image" disabled={readOnly}>
          <img src={url} alt="" style={cropStyle(frame, ratio)} draggable={false} />
        </button>
      ) : (
        !readOnly && (
          <button type="button" className={s.sbAdd} onClick={() => input.current?.click()} aria-label={`Importer une image pour le plan ${label}`} title="Importer une image" data-testid="grid-storyboard-add">
            <ImagePlus size={13} strokeWidth={1.25} />
          </button>
        )
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(e) => {
          void put(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
