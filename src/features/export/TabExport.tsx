import type { DocPage } from '../../domain/documents';
import { downloadBlob } from '../../store/persistence';
import { useDoc } from '../../store/projectStore';
import { downloadWord } from './docExport';
import { ExportPanel } from './ExportPanel';
import { exportDocumentPages } from './imageExport';

interface Props {
  /** Document mis en page : PDF et images A4 (générés par l'outil), Word. */
  doc: () => DocPage | Promise<DocPage>;
  fileBase?: string;
  /** Données brutes (CSV, texte…), secondaires. */
  file?: { label: string; name: string; content: () => string | Promise<Blob>; type?: string; hint?: string };
  /** Clé des réglages mémorisés (propre à chaque page) et préfixe des testid. */
  id?: string;
  /** Orientation par défaut du document (paysage pour les tableaux larges). */
  orientation?: 'landscape' | 'portrait';
}

/** Menu d'export d'un onglet : PDF, images A4, Word et données brutes, sans l'impression du navigateur. */
export function TabExport({ doc, fileBase = 'document', file, id = 'tab', orientation = 'portrait' }: Props) {
  const project = useDoc();
  if (!project) return null;
  const extra = [{ key: 'word', label: 'Word', hint: 'Document Word (.doc) modifiable.' }];
  if (file) extra.push({ key: 'file', label: file.label, hint: file.hint ?? 'Données brutes, pour un tableur ou un autre outil.' });
  return (
    <span className="no-print">
      <ExportPanel
        doc={project}
        id={id}
        testId="tab"
        title="Exporter cette page"
        defaultOrientation={orientation}
        extra={extra}
        onExport={async ({ format, orientation, numbers }) => {
          if (format === 'word') return downloadWord(await doc(), fileBase, orientation);
          if (format === 'file' && file) {
            const c = await file.content();
            return downloadBlob(typeof c === 'string' ? new Blob([c], { type: file.type ?? 'text/csv;charset=utf-8' }) : c, file.name);
          }
          if (format === 'pdf' || format === 'images') return exportDocumentPages((await doc()).html, `${fileBase}-A4-${orientation === 'portrait' ? 'portrait' : 'paysage'}`, { format, orientation, numbers });
        }}
      />
    </span>
  );
}
