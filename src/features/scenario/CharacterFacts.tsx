import { sortedCharacters } from '../../domain/characters';
import { mergeCharacters } from '../../domain/ops';
import type { CharacterKind, ID, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { ask } from '../../ui/dialogStore';
import { DeleteFiche } from './DeleteFiche';
import s from './Facts.module.css';

const KINDS: CharacterKind[] = ['principal', 'secondaire', 'figurant', 'silhouette', 'voix off'];

/**
 * Nature d'un personnage (principal, secondaire, figurant…) et fusion d'un doublon (« Candi » dans
 * « Candice ») : à monter dans la fiche du personnage. La fiche fusionnée disparaît, ses plans, ses
 * séquences, ses convocations et ses versions passent à l'autre, qui garde son nom en alias ;
 * confirmée, puis annulable (⌘Z). « Supprimer la fiche » : sans question si rien ne s'en sert.
 */
export function CharacterFacts({ doc, characterId, readOnly, onMerged, onDeleted }: { doc: ProjectDoc; characterId: ID; readOnly?: boolean; onMerged?: (intoId: ID) => void; onDeleted?: () => void }) {
  const c = doc.characters[characterId];
  if (!c) return null;
  const others = sortedCharacters(doc).filter((o) => o.id !== characterId);
  const merge = async (intoId: ID) => {
    const into = doc.characters[intoId];
    if (!into) return;
    const r = await ask({
      title: `Fusionner « ${c.name} » dans « ${into.name} » ?`,
      body: `Les plans et les séquences de « ${c.name} » passent à « ${into.name} », qui garde « ${c.name} » comme alias (annulable avec ⌘Z).`,
      confirmLabel: 'Fusionner',
    });
    if (!r.ok) return;
    mutateDoc((d) => mergeCharacters(d, characterId, intoId));
    onMerged?.(intoId);
  };
  return (
    <div className={s.facts} data-testid="character-facts">
      <div className={s.two}>
        <label className={s.field}>
          <span>Nature</span>
          <select value={c.kind} disabled={readOnly} onChange={(e) => mutateDoc((d) => void (d.characters[characterId].kind = e.target.value as CharacterKind))}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {!readOnly && others.length > 0 && (
          <label className={s.field}>
            <span>Fusionner dans</span>
            <select value="" aria-label={`Fusionner ${c.name} dans…`} onChange={(e) => e.target.value && void merge(e.target.value)}>
              <option value="">—</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {c.aliases?.length ? <p className={s.alias}>Aussi nommé {c.aliases.join(', ')}</p> : null}
      {!readOnly && <DeleteFiche doc={doc} kind="character" id={characterId} onDeleted={onDeleted} />}
    </div>
  );
}
