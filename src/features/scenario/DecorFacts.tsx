import { decorLocation, setDecorLocation } from '../../domain/locations';
import type { FilmingLocation, ID, IntExt, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { CommitField } from './CommitField';
import s from './Facts.module.css';

const INT_EXT: IntExt[] = ['INT', 'EXT', 'INT/EXT'];

/**
 * Lieu de tournage réel d'un décor (nom, accès, contact) et son INT / EXT : repris par la feuille de
 * service. À monter dans la fiche du décor, à côté de l'adresse de tournage.
 */
export function DecorFacts({ doc, decorId, readOnly }: { doc: ProjectDoc; decorId: ID; readOnly?: boolean }) {
  const decor = doc.decors[decorId];
  if (!decor) return null;
  const loc = decorLocation(decor);
  const set = (patch: Partial<FilmingLocation>) => mutateDoc((d) => setDecorLocation(d, decorId, patch));
  return (
    <div className={s.facts} data-testid="decor-facts">
      <div className={s.two}>
        <CommitField label="Lieu de tournage" value={loc.name ?? ''} readOnly={readOnly} onCommit={(v) => set({ name: v })} />
        <label className={s.field}>
          <span>Intérieur ou extérieur</span>
          <select value={decor.intExt ?? ''} disabled={readOnly} onChange={(e) => mutateDoc((d) => void (d.decors[decorId].intExt = (e.target.value || undefined) as IntExt | undefined))}>
            <option value="">—</option>
            {INT_EXT.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <CommitField label="Accès" value={loc.access ?? ''} readOnly={readOnly} onCommit={(v) => set({ access: v })} />
      <CommitField label="Contact" value={loc.contact ?? ''} readOnly={readOnly} onCommit={(v) => set({ contact: v })} />
    </div>
  );
}
