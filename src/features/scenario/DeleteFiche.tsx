import { Trash2 } from 'lucide-react';
import { deleteWarning, type FicheKind } from '../../domain/fiches';
import { deleteCharacter, deleteDecor } from '../../domain/registry';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { ask } from '../../ui/dialogStore';
import s from './Facts.module.css';

/**
 * « Supprimer la fiche » : sans question si rien ne s'en sert ; sinon confirmée, avec ce qu'elle
 * touche (séquences, autres versions). Toujours annulable (⌘Z).
 */
export function DeleteFiche({ doc, kind, id, onDeleted }: { doc: ProjectDoc; kind: FicheKind; id: ID; onDeleted?: () => void }) {
  const name = (kind === 'character' ? doc.characters[id] : doc.decors[id])?.name;
  if (!name) return null;
  const run = async () => {
    const body = deleteWarning(doc, kind, id);
    if (body) {
      const r = await ask({ title: `Supprimer la fiche « ${name} » ?`, body, confirmLabel: 'Supprimer', danger: true });
      if (!r.ok) return;
    }
    mutateDoc((d) => (kind === 'character' ? deleteCharacter(d, id) : deleteDecor(d, id)));
    onDeleted?.();
  };
  return (
    <Button variant="ghost" size="sm" className={s.delete} icon={<Trash2 size={13} strokeWidth={1.25} />} onClick={() => void run()} aria-label={`Supprimer la fiche ${name}`}>
      Supprimer la fiche
    </Button>
  );
}
