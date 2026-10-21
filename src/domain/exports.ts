/**
 * Exports individuels par onglet (CSV, texte, SVG), réutilisés par le dossier de production.
 */
import { aggregateEquipment, equipmentCategories } from './equipment';
import { breakdownCategories, breakdownLabel, breakdownOf, derivedBreakdown } from './breakdown';
import { sequenceCharacterIds } from './characters';
import { cameraCone, lightBeam, planOf, plansOf, reflections, PLAN_W, PLAN_H, type FloorItem } from './floorplan';
import { formatFocal } from './focal';
import { sequenceHeading, shotCode } from './numbering';
import { characterStats, decorStats } from './registry';
import { callSheetStrips, dayStats, scheduleDays, stripsByDay } from './schedule';
import { formatTc } from './timecode';
import { computeTiming, formatGap } from './timing';
import { renderTokens } from './tokens';
import type { ID, ProjectDoc } from './types';
import { isZoom } from './vocabulary';

const esc = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV « ; » avec BOM, lisible directement par Excel en français. */
export function csv(rows: ReadonlyArray<ReadonlyArray<string | number | undefined>>): string {
  return `\uFEFF${rows.map((r) => r.map(esc).join(';')).join('\r\n')}\r\n`;
}

export function sequencesCsv(doc: ProjectDoc): string {
  const t = computeTiming(doc);
  return csv([
    ['N°', 'Séquence', 'Décor', 'INT/EXT', 'Effet', 'Personnages', 'Plans', 'Estimée', 'Calculée', 'Écart'],
    ...doc.project.sequenceIds.map((id, i) => {
      const s = doc.sequences[id];
      const st = t.sequences.get(id);
      return [
        i + 1,
        s.label,
        s.decorId ? doc.decors[s.decorId]?.name : '',
        s.intExt,
        s.effect,
        sequenceCharacterIds(doc, id).map((c) => doc.characters[c]?.name).join(', '),
        s.shotIds.length,
        s.estimatedSec !== undefined ? formatTc(s.estimatedSec) : '',
        st ? formatTc(st.durationSec) : '',
        st?.gap ? formatGap(st.gap) : '',
      ];
    }),
  ]);
}

export function charactersCsv(doc: ProjectDoc): string {
  const st = characterStats(doc);
  return csv([
    ['Nom', 'Alias', 'Type', 'Comédien·ne', 'Séquences', 'Plans'],
    ...Object.values(doc.characters)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((c) => [c.name, (c.aliases ?? []).join(', '), c.kind, c.actor, (st.get(c.id)?.sequenceIds ?? []).map((id) => doc.project.sequenceIds.indexOf(id) + 1).join(' '), st.get(c.id)?.shotIds.length ?? 0]),
  ]);
}

export function decorsCsv(doc: ProjectDoc): string {
  const st = decorStats(doc, computeTiming(doc));
  return csv([
    ['Décor', 'INT/EXT', 'Adresse', 'Séquences', 'Durée à tourner'],
    ...Object.values(doc.decors).map((d) => [d.name, d.intExt, d.address, (st.get(d.id)?.sequenceIds ?? []).map((id) => doc.project.sequenceIds.indexOf(id) + 1).join(' '), formatTc(st.get(d.id)?.totalSec ?? 0)]),
  ]);
}

export function shotsCsv(doc: ProjectDoc): string {
  const rows: Array<Array<string | number | undefined>> = [['Plan', 'Séquence', 'Sujet', 'Valeur', 'Angle', 'Mouvement', 'Focale', 'Action', 'Statut', 'Jour', 'Image storyboard']];
  for (const seqId of doc.project.sequenceIds)
    for (const id of doc.sequences[seqId]?.shotIds ?? []) {
      const s = doc.shots[id];
      rows.push([shotCode(doc, id), sequenceHeading(doc, seqId), s.subject, s.value, renderTokens(s.angle), renderTokens(s.movement, s.movementSep), formatFocal(s.focal, isZoom(s.movement)), doc.blocks[s.actionBlockId]?.text, s.status, s.shootingDay !== undefined ? `J${s.shootingDay}` : '', s.storyboard ? `${shotCode(doc, id)}` : '']);
    }
  return csv(rows);
}

