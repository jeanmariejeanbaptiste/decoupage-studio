import { useCallback, useMemo, useRef, useState } from 'react';
import { useReadOnly } from '../../store/share';
import type { ProjectDoc } from '../../domain/types';
import { richToText, textToRich } from '../../domain/richText';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { downloadBlob } from '../../store/persistence';
import { ExportPanel } from '../export/ExportPanel';
import { RichEditor } from './RichEditor';

/** Note d'intention : un document mis en forme, sur des pages A4, enregistré dans le projet. */
export function IntentionPage({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  // Ancienne note en texte brut : reprise telle quelle, en paragraphes.
  const html = useMemo(() => doc.intentionHtml ?? textToRich(doc.intention ?? ''), [doc.intentionHtml, doc.intention]);
  const editor = useRef<HTMLDivElement | null>(null);
  const [pages, setPages] = useState(1);
  const onChange = useCallback(
    (next: string) =>
      mutateDoc((d) => {
        d.intentionHtml = next;
        // Le texte brut suit : comptes de mots, assistant, export texte.
        d.intention = richToText(next);
      }),
    [],
  );
  const base = `${doc.project.title || 'projet'}-note-d-intention`;
  const exportButton = (
    <span className="no-print">
      <ExportPanel
        doc={doc}
        id="intention"
        testId="tab"
        title="Exporter la note d’intention"
        defaultOrientation="portrait"
        noOrientation
        extra={[
          { key: 'word', label: 'Word', hint: 'Document Word (.doc) : styles, images et sauts de page gardés.' },
          { key: 'text', label: 'Texte', hint: 'Texte brut, sans mise en forme.' },
        ]}
        onExport={async ({ format, numbers }) => {
          const cur = useProjectStore.getState().doc ?? doc;
          const curHtml = cur.intentionHtml ?? textToRich(cur.intention ?? '');
          if (format === 'text') return downloadBlob(new Blob([richToText(curHtml)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
          const { downloadNoteWord, exportNotePages } = await import('./noteExport');
          if (format === 'word') return downloadNoteWord(curHtml, cur.project.title || 'Note d’intention', base);
          const stack = editor.current?.closest<HTMLElement>('[data-testid="note-stack"]');
          if (stack) return exportNotePages(stack, pages, `${base}-A4`, { format: format as 'pdf' | 'images', orientation: 'portrait', numbers });
        }}
      />
    </span>
  );
  return (
    <div className="page">
      <RichEditor html={html} projectId={doc.project.id} readOnly={readOnly} onChange={onChange} onLayout={setPages} editorRef={editor} trail={exportButton} />
    </div>
  );
}
