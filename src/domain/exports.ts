/**
 * Exports individuels par onglet (CSV, texte, SVG), réutilisés par le dossier de production.
 */
import { aggregateEquipment, equipmentCategories } from './equipment';
import { breakdownCategories, breakdownLabel, breakdownOf, derivedBreakdown } from './breakdown';
import { sequenceCharacterIds } from './characters';
import { cameraCone, choreography, computeLighting, lightSpecs, oneShotPlansOf, planOf, plansOf, roomDimensions, DIMENSION_FONT, PLAN_W, PLAN_H, type FloorItem } from './floorplan';
import { CAMERA, FRESNEL, labelBehind, railSvg, symbolSvg } from './floorSymbols';
import { formatFocal } from './focal';
import { sequenceHeading, shotCode } from './numbering';
import { characterNumbers, characterStats, characterUsage, decorStats, decorUsage, usageDayLabel } from './registry';
import { bannerLabel, callSheetStrips, dayAgenda, dayKeyTimes, dayStats, scheduleDays, stripCharacterIds, dayItinerary, dayEquipment, shotSlotsText } from './schedule';
import { decorLocation } from './locations';
import { formatTc } from './timecode';
import { computeTiming, formatGap } from './timing';
import { renderTokens } from './tokens';
import { safeCell } from './csv';
import type { ID, ProjectDoc } from './types';
import { isZoom } from './vocabulary';

const esc = (v: string | number | undefined) => {
  const s = v === undefined ? '' : typeof v === 'number' ? String(v) : safeCell(v);
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
  const nums = characterNumbers(doc);
  const u = characterUsage(doc);
  return csv([
    ['N°', 'Nom', 'Alias', 'Type', 'Interprète', 'Séquences', 'Plans', '1er jour', 'Jours'],
    ...Object.values(doc.characters)
      .sort((a, b) => (nums.get(a.id) ?? 0) - (nums.get(b.id) ?? 0))
      .map((c) => [nums.get(c.id), c.name, (c.aliases ?? []).join(', '), c.kind, c.actor, (st.get(c.id)?.sequenceIds ?? []).map((id) => doc.project.sequenceIds.indexOf(id) + 1).join(' '), st.get(c.id)?.shotIds.length ?? 0, usageDayLabel(doc, u.get(c.id)), u.get(c.id)?.days.length ?? 0]),
  ]);
}

