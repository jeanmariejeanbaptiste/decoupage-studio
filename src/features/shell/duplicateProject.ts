import { newId } from '../../domain/factory';
import { migrate, projectCopy } from '../../domain/serialize';
import { loadProject, saveProject } from '../../store/db';
import { flushPendingSave } from '../../store/persistence';
import { announceProjects } from '../../store/homeHistory';

/**
 * Copie d'un projet de ce navigateur, sans l'ouvrir : même contenu, nouvel identifiant, titre suivi de
 * « (copie) ». Les images et les sons restent partagés : la suppression de l'original les confie à la copie.
 */
export async function duplicateProject(id: string): Promise<string | null> {
  // Modification en attente sur ce projet : la copie part de son dernier état.
  await flushPendingSave(id);
  const stored = await loadProject(id);
  if (!stored) return null;
  const copy = projectCopy(migrate(stored), newId());
  const now = new Date().toISOString();
  copy.project = { ...copy.project, createdAt: now, updatedAt: now };
  await saveProject(copy);
  announceProjects(copy.project.id);
  return copy.project.id;
}