export function equipmentCsv(doc: ProjectDoc): string {
  const eq = aggregateEquipment(doc);
  return csv([['Poste', 'Matériel', 'Plans', 'Ajout manuel'], ...equipmentCategories(doc).flatMap((c) => eq[c].map((l) => [c, l.label, l.shotIds.map((id) => shotCode(doc, id)).join(' '), l.manual ? 'oui' : '']))]);
}

export function breakdownCsv(doc: ProjectDoc): string {
  return csv([
    ['Séquence', ...breakdownCategories(doc).map((c) => breakdownLabel(c))],
    ...doc.project.sequenceIds.map((id) => {
      const m = breakdownOf(doc, id);
      const d = derivedBreakdown(doc, id);
      return [sequenceHeading(doc, id), ...breakdownCategories(doc).map((c) => [...(d[c] ?? []), ...(m[c] ?? [])].join(', '))];
    }),
  ]);
}

export function scheduleCsv(doc: ProjectDoc): string {
  const t = computeTiming(doc);
  const strips = stripsByDay(doc);
  const rows: Array<Array<string | number | undefined>> = [['Jour', 'Date', 'Séquence', 'Plans', 'Décor', 'Personnages', 'Durée d’écran du jour']];
  for (const d of scheduleDays(doc)) {
    const st = dayStats(doc, t, d.n);
    for (const s of strips.get(d.n) ?? []) {
      const seq = doc.sequences[s.seqId];
      rows.push([`J${d.n}`, d.date, sequenceHeading(doc, s.seqId), s.shotIds.map((id) => shotCode(doc, id)).join(' '), seq.decorId ? doc.decors[seq.decorId]?.name : '', sequenceCharacterIds(doc, s.seqId).map((c) => doc.characters[c]?.name).join(', '), formatTc(st.screenSec)]);
    }
  }
  return csv(rows);
}

