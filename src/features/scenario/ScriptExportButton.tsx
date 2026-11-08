import { scriptToFdx } from '../../domain/fdx';
import { blocksFromSource, parseTitlePage } from '../../domain/screenplay';
import type { ProjectDoc } from '../../domain/types';
import { downloadBlob } from '../../store/persistence';
import { ExportPanel } from '../export/ExportPanel';
import { finish } from '../export/imageExport';

const FORMATS = [
  { key: 'word', label: 'Word', hint: 'Document Word (.docx) : styles du scénario, police intégrée, mêmes pages que le PDF.' },
  { key: 'fdx', label: 'Final Draft', hint: 'Fichier .fdx, lu par Final Draft, KIT Scenarist, Highland, WriterDuet, Fade In.' },
  { key: 'fountain', label: 'Fountain', hint: 'Texte brut au format Fountain.' },
];

/** Export du scénario : toujours A4 portrait, au gabarit du modèle (Courier Prime 12 pt, numéros de page en haut à droite). */
export function ScriptExportButton({ doc, current, title }: { doc: ProjectDoc; current: () => ProjectDoc; title: string }) {
  return (
    <span className="no-print">
      <ExportPanel
        doc={doc}
        id="scenario"
        testId="tab"
        title="Exporter le scénario"
        defaultOrientation="portrait"
        noOrientation
        noNumbers
        extra={FORMATS}
        onExport={async ({ format }) => {
          const source = current().scenario ?? '';
          const tb = blocksFromSource(source).blocks.find((b) => b.type === 'title');
          const meta = { title: current().project.title || parseTitlePage(tb?.text ?? '').Title || 'Scénario', author: parseTitlePage(tb?.text ?? '').Author };
          if (format === 'fountain') return downloadBlob(new Blob([source], { type: 'text/plain;charset=utf-8' }), `${title}.fountain`);
          if (format === 'fdx') return downloadBlob(new Blob([scriptToFdx(blocksFromSource(source).blocks)], { type: 'application/xml;charset=utf-8' }), `${title}.fdx`);
          const { scriptCanvases, scriptDocx, scriptPdf } = await import('./scriptExport');
          if (format === 'word') return downloadBlob(await scriptDocx(source, meta), `${title}.docx`);
          if (format === 'pdf') return downloadBlob(await scriptPdf(source, meta), `${title}.pdf`);
          if (format === 'images') return finish(await scriptCanvases(source), `${title}-A4`, { format: 'images', orientation: 'portrait', numbers: false });
        }}
      />
    </span>
  );
}
