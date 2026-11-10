import { useProjectStore } from '../../../store/projectStore';
import type { ExportSection } from '../ScriptExportButton';

/**
 * Section « Séquencier » du menu Exporter (PDF, Word), placée entre Scénario et Statistiques.
 * Un séquencier se lit dans l'ordre du récit.
 */
export function outlineExportSection(): ExportSection | null {
  const opts = () => ({ order: 'list' as const });
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
          if (d) await (await lib()).exportOutlinePdf(d, opts());
        },
      },
      {
        key: 'word',
        label: 'Word',
        run: async () => {
          const d = doc();
          if (d) await (await lib()).exportOutlineDocx(d, opts());
        },
      },
    ],
  };
}
