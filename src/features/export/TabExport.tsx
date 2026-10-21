import type { DocPage } from '../../domain/documents';
import { downloadBlob } from '../../store/persistence';
import { useDoc } from '../../store/projectStore';
import { downloadWord } from './docExport';
import { ExportPanel } from './ExportPanel';
import { exportDocumentPages } from './imageExport';

interface Props {
  /** Document mis en page : PDF et images A4 (générés par l'outil), Word. */
  doc: () => DocPage;
  fileBase?: string;
  /** Données brutes (CSV, texte…), secondaires. */
  file?: { label: string; name: string; content: () => string | Promise<Blob>; type?: string };
  /** Clé des réglages mémorisés et préfixe des testid. */
  id?: string;
}

/** Menu d'export d'un onglet : PDF, images A4, Word et données brutes, sans l'impression du navigateur. */
export function TabExport({ doc, fileBase = 'document', file, id = 'tab' }: Props) {
  const project = useDoc();
  if (!project) return null;
  const extra = [{ key: 'word', label: 'Word', hint: 'Document Word (.doc) modifiable.' }];
  if (file) extra.push({ key: 'file', label: file.label, hint: 'Données brutes, pour un tableur ou un autre outil.' });
  return (
    <span className="no-print">
      <ExportPanel
        doc={project}
        id={id}
        title="Exporter cette page"
        defaultOrientation="portrait"
        extra={extra}
        onExport={async ({ format, orientation, numbers }) => {
          if (format === 'word') return downloadWord(doc(), fileBase);
          if (format === 'file' && file) {
            const c = await file.content();
            return downloadBlob(typeof c === 'string' ? new Blob([c], { type: file.type ?? 'text/csv;charset=utf-8' }) : c, file.name);
          }
          if (format === 'pdf' || format === 'images') return exportDocumentPages(doc().html, `${fileBase}-A4-${orientation === 'portrait' ? 'portrait' : 'paysage'}`, { format, orientation, numbers });
        }}
      />
    </span>
  );
}
