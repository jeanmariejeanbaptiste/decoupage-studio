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
import { characterStats, decorStats } from './registry';
import { callSheetStrips, dayItinerary, dayStats, firstSlot, scheduleDays, shotSlotsText, stripRange, stripsByTime } from './schedule';
import { formatTc } from './timecode';
import { computeTiming, formatGap } from './timing';
import { renderTokens } from './tokens';
import type { ProjectDoc } from './types';
import { isZoom, valueRank } from './vocabulary';

export const esc = (s: string | number | undefined | null) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const CSS = `
@page { size: A4 PORTRAIT; margin: 0; }
table.sheet { width: 100%; border: 0; margin: 0; } table.sheet > * > tr > td { border: 0; padding: 0 13mm; } .pad { height: 13mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Source Serif 4', Georgia, serif; font-size: 10pt; color: #2a2824; margin: 0; background: #fff; }
header.doc { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #2a2824; padding-bottom: 6pt; margin-bottom: 12pt; }
header.doc .kicker { font-family: 'Caveat', cursive; color: #9c3d2b; font-size: 15pt; margin: 0; }
header.doc h1 { font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 24pt; margin: 0; line-height: 1; }
header.doc .meta { text-align: right; color: #6e675b; font-size: 9pt; }
h2 { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 15pt; margin: 14pt 0 5pt; break-after: avoid; }
h3 { font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: #6e675b; margin: 10pt 0 4pt; break-after: avoid; }
table { width: 100%; border-collapse: collapse; margin-bottom: 6pt; }
th { text-align: left; font-size: 7.5pt; letter-spacing: .08em; text-transform: uppercase; color: #6e675b; border-bottom: 1.2pt solid #2a2824; padding: 3pt 4pt; }
td { border-bottom: .6pt solid #d3c8b4; padding: 3pt 4pt; vertical-align: top; }
tr { break-inside: avoid; }
.code { color: #9c3d2b; font-weight: 600; white-space: nowrap; }
.muted { color: #6e675b; font-style: italic; }
.block { break-inside: avoid; margin-bottom: 8pt; }
.chips span { display: inline-block; border: .6pt solid #d3c8b4; border-radius: 8pt; padding: 0 5pt; margin: 0 3pt 3pt 0; font-size: 8.5pt; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4pt 14pt; }
.day { break-inside: avoid; margin-bottom: 10pt; }
.tone-ext { background: #faf1d2; } .tone-night { background: #e3eaf4; } .tone-extnight { background: #e5efdf; } .tone-twilight { background: #f7e3da; }
.plan { break-inside: avoid; break-after: page; } .plan:last-child { break-after: auto; }
.plan svg { width: 100%; height: auto; border: .6pt solid #d3c8b4; }
.time { font-family: 'JetBrains Mono', monospace; font-size: 9pt; white-space: nowrap; }
p.text { white-space: pre-wrap; line-height: 1.6; font-size: 11pt; }
`;

export interface DocPage {
  title: string;
  html: string;
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
      const rows = breakdownCategories(doc).map((c) => ({ c, items: [...(d[c] ?? []), ...(m[c] ?? [])] })).filter((r) => r.items.length);
      return `<section class="block"><h2>${esc(sequenceHeading(doc, id))} <span class="muted" style="font-size:10pt">${esc([seq.intExt, seq.effect].filter(Boolean).join(' · '))}</span></h2>${
        seq.summary ? `<p class="muted">${esc(seq.summary)}</p>` : ''
      }${rows.length ? `<table><tbody>${rows.map((r) => `<tr><th style="width:24%">${esc(breakdownLabel(r.c))}</th><td class="chips">${r.items.map((x) => `<span>${esc(x)}</span>`).join('')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Rien à signaler.</p>'}</section>`;
    })
    .join('');
  return shell(doc, 'Étape 3', 'Dépouillement', body);
}

export function equipmentDocument(doc: ProjectDoc, showShots: boolean): DocPage {
  const eq = aggregateEquipment(doc);
  const body = equipmentCategories(doc).map(
    (c) =>
      `<section class="block"><h2>${c}</h2>${
        eq[c].length
          ? `<table><thead><tr><th>Matériel</th>${showShots ? '<th>Plans concernés</th>' : ''}</tr></thead><tbody>${eq[c]
              .map((l) => `<tr><td>${esc(l.label)}${l.manual ? ' <span class="muted">(ajout)</span>' : ''}</td>${showShots ? `<td>${l.shotIds.map((id) => esc(shotCode(doc, id))).join(', ') || '—'}</td>` : ''}</tr>`)
              .join('')}</tbody></table>`
          : '<p class="muted">Rien pour ce poste.</p>'
      }</section>`,
  ).join('');
  return shell(doc, 'Étape 7', 'Listes de matériel', body);
}

function tone(doc: ProjectDoc, seqId: string): string {
  const s = doc.sequences[seqId];
  if (s?.effect === 'AUBE' || s?.effect === 'CRÉPUSCULE') return 'tone-twilight';
  if (s?.effect === 'NUIT') return s.intExt === 'EXT' ? 'tone-extnight' : 'tone-night';
  return s?.intExt === 'EXT' ? 'tone-ext' : '';
}

