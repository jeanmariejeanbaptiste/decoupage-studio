import { Download, Printer } from 'lucide-react';
import { downloadBlob } from '../../store/persistence';
import { Button } from '../../ui/Button';

const IC = { size: 15, strokeWidth: 1.25 } as const;

/** Boutons d'export individuels d'un onglet : un fichier (CSV, SVG, texte) et l'impression PDF. */
export function TabExport({ file, print = true }: { file?: { label: string; name: string; content: () => string; type?: string }; print?: boolean }) {
  return (
    <span className="no-print" style={{ display: 'inline-flex', gap: 6 }}>
      {file && (
        <Button
          variant="outline"
          icon={<Download {...IC} />}
          onClick={() => downloadBlob(new Blob([file.content()], { type: file.type ?? 'text/csv;charset=utf-8' }), file.name)}
          data-testid="tab-export-file"
        >
          {file.label}
        </Button>
      )}
      {print && (
        <Button variant="outline" icon={<Printer {...IC} />} onClick={() => window.print()} data-testid="tab-export-pdf">
          PDF
        </Button>
      )}
    </span>
  );
}
