import { Download, FileText, Printer } from 'lucide-react';
import type { DocPage } from '../../domain/documents';
import { downloadBlob } from '../../store/persistence';
import { Button } from '../../ui/Button';
import { downloadWord, printDocument } from './docExport';

const IC = { size: 15, strokeWidth: 1.25 } as const;

interface Props {
  /** Document mis en page : PDF (impression) et Word. */
  doc?: () => DocPage;
  fileBase?: string;
  /** Données brutes (CSV, SVG…), secondaires. */
  file?: { label: string; name: string; content: () => string | Promise<Blob>; type?: string };
}

/** Exports d'un onglet : PDF et Word mis en page, puis les données brutes. */
export function TabExport({ doc, fileBase = 'document', file }: Props) {
  return (
    <span className="no-print" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {doc && (
        <>
          <Button variant="primary" icon={<Printer {...IC} />} onClick={() => printDocument(doc())} data-testid="tab-export-pdf">
            PDF
          </Button>
          <Button variant="outline" icon={<FileText {...IC} />} onClick={() => downloadWord(doc(), fileBase)} data-testid="tab-export-word">
            Word
          </Button>
        </>
      )}
      {file && (
        <Button
          variant="ghost"
          icon={<Download {...IC} />}
          onClick={async () => {
            const c = await file.content();
            downloadBlob(typeof c === 'string' ? new Blob([c], { type: file.type ?? 'text/csv;charset=utf-8' }) : c, file.name);
          }}
          data-testid="tab-export-file"
          title="Données brutes"
        >
          {file.label}
        </Button>
      )}
    </span>
  );
}
