import { toCsv } from '../../domain/csv';
import { allFloorPlans, breakdownCsv, callSheetCsv, charactersCsv, decorsCsv, equipmentCsv, scheduleCsv, sequencesCsv, shotsCsv } from '../../domain/exports';
import { shotCode } from '../../domain/numbering';
import { scheduleDays } from '../../domain/schedule';
import { fileNameFor, serializeDoc } from '../../domain/serialize';
import type { ProjectDoc } from '../../domain/types';
import { getBlob } from '../../store/db';

const README = (doc: ProjectDoc) => `DOSSIER DE PRODUCTION — ${doc.project.title} (${doc.project.version})
Exporté le ${new Date().toLocaleString('fr-FR')}.

00 Projet          fichier .decoupage (projet complet, à rouvrir dans l'application)
01 Intention       note d'intention
02 Scénario        scénario au format Fountain
03 Dépouillement   éléments par séquence
04 Découpage       tableau Excel fusionné (thème et économie d'encre du projet) et CSV
05 Storyboard      images des plans, nommées par code de plan
06 Plans au sol    un SVG par plan (s'ouvre dans tout navigateur)
07 Matériel        listes par chef de poste
08 Plan de travail jours, séquences et durées
09 Feuilles        une feuille de service par jour
10 Registre        séquences, personnages, décors, plans

Les PDF mis en page s'obtiennent depuis chaque onglet de l'application (bouton PDF).
`;

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();

/** Assemble tout le projet dans une archive .zip rangée par étape de préparation. */
export async function buildProductionZip(doc: ProjectDoc): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const { exportXlsx } = await import('./xlsx');
  const zip = new JSZip();
  const root = zip.folder(safe(`${doc.project.title || 'Projet'} — dossier de production`))!;
  root.file('LISEZ-MOI.txt', README(doc));
  root.file(`00 Projet/${fileNameFor(doc)}`, serializeDoc(doc));
  if (doc.intention?.trim()) root.file('01 Intention/Note d’intention.txt', doc.intention);
  if (doc.scenario?.trim()) root.file('02 Scénario/Scénario.fountain', doc.scenario);
  root.file('03 Dépouillement/Dépouillement.csv', breakdownCsv(doc));
  root.file('04 Découpage/Découpage technique.xlsx', await exportXlsx(doc));
  root.file('04 Découpage/Découpage technique.csv', toCsv(doc));
  for (const seqId of doc.project.sequenceIds)
    for (const id of doc.sequences[seqId]?.shotIds ?? []) {
      const key = doc.shots[id]?.storyboard?.blobKey;
      const blob = key ? await getBlob(key) : undefined;
      if (blob) root.file(`05 Storyboard/Plan ${shotCode(doc, id)}.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, blob);
    }
  for (const p of allFloorPlans(doc)) root.file(`06 Plans au sol/${safe(p.name)}.svg`, p.svg);
  root.file('07 Matériel/Listes de matériel.csv', equipmentCsv(doc));
  root.file('08 Plan de travail/Plan de travail.csv', scheduleCsv(doc));
  for (const d of scheduleDays(doc)) root.file(`09 Feuilles de service/Jour ${d.n}.csv`, callSheetCsv(doc, d.n));
  root.file('10 Registre/Séquences.csv', sequencesCsv(doc));
  root.file('10 Registre/Personnages.csv', charactersCsv(doc));
  root.file('10 Registre/Décors.csv', decorsCsv(doc));
  root.file('10 Registre/Plans.csv', shotsCsv(doc));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
