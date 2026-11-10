/** Aller à un endroit précis du découpage depuis une autre page : un plan et sa cellule, ou une séquence. */
import { navigate } from '../../app/router';
import type { ColumnKey, ID, ProjectDoc } from '../../domain/types';
import { useUi } from '../../store/uiStore';
import { rowOfShot } from './actions';

/** On arrive sur la grille d'édition (pas l'aperçu, ni l'onglet Interview d'un institutionnel). */
function toGrid() {
  useUi.getState().set({ printView: false, itwTab: 'broll', editing: null });
}

/** Saute au plan dans la grille, sur la cellule demandée (le sujet si la colonne n'est pas affichée). */
export function goToShot(doc: ProjectDoc, shotId: ID | undefined, col: ColumnKey = 'subject') {
  toGrid();
  if (!shotId) return navigate('grid');
  const row = rowOfShot(doc, shotId);
  const shown = doc.project.settings.gridColumns;
  if (row >= 0) useUi.getState().setSelection({ row, col: shown.includes(col) ? col : shown.includes('subject') ? 'subject' : shown[0] });
  navigate('grid');
}

/**
 * Saute à une séquence : son en-tête (premier plan) ; sans plan, la grille l'amène en haut et donne
 * le focus à son « + ».
 */
export function goToSequence(doc: ProjectDoc, seqId: ID) {
  const first = doc.sequences[seqId]?.shotIds[0];
  if (first) return goToShot(doc, first, 'sequence');
  toGrid();
  useUi.getState().set({ selection: null, focusSeq: seqId });
  navigate('grid');
}