const slotText = (slot?: { start?: string; end?: string }) => (slot?.start || slot?.end ? `${slot.start ?? '…'} – ${slot.end ?? '…'}` : '');

export function scheduleDocument(doc: ProjectDoc): DocPage {
  const t = computeTiming(doc);
  const days = scheduleDays(doc);
  const body = days.length
    ? days
        .map((d) => {
          const st = dayStats(doc, t, d.n);
          const strips = stripsByTime(doc, d.n);
          return `<section class="day"><h2>Jour ${d.n}${d.date ? ` — ${esc(new Date(`${d.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}` : ''}${
            d.callTime ? ` <span class="time">RDV ${esc(d.callTime)}</span>` : ''
          }</h2><table><thead><tr><th>Horaire</th><th>Séq.</th><th>INT/EXT</th><th>Décor</th><th>Personnages</th><th>Plans</th></tr></thead><tbody>${strips
            .map((s) => {
              const seq = doc.sequences[s.seqId];
              return `<tr class="${tone(doc, s.seqId)}"><td class="time">${esc(slotText(stripRange(doc, d.n, s)))}</td><td class="code">${esc(sequenceHeading(doc, s.seqId))}</td><td>${esc([seq.intExt, seq.effect].filter(Boolean).join(' · '))}</td><td>${esc(seq.decorId ? doc.decors[seq.decorId]?.name : '')}</td><td>${esc(sequenceCharacterIds(doc, s.seqId).map((c) => doc.characters[c]?.name).join(', '))}</td><td>${s.shotIds.length}</td></tr>`;
            })
            .join('')}</tbody></table><p class="muted">${st.shots} plans · ${formatTc(st.screenSec)} d’écran · ${st.decorIds.length} décor(s)</p></section>`;
        })
        .join('')
    : '<p class="muted">Aucun jour de tournage.</p>';
  return shell(doc, 'Étape 8', 'Plan de travail', body, true);
}

export function callSheetDocument(doc: ProjectDoc, day: number): DocPage {
  const d = scheduleDays(doc).find((x) => x.n === day);
  const strips = callSheetStrips(doc, day);
  const st = dayStats(doc, computeTiming(doc), day, strips);
  const body = `<div class="grid"><div><h3>Rendez-vous</h3><p class="time" style="font-size:14pt">${esc(d?.callTime || '—')}</p></div><div><h3>Date</h3><p>${esc(d?.date ? new Date(`${d.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'à préciser')}</p></div></div>
<h3>Lieux et horaires</h3><table><thead><tr><th>Horaire</th><th>Lieu</th><th>Adresse</th><th>Séquence</th></tr></thead><tbody>${dayItinerary(doc, day)
    .map((p) => `<tr><td class="time">${p.start ? `${p.start} – ${p.end}` : '—'}</td><td><b>${esc(p.decorId ? doc.decors[p.decorId]?.name : 'Décor non renseigné')}</b> ${esc(p.decorId ? doc.decors[p.decorId]?.intExt : '')}</td><td>${esc(p.address || 'à préciser')}</td><td>${esc(p.seqIds.map((id) => sequenceHeading(doc, id)).join(' · '))}</td></tr>`)
    .join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table>
<h3>Convocations</h3><table><thead><tr><th>Rôle</th><th>Comédien·ne</th><th>Convocation</th></tr></thead><tbody>${st.characterIds
    .map((id) => `<tr><td>${esc(doc.characters[id]?.name)}</td><td>${esc(doc.characters[id]?.actor || '—')}</td><td class="time">${esc(d?.calls?.[id] || '—')}</td></tr>`)
    .join('')}</tbody></table>
<h3>Plans du jour</h3><table><thead><tr><th>Horaire</th><th>Plan</th><th>Sujet</th><th>Valeur</th><th>Angle</th><th>Mouvement</th><th>Focale</th><th>Action</th></tr></thead><tbody>${strips
    .flatMap((s) => s.shotIds)
    .sort((a, b) => (firstSlot(doc, day, a)?.start ?? '99').localeCompare(firstSlot(doc, day, b)?.start ?? '99'))
    .map((id) => {
        const sh = doc.shots[id];
        return `<tr><td class="time">${esc(shotSlotsText(doc, day, id) || '—')}</td><td class="code">${esc(shotCode(doc, id))}</td><td>${esc(sh.subject)}</td><td>${esc(sh.value)}</td><td>${esc(renderTokens(sh.angle))}</td><td>${esc(renderTokens(sh.movement, sh.movementSep))}</td><td>${esc(formatFocal(sh.focal, isZoom(sh.movement)))}</td><td>${esc(doc.blocks[sh.actionBlockId]?.text)}</td></tr>`;
      })
    .join('')}</tbody></table>
${d?.notes ? `<h3>Notes</h3><p class="text">${esc(d.notes)}</p>` : ''}`;
  return shell(doc, 'Étape 9', `Feuille de service — Jour ${day}`, body);
}

export function registryDocument(doc: ProjectDoc): DocPage {
  const t = computeTiming(doc);
  const cs = characterStats(doc);
  const ds = decorStats(doc, t);
  const n = (ids: string[]) => ids.map((id) => doc.project.sequenceIds.indexOf(id) + 1).join(', ');
  const body = `<h2>Séquences</h2><table><thead><tr><th>N°</th><th>Libellé</th><th>Décor</th><th>INT/EXT · effet</th><th>Personnages</th><th>Plans</th><th>Estimée</th><th>Calculée</th><th>Écart</th></tr></thead><tbody>${doc.project.sequenceIds
    .map((id, i) => {
      const s = doc.sequences[id];
      const st = t.sequences.get(id);
      return `<tr><td class="code">${i + 1}</td><td>${esc(s.label)}</td><td>${esc(s.decorId ? doc.decors[s.decorId]?.name : '')}</td><td>${esc([s.intExt, s.effect].filter(Boolean).join(' · '))}</td><td>${esc(sequenceCharacterIds(doc, id).map((c) => doc.characters[c]?.name).join(', '))}</td><td>${s.shotIds.length}</td><td class="time">${s.estimatedSec !== undefined ? formatTc(s.estimatedSec) : '—'}</td><td class="time">${formatTc(st?.durationSec ?? 0)}</td><td class="time">${st?.gap ? esc(formatGap(st.gap)) : '—'}</td></tr>`;
    })
    .join('')}</tbody></table>
<h2>Personnages</h2><table><thead><tr><th>Nom</th><th>Type</th><th>Comédien·ne</th><th>Séquences</th><th>Plans</th></tr></thead><tbody>${Object.values(doc.characters)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.kind)}</td><td>${esc(c.actor || '—')}</td><td>${n(cs.get(c.id)?.sequenceIds ?? [])}</td><td>${cs.get(c.id)?.shotIds.length ?? 0}</td></tr>`)
    .join('')}</tbody></table>
<h2>Décors</h2><table><thead><tr><th>Décor</th><th>INT/EXT</th><th>Adresse</th><th>Séquences</th><th>Durée</th></tr></thead><tbody>${Object.values(doc.decors)
    .map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.intExt)}</td><td>${esc(d.address || '—')}</td><td>${n(ds.get(d.id)?.sequenceIds ?? [])}</td><td class="time">${formatTc(ds.get(d.id)?.totalSec ?? 0)}</td></tr>`)
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

const BEAT_HUES = ['#a4472c', '#2c5d8a', '#6b8e3a', '#8a4f9e', '#b8862e', '#2f7f7a', '#9b3b5a', '#556070'];

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
              return `<tr><td class="code" style="color:${BEAT_HUES[i % BEAT_HUES.length]}">T${i + 1}</td><td class="time">${formatTc(w.startMin)}${w.startMax !== w.startMin ? `–${formatTc(w.startMax)}` : ''}</td><td class="time">${dur}</td><td>${esc(b.value)}</td><td>${esc(b.subject)}</td><td>${esc(b.angle)}</td><td>${esc(b.movement)}</td><td>${b.focal ? `${b.focal} mm` : ''}</td><td>${esc(b.cue)}</td></tr>`;
            })
            .join('');
          const trans = beatTransitions(beats, valueRank, (n) => cameraAt(n))
            .map((x) => `<li><b>T${x.from} → T${x.to}</b> : ${x.notes.map(esc).join(' · ')}</li>`)
            .join('');
          const plan = items.length ? `<h3>Plan au sol du plan-séquence</h3>${floorPlanSvg(doc, key, `Plan-séquence ${shotCode(doc, id)}`)}` : '<p class="muted">Pas encore de vue de plan au sol pour ce plan-séquence (onglet Plan au sol, vue « Plan-séquence »).</p>';
          return `<section class="plan"><h2>Plan-séquence ${esc(shotCode(doc, id))} <span class="muted" style="font-size:10pt">${esc(sequenceHeading(doc, shot.sequenceId))}</span></h2><p><b>${beats.length} temps</b> · durée ${esc(formatOneShotDuration(t) || 'à estimer')}${doc.blocks[shot.actionBlockId]?.text ? ` · ${esc(doc.blocks[shot.actionBlockId].text)}` : ''}</p>${strip}<table><thead><tr><th>Temps</th><th>Début</th><th>Durée</th><th>Valeur</th><th>Sujet</th><th>Angle</th><th>Mouvement</th><th>Focale</th><th>Repères</th></tr></thead><tbody>${rows}</tbody></table><h3>Transitions</h3><ul>${trans || '<li class="muted">Un seul temps.</li>'}</ul>${plan}</section>`;
        })
        .join('')
    : '<p class="muted">Aucun plan-séquence dans ce découpage.</p>';
  return shell(doc, '', 'Annexe · plans-séquences', body);
}
