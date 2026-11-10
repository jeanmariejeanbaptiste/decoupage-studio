import { useProjectStore } from '../../../store/projectStore';
import type { ExportSection } from '../ScriptExportButton';
import { savedOutlineMode } from './OutlineToolbar';
import { checkedPlots } from './outlineUi';
import { plotsInUse, plotsOf } from '../../../domain/outline';
import type { ProjectDoc } from '../../../domain/types';

/** Intrigues cochées dans le filtre du séquencier (celles du projet et celles lues dans le texte). */
const shownPlots = (doc: ProjectDoc): string[] =>
  checkedPlots([...new Set([...plotsOf(doc).map((p) => p.key), ...plotsInUse(doc)])].sort());

/**
 * Section « Séquencier » du menu Exporter (PDF, Word), placée entre Scénario et Statistiques.
 * L'ordre suit la vue retenue du séquencier : Liste (ordre du récit) ou Par intrigue.
 */
export function outlineExportSection(): ExportSection | null {
  const opts = (d: ProjectDoc) => ({ order: savedOutlineMode(), plots: shownPlots(d) });
  const doc = () => useProjectStore.getState().doc;
  const lib = () => import('../outlineExport');
  return {
    id: 'outline',
    label: 'Séquencier',
    items: [
      {
        key: 'pdf',
        label: 'PDF',
        run: async () => {
          const d = doc();
          if (d) await (await lib()).exportOutlinePdf(d, opts(d));
        },
      },
      {
        key: 'word',
        label: 'Word',
        run: async () => {
          const d = doc();
          if (d) await (await lib()).exportOutlineDocx(d, opts(d));
        },
      },
    ],
  };
}
