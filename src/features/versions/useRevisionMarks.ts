import { useDeferredValue, useMemo } from 'react';
import type { ProjectDoc } from '../../domain/types';
import { revisedScenes } from '../../domain/versions';

/** Scènes neuves ou modifiées depuis la version d'origine (calcul différé : la frappe n'attend pas). */
export function useRevisionMarks(doc: ProjectDoc): Map<number, 'new' | 'changed'> | null {
  const scenario = useDeferredValue(doc.scenario);
  const { versions, activeVersionId } = doc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => revisedScenes({ ...doc, scenario }), [scenario, versions, activeVersionId]);
}
