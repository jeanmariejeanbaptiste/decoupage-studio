/**
 * Documents imprimables (PDF) et exportables (Word) de chaque onglet : HTML autonome, sobre,
 * pensé pour le papier (fond blanc, filets fins, couleurs en accent seulement).
 */
import { aggregateEquipment, equipmentCategories } from './equipment';
import { breakdownCategories, breakdownLabel, breakdownOf, derivedBreakdown } from './breakdown';
import { sequenceCharacterIds } from './characters';
import { allFloorPlans, floorPlanSvg } from './exports';
import { oneShotPlanKey, planOf } from './floorplan';
import { beatTransitions, formatOneShotDuration, oneShotTiming } from './oneshot';
import { formatFocal } from './focal';
import { sequenceHeading, shotCode } from './numbering';
import { characterNumbers, characterStats, decorStats, decorUsage, characterUsage, numberedCast, usageDayLabel } from './registry';
import { bannerLabel, showTime, callSheetAgenda, callSheetStrips, dayAgenda, dayKeyTimes, dayEquipment, dayStats, dayTitle, dayTotalsText, firstSlot, scheduleDays, shotSlotsText, stripCharacterIds, stripTone, type AgendaItem } from './schedule';
import { decorLocation } from './locations';
import { sequenceSummary } from './outline';
import { cleanAddress, routeUrl, storedGeocode } from './geo';
import { formatTc } from './timecode';
import { computeTiming, formatGap } from './timing';
import { renderTokens } from './tokens';
import type { ProjectDoc } from './types';
import { isZoom, valueRank } from './vocabulary';
import { cameraFrameKey, questionsFor, setupRef, setupShotIds, type InterviewQuestion } from './interview';
import { productionSvgPages } from './productionChart';
import { durationDays, formatFrDate, phaseDays, phaseSpan } from './production';
import { todayIso } from './calendar';

export const esc = (s: string | number | undefined | null) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const CSS = `
@page { size: A4 PORTRAIT; margin: 0; }
table.sheet { width: 100%; border: 0; margin: 0; } table.sheet > * > tr > td { border: 0; padding: 0 13mm; } .pad { height: 13mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Inter Variable', 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #111318; margin: 0; background: #fff; }
header.doc { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111318; padding-bottom: 6pt; margin-bottom: 12pt; }
header.doc .kicker { font-family: 'Inter Variable', sans-serif; color: #111111; font-size: 15pt; margin: 0; }
header.doc h1 { font-family: 'Inter Variable', sans-serif; font-weight: 600; font-size: 24pt; margin: 0; line-height: 1; }
header.doc .meta { text-align: right; color: #6b7079; font-size: 9pt; }
h2 { font-family: 'Inter Variable', sans-serif; font-size: 15pt; margin: 14pt 0 5pt; break-after: avoid; }
h3 { font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: #6b7079; margin: 10pt 0 4pt; break-after: avoid; }
table { width: 100%; border-collapse: collapse; margin-bottom: 6pt; }
th { text-align: left; font-size: 7.5pt; letter-spacing: .08em; text-transform: uppercase; color: #6b7079; border-bottom: 1.2pt solid #111318; padding: 3pt 4pt; }
td { border-bottom: .6pt solid #d6d8dd; padding: 3pt 4pt; vertical-align: top; }
tr { break-inside: avoid; }
.code { color: #111111; font-weight: 600; white-space: nowrap; }
.muted { color: #6b7079; font-style: italic; }
.block { break-inside: avoid; margin-bottom: 8pt; }
.chips span { display: inline-block; border: .6pt solid #d6d8dd; border-radius: 8pt; padding: 0 5pt; margin: 0 3pt 3pt 0; font-size: 8.5pt; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4pt 14pt; }
.cs-head { display: grid; grid-template-columns: 1fr 1.1fr 1fr; border: 1pt solid #111318; margin: 0 0 8pt; break-inside: avoid; }
.cs-head > div { padding: 7pt 9pt; } .cs-head > div + div { border-left: .6pt solid #111318; }
.cs-head p { margin: 0 0 2pt; } .cs-head h3 { margin: 4pt 0 2pt; } .cs-head h3:first-child { margin-top: 0; }
.cs-prod { font-weight: 700; font-size: 11pt; } .cs-mid { text-align: center; display: flex; flex-direction: column; justify-content: center; }
.cs-title { font-size: 13pt; font-weight: 700; } .cs-call { font-size: 20pt; font-weight: 700; margin-top: 6pt !important; letter-spacing: .02em; }
.cs-events th { border: 0; padding: 1pt 6pt 1pt 0; text-transform: none; letter-spacing: 0; font-size: 8.5pt; color: #6b7079; } .cs-events td { border: 0; padding: 1pt 0; }
.cs-depts { grid-template-columns: repeat(3, 1fr); }
.itw-frames { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6pt; margin-top: 6pt; } .itw-frames figure { margin: 0; break-inside: avoid; } .itw-frames img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border: .6pt solid #d6d8dd; display: block; } .itw-frames figcaption { font-size: 8pt; color: #6b7079; margin-top: 2pt; }
.day { break-inside: avoid; margin-bottom: 10pt; }
.tone-ext-day { background: #eeeeef; } .tone-int-night { background: #dcdddf; } .tone-ext-night { background: #c8c9cc; }
.tone-int-twilight { background: repeating-linear-gradient(135deg, #e1e2e4 0 4px, #ffffff 4px 8px); } .tone-ext-twilight { background: repeating-linear-gradient(135deg, #d7d8da 0 4px, #eeeeef 4px 8px); }
.day-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10pt; border-bottom: 1.2pt solid #111318; padding-bottom: 3pt; margin: 14pt 0 4pt; break-after: avoid; }
tr.banner td { border-bottom: .6pt dashed #b9bbc0; color: #6b7079; font-style: italic; } tr.banner b { color: #111318; font-style: normal; font-weight: 600; }
.day-head h2 { margin: 0; } .day-head .totals { color: #6b7079; font-size: 8.5pt; text-align: right; }
.plan { break-inside: avoid; break-after: page; } .plan:last-child { break-after: auto; }
.plan svg { width: 100%; height: auto; border: .6pt solid #d6d8dd; }
.plan.gantt svg { border: 0; }
.time { font-family: 'Inter Variable', sans-serif; font-size: 9pt; white-space: nowrap; }
p.text { white-space: pre-wrap; line-height: 1.6; font-size: 11pt; }
a.route { color: #111318; font-size: 8pt; text-decoration: underline; text-decoration-thickness: .5pt; }
.cs-map { display: grid; grid-template-columns: 1.7fr 1fr; gap: 10pt; align-items: start; break-inside: avoid; margin: 2pt 0 8pt; }
.cs-map img { display: block; width: 100%; height: auto; border: .6pt solid #d6d8dd; }
.cs-map ol { list-style: none; margin: 0; padding: 0; } .cs-map li { display: flex; gap: 5pt; align-items: baseline; padding: 1.5pt 0; font-size: 9pt; }
.cs-map .pin { flex: none; min-width: 13pt; padding: 0 3pt; border-radius: 7pt; background: #111318; color: #fff; font-size: 7.5pt; font-weight: 600; text-align: center; line-height: 12pt; } .cs-map .pin.h { border-radius: 2pt; }
`;