export function callSheetCsv(doc: ProjectDoc, day: number): string {
  const d = scheduleDays(doc).find((x) => x.n === day);
  const strips = callSheetStrips(doc, day);
  const st = dayStats(doc, computeTiming(doc), day, strips);
  const rows: Array<Array<string | number | undefined>> = [
    ['Feuille de service', doc.project.title, `Jour ${day}`, d?.date ?? '', d?.callTime ? `RDV ${d.callTime}` : ''],
    [],
    ['Décors'],
    ...st.decorIds.map((id) => [doc.decors[id]?.name, doc.decors[id]?.address]),
    [],
    ['Convocations', 'Comédien·ne', 'Heure'],
    ...st.characterIds.map((id) => [doc.characters[id]?.name, doc.characters[id]?.actor, d?.calls?.[id]]),
    [],
    ['Plan', 'Séquence', 'Sujet', 'Valeur', 'Focale', 'Action'],
    ...strips.flatMap((s) =>
      s.shotIds.map((id) => {
        const sh = doc.shots[id];
        return [shotCode(doc, id), sequenceHeading(doc, s.seqId), sh.subject, sh.value, formatFocal(sh.focal, isZoom(sh.movement)), doc.blocks[sh.actionBlockId]?.text];
      }),
    ),
  ];
  if (d?.notes) rows.push([], ['Notes', d.notes]);
  return csv(rows);
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pts = (p: Array<{ x: number; y: number }>) => p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');

/** Plan au sol en SVG autonome (styles en ligne), pour l'export. */
export function floorPlanSvg(doc: ProjectDoc, key: string, title: string): string {
  const items = planOf(doc, key).items;
  const out: string[] = [];
  const beams = [...items.filter((i) => i.kind === 'light').map((l) => lightBeam(l as Parameters<typeof lightBeam>[0])), ...reflections(items)];
  for (const b of beams) out.push(`<polygon points="${pts(b.points)}" fill="#e8c46a" fill-opacity="${(0.28 * b.intensity).toFixed(2)}"/>`);
  for (const i of items as FloorItem[]) {
    switch (i.kind) {
      case 'camera': {
        const c = cameraCone(doc, i);
        out.push(`<polygon points="${pts(c.points)}" fill="#9c3d2b" fill-opacity="0.1" stroke="#9c3d2b" stroke-dasharray="4 3"/>`);
        out.push(`<rect x="${i.x - 14}" y="${i.y - 10}" width="28" height="20" rx="3" fill="#2a2824" transform="rotate(${i.rot} ${i.x} ${i.y})"/>`);
        out.push(`<text x="${i.x}" y="${i.y + 30}" font-size="12" text-anchor="middle" fill="#6e675b">${xml(`${i.label ?? ''}${c.focal ? ` · ${c.focal}mm` : ''}`)}</text>`);
        break;
      }
      case 'actor':
        if (i.to) out.push(`<line x1="${i.x}" y1="${i.y}" x2="${i.to.x}" y2="${i.to.y}" stroke="#2e4263" stroke-width="2" stroke-dasharray="6 4"/>`);
        out.push(`<circle cx="${i.x}" cy="${i.y}" r="16" fill="#2e4263"/><text x="${i.x}" y="${i.y + 5}" font-size="14" text-anchor="middle" fill="#fff">${xml(i.label)}</text>`);
        if (i.characterId && doc.characters[i.characterId]) out.push(`<text x="${i.x}" y="${i.y + 32}" font-size="12" text-anchor="middle" fill="#6e675b">${xml(doc.characters[i.characterId].name)}</text>`);
        break;
      case 'wall':
        out.push(`<line x1="${i.x}" y1="${i.y}" x2="${i.x2}" y2="${i.y2}" stroke="#2a2824" stroke-width="7"/>`);
        break;
      case 'rail':
        out.push(`<line x1="${i.x}" y1="${i.y}" x2="${i.x2}" y2="${i.y2}" stroke="#b88a2e" stroke-width="9" stroke-dasharray="2 6"/>`);
        break;
      case 'reflector':
        out.push(`<line x1="${i.x}" y1="${i.y}" x2="${i.x2}" y2="${i.y2}" stroke="#a9aeb6" stroke-width="8" stroke-linecap="round"/>`);
        break;
      case 'door':
      case 'window':
        out.push(`<rect x="${i.x}" y="${i.y - 4}" width="${i.width}" height="8" fill="#fff" stroke="#2a2824" transform="rotate(${i.rot} ${i.x} ${i.y})"/>`);
        break;
      case 'light':
        out.push(`<circle cx="${i.x}" cy="${i.y}" r="12" fill="#b88a2e"/><text x="${i.x}" y="${i.y + 28}" font-size="12" text-anchor="middle" fill="#6e675b">${xml(i.label ?? '')}</text>`);
        break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -40 ${PLAN_W} ${PLAN_H + 40}" font-family="Georgia, serif"><rect y="-40" width="${PLAN_W}" height="${PLAN_H + 40}" fill="#fff"/><text x="10" y="-14" font-size="18" fill="#2a2824">${xml(title)}</text><rect width="${PLAN_W}" height="${PLAN_H}" fill="none" stroke="#d3c8b4"/>${out.join('')}</svg>`;
}

/** Tous les plans au sol du projet : nom de fichier → SVG. */
export function allFloorPlans(doc: ProjectDoc): Array<{ name: string; svg: string; seqId: ID }> {
  return doc.project.sequenceIds.flatMap((seqId, i) =>
    plansOf(doc, seqId)
      .filter((p) => planOf(doc, p.key).items.length > 0)
      .map((p) => ({ seqId, name: `Séquence ${i + 1} — ${p.name}`, svg: floorPlanSvg(doc, p.key, `${sequenceHeading(doc, seqId)} — ${p.name}`) })),
  );
}
