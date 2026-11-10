import { navigate } from '../../app/router';
import { checkTarget } from '../../domain/checkTarget';
import type { Issue } from '../../domain/lint';
import type { ProjectDoc } from '../../domain/types';
import { useUi } from '../../store/uiStore';
import { flashWhenReady } from '../../ui/flash';
import { rowOfShot } from '../grid/actions';

const q = (v: string) => CSS.escape(v);

/**
 * Ouvre l'endroit exact d'un avertissement : le plan dans le découpage (cellules du contrôle
 * sélectionnées), la séquence vide, ou la ligne de la séquence dans le registre. La cible est
 * brièvement mise en évidence à l'arrivée.
 */
export function openCheck(doc: ProjectDoc, issue: Issue): void {
  const t = checkTarget(doc, issue);
  if (t.page === 'registry') {
    navigate('registry', { tab: t.tab });
    flashWhenReady([`tr[data-seq-row="${q(t.sequenceId)}"]`]);
    return;
  }
  const ui = useUi.getState();
  // La grille d'édition (pas l'aperçu, ni l'onglet Interview d'un institutionnel), comme depuis le registre.
  ui.set({ printView: false, itwTab: 'broll', editing: null });
  const selectors: string[] = [];
  if (t.shotId) {
    const row = rowOfShot(doc, t.shotId);
    const [first, last] = [t.cols[0], t.cols[t.cols.length - 1]];
    if (row >= 0) {
      ui.setSelection({ row, col: first }, { row, col: last });
      // Une seule cellule : elle ; plusieurs : la ligne du plan.
      if (t.cols.length === 1) selectors.push(`[data-testid="grid"] [data-cell="${row}:${first}"]`);
    }
    // Lecture seule ou cellule fusionnée : la ligne du plan (grille ou aperçu).
    selectors.push(`tr[data-shot="${q(t.shotId)}"]`);
  } else {
    selectors.push(`[data-empty-seq="${q(t.sequenceId)}"]`, `tbody[data-seq="${q(t.sequenceId)}"] > tr`);
  }
  navigate('grid');
  flashWhenReady(selectors, () => {
    // Au clavier, on continue dans la grille, sur la cellule choisie.
    document.querySelector<HTMLElement>('[data-testid="grid"]')?.focus({ preventScroll: true });
  });
}
