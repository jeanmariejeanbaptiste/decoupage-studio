import { useEffect, useRef, useState } from 'react';
import { recoverStaleChunk } from '../../ui/staleChunk';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { downloadBlob } from '../../store/persistence';
import { fileNameFor } from '../../domain/serialize';
import { useUi } from '../../store/uiStore';
import { ExportTable } from '../export/ExportTable';
import { exportDocumentPages, exportNodePages, waitForPages, type PageExportOptions } from '../export/imageExport';
import { interviewDocument, oneShotAnnexDocument } from '../../domain/documents';
import { ExportPanel } from '../export/ExportPanel';
import { StoryboardExportOptions, StoryboardImaging } from '../storyboard/StoryboardPage';
import s from './GridPage.module.css';

export type CutContent = 'grid' | 'storyboard';

const CONTENTS = [
  ['grid', 'Découpage'],
  ['storyboard', 'Storyboard'],
] as const;

/** Export du découpage technique : on choisit le contenu (tableau ou storyboard), puis le format. */
export function CutExport({ doc, defaultContent }: { doc: ProjectDoc; defaultContent: CutContent }) {
  const [content, setContent] = useState<CutContent>(defaultContent);
  useEffect(() => setContent(defaultContent), [defaultContent]);
  const [cutImaging, setCutImaging] = useState<PageExportOptions | null>(null);
  const [sbImaging, setSbImaging] = useState<PageExportOptions | null>(null);
  const institutional = doc.project.format === 'institutionnel';
  const nSeq = doc.project.sequenceIds.length;
  const nShots = doc.project.sequenceIds.reduce((n, id) => n + (doc.sequences[id]?.shotIds.length ?? 0), 0);
  const base = fileNameFor(doc).replace(/\.decoupage$/, '');

  // Tableau : rendu d'export monté hors écran le temps de la capture.
  const imageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cutImaging || !imageRef.current) return;
    const root = imageRef.current;
    void waitForPages(root, '[data-testid="print-page"]')
      .then((pages) => exportNodePages(pages, `${base}-decoupage-A4-${cutImaging.orientation === 'portrait' ? 'portrait' : 'paysage'}`, cutImaging, pages[0] ? getComputedStyle(pages[0]).backgroundColor : '#ffffff'))
      .finally(() => setCutImaging(null));
  }, [cutImaging]); // eslint-disable-line react-hooks/exhaustive-deps

  const contents = { value: content, options: CONTENTS, onChange: (v: string) => setContent(v as CutContent) };
  const busy = !!cutImaging || !!sbImaging;

  return (
    <>
      {content === 'storyboard' ? (
        <ExportPanel
          doc={doc}
          id="storyboard"
          title="Exporter"
          contents={contents}
          perPage={[1, 2, 3, 4, 6, 9]}
          noNumbers
          disabled={nShots === 0 || busy}
          onExport={({ format, orientation, numbers }) => setSbImaging({ format: format as 'pdf' | 'images', orientation, numbers })}
        >
          <StoryboardExportOptions doc={doc} />
        </ExportPanel>
      ) : (
        <ExportPanel
          doc={doc}
          id="grid"
          title="Exporter"
          contents={contents}
          extra={[
            ...(institutional ? [{ key: 'interview', label: 'Fiche d’interview', hint: 'PDF A4 : une page par intervenant (dispositif, lieu, lumière, son, questions).' }] : []),
            { key: 'excel', label: 'Excel', hint: 'Classeur avec fusions, couleurs et onglet Registre.' },
            ...(Object.values(doc.shots).some((x) => x.oneShot)
              ? [{ key: 'annex', label: 'Annexe plans-séquences', hint: 'PDF A4 : une page par plan-séquence (frise des temps, tableau, transitions en clair, plan au sol dédié).' }]
              : []),
          ]}
          disabled={(nSeq === 0 && !institutional) || busy}
          options={
            <>
              <label className={s.noMerge} title="Chaque ligne porte sa propre valeur (utile pour retraiter le tableau)">
                <input
                  type="checkbox"
                  checked={!!doc.project.settings.exportNoMerge}
                  onChange={(e) => mutateDoc((d) => void (d.project.settings.exportNoMerge = e.target.checked || undefined))}
                  data-testid="grid-export-nomerge"
                />
                Sans fusion de cellules
              </label>
              <label className={s.noMerge} title="PDF et images : sur chaque page, les colonnes facultatives vides (dialogue, son, notes…) sont masquées, et l’espace profite aux autres">
                <input
                  type="checkbox"
                  checked={!!doc.project.settings.exportSmart}
                  onChange={(e) => mutateDoc((d) => void (d.project.settings.exportSmart = e.target.checked || undefined))}
                  data-testid="grid-export-smart"
                />
                Export intelligent (colonnes vides masquées par page)
              </label>
            </>
          }
          onExport={async ({ format, orientation, numbers }) => {
            try {
              if (format === 'pdf' || format === 'images') setCutImaging({ format, orientation, numbers });
              else if (format === 'interview') await exportDocumentPages(interviewDocument(doc).html, `${base}-interview`, { format: 'pdf', orientation: 'portrait', numbers });
              else if (format === 'annex') await exportDocumentPages(oneShotAnnexDocument(doc).html, `${base}-annexe-plans-sequences`, { format: 'pdf', orientation: 'portrait', numbers });
              else {
                const { exportXlsx } = await import('../export/xlsx');
                downloadBlob(await exportXlsx(doc), `${base}.xlsx`);
              }
            } catch (err) {
              if (recoverStaleChunk(err)) return;
              useUi.getState().toast({ message: `Export impossible : ${(err as Error).message}`, tone: 'warn' });
            }
          }}
        />
      )}
      {cutImaging && (
        <div ref={imageRef} aria-hidden="true" style={{ position: 'fixed', left: -20000, top: 0 }}>
          <ExportTable doc={doc} paper="A4" orientation={cutImaging.orientation} safety={0} />
        </div>
      )}
      {sbImaging && <StoryboardImaging doc={doc} imaging={sbImaging} onDone={() => setSbImaging(null)} />}
    </>
  );
}
