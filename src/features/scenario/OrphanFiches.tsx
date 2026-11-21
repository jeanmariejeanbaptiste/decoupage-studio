import { useMemo, useState } from 'react';
import { ficheUse, orphanFiches } from '../../domain/fiches';
import { decorLocation, setDecorLocation } from '../../domain/locations';
import { renameFiche } from '../../domain/registry';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { CharacterFacts } from './CharacterFacts';
import { CommitField } from './CommitField';
import { DecorFacts } from './DecorFacts';
import s from './Facts.module.css';

/**
 * Fiches que le texte du scénario ne nomme pas (créées au dépouillement, depuis la grille, ou dont le
 * nom a quitté le texte), sous la liste du panneau Personnages ou Décors : rien ne devient
 * inaccessible. Chacune s'ouvre comme une fiche ordinaire : nom (l'ancien reste en alias), interprète
 * ou adresse, nature, fusion, lieu de tournage, suppression. Rien s'il n'y en a pas.
 */
export function OrphanFiches({ doc, kind, readOnly }: { doc: ProjectDoc; kind: 'characters' | 'decors'; readOnly?: boolean }) {
  const k = kind === 'characters' ? 'character' : 'decor';
  const list = useMemo(() => (k === 'character' ? orphanFiches(doc, 'character') : orphanFiches(doc, 'decor')), [doc, k]);
  const [open, setOpen] = useState<ID | null>(null);
  if (!list.length) return null;
  return (
    <section className={s.orphans} data-testid={`orphan-${kind}`}>
      <p className={s.orphansHead}>Hors du texte</p>
      <ul>
        {list.map((f) => {
          const on = open === f.id;
          const n = ficheUse(doc, k, f.id).sequences;
          return (
            <li key={f.id} className={s.orphan}>
              <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : f.id)} data-testid="orphan-row">
                {f.name}
                <span>{n ? `${n} séq.` : 'aucune séquence'}</span>
              </button>
              {on && (
                <div className={s.fiche}>
                  <CommitField label="Nom" value={f.name} readOnly={readOnly} onCommit={(v) => mutateDoc((d) => renameFiche(d, k, f.id, v))} />
                  {k === 'character' ? (
                    <>
                      <CommitField
                        label="Interprète"
                        value={doc.characters[f.id]?.actor ?? ''}
                        readOnly={readOnly}
                        onCommit={(v) => mutateDoc((d) => void (d.characters[f.id].actor = v.trim() || undefined))}
                      />
                      <CharacterFacts doc={doc} characterId={f.id} readOnly={readOnly} onMerged={() => setOpen(null)} onDeleted={() => setOpen(null)} />
                    </>
                  ) : (
                    <>
                      <CommitField
                        label="Adresse de tournage"
                        value={decorLocation(doc.decors[f.id]).address ?? ''}
                        readOnly={readOnly}
                        onCommit={(v) => mutateDoc((d) => setDecorLocation(d, f.id, { address: v }))}
                      />
                      <DecorFacts doc={doc} decorId={f.id} readOnly={readOnly} onDeleted={() => setOpen(null)} />
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
