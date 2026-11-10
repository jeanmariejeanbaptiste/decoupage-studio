import { navigate } from '../../app/router';
import { tcLast } from '../../domain/columns';
import type { CheckTarget, InterviewField } from '../../domain/checkTarget';
import type { ProjectDoc } from '../../domain/types';
import { openInterviewFiche, useUi } from '../../store/uiStore';
import { flashWhenReady } from '../../ui/flash';
import { rowOfShot } from '../grid/actions';

const q = (v: string) => CSS.escape(v);

/** Libellé du champ d'une caméra dans la fiche d'interview. */
const ITW_FIELD_LABEL: Record<InterviewField, string> = { value: 'Valeur', angle: 'Axe', focal: 'Focale' };

const focus = (el: Element | null | undefined) => (el as HTMLElement | null)?.focus({ preventScroll: true });

/**
 * Ouvre l'endroit exact d'un avertissement : le plan dans le découpage (cellules du contrôle
 * sélectionnées), la séquence sans plan (sur son « + »), la cellule de la séquence dans le registre,
 * ou la caméra d'un plan d'interview dans sa fiche. La cible est brièvement mise en évidence et
 * reçoit le clavier.
 */
export function openCheck(doc: ProjectDoc, t: CheckTarget): void {
  const ui = useUi.getState();
  if (t.page === 'registry') {
    navigate('registry', { tab: t.tab });
    const row = `tr[data-seq-row="${q(t.sequenceId)}"]`;
    flashWhenReady([`${row} > td[data-col="${t.col}"]`, row], (el) => focus(el.matches('td') ? el : el.querySelector('td[tabindex]')));
    return;
  }
  if (t.page === 'interview') {
    ui.set({ editing: null, cutFocus: null });
    openInterviewFiche(t.subjectId, t.setupId);
    navigate('grid');
    const cam = `[data-itw-cam="${q(t.cameraId)}"]`;
    flashWhenReady([cam], (el) => t.field && focus(el.querySelector(`[aria-label="${ITW_FIELD_LABEL[t.field]}"]`)));
    return;
  }

  // La grille d'édition (pas l'aperçu, ni l'onglet Interview d'un institutionnel), comme depuis le registre.
  ui.set({ printView: false, itwTab: 'broll', editing: null, cutFocus: { seqId: t.sequenceId, shotId: t.shotId } });
  const selectors: string[] = [];
  let toGrid = false;
  if (t.shotId) {
    const row = rowOfShot(doc, t.shotId);
    const lastRow = t.lastShotId ? rowOfShot(doc, t.lastShotId) : row;
    const shown = tcLast(doc.project.settings.gridColumns);
    // Colonne voulue masquée : la ligne entière.
    const [first, last] = t.cols.length ? [t.cols[0], t.cols[t.cols.length - 1]] : [shown.find((c) => c !== 'sequence' && c !== 'number') ?? shown[0], shown[shown.length - 1]];
    if (row >= 0) {
      ui.setSelection({ row, col: first }, { row: lastRow >= 0 ? lastRow : row, col: last });
      toGrid = true;
      // Une seule cellule : elle ; sinon les lignes des plans.
      if (t.cols.length === 1 && lastRow === row) selectors.push(`[data-testid="grid"] [data-cell="${row}:${first}"]`);
    }
    const ids = t.lastShotId ? seriesIds(doc, t.shotId, t.lastShotId) : [t.shotId];
    // Lecture seule (aperçu) ou cellule fusionnée : les lignes des plans.
    selectors.push(ids.map((id) => `tr[data-shot="${q(id)}"]`).join(', '));
    // Téléphone : le champ du plan, sinon son titre.
    if (t.cols.length === 1) selectors.push(`[data-testid="mobile-cut"] [data-field="${t.cols[0]}"]`);
    selectors.push(`[data-testid="mobile-cut"] [data-mobile-title]`);
  } else {
    // Séquence sans plan : rien à sélectionner dans la grille ; le clavier va sur son « + ».
    ui.setSelection(null);
    selectors.push(`[data-empty-seq="${q(t.sequenceId)}"]`, `tbody[data-seq="${q(t.sequenceId)}"] > tr`);
  }
  navigate('grid');
  flashWhenReady(selectors, (el) => {
    if (!t.shotId) {
      focus(el.matches('button') ? el : el.querySelector('[data-testid="add-first-shot"]'));
      return;
    }
    // Au clavier, on continue dans la grille, sur la cellule choisie.
    if (toGrid && el.closest('[data-testid="grid"]')) focus(document.querySelector('[data-testid="grid"]'));
  });
}

/** Plans d'une série (sautes), du premier au dernier, dans leur séquence. */
function seriesIds(doc: ProjectDoc, first: string, last: string): string[] {
  const ids = doc.sequences[doc.shots[first]?.sequenceId ?? '']?.shotIds ?? [];
  const a = ids.indexOf(first);
  const b = ids.indexOf(last);
  return a >= 0 && b >= a ? ids.slice(a, b + 1) : [first];
}
