import { toCsv } from '../../domain/csv';
import { scriptToFdx } from '../../domain/fdx';
import { blocksFromSource } from '../../domain/screenplay';
import { breakdownDocument, callSheetDocument, equipmentDocument, scheduleDocument, wordHtml, type DocPage } from '../../domain/documents';
import {
  allFloorPlans,
  breakdownCsv,
  calendarFiles,
  callSheetCsv,
  charactersCsv,
  decorsCsv,
  dossierReadme,
  equipmentCsv,
  interviewFrameFiles,
  scheduleCsv,
  sequencesCsv,
  shotsCsv,
  storyboardFiles,
  uniqueNames,
} from '../../domain/exports';
import { scheduleDays } from '../../domain/schedule';
import { fileNameFor, serializeDoc } from '../../domain/serialize';
import type { ProjectDoc } from '../../domain/types';
import { getBlob } from '../../store/db';
import { collectMedia } from '../../store/persistence';

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();
const word = (page: DocPage) => new Blob(['\uFEFF', wordHtml(page)], { type: 'application/msword' });
const ext = (blob: Blob) => (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '');

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ko(r.error);
    r.readAsDataURL(b);
  });

/** Note d'intention mise en forme (titres, images, sauts de page), comme l'export Word de la note. */
async function noteWord(html: string, title: string): Promise<Blob> {
  let body = html;
  for (const m of new Set([...html.matchAll(/data-blob="([^"]+)"/g)].map((x) => x[1]))) {
    const b = await getBlob(m);
    if (b) body = body.split(`data-blob="${m}"`).join(`src="${await blobToDataUrl(b)}"`);
  }
  body = body.replace(/<hr class="page-break">/g, '<br clear="all" style="page-break-before: always">');
  const css = `@page WordSection { size: 21cm 29.7cm; margin: 2.5cm; } div.WordSection { page: WordSection; }
body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111318; }
p { margin: 0 0 6pt; } h1 { font-size: 24pt; font-weight: 600; margin: 0 0 10pt; } h4 { font-size: 13pt; font-weight: 400; color: #6b7079; margin: 0 0 12pt; }
h2 { font-size: 15pt; font-weight: 600; margin: 6pt 0 6pt; } h3 { font-size: 12.5pt; font-weight: 600; margin: 4pt 0 4pt; }
blockquote { margin: 0 0 8pt; padding-left: 14pt; border-left: 2px solid #111318; font-style: italic; } img { max-width: 100%; }`;
  const page = `<!doctype html><html lang="fr" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><style>${css}</style></head><body><div class="WordSection">${body}</div></body></html>`;
  return new Blob(['\uFEFF', page], { type: 'application/msword' });
}

/** Assemble tout le projet dans une archive .zip rangée par étape de préparation. */
export async function buildProductionZip(doc: ProjectDoc): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const { exportXlsx } = await import('./xlsx');
  const zip = new JSZip();
  const root = zip.folder(safe(`${doc.project.title || 'Projet'} — dossier de production`))!;
  // Dossiers réellement écrits : le LISEZ-MOI n'annonce qu'eux.
  const present = new Set<string>();
  const put = (path: string, content: string | Blob | Uint8Array) => {
    present.add(path.split('/')[0]);
    root.file(path, content);
  };
  put(`00 Projet/${fileNameFor(doc)}`, serializeDoc(doc, undefined, await collectMedia(doc)));
  if (doc.intentionHtml?.trim()) put('01 Intention/Note d’intention.doc', await noteWord(doc.intentionHtml, doc.project.title || 'Note d’intention'));
  if (doc.intention?.trim()) put('01 Intention/Note d’intention.txt', doc.intention);
  if (doc.scenario?.trim()) {
    const { scriptDocx, scriptPdf } = await import('../scenario/scriptExport');
    put('02 Scénario/Scénario.pdf', await scriptPdf(doc.scenario, { title: doc.project.title }));
    put('02 Scénario/Scénario.docx', await scriptDocx(doc.scenario, { title: doc.project.title }));
    put('02 Scénario/Scénario.fdx', scriptToFdx(blocksFromSource(doc.scenario).blocks));
    put('02 Scénario/Scénario.fountain', doc.scenario);
  }
  put('03 Dépouillement/Dépouillement.doc', word(breakdownDocument(doc)));
  put('03 Dépouillement/Dépouillement.csv', breakdownCsv(doc));
  put('04 Découpage/Découpage technique.xlsx', await exportXlsx(doc));
  put('04 Découpage/Découpage technique.csv', toCsv(doc));
  // Storyboard : images des plans, puis cadres d'interview restés en annexe ; jamais deux fois le même nom.
  const images: Array<{ name: string; blob: Blob }> = [];
  const shotFiles = doc.project.sequenceIds.flatMap((seqId) => (doc.sequences[seqId]?.shotIds ?? []).flatMap((id) => storyboardFiles(doc, id)));
  for (const f of [...shotFiles, ...interviewFrameFiles(doc)]) {
    const blob = await getBlob(f.key);
    if (blob) images.push({ name: safe(f.name), blob });
  }
  uniqueNames(images.map((i) => i.name)).forEach((n, k) => put(`05 Storyboard/${n}.${ext(images[k].blob)}`, images[k].blob));
  const plans = allFloorPlans(doc);
  uniqueNames(plans.map((p) => safe(p.name))).forEach((n, k) => put(`06 Plans au sol/${n}.svg`, plans[k].svg));
  put('07 Matériel/Listes de matériel.doc', word(equipmentDocument(doc, true)));
  put('07 Matériel/Listes de matériel.csv', equipmentCsv(doc));
  const days = scheduleDays(doc);
  // Sans jour de tournage, ni plan de travail ni feuilles de service : pas de fichiers vides.
  if (days.length) {
    put('08 Plan de travail/Plan de travail.doc', word(scheduleDocument(doc)));
    put('08 Plan de travail/Plan de travail.csv', scheduleCsv(doc));
  }
  for (const d of days) {
    put(`09 Feuilles de service/Jour ${d.n}.doc`, word(callSheetDocument(doc, d.n)));
    put(`09 Feuilles de service/Jour ${d.n}.csv`, callSheetCsv(doc, d.n));
  }
  put('10 Registre/Séquences.csv', sequencesCsv(doc));
  put('10 Registre/Personnages.csv', charactersCsv(doc));
  put('10 Registre/Décors.csv', decorsCsv(doc));
  put('10 Registre/Plans.csv', shotsCsv(doc));
  for (const f of calendarFiles(doc)) put(`11 Calendriers/${f.name}`, f.content);
  root.file('LISEZ-MOI.txt', dossierReadme(doc, present));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