export interface DocPage {
  title: string;
  html: string;
}

/** Document Word (.doc) : le HTML du document, que Word, Pages et LibreOffice ouvrent directement. */
export function wordHtml(page: DocPage, orientation?: 'portrait' | 'landscape'): string {
  let html = page.html.replace('<html lang="fr">', '<html lang="fr" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
  // Word ne lit pas `@page { size }` seul : la section reçoit aussi son orientation (mso).
  if (orientation === 'landscape')
    html = html.replace('</style>', '@page WordSection { size: 29.7cm 21cm; mso-page-orientation: landscape; margin: 1.5cm; } body { page: WordSection; } div.WordSection { page: WordSection; }</style>').replace(/<body([^>]*)>/, '<body$1><div class="WordSection">').replace('</body>', '</div></body>');
  return html;
}

function shell(doc: ProjectDoc, kicker: string, title: string, body: string, landscape = false): DocPage {
  const date = new Date().toLocaleDateString('fr-FR');
  void kicker; // l'étape n'apparaît plus dans les documents (titre seul)
  const head = `<header class="doc"><div><h1>${esc(title)}</h1></div><div class="meta">${esc(doc.project.title)} · ${esc(doc.project.version)}<br>${esc(
    [doc.project.director && `Réalisation : ${doc.project.director}`, doc.project.dop && `Image : ${doc.project.dop}`].filter(Boolean).join(' · '),
  )}<br>${date}</div></header>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(`${doc.project.title} — ${title}`)}</title><style>${CSS.replace(
    'PORTRAIT',
    landscape ? 'landscape' : 'portrait',
  )}</style></head><body><table class="sheet"><thead><tr><td><div class="pad"></div></td></tr></thead><tbody><tr><td>${head}${body}</td></tr></tbody><tfoot><tr><td><div class="pad"></div></td></tr></tfoot></table></body></html>`;
  return { title, html };
}

export function breakdownDocument(doc: ProjectDoc): DocPage {
  const body = doc.project.sequenceIds
    .map((id) => {
      const m = breakdownOf(doc, id);
      const d = derivedBreakdown(doc, id);
      const seq = doc.sequences[id];
      const summary = sequenceSummary(doc, id);
      const rows = breakdownCategories(doc).map((c) => ({ c, items: [...(d[c] ?? []), ...(m[c] ?? [])] })).filter((r) => r.items.length);
      return `<section class="block"><h2>${esc(sequenceHeading(doc, id))} <span class="muted" style="font-size:10pt">${esc([seq.intExt, seq.effect].filter(Boolean).join(' · '))}</span></h2>${
        summary ? `<p class="muted">${esc(summary)}</p>` : ''
      }${rows.length ? `<table><tbody>${rows.map((r) => `<tr><th style="width:24%">${esc(breakdownLabel(r.c))}</th><td class="chips">${r.items.map((x) => `<span>${esc(x)}</span>`).join('')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Rien à signaler.</p>'}</section>`;
    })
    .join('');
  return shell(doc, 'Étape 3', 'Dépouillement', body);
}

export function equipmentDocument(doc: ProjectDoc, showShots: boolean): DocPage {
  const eq = aggregateEquipment(doc);
  const body = equipmentCategories(doc).map(
    (c) =>
      `<section class="block"><h2>${esc(c)}</h2>${
        eq[c].length
          ? `<table><thead><tr><th>Matériel</th>${showShots ? '<th>Plans concernés</th>' : ''}</tr></thead><tbody>${eq[c]
              .map((l) => `<tr><td>${esc(l.label)}${l.manual ? ' <span class="muted">(ajout)</span>' : ''}</td>${showShots ? `<td>${l.shotIds.map((id) => esc(shotCode(doc, id))).join(', ') || '—'}</td>` : ''}</tr>`)
              .join('')}</tbody></table>`
          : '<p class="muted">Rien pour ce poste.</p>'
      }</section>`,
  ).join('');
  return shell(doc, 'Étape 7', 'Listes de matériel', body);
}

/** Classe de la bande imprimée (mêmes paliers de gris qu'à l'écran) ; aucune en économie d'encre. */
function tone(doc: ProjectDoc, seqId: string): string {
  if (doc.project.settings.exportInkSaver) return '';
  const t = stripTone(doc.sequences[seqId]);
  return t === 'int-day' ? '' : `tone-${t}`;
}

/** Plage horaire imprimée ; après minuit : « 01:30 (+1) ». */
const slotText = (slot?: { start?: string; end?: string }) => (slot?.start || slot?.end ? `${showTime(slot.start) || '…'} – ${showTime(slot.end) || '…'}` : '');

/** Ligne d'un bandeau (installation, trajet, repas, pause) dans un tableau horaire. */
const bannerRow = (it: Extract<AgendaItem, { type: 'banner' }>, span: number) =>
  `<tr class="banner"><td class="time">${esc(slotText(it))}</td><td colspan="${span}"><b>${esc(bannerLabel(it.banner))}</b>${it.banner.label ? ` · ${esc(it.banner.label)}` : ''} · ${it.banner.minutes} min</td></tr>`;

export function scheduleDocument(doc: ProjectDoc): DocPage {
  const t = computeTiming(doc);
  const days = scheduleDays(doc);
  const nums = characterNumbers(doc);
  const body = days.length
    ? days
        .map((d) => {
          const st = dayStats(doc, t, d.n);
          return `<section class="day"><div class="day-head"><h2>${esc(dayTitle(d, days.length))}</h2><span class="totals">${esc(dayTotalsText(doc, st))}</span></div><table><thead><tr><th>Horaire</th><th>Séq.</th><th>INT/EXT</th><th>Décor</th><th>Personnages</th><th>Plans</th></tr></thead><tbody>${dayAgenda(doc, d.n)
            .map((it) => {
              if (it.type === 'banner') return bannerRow(it, 5);
              const s = it.strip;
              const seq = doc.sequences[s.seqId];
              return `<tr class="${tone(doc, s.seqId)}"><td class="time">${esc(slotText(it))}</td><td class="code">${esc(sequenceHeading(doc, s.seqId))}</td><td>${esc([seq.intExt, seq.effect].filter(Boolean).join(' · '))}</td><td>${esc(seq.decorId ? doc.decors[seq.decorId]?.name : '')}</td><td>${esc(numberedCast(doc, stripCharacterIds(doc, s), nums))}</td><td>${s.shotIds.length}</td></tr>`;
            })
            .join('')}</tbody></table></section>`;
        })
        .join('')
    : '<p class="muted">Aucun jour de tournage.</p>';
  return shell(doc, 'Étape 8', 'Plan de travail', body, true);
}

/**
 * Feuille de service, au format des feuilles professionnelles : en-tête en trois blocs (production,
 * jour et rendez-vous, météo, horaires clés et hôpital), puis séquences, plans, comédiens, figuration,
 * besoins par poste, prévisions du lendemain et notes.
 */
/** Lien d'itinéraire OpenStreetMap vers une adresse (coordonnées du géocodage si connues). */
function routeLink(doc: ProjectDoc, address: string): string {
  return `<a class="route" href="${esc(routeUrl(address, storedGeocode(doc, address)))}">Itinéraire</a>`;
}

/** Carte des lieux du jour pour l'export : image composée à part (tuiles et repères), légende numérotée. */
export interface CallSheetMap {
  src: string;
  width: number;
  height: number;
  legend: Array<{ label: string; title: string; hospital?: boolean }>;
}

export function callSheetDocument(doc: ProjectDoc, day: number, opts: { map?: CallSheetMap } = {}): DocPage {
  const days = scheduleDays(doc);
  const d = days.find((x) => x.n === day);
  const strips = callSheetStrips(doc, day);
  const timing = computeTiming(doc);
  const st = dayStats(doc, timing, day, strips);
  const nums = characterNumbers(doc);
  const date = d?.date ? new Date(`${d.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Date à préciser';
  const cell = (label: string, value?: string) => (value ? `<tr><th>${esc(label)}</th><td class="time">${esc(value)}</td></tr>` : '');
  const agenda = callSheetAgenda(doc, day);
  // Repas, reprise et fin prévue : saisis sur la feuille, sinon déduits du déroulé (bandeau « Repas », dernière bande).
  const keys = dayKeyTimes(doc, day);
  const range = (a: string, b?: string) => (b ? `de ${showTime(a)} à ${showTime(b)}` : showTime(a));
  const events = [
    cell('Rendez-vous', d?.callTime),
    cell('Prêt à tourner', d?.pat),
    keys.meal && cell('Repas', range(keys.meal.start, keys.meal.end)),
    keys.restart && cell('Reprise', range(keys.restart.start, keys.restart.end)),
    !keys.restart?.end && cell('Fin prévue', showTime(keys.wrap)),
  ]
    .filter(Boolean)
    .join('');
  const sun = [d?.sunrise && `Lever ${d.sunrise}`, d?.sunset && `coucher ${d.sunset}`].filter(Boolean).join(' · ');
  const head = `<div class="cs-head">
<div><p class="cs-prod">${esc(doc.project.title)}</p><p class="muted">${esc(doc.project.version)}</p>
${doc.project.director ? `<p>Réalisation : ${esc(doc.project.director)}</p>` : ''}${doc.project.dop ? `<p>Image : ${esc(doc.project.dop)}</p>` : ''}</div>
<div class="cs-mid"><p class="cs-title">${esc(date)}</p><p>Jour ${day}${days.length ? ` sur ${days.length}` : ''}</p><p class="cs-call">RDV&nbsp;: ${esc(d?.callTime || '—')}</p></div>
<div><h3>Météo</h3><p>${esc(d?.weather || '—')}</p>${sun ? `<p class="muted">${esc(sun)}</p>` : ''}
${events ? `<h3>Horaires</h3><table class="cs-events"><tbody>${events}</tbody></table>` : ''}
<h3>Hôpital le plus proche</h3><p>${esc(d?.hospital || '—')}${d?.hospital?.trim() ? `<br>${routeLink(doc, cleanAddress(d.hospital))}` : ''}</p></div>
</div>`;

  const seqRows = agenda
    .map((it) => {
      if (it.type === 'banner') return bannerRow(it, 5);
      const strip = it.strip;
      const seq = doc.sequences[strip.seqId];
      const summary = seq ? sequenceSummary(doc, strip.seqId) : undefined;
      const r = it.start ? it : undefined;
      const decor = seq?.decorId ? doc.decors[seq.decorId] : undefined;
      const heading = [[seq?.intExt, decor?.name ?? seq?.label].filter(Boolean).join('. '), seq?.effect].filter(Boolean).join(' — ');
      const cast = stripCharacterIds(doc, strip).map((id) => nums.get(id)).filter((n): n is number => !!n).sort((a, b) => a - b);
      const dur = strip.shotIds.reduce((n, id) => n + (doc.shots[id] ? (timing.blocks.get(doc.shots[id].actionBlockId)?.durationSec ?? 0) / Math.max(1, strip.shotIds.length) : 0), 0);
      const loc = decorLocation(decor);
      // Lieu de tournage : nom, adresse (celle du jour d'abord), accès et contact.
      const address = d?.seqAddresses?.[strip.seqId] ?? (seq?.decorId ? d?.addresses?.[seq.decorId] : undefined) ?? loc.address ?? '';
      const place = [loc.name && `<b>${esc(loc.name)}</b>`, esc(address), address.trim() && routeLink(doc, address), loc.access && `<span class="muted">Accès : ${esc(loc.access)}</span>`, loc.contact && `<span class="muted">Contact : ${esc(loc.contact)}</span>`].filter(Boolean).join('<br>');
      return `<tr><td class="time">${r ? esc(slotText(r)) : '—'}</td><td class="code">${doc.project.sequenceIds.indexOf(strip.seqId) + 1}</td><td><b>${esc(heading.toUpperCase())}</b>${summary ? `<br><span class="muted">${esc(summary)}</span>` : ''}</td><td>${cast.join(', ')}</td><td class="time">${strip.shotIds.length} pl.${dur ? ` · ${esc(formatTc(Math.round(dur)))}` : ''}</td><td>${place}</td></tr>`;
    })
    .join('');
  const scenes = `<h3>Séquences</h3><table><thead><tr><th>Horaire</th><th>Séq.</th><th>Description</th><th>Personnages</th><th>Plans · durée</th><th>Lieu de tournage</th></tr></thead><tbody>${seqRows || '<tr><td colspan="6" class="muted">Aucune séquence ce jour.</td></tr>'}</tbody></table>`;

  // Carte réduite des lieux du jour, sous le tableau qui donne leurs adresses et itinéraires.
  const m = opts.map;
  const map = m
    ? `<h3>Lieux du jour</h3><div class="cs-map"><img src="${esc(m.src)}" width="${m.width}" height="${m.height}" alt="Carte des lieux du jour"><ol>${m.legend
        .map((x) => `<li><span class="pin${x.hospital ? ' h' : ''}">${esc(x.label)}</span>${esc(x.title)}</li>`)
        .join('')}</ol></div>`
    : '';

  const shots = `<h3>Plans</h3><table><thead><tr><th>Horaire</th><th>Plan</th><th>Image</th><th>Sujet · action</th></tr></thead><tbody>${strips
    .flatMap((x) => x.shotIds)
    .sort((a, b) => (firstSlot(doc, day, a)?.start ?? '99').localeCompare(firstSlot(doc, day, b)?.start ?? '99'))
    .map((id) => {
      const sh = doc.shots[id];
      const visual = [sh.value, renderTokens(sh.angle), renderTokens(sh.movement, sh.movementSep), formatFocal(sh.focal, isZoom(sh.movement))].filter(Boolean).join(' · ');
      return `<tr><td class="time">${esc(shotSlotsText(doc, day, id) || '—')}</td><td class="code">${esc(shotCode(doc, id))}</td><td>${esc(visual)}</td><td>${esc([sh.subject, doc.blocks[sh.actionBlockId]?.text].filter(Boolean).join(' — '))}</td></tr>`;
    })
    .join('')}</tbody></table>`;

  const castRows = [...st.characterIds]
    .sort((a, b) => (nums.get(a) ?? 99) - (nums.get(b) ?? 99))
    .map((id) => {
      const c = doc.characters[id];
      const x = d?.callDetails?.[id] ?? {};
      return `<tr><td class="code">${nums.get(id) ?? ''}</td><td>${esc(c?.name)}</td><td>${esc(c?.actor || '—')}</td><td class="time">${esc(x.pickup || '')}</td><td class="time">${esc(d?.calls?.[id] || '—')}</td><td class="time">${esc(x.makeup || '')}</td><td class="time">${esc(x.costume || '')}</td><td class="time">${esc(x.onSet || '')}</td></tr>`;
    })
    .join('');
  const cast = `<h3>Comédiens</h3><table><thead><tr><th>N°</th><th>Rôle</th><th>Interprète</th><th>Départ</th><th>Convocation</th><th>HMC</th><th>Costume</th><th>Sur le plateau</th></tr></thead><tbody>${castRows || '<tr><td colspan="8" class="muted">Aucun comédien.</td></tr>'}</tbody></table>`;

  // Besoins des postes, tirés du dépouillement des séquences du jour.
  const needs = new Map<string, Set<string>>();
  for (const strip of strips) {
    const m = breakdownOf(doc, strip.seqId);
    const der = derivedBreakdown(doc, strip.seqId);
    for (const cat of breakdownCategories(doc)) {
      // Personnages : tableau des comédiens ; machinerie, lumière, son : le matériel du jour.
      if (cat === 'personnages' || cat === 'machinerie' || cat === 'lumiere' || cat === 'son') continue;
      for (const item of [...(der[cat] ?? []), ...(m[cat] ?? [])]) {
        const set = needs.get(cat) ?? new Set<string>();
        set.add(item);
        needs.set(cat, set);
      }
    }
  }
  const extras = needs.get('figurants');
  needs.delete('figurants');
  const figuration = extras?.size ? `<h3>Figuration</h3><p>${[...extras].map(esc).join(' · ')}</p>` : '';
  const deptBoxes = [...needs.entries()].map(([cat, set]) => `<div><b>${esc(breakdownLabel(cat))}</b><p>${[...set].map(esc).join('<br>')}</p></div>`);
  const equipment = dayEquipment(doc, strips.flatMap((x) => x.shotIds), aggregateEquipment(doc), equipmentCategories(doc))
    .filter((g) => g.labels.length)
    .map((g) => `<div><b>Matériel · ${esc(g.category)}</b><p>${g.labels.map(esc).join('<br>')}</p></div>`);
  const depts = deptBoxes.length || equipment.length ? `<h3>Besoins des postes</h3><div class="grid cs-depts">${[...deptBoxes, ...equipment].join('')}</div>` : '';

  const next = days.find((x) => x.n > day);
  const nextStrips = next ? callSheetStrips(doc, next.n) : [];
  const tomorrow = next
    ? `<h3>Prévisions · jour ${next.n}${next.date ? `, ${esc(new Date(`${next.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}` : ''}${next.callTime ? ` · RDV ${esc(next.callTime)}` : ''}</h3><p>${nextStrips.map((x) => esc(sequenceHeading(doc, x.seqId))).join(' · ') || '<span class="muted">À préciser.</span>'}</p>`
    : '';

  const body = `${head}${scenes}${map}${shots}${cast}${figuration}${depts}${tomorrow}${d?.notes ? `<h3>Notes</h3><p class="text">${esc(d.notes)}</p>` : ''}`;
  return shell(doc, 'Étape 9', `Feuille de service — Jour ${day}`, body);
}

export function registryDocument(doc: ProjectDoc): DocPage {
  const t = computeTiming(doc);
  const cs = characterStats(doc);
  const ds = decorStats(doc, t);
  const nums = characterNumbers(doc);
  const cu = characterUsage(doc);
  const du = decorUsage(doc);
  const unused = '<span class="muted">inutilisé</span>';
  const n = (ids: string[]) => ids.map((id) => doc.project.sequenceIds.indexOf(id) + 1).join(', ');
  const body = `<h2>Séquences</h2><table><thead><tr><th>N°</th><th>Libellé</th><th>Décor</th><th>INT/EXT · effet</th><th>Personnages</th><th>Plans</th><th>Estimée</th><th>Calculée</th><th>Écart</th></tr></thead><tbody>${doc.project.sequenceIds
    .map((id, i) => {
      const s = doc.sequences[id];
      const st = t.sequences.get(id);
      return `<tr><td class="code">${i + 1}</td><td>${esc(s.label)}</td><td>${esc(s.decorId ? doc.decors[s.decorId]?.name : '')}</td><td>${esc([s.intExt, s.effect].filter(Boolean).join(' · '))}</td><td>${esc(sequenceCharacterIds(doc, id).map((c) => doc.characters[c]?.name).join(', '))}</td><td>${s.shotIds.length}</td><td class="time">${s.estimatedSec !== undefined ? formatTc(s.estimatedSec) : '—'}</td><td class="time">${formatTc(st?.durationSec ?? 0)}</td><td class="time">${st?.gap ? esc(formatGap(st.gap)) : '—'}</td></tr>`;
    })
    .join('')}</tbody></table>
<h2>Personnages</h2><table><thead><tr><th>N°</th><th>Nom</th><th>Type</th><th>Interprète</th><th>Séquences</th><th>Plans</th><th>1er jour</th><th>Jours</th></tr></thead><tbody>${Object.values(doc.characters)
    .sort((a, b) => (nums.get(a.id) ?? 0) - (nums.get(b.id) ?? 0))
    .map((c) => {
      const u = cu.get(c.id);
      return `<tr><td class="code">${nums.get(c.id) ?? ''}</td><td>${esc(c.name)}</td><td>${esc(c.kind)}</td><td>${esc(c.actor || '—')}</td><td>${u?.sequenceIds.length ? n(u.sequenceIds) : unused}</td><td>${cs.get(c.id)?.shotIds.length ?? 0}</td><td class="time">${esc(usageDayLabel(doc, u) || '—')}</td><td>${u?.days.length || '—'}</td></tr>`;
    })
    .join('')}</tbody></table>
<h2>Décors</h2><table><thead><tr><th>Décor</th><th>INT/EXT</th><th>Lieu de tournage</th><th>Séquences</th><th>Durée</th><th>1er jour</th><th>Jours</th></tr></thead><tbody>${Object.values(doc.decors)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .map((d) => {
      const u = du.get(d.id);
      const loc = decorLocation(d);
      const place = [loc.name && `<b>${esc(loc.name)}</b>`, esc(loc.address), loc.access && `<span class="muted">Accès : ${esc(loc.access)}</span>`, loc.contact && `<span class="muted">Contact : ${esc(loc.contact)}</span>`].filter(Boolean).join('<br>');
      return `<tr><td>${esc(d.name)}</td><td>${esc(d.intExt)}</td><td>${place || '—'}</td><td>${u?.sequenceIds.length ? n(u.sequenceIds) : unused}</td><td class="time">${formatTc(ds.get(d.id)?.totalSec ?? 0)}</td><td class="time">${esc(usageDayLabel(doc, u) || '—')}</td><td>${u?.days.length || '—'}</td></tr>`;
    })
    .join('')}</tbody></table>`;
  return shell(doc, 'Base du projet', 'Registre', body, true);
}

export function floorPlansDocument(doc: ProjectDoc): DocPage {
  const plans = allFloorPlans(doc);
  const body = plans.length ? plans.map((p) => `<section class="plan"><h2>${esc(p.name)}</h2>${p.svg}</section>`).join('') : '<p class="muted">Aucun plan au sol.</p>';
  return shell(doc, 'Étape 6', 'Plans au sol', body, true);
}

export function intentionDocument(doc: ProjectDoc): DocPage {
  return shell(doc, 'Étape 1', 'Note d’intention', `<p class="text">${esc(doc.intention || '')}</p>`);
}

/** Temps du plan-séquence en gris alternés (aucune couleur, comme à l'écran). */
const BEAT_HUES = ['#111318', '#5f636b', '#3a3e46', '#8b9099'];

/**
 * Annexe technique des plans-séquences : une page par plan-séquence, avec la frise des temps,
 * le tableau des temps, les transitions en clair et la vue du plan au sol qui lui est propre.
 */
export function oneShotAnnexDocument(doc: ProjectDoc): DocPage {
  const ids = doc.project.sequenceIds.flatMap((s) => doc.sequences[s]?.shotIds ?? []).filter((id) => doc.shots[id]?.oneShot);
  const body = ids.length
    ? ids
        .map((id) => {
          const shot = doc.shots[id];
          const beats = shot.oneShot!.beats;
          const t = oneShotTiming(beats);
          const key = oneShotPlanKey(id);
          const items = planOf(doc, key).items;
          const cams = items.filter((i) => i.kind === 'camera' && i.beat);
          const cameraAt = (n: number) => cams.find((c) => (c as { beat?: number }).beat === n);
          const total = Math.max(1, t.expected || beats.length);
          const share = (i: number) => {
            const b = beats[i];
            const a = b.minSec ?? b.maxSec;
            const z = b.maxSec ?? b.minSec;
            return a !== undefined && z !== undefined ? (a + z) / 2 : t.expected ? 0 : 1;
          };
          const strip = `<div style="display:flex;gap:2px;margin:6pt 0 10pt;height:16pt">${beats
            .map((b, i) => `<div style="flex:${Math.max(share(i), total * 0.05)} 1 0;background:${BEAT_HUES[i % BEAT_HUES.length]};color:#fff;font-size:8pt;padding:2pt 4pt;border-radius:2pt;overflow:hidden;white-space:nowrap">T${i + 1} ${esc(b.value)}</div>`)
            .join('')}</div>`;
          const rows = beats
            .map((b, i) => {
              const w = t.beats[i];
              const dur = b.minSec !== undefined || b.maxSec !== undefined ? `${formatTc(b.minSec ?? b.maxSec ?? 0)}${b.maxSec !== undefined && b.maxSec !== b.minSec ? `–${formatTc(b.maxSec)}` : ''}` : '—';
              return `<tr><td class="code" style="color:${BEAT_HUES[i % BEAT_HUES.length]}">T${i + 1}</td><td class="time">${formatTc(w.startMin)}${w.startMax !== w.startMin ? `–${formatTc(w.startMax)}` : ''}</td><td class="time">${dur}</td><td>${esc(b.value)}</td><td>${esc(b.subject)}</td><td>${esc(b.angle)}</td><td>${esc(b.movement)}</td><td>${b.focal ? `${b.focal} mm` : ''}</td><td>${esc(b.cue)}</td></tr>${b.bridge && i + 1 < beats.length ? `<tr><td></td><td colspan="8" style="font-style:italic">↳ Liaison vers T${i + 2} : ${esc(b.bridge)}</td></tr>` : ''}`;
            })
            .join('');
          const trans = beatTransitions(beats, valueRank, (n) => cameraAt(n))
            .map((x) => `<li><b>T${x.from} → T${x.to}</b> : ${x.notes.map(esc).join(' · ')}</li>`)
            .join('');
          const plan = items.length ? `<h3>Plan au sol du plan-séquence</h3>${floorPlanSvg(doc, key, `Plan-séquence ${shotCode(doc, id)}`)}` : '<p class="muted">Pas de plan au sol pour ce plan-séquence.</p>';
          return `<section class="plan"><h2>Plan-séquence ${esc(shotCode(doc, id))} <span class="muted" style="font-size:10pt">${esc(sequenceHeading(doc, shot.sequenceId))}</span></h2><p><b>${beats.length} temps</b> · durée ${esc(formatOneShotDuration(t) || 'à estimer')}${doc.blocks[shot.actionBlockId]?.text ? ` · ${esc(doc.blocks[shot.actionBlockId].text)}` : ''}</p>${strip}<table><thead><tr><th>Temps</th><th>Début</th><th>Durée</th><th>Valeur</th><th>Sujet</th><th>Angle</th><th>Mouvement</th><th>Focale</th><th>Repères</th></tr></thead><tbody>${rows}</tbody></table><h3>Transitions</h3><ul>${trans || '<li class="muted">Un seul temps.</li>'}</ul>${plan}</section>`;
        })
        .join('')
    : '<p class="muted">Aucun plan-séquence dans ce découpage.</p>';
  return shell(doc, '', 'Annexe · plans-séquences', body);
}

const EYELINE: Record<string, string> = { gauche: 'Regard à gauche de la caméra (vers l’intervieweur)', droite: 'Regard à droite de la caméra (vers l’intervieweur)', camera: 'Face caméra' };

/**
 * Fiche d'interview (institutionnel, A-roll) : une page par intervenant. En paysage (par défaut, comme
 * le découpage), chaque cadre tient sur deux colonnes : le dispositif à gauche, les questions à droite.
 */
export function interviewDocument(doc: ProjectDoc, orientation: 'portrait' | 'landscape' = 'landscape'): DocPage {
  const itw = doc.interview;
  const subjects = itw?.subjects ?? [];
  const landscape = orientation === 'landscape';
  const body = subjects
    .map((s, i) => {
      const qRows = (qs: InterviewQuestion[]) =>
        qs.length
          ? `<table><thead><tr><th style="width:8%">N°</th><th>Question</th><th style="width:36%">Réponse attendue</th></tr></thead><tbody>${qs.map((q, k) => `<tr><td class="code">${k + 1}</td><td>${esc(q.text)}${q.note ? `<br><span class="muted">${esc(q.note)}</span>` : ''}</td><td>${esc(q.expected ?? '')}</td></tr>`).join('')}</tbody></table>`
          : '<p class="muted">Aucune question.</p>';
      const setups = (s.setups ?? [])
        .map((st) => {
          const placed = setupShotIds(doc, st.id);
          const where = placed.length ? `${sequenceHeading(doc, doc.shots[placed[0]].sequenceId)} · plan${placed.length > 1 ? 's' : ''} ${placed.map((id) => shotCode(doc, id)).join(', ')}` : '';
          const cams = st.cameras.map((c) => `<tr><td class="code">Caméra ${esc(c.name)}</td><td>${esc(c.value)}</td><td>${esc(c.angle)}</td><td>${esc(c.focal ? `${c.focal} mm` : '')}</td><td>${esc(c.note ?? '')}</td></tr>`).join('');
          // Storyboard du cadre : une image par caméra, sous le dispositif.
          const frames = st.cameras.map((c) => ({ c, key: cameraFrameKey(doc, st.id, c) })).filter((f) => f.key);
          const board = frames.length ? `<div class="itw-frames">${frames.map(({ c, key }) => `<figure><img data-blob="${esc(key!)}" alt=""><figcaption>${esc(c.name)} · ${esc(c.value)}</figcaption></figure>`).join('')}</div>` : '';
          const setupHtml = `<table><thead><tr><th>Caméra</th><th>Valeur</th><th>Axe</th><th>Focale</th><th>Note</th></tr></thead><tbody>${cams}</tbody></table>
<p>${esc(EYELINE[st.eyeline] ?? '')}</p>
<div class="grid">
<div><h3>Lieu</h3><p>${esc(st.place) || '—'}</p></div>
<div><h3>Arrière-plan</h3><p>${esc(st.background) || '—'}</p></div>
<div><h3>Lumière</h3><p>${esc(st.light) || '—'}</p></div>
<div><h3>Son</h3><p>${esc(st.sound) || '—'}</p></div>
</div>${board}`;
          const qs = qRows(itw ? questionsFor(itw, s.id, st.id) : []);
          // Même repère que la fiche à l'écran : le nom du cadre, sinon « Plan 2.9 » ou « ITW 1 ».
          const name = st.name.trim() || setupRef(doc, s, st.id);
          const title = `<h3>${esc(name)}${where ? ` <span class="muted" style="font-weight:400">— ${esc(where)}</span>` : ''}</h3>`;
          return landscape
            ? `${title}<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:0 9mm;align-items:start"><div>${setupHtml}</div><div>${qs}</div></div>`
            : `${title}${setupHtml}<h3>Questions · ${esc(name)}</h3>${qs}`;
        })
        .join('');
      return `<section class="plan">
<h2>${esc(s.name || `Intervenant ${i + 1}`)}${s.role ? ` — <span class="muted">${esc(s.role)}</span>` : ''}</h2>
${setups}
${s.notes ? `<h3>Notes</h3><p class="text">${esc(s.notes)}</p>` : ''}
</section>`;
    })
    .join('');
  return shell(doc, '', 'Interview', body || '<p class="muted">Aucun intervenant.</p>', landscape);
}

/** Calendrier de production (A4 paysage) : tableau des étapes et frise, une page par paquet de lignes. */
export function productionDocument(doc: ProjectDoc, today = todayIso()): DocPage {
  const pages = doc.production ? productionSvgPages(doc.production, today) : [];
  const body = pages.length ? pages.map((svg) => `<div class="plan gantt">${svg}</div>`).join('') : '<p class="muted">Aucune étape.</p>';
  return shell(doc, '', 'Calendrier de production', body, true);
}

/**
 * Calendrier de production pour Word : un tableau Étape / Début / Fin / Jours (les traitements de
 * texte ne rendent pas la frise en SVG). Phases en gras, jalons marqués, étapes faites barrées.
 */
export function productionWordDocument(doc: ProjectDoc): DocPage {
  const cell = (v: string | number, done = false) => (done ? `<s>${esc(v)}</s>` : esc(v));
  const rows = (doc.production?.phases ?? []).flatMap((phase) => {
    const sp = phaseSpan(phase);
    const head = `<tr><td><b>${esc(phase.name)}</b></td><td><b>${formatFrDate(sp?.start)}</b></td><td><b>${formatFrDate(sp?.end)}</b></td><td style="text-align:right"><b>${phaseDays(phase) || ''}</b></td></tr>`;
    return [
      head,
      ...phase.tasks.map(
        (t) =>
          `<tr><td style="padding-left:14pt">${cell(t.name, t.done)}</td><td>${formatFrDate(t.start)}</td><td>${t.milestone ? '' : formatFrDate(t.end)}</td><td style="text-align:right">${t.milestone ? 'jalon' : durationDays(t)}</td></tr>`,
      ),
    ];
  });
  const body = rows.length
    ? `<table width="100%" style="width:100%"><thead><tr><th>Étape</th><th style="width:3cm">Début</th><th style="width:3cm">Fin</th><th style="width:2cm;text-align:right">Jours</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<p class="muted">Aucune étape.</p>';
  const page = shell(doc, '', 'Calendrier de production', body, true);
  // Word ne connaît pas « Inter Variable » : Inter est déclarée d'abord, sinon il retombe sur Times.
  return { ...page, html: page.html.replace(/'Inter Variable'/g, "Inter, 'Inter Variable'").replace('</style>', 'td + td { white-space: nowrap; }</style>') };
}