export function decorsCsv(doc: ProjectDoc): string {
  const st = decorStats(doc, computeTiming(doc));
  const u = decorUsage(doc);
  return csv([
    ['Décor', 'INT/EXT', 'Lieu de tournage', 'Adresse', 'Accès · stationnement', 'Contact', 'Séquences', 'Durée à tourner', '1er jour', 'Jours'],
    ...Object.values(doc.decors).map((d) => [d.name, d.intExt, decorLocation(d).name, decorLocation(d).address, decorLocation(d).access, decorLocation(d).contact, (st.get(d.id)?.sequenceIds ?? []).map((id) => doc.project.sequenceIds.indexOf(id) + 1).join(' '), formatTc(st.get(d.id)?.totalSec ?? 0), usageDayLabel(doc, u.get(d.id)), u.get(d.id)?.days.length ?? 0]),
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
  const rows: Array<Array<string | number | undefined>> = [['Jour', 'Date', 'Début', 'Fin', 'Séquence', 'Plans', 'Décor', 'Personnages', 'Durée d’écran du jour']];
  for (const d of scheduleDays(doc)) {
    const st = dayStats(doc, t, d.n);
    for (const it of dayAgenda(doc, d.n)) {
      if (it.type === 'banner') {
        rows.push([`J${d.n}`, d.date, it.start, it.end, [bannerLabel(it.banner), it.banner.label].filter(Boolean).join(' · '), '', '', '', '']);
        continue;
      }
      const s = it.strip;
      const seq = doc.sequences[s.seqId];
      rows.push([`J${d.n}`, d.date, it.start, it.end, sequenceHeading(doc, s.seqId), s.shotIds.map((id) => shotCode(doc, id)).join(' '), seq.decorId ? doc.decors[seq.decorId]?.name : '', stripCharacterIds(doc, s).map((c) => doc.characters[c]?.name).join(', '), formatTc(st.screenSec)]);
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
    ...(() => {
      // Horaires clés : repas et reprise de … à …, fin prévue.
      const k = dayKeyTimes(doc, day, dayAgenda(doc, day, strips));
      const lines = [
        d?.pat && ['Prêt à tourner', d.pat],
        k.meal && ['Repas', k.meal.start, k.meal.end],
        k.restart && ['Reprise', k.restart.start, k.restart.end],
        !k.restart?.end && k.wrap && ['Fin prévue', '', k.wrap],
      ].filter((x): x is Array<string | undefined> => !!x);
      return lines.length ? [['Horaires', 'Début', 'Fin'], ...lines, []] : [];
    })(),
    ['Lieux et horaires', 'Adresse', 'Début', 'Fin', 'Séquence'],
    ...(() => {
      const stops = dayItinerary(doc, day);
      return dayAgenda(doc, day, strips).flatMap((it) => {
        if (it.type === 'banner') return [[[bannerLabel(it.banner), it.banner.label].filter(Boolean).join(' · '), '', it.start, it.end, `${it.banner.minutes} min`]];
        const p = stops.find((x) => x.seqIds[0] === it.strip.seqId);
        return p ? [[p.decorId ? doc.decors[p.decorId]?.name : '', p.address, p.start, p.end, p.seqIds.map((id) => sequenceHeading(doc, id)).join(' · ')]] : [];
      });
    })(),
    [],
    ['Convocations', 'Interprète', 'Heure'],
    ...st.characterIds.map((id) => [doc.characters[id]?.name, doc.characters[id]?.actor, d?.calls?.[id]]),
    [],
    ['Matériel requis'],
    ...dayEquipment(doc, strips.flatMap((s) => s.shotIds), aggregateEquipment(doc), equipmentCategories(doc)).flatMap((g) => g.labels.map((l) => [g.category, l])),
    [],
    ['Horaire', 'Plan', 'Séquence', 'Sujet', 'Valeur', 'Focale', 'Action'],
    ...strips.flatMap((s) =>
      s.shotIds.map((id) => {
        const sh = doc.shots[id];
        return [shotSlotsText(doc, day, id), shotCode(doc, id), sequenceHeading(doc, s.seqId), sh.subject, sh.value, formatFocal(sh.focal, isZoom(sh.movement)), doc.blocks[sh.actionBlockId]?.text];
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
  const k = planOf(doc, key).stroke ?? 1;
  const out: string[] = [];
  const { beams, shadows } = computeLighting(items);
  for (const sh of shadows) out.push(`<polygon points="${pts(sh)}" fill="#111318" fill-opacity="0.14"/>`);
  for (const b of beams) out.push(`<polygon points="${pts(b.points)}" fill="#6b7079" fill-opacity="${Math.min(0.4, 0.22 * b.intensity).toFixed(2)}"/>`);
  for (const p of choreography(items))
    if (p.points.length > 1) out.push(`<polyline points="${pts(p.points)}" fill="none" stroke="${p.kind === 'camera' ? '#111318' : '#6b7079'}" stroke-width="${p.kind === 'camera' ? 2.5 : 2}" stroke-dasharray="${p.kind === 'camera' ? '10 6' : '3 5'}"/>`);
  for (const i of items as FloorItem[]) {
    if ((i.kind === 'camera' || i.kind === 'actor') && i.beat) out.push(`<text x="${i.x + 16}" y="${i.y - 16}" font-size="14" font-weight="700" fill="#111318">T${i.beat}</text>`);
    switch (i.kind) {
      case 'camera': {
        const c = cameraCone(doc, i);
        out.push(`<polygon points="${pts(c.points)}" fill="#111318" fill-opacity="0.06" stroke="#111318" stroke-dasharray="4 3"/>`);
        out.push(symbolSvg(CAMERA, i.x, i.y, i.rot));
        const at = labelBehind(i.x, i.y, i.rot, 34);
        out.push(`<text x="${at.x.toFixed(1)}" y="${at.y.toFixed(1)}" font-size="12" text-anchor="${at.anchor}" fill="#6b7079">${xml(`${i.label ?? ''}${c.focal ? ` · ${c.focal}mm` : ''}`)}</text>`);
        break;
      }
      case 'actor':
        if (i.to) out.push(`<line x1="${i.x}" y1="${i.y}" x2="${i.to.x}" y2="${i.to.y}" stroke="#6b7079" stroke-width="1.2" stroke-dasharray="5 4"/>`);
        out.push(
          `<g transform="rotate(${(i.rot ?? 90) - 90} ${i.x} ${i.y})"><ellipse cx="${i.x}" cy="${i.y}" rx="17" ry="7" fill="#c9ccd2" stroke="#111318"/><circle cx="${i.x}" cy="${i.y}" r="8.5" fill="#111318" stroke="#fff"/><circle cx="${i.x - 3.2}" cy="${i.y + 5.6}" r="1.3" fill="#fff"/><circle cx="${i.x + 3.2}" cy="${i.y + 5.6}" r="1.3" fill="#fff"/></g><text x="${i.x}" y="${i.y - 13}" font-size="11" font-weight="600" text-anchor="middle" fill="#111318">${xml(i.label)}</text>`,
        );
        if (i.characterId && doc.characters[i.characterId]) out.push(`<text x="${i.x}" y="${i.y + 32}" font-size="12" text-anchor="middle" fill="#6b7079">${xml(doc.characters[i.characterId].name)}</text>`);
        break;
      case 'wall':
        out.push(`<line x1="${i.x}" y1="${i.y}" x2="${i.x2}" y2="${i.y2}" stroke="${i.kind === 'wall' && i.white ? '#d6d8dd' : '#5f636b'}" stroke-width="${3.5 * k}"/>`);
        break;
      case 'rail':
        out.push(railSvg(i.x, i.y, i.x2, i.y2, k));
        break;
      case 'reflector':
        out.push(`<line x1="${i.x + 3}" y1="${i.y + 4}" x2="${i.x2 + 3}" y2="${i.y2 + 4}" stroke="#000" stroke-opacity="0.35" stroke-width="${8 * k}" stroke-linecap="round"/>`);
        out.push(`<line x1="${i.x}" y1="${i.y}" x2="${i.x2}" y2="${i.y2}" stroke="#1f1d1a" stroke-width="${7 * k}" stroke-linecap="round"/><line x1="${i.x}" y1="${i.y}" x2="${i.x2}" y2="${i.y2}" stroke="#ffffff" stroke-width="${3.5 * k}" stroke-linecap="round"/>`);
        break;
      case 'diffuser':
        out.push(`<line x1="${i.x}" y1="${i.y}" x2="${i.x2}" y2="${i.y2}" stroke="#9aa1ab" stroke-width="${5 * k}" stroke-dasharray="1 1.5"/>`);
        break;
      case 'flag':
        out.push(`<line x1="${i.x}" y1="${i.y}" x2="${i.x2}" y2="${i.y2}" stroke="#0d0d0d" stroke-width="${4.5 * k}"/>`);
        break;
      case 'door':
        // Ouverture dans le mur et battant au quart de cercle, comme à l'écran.
        out.push(
          `<g transform="rotate(${i.rot} ${i.x} ${i.y})"><line x1="${i.x}" y1="${i.y}" x2="${i.x + i.width}" y2="${i.y}" stroke="#fff" stroke-width="${9 * k}"/><path d="M ${i.x} ${i.y} L ${i.x} ${i.y + i.width} A ${i.width} ${i.width} 0 0 0 ${i.x + i.width} ${i.y}" fill="none" stroke="#5f636b" stroke-width="${1.5 * k}"/></g>`,
        );
        break;
      case 'window':
        out.push(`<rect x="${i.x}" y="${i.y - 4}" width="${i.width}" height="8" fill="#fff" stroke="#5f636b" stroke-width="${1.5 * k}" transform="rotate(${i.rot} ${i.x} ${i.y})"/>`);
        break;
      case 'light':
        // Projecteur orienté comme à l'écran ; lampe de jeu : ampoule et rayons.
        out.push(
          i.practical
            ? `<circle cx="${i.x}" cy="${i.y}" r="9" fill="#fff" stroke="#111318" stroke-width="1.5"/><path d="${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const r = (a * Math.PI) / 180; return `M ${(i.x + Math.cos(r) * 12).toFixed(1)} ${(i.y + Math.sin(r) * 12).toFixed(1)} L ${(i.x + Math.cos(r) * 17).toFixed(1)} ${(i.y + Math.sin(r) * 17).toFixed(1)}`; }).join(' ')}" stroke="#6b7079" stroke-width="1.6" stroke-linecap="round"/>`
            : symbolSvg(FRESNEL, i.x, i.y, i.rot),
        );
        {
          const at = i.practical ? { x: i.x, y: i.y + 30, anchor: 'middle' } : labelBehind(i.x, i.y, i.rot, 30);
          const specs = lightSpecs(i);
          out.push(
            `<text x="${at.x.toFixed(1)}" y="${at.y.toFixed(1)}" font-size="12" text-anchor="${at.anchor}" fill="#6b7079">${xml(i.label ?? '')}${specs ? `<tspan x="${at.x.toFixed(1)}" dy="${at.y < i.y ? '-1.25em' : '1.25em'}" font-size="10">${xml(specs)}</tspan>` : ''}</text>`,
          );
        }
        break;
    }
  }
  // Cotes de la pièce : traits fins et valeurs en mètres, comme à l'écran ; le texte grandit avec le
  // cadre exporté pour rester lisible une fois la page réduite.
  const span = (vs: number[]) => Math.max(...vs) - Math.min(...vs);
  const xs = [0, PLAN_W, ...items.flatMap((i) => ('x2' in i ? [i.x, i.x2] : [i.x]))];
  const ys = [0, PLAN_H, ...items.flatMap((i) => ('y2' in i ? [i.y, i.y2] : [i.y]))];
  const dims = roomDimensions(planOf(doc, key), Math.max(1, Math.max(span(xs), span(ys)) / (70 * DIMENSION_FONT)));
  for (const d of dims) {
    const t = d.tick;
    const ticks = [[d.x1, d.y1], [d.x2, d.y2]].map(([x, y]) => `M ${x - t} ${y + t} L ${x + t} ${y - t}`).join(' ');
    out.push(
      `<g stroke="#6b7079" stroke-width="0.8" fill="none">${d.ext.map(([a, b, c, e]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${e}"/>`).join('')}<line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}"/><path d="${ticks}" stroke-width="1.2"/></g><text x="${d.tx}" y="${d.ty}" font-size="${+d.font.toFixed(1)}" text-anchor="middle" fill="#3a3e45"${d.rot ? ` transform="rotate(${d.rot} ${d.tx} ${d.ty})"` : ''}>${xml(d.label)}</text>`,
    );
  }
  // Cadre : la zone par défaut, élargie à tout ce qui a été placé (fond à l'échelle réelle et cotes compris).
  for (const d of dims) {
    xs.push(d.rot ? d.tx - d.font : d.x1);
    ys.push(d.rot ? d.y1 : d.ty - d.font);
  }
  const x0 = Math.min(...xs) - 30;
  const y0 = Math.min(...ys) - 70;
  const w = Math.max(...xs) + 30 - x0;
  const h = Math.max(...ys) + 30 - y0;
  // Largeur et hauteur explicites : Safari ne sait pas dessiner un SVG qui n'a qu'une viewBox.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="${x0} ${y0} ${w} ${h}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#fff"/><text x="${x0 + 40}" y="${y0 + 26}" font-size="18" fill="#111318">${xml(title)}</text>${out.join('')}</svg>`;
}

/** Tous les plans au sol du projet : nom de fichier → SVG. */
export function allFloorPlans(doc: ProjectDoc): Array<{ name: string; svg: string; seqId: ID }> {
  return doc.project.sequenceIds.flatMap((seqId, i) =>
    [...plansOf(doc, seqId), ...oneShotPlansOf(doc, seqId)]
      .filter((p) => planOf(doc, p.key).items.length > 0)
      .map((p) => ({ seqId, name: `Séquence ${i + 1} — ${p.name}`, svg: floorPlanSvg(doc, p.key, `${sequenceHeading(doc, seqId)} — ${p.name}`) })),
  );
}
