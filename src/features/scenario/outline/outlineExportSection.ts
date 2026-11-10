import { useProjectStore } from '../../../store/projectStore';
import type { ExportSection } from '../ScriptExportButton';
import { savedOutlineMode } from './OutlineToolbar';

/** Intrigues cochées dans le filtre du séquencier (toutes si rien n'est retenu). */
const savedPlots = (): string[] | undefined => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem('ds-outline-plots') ?? 'null');
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Section « Séquencier » du menu Exporter (PDF, Word), placée entre Scénario et Statistiques.
 * L'ordre suit la vue retenue du séquencier : Liste (ordre du récit) ou Par intrigue.
 */
export function outlineExportSection(): ExportSection | null {
  const opts = () => ({ order: savedOutlineMode(), plots: savedPlots() });
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
