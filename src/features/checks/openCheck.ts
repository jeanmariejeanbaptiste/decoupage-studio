import { navigate } from '../../app/router';
import { tcLast } from '../../domain/columns';
import type { CheckTarget, InterviewField } from '../../domain/checkTarget';
import type { ProjectDoc } from '../../domain/types';
import { useShare } from '../../store/share';
import { openInterviewFiche, useUi } from '../../store/uiStore';
import { flashWhenReady } from '../../ui/flash';
import { rowOfShot } from '../grid/actions';

const q = (v: string) => CSS.escape(v);

/** Libellé du champ d'une caméra dans la fiche d'interview. */
const ITW_FIELD_LABEL: Record<InterviewField, string> = { value: 'Valeur', angle: 'Axe', focal: 'Focale' };

const focus = (el: Element | null | undefined) => (el as HTMLElement | null)?.focus({ preventScroll: true });

/** Champ prêt à la saisie : le focus, le curseur en fin de texte. */
function typeIn(el: Element | null | undefined) {
  const f = el as HTMLInputElement | HTMLTextAreaElement | null;
  if (!f) return;
  f.focus({ preventScroll: true });
  const end = f.value.length;
  f.setSelectionRange?.(end, end);
}

/** Même seuil que la vue téléphone du découpage (useIsMobile). */
const phone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 700px)').matches;

/** Invité en lecture seule : rien ne s'ouvre en saisie. */
const readOnly = () => {
  const s = useShare.getState();
  return s.role === 'guest' && s.mode !== 'edit';
};

/**
 * Ouvre l'endroit exact d'un avertissement : le plan dans le découpage (cellules du contrôle
 * sélectionnées ; une seule cellule à remplir s'ouvre en saisie, comme par un double-clic), la
 * séquence sans plan (sur son « + »), la durée estimée dans l'en-tête de la séquence, en saisie, ou
 * la caméra d'un plan d'interview dans sa fiche. La cible est brièvement mise en évidence et reçoit
 * le clavier.
 */
export function openCheck(doc: ProjectDoc, t: CheckTarget): void {
  const ui = useUi.getState();
  if (t.page === 'interview') {
    ui.set({ editing: null, cutFocus: null });
    openInterviewFiche(t.subjectId, t.setupId);
    navigate('grid');
    const cam = `[data-itw-cam="${q(t.cameraId)}"]`;
    flashWhenReady([cam], (el) => t.field && typeIn(el.querySelector(`[aria-label="${ITW_FIELD_LABEL[t.field]}"]`)));
    return;
  }

  if (t.page === 'seq-head') {
    // En-tête de la séquence (grille) ; sur téléphone, son premier plan, dont l'en-tête la porte.
    const first = doc.sequences[t.sequenceId]?.shotIds[0];
    ui.set({ printView: false, itwTab: 'broll', editing: null, cutFocus: { seqId: t.sequenceId, shotId: first } });
    const row = first ? rowOfShot(doc, first) : -1;
    ui.setSelection(row >= 0 ? { row, col: 'sequence' } : null);
    navigate('grid');
    flashWhenReady([`input[data-seq-estimate="${q(t.sequenceId)}"]`, `[data-empty-seq="${q(t.sequenceId)}"]`], (el) => {
      if (el.matches('input') && !readOnly()) {
        focus(el);
        (el as HTMLInputElement).select();
      }
    });
    return;
  }

  // La grille d'édition (pas l'aperçu, ni l'onglet Interview d'un institutionnel).
  ui.set({ printView: false, itwTab: 'broll', editing: null, cutFocus: { seqId: t.sequenceId, shotId: t.shotId } });
  const selectors: string[] = [];
  let toGrid = false;
  // Une seule cellule à remplir : son éditeur, comme après un double-clic (pas sur téléphone, où
  // le champ du plan reçoit le clavier, ni pour un invité en lecture seule).
  const edit = !!t.edit && !readOnly();
  if (t.shotId) {
    const row = rowOfShot(doc, t.shotId);
    const lastRow = t.lastShotId ? rowOfShot(doc, t.lastShotId) : row;
    const shown = tcLast(doc.project.settings.gridColumns);
    // Colonne voulue masquée : la ligne entière.
    const [first, last] = t.cols.length ? [t.cols[0], t.cols[t.cols.length - 1]] : [shown.find((c) => c !== 'sequence' && c !== 'number') ?? shown[0], shown[shown.length - 1]];
    if (row >= 0) {
      ui.setSelection({ row, col: first }, { row: lastRow >= 0 ? lastRow : row, col: last });
      toGrid = true;
      if (edit && !phone() && t.cols.length === 1 && lastRow === row) ui.setEditing({ pos: { row, col: first } });
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
    // Cellule ouverte en saisie : le curseur est dans son champ.
    const editor = useUi.getState().editing && el.querySelector<HTMLInputElement>('[data-testid="cell-editor"]');
    if (editor) {
      // Zoom dont la focale d'arrivée manque : directement dans « à ».
      const to = el.querySelector<HTMLInputElement>('[data-testid="focal-to"]');
      return typeIn(to && editor.value && !to.value ? to : editor);
    }
    // Téléphone : le champ du plan, en saisie.
    if (edit && el.matches('[data-field]')) return typeIn(el.querySelector('input, textarea'));
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
