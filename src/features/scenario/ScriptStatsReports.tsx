import { useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { SBlock } from '../../domain/screenplay';
import { characterReports, locationReports, sceneReports, sidesOf, type SceneInfo } from '../../domain/scriptReports';
import { blockLabel, isEmptyBlock } from '../../domain/screenplay';
import type { ProjectDoc } from '../../domain/types';
import { layoutScript, NOT_PRINTED } from '../../domain/scriptLayout';
import s from './ScriptStatsReports.module.css';

import { chronoOf, chronoTimeline, mmss, printedText } from '../../domain/chronometry';

export type Report = 'summary' | 'scenes' | 'decors' | 'characters' | 'dialogues' | 'structure' | 'activity';
/** Rapports : clé, nom de la bascule, titre de l'export. */
export const REPORTS: ReadonlyArray<readonly [Report, string, string]> = [
  ['summary', 'Sommaire', 'Sommaire des statistiques'],
  ['scenes', 'Séquences', 'Rapport des séquences'],
  ['decors', 'Décors', 'Rapport des décors'],
  ['characters', 'Personnages', 'Rapport des personnages'],
  ['dialogues', 'Dialogues', 'Dialogues d’un personnage'],
  ['structure', 'Structure', 'Structure de l’histoire'],
  ['activity', 'Activité', 'Activité des personnages'],
];
/** Rapports qui sont des graphiques (exportables en PNG). */
export const CHART_REPORTS: ReadonlySet<Report> = new Set<Report>(['structure', 'activity']);
export const isReport = (r: string | null | undefined): r is Report => REPORTS.some(([k]) => k === r);

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Rapport à imprimer : sans les contrôles de l'écran (tri, cases, choix des personnages). Le tri et le
 * personnage choisis deviennent une ligne de texte ; la légende du graphique ne garde que ses courbes.
 */
export function printable(box: HTMLElement): string {
  const notes = Array.from(box.querySelectorAll<HTMLElement>('[data-print]'))
    .map((l) => {
      const sel = l.querySelector('select');
      // L'ordre du scénario va de soi : seul un autre tri est dit.
      if (!sel || (l.dataset.print === 'Trié' && sel.selectedIndex === 0)) return '';
      const t = sel.selectedOptions[0]?.text;
      return t ? `${l.dataset.print} ${t}` : '';
    })
    .filter(Boolean);
  const clone = box.cloneNode(true) as HTMLElement;
  const shown = Array.from(box.querySelectorAll<HTMLInputElement>('[data-legend] input')).map((i) => i.checked);
  clone.querySelectorAll('[data-legend] label').forEach((l, i) => (shown[i] === false ? l.remove() : l.querySelector('input')?.remove()));
  clone.querySelectorAll('[data-no-print]').forEach((e) => e.remove());
  return (notes.length ? `<p class="muted">${esc(notes.join(' · '))}</p>` : '') + clone.innerHTML;
}

/** Dernier rapport ouvert, retenu d'une visite à l'autre. */
export const savedReport = (): Report => {
  try {
    const r = localStorage.getItem('ds-script-report');
    return isReport(r) ? r : 'summary';
  } catch {
    return 'summary';
  }
};
export const storeReport = (r: Report) => {
  try {
    localStorage.setItem('ds-script-report', r);
  } catch {
    /* choix valable pour la session */
  }
};

/** Exports du rapport affiché (menu Exporter de la page). */
export interface ReportsApi {
  /** Le rapport affiché, en PDF (le titre n'apparaît qu'à l'export). */
  print: () => Promise<void>;
  /** Le graphique affiché, en PNG (Structure, Activité). */
  png: () => Promise<void>;
}

/**
 * Statistiques du scénario, page entière : sommaire chiffré, rapports (séquences, décors, personnages,
 * dialogues) et graphiques (structure, activité). Pages et numéros de page sont ceux de l'impression.
 * Le choix du rapport et les exports sont portés par la page (bascule de la ligne 2, menu Exporter).
 */
export function ScriptStatsReports({
  doc,
  blocks,
  report,
  onGo,
  apiRef,
}: {
  doc: ProjectDoc;
  blocks: readonly SBlock[];
  report: Report;
  onGo: (id: string) => void;
  apiRef?: Ref<ReportsApi>;
}) {
  const names = useMemo(() => Object.values(doc.characters).flatMap((c) => [c.name, ...(c.aliases ?? [])]), [doc.characters]);
  const scenes = useMemo(() => sceneReports(blocks, names, doc.project.settings.scriptChrono), [blocks, names, doc.project.settings.scriptChrono]);
  const laid = useMemo(() => layoutScript(blocks), [blocks]);
  const pages = Math.max(1, laid.pages.length);
  // Durée totale : celle de la barre du scénario, ouverture comprise (avant la première séquence).
  const duration = useMemo(() => chronoTimeline(blocks, chronoOf(doc.project.settings.scriptChrono)).total, [blocks, doc.project.settings.scriptChrono]);
  const pageOf = useMemo(() => new Map([...laid.placement].map(([id, p]) => [id, p.page + 1])), [laid]);
  const box = useRef<HTMLDivElement>(null);
  const [, label, title] = REPORTS.find(([k]) => k === report)!;
  useImperativeHandle(
    apiRef,
    () => ({
      print: async () => {
        const { exportDocumentPages } = await import('../export/imageExport');
        const css = `body{font-family:Inter,sans-serif;font-size:9.5pt;color:#111318} h1{font-size:15pt;margin:0 0 4pt} .muted{color:#6b7079} table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:3pt 4pt;border-bottom:.5pt solid #d6d8dd} th{font-size:7.5pt;text-transform:uppercase;letter-spacing:.08em;color:#6b7079} .bar td{background:#eef0f3;font-weight:600} svg{width:100%;height:auto} .pad{height:13mm}`;
        const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css}</style></head><body><table class="sheet"><thead><tr><td><div class="pad"></div></td></tr></thead><tbody><tr><td style="padding:0 13mm"><h1>${esc(doc.project.title)} — ${title}</h1>${box.current ? printable(box.current) : ''}</td></tr></tbody><tfoot><tr><td><div class="pad"></div></td></tr></tfoot></table></body></html>`;
        await exportDocumentPages(html, `${doc.project.title || 'scenario'}-${title}`, { format: 'pdf', orientation: 'portrait', numbers: true });
      },
      png: async () => {
        const svg = box.current?.querySelector<SVGSVGElement>('svg[role="img"]');
        if (!svg) return;
        const { svgToPng } = await import('./svgPng');
        await svgToPng(svg, `${doc.project.title || 'scenario'}-${title}`);
      },
    }),
    [doc.project.title, title],
  );
  return (
    <section className={s.page} data-testid="script-reports" aria-label={label}>
      {!scenes.length ? (
        <p className={s.empty}>Aucune séquence</p>
      ) : (
        <div ref={box}>
          {report === 'summary' && <SummaryReport scenes={scenes} blocks={blocks} pages={pages} duration={duration} />}
          {report === 'scenes' && <ScenesReport scenes={scenes} pageOf={pageOf} onGo={onGo} />}
          {report === 'decors' && <DecorsReport scenes={scenes} pageOf={pageOf} onGo={onGo} />}
          {report === 'characters' && <CharactersReport scenes={scenes} />}
          {report === 'dialogues' && <DialoguesReport scenes={scenes} blocks={blocks} pageOf={pageOf} />}
          {report === 'structure' && <StructureChart scenes={scenes} />}
          {report === 'activity' && <ActivityChart scenes={scenes} />}
        </div>
      )}
    </section>
  );
}

function Sort<T extends string>({ value, options, onChange }: { value: T; options: ReadonlyArray<[T, string]>; onChange: (v: T) => void }) {
  return (
    <label className={s.sort} data-print="Trié">
      <span>Trier</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

type SceneSort = 'script' | 'alpha' | 'long' | 'short' | 'big' | 'small';
const SCENE_SORTS: ReadonlyArray<[SceneSort, string]> = [
  ['script', 'par ordre du scénario'],
  ['alpha', 'par ordre alphabétique'],
  ['long', 'de la plus longue à la plus courte'],
  ['short', 'de la plus courte à la plus longue'],
  ['big', 'du plus au moins de personnages'],
  ['small', 'du moins au plus de personnages'],
];

/** Séquences : n°, page, personnages (avec leurs répliques, première apparition soulignée), durée. */
function ScenesReport({ scenes, pageOf, onGo }: { scenes: SceneInfo[]; pageOf: Map<string, number>; onGo: (id: string) => void }) {
  const [sort, setSort] = useState<SceneSort>('script');
  const [withCast, setWithCast] = useState(true);
  const first = useMemo(() => {
    const seen = new Map<string, number>();
    for (const sc of scenes) for (const n of sc.present) if (!seen.has(n)) seen.set(n, sc.n);
    return seen;
  }, [scenes]);
  const list = [...scenes];
  if (sort === 'alpha') list.sort((a, b) => a.heading.localeCompare(b.heading, 'fr'));
  if (sort === 'long') list.sort((a, b) => b.durationSec - a.durationSec);
  if (sort === 'short') list.sort((a, b) => a.durationSec - b.durationSec);
  if (sort === 'big') list.sort((a, b) => b.present.size - a.present.size);
  if (sort === 'small') list.sort((a, b) => a.present.size - b.present.size);
  return (
    <>
      <div className={s.opts} data-no-print>
        <Sort value={sort} options={SCENE_SORTS} onChange={setSort} />
        <label className={s.check}>
          <input type="checkbox" checked={withCast} onChange={(e) => setWithCast(e.target.checked)} /> Personnages
        </label>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Séquence</th>
            <th>N°</th>
            <th>Page</th>
            <th>Pers.</th>
            <th>Durée</th>
          </tr>
        </thead>
        <tbody>
          {list.map((sc) => (
            <FragmentRows key={sc.id}>
              <tr className={s.barRow}>
                <td>
                  <button type="button" className={s.link} onClick={() => onGo(sc.id)}>
                    {sc.heading}
                  </button>
                </td>
                <td>{sc.n}</td>
                <td>{pageOf.get(sc.id) ?? ''}</td>
                <td>{sc.present.size}</td>
                <td>{mmss(sc.durationSec)}</td>
              </tr>
              {withCast && sc.present.size > 0 && (
                <tr>
                  <td colSpan={5} className={s.cast}>
                    {[...sc.present].map((n, k) => (
                      <span key={n}>
                        {k > 0 && ', '}
                        {first.get(n) === sc.n ? <u title="Première apparition">{n}</u> : n}({sc.replies.get(n) ?? 0})
                      </span>
                    ))}
                  </td>
                </tr>
              )}
            </FragmentRows>
          ))}
        </tbody>
      </table>
    </>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

type DecorSort = 'script' | 'alpha' | 'most' | 'least' | 'long' | 'short';
const DECOR_SORTS: ReadonlyArray<[DecorSort, string]> = [
  ['script', 'par ordre du scénario'],
  ['alpha', 'par ordre alphabétique'],
  ['most', 'du plus au moins de séquences'],
  ['least', 'du moins au plus de séquences'],
  ['long', 'du plus long au plus court'],
  ['short', 'du plus court au plus long'],
];

/** Décors : séquences regroupées par lieu, durée cumulée ; affichage étendu = chaque séquence. */
function DecorsReport({ scenes, pageOf, onGo }: { scenes: SceneInfo[]; pageOf: Map<string, number>; onGo: (id: string) => void }) {
  const [sort, setSort] = useState<DecorSort>('script');
  const [extended, setExtended] = useState(true);
  const list = locationReports(scenes);
  if (sort === 'alpha') list.sort((a, b) => a.location.localeCompare(b.location, 'fr'));
  if (sort === 'most') list.sort((a, b) => b.scenes.length - a.scenes.length);
  if (sort === 'least') list.sort((a, b) => a.scenes.length - b.scenes.length);
  if (sort === 'long') list.sort((a, b) => b.durationSec - a.durationSec);
  if (sort === 'short') list.sort((a, b) => a.durationSec - b.durationSec);
  return (
    <>
      <div className={s.opts} data-no-print>
        <Sort value={sort} options={DECOR_SORTS} onChange={setSort} />
        <label className={s.check}>
          <input type="checkbox" checked={extended} onChange={(e) => setExtended(e.target.checked)} /> Affichage étendu
        </label>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Décor / séquence</th>
            <th>N°</th>
            <th>Page</th>
            <th>Séq.</th>
            <th>Durée</th>
          </tr>
        </thead>
        <tbody>
          {list.map((l) => (
            <FragmentRows key={l.location}>
              <tr className={s.barRow}>
                <td>{[l.location || 'Lieu non précisé', l.effects.join(', ')].filter(Boolean).join(' — ')}</td>
                <td />
                <td />
                <td>{l.scenes.length}</td>
                <td>{mmss(l.durationSec)}</td>
              </tr>
              {extended &&
                l.scenes.map((n) => {
                  const sc = scenes[n - 1];
                  return (
                    <tr key={n}>
                      <td>
                        <button type="button" className={s.link} onClick={() => onGo(sc.id)}>
                          {sc.heading}
                        </button>
                      </td>
                      <td>{n}</td>
                      <td>{pageOf.get(sc.id) ?? ''}</td>
                      <td />
                      <td>{mmss(sc.durationSec)}</td>
                    </tr>
                  );
                })}
            </FragmentRows>
          ))}
        </tbody>
      </table>
    </>
  );
}

type CharSort = 'script' | 'alpha' | 'most' | 'least' | 'talk' | 'quiet';
const CHAR_SORTS: ReadonlyArray<[CharSort, string]> = [
  ['script', 'par ordre du scénario'],
  ['alpha', 'par ordre alphabétique'],
  ['most', 'du plus au moins de séquences'],
  ['least', 'du moins au plus de séquences'],
  ['talk', 'du plus au moins de répliques'],
  ['quiet', 'du moins au plus de répliques'],
];

/** Personnages : répliques, séquences parlantes et muettes, total. */
function CharactersReport({ scenes }: { scenes: SceneInfo[] }) {
  const [sort, setSort] = useState<CharSort>('script');
  const [split, setSplit] = useState(true);
  const list = characterReports(scenes);
  if (sort === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (sort === 'most') list.sort((a, b) => b.total - a.total);
  if (sort === 'least') list.sort((a, b) => a.total - b.total);
  if (sort === 'talk') list.sort((a, b) => b.replies - a.replies);
  if (sort === 'quiet') list.sort((a, b) => a.replies - b.replies);
  return (
    <>
      <div className={s.opts} data-no-print>
        <Sort value={sort} options={CHAR_SORTS} onChange={setSort} />
        <label className={s.check}>
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Parlantes et muettes
        </label>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Personnage</th>
            <th>Répliques</th>
            {split && <th>Séq. parlantes</th>}
            {split && <th>Séq. muettes</th>}
            <th>Séquences</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td>{c.replies}</td>
              {split && <td>{c.speaking}</td>}
              {split && <td>{c.silent}</td>}
              <td>{c.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Dialogues d'un personnage, séquence par séquence (à remettre au comédien). */
function DialoguesReport({ scenes, blocks, pageOf }: { scenes: SceneInfo[]; blocks: readonly SBlock[]; pageOf: Map<string, number> }) {
  const chars = characterReports(scenes).filter((c) => c.replies > 0);
  const [who, setWho] = useState(chars[0]?.name ?? '');
  const name = chars.some((c) => c.name === who) ? who : (chars[0]?.name ?? '');
  const sides = useMemo(() => (name ? sidesOf(blocks, name) : []), [blocks, name]);
  if (!chars.length) return <p className={s.empty}>Aucune réplique.</p>;
  return (
    <>
      <div className={s.opts} data-no-print>
        <label className={s.sort} data-print="Personnage :">
          <span>Personnage</span>
          <select value={name} onChange={(e) => setWho(e.target.value)}>
            {chars.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.replies})
              </option>
            ))}
          </select>
        </label>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Séquence / réplique</th>
            <th>N°</th>
            <th>Page</th>
          </tr>
        </thead>
        <tbody>
          {sides.map((sc) => (
            <FragmentRows key={sc.n}>
              <tr className={s.barRow}>
                <td>{sc.heading}</td>
                <td>{sc.n}</td>
                <td>{pageOf.get(scenes[sc.n - 1]?.id ?? '') ?? ''}</td>
              </tr>
              {sc.lines.map((l, k) => (
                <tr key={k}>
                  <td colSpan={3}>
                    {l.paren && <span className={s.muted}>{l.paren} </span>}
                    {l.text}
                  </td>
                </tr>
              ))}
            </FragmentRows>
          ))}
        </tbody>
      </table>
    </>
  );
}

const W = 520;
const H = 260;
const PAD = { l: 34, r: 10, t: 10, b: 28 };

/** Axe du temps du film (minutes) commun aux deux graphiques. */
function timeline(scenes: SceneInfo[]) {
  let t = 0;
  const at = scenes.map((sc) => {
    const start = t;
    t += sc.durationSec;
    return { sc, start, mid: start + sc.durationSec / 2 };
  });
  return { at, total: Math.max(1, t) };
}

const SERIES = [
  { key: 'dur', label: 'Durée de la séquence (min)', dash: '', value: (sc: SceneInfo) => sc.durationSec / 60 },
  { key: 'act', label: 'Durée de l’action (min)', dash: '6 3', value: (sc: SceneInfo) => sc.actionSec / 60 },
  { key: 'dia', label: 'Durée des dialogues (min)', dash: '2 3', value: (sc: SceneInfo) => sc.dialogueSec / 60 },
  { key: 'cast', label: 'Nombre de personnages', dash: '10 3 2 3', value: (sc: SceneInfo) => sc.present.size },
  { key: 'rep', label: 'Nombre de répliques', dash: '1 2', value: (sc: SceneInfo) => [...sc.replies.values()].reduce((a, b) => a + b, 0) },
] as const;

/** Structure de l'histoire : durées et comptes de chaque séquence, au fil du film (en minutes). */
function StructureChart({ scenes }: { scenes: SceneInfo[] }) {
  const [on, setOn] = useState<Record<string, boolean>>({ dur: true, act: true, dia: true, cast: true, rep: true });
  const { at, total } = timeline(scenes);
  const shown = SERIES.filter((x) => on[x.key]);
  const max = Math.max(1, ...shown.flatMap((x) => scenes.map((sc) => x.value(sc))));
  const X = (sec: number) => PAD.l + (sec / total) * (W - PAD.l - PAD.r);
  const Y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const ticks = Array.from({ length: Math.floor(total / 60) + 1 }, (_, i) => i).filter((m, _, all) => all.length <= 12 || m % Math.ceil(all.length / 12) === 0);
  return (
    <>
      <div className={s.legend} data-legend>
        {SERIES.map((x) => (
          <label key={x.key} className={s.check}>
            <input type="checkbox" checked={!!on[x.key]} onChange={(e) => setOn({ ...on, [x.key]: e.target.checked })} />
            <svg width="26" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="1.6" strokeDasharray={x.dash} />
            </svg>
            {x.label}
          </label>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.chart} role="img" aria-label="Structure de l’histoire">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(max * f)} y2={Y(max * f)} className={s.grid} />
            <text x={PAD.l - 4} y={Y(max * f) + 3} className={s.tick} textAnchor="end">
              {Math.round(max * f * 10) / 10}
            </text>
          </g>
        ))}
        {ticks.map((m) => (
          <text key={m} x={X(m * 60)} y={H - 10} className={s.tick} textAnchor="middle">
            {m}
          </text>
        ))}
        <text x={(W + PAD.l) / 2} y={H - 1} className={s.tick} textAnchor="middle">
          minutes
        </text>
        {shown.map((x) => (
          <polyline key={x.key} fill="none" className={s.line} strokeDasharray={x.dash} points={[`${X(0)},${Y(0)}`, ...at.map((p) => `${X(p.mid)},${Y(x.value(p.sc))}`), `${X(total)},${Y(0)}`].join(' ')} />
        ))}
        {at.map((p) => (
          <circle key={p.sc.id} cx={X(p.mid)} cy={Y(shown[0] ? shown[0].value(p.sc) : 0)} r="3" className={s.dot}>
            <title>{`Séquence ${p.sc.n} — ${p.sc.heading}\nDurée : ${mmss(p.sc.durationSec)} · action ${mmss(p.sc.actionSec)} · dialogues ${mmss(p.sc.dialogueSec)}\n${p.sc.present.size} personnage(s) · ${[...p.sc.replies.values()].reduce((a, b) => a + b, 0)} réplique(s)`}</title>
          </circle>
        ))}
      </svg>
    </>
  );
}

/** Activité des personnages : une ligne par personnage, ses séquences au fil du film. */
function ActivityChart({ scenes }: { scenes: SceneInfo[] }) {
  const chars = characterReports(scenes);
  const [picked, setPicked] = useState<string[]>(() => chars.slice(0, 6).map((c) => c.name));
  const { at, total } = timeline(scenes);
  const rows = chars.filter((c) => picked.includes(c.name));
  const rowH = 22;
  const h = PAD.t + rows.length * rowH + PAD.b;
  const left = 110;
  const X = (sec: number) => left + (sec / total) * (W - left - PAD.r);
  return (
    <>
      <div className={s.picks} data-no-print>
        {chars.map((c) => {
          const on = picked.includes(c.name);
          return (
            <button key={c.name} type="button" aria-pressed={on} className={on ? s.pickOn : ''} onClick={() => setPicked(on ? picked.filter((n) => n !== c.name) : [...picked, c.name])}>
              {c.name}
            </button>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${W} ${h}`} className={s.chart} role="img" aria-label="Activité des personnages">
        {Array.from({ length: Math.floor(total / 60) + 1 }, (_, m) => (
          <g key={m}>
            <line x1={X(m * 60)} x2={X(m * 60)} y1={PAD.t} y2={h - PAD.b} className={s.grid} />
            <text x={X(m * 60)} y={h - 10} className={s.tick} textAnchor="middle">
              {m}
            </text>
          </g>
        ))}
        {rows.map((c, i) => (
          <g key={c.name}>
            <text x={left - 6} y={PAD.t + i * rowH + 14} className={s.name} textAnchor="end">
              {c.name}
            </text>
            {at
              .filter((p) => p.sc.present.has(c.name))
              .map((p) => (
                <rect key={p.sc.id} x={X(p.start)} y={PAD.t + i * rowH + 5} width={Math.max(2, X(p.start + p.sc.durationSec) - X(p.start))} height={12} className={p.sc.replies.get(c.name) ? s.speaks : s.here}>
                  <title>{`${c.name} — séquence ${p.sc.n} : ${p.sc.replies.get(c.name) ?? 0} réplique(s)`}</title>
                </rect>
              ))}
          </g>
        ))}
        <text x={(W + left) / 2} y={h - 1} className={s.tick} textAnchor="middle">
          minutes
        </text>
      </svg>
    </>
  );
}

const wordsOf = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Barre de pourcentage (gris, sans couleur). */
function Pct({ v }: { v: number }) {
  return (
    <span className={s.pct}>
      <i style={{ width: `${Math.max(1, v)}%` }} />
      {Math.round(v)} %
    </span>
  );
}

/** Sommaire : durée, pages, mots, signes ; texte par type de paragraphe ; moments, lieux, personnages. */
function SummaryReport({ scenes, blocks, pages, duration }: { scenes: SceneInfo[]; blocks: readonly SBlock[]; pages: number; duration: number }) {
  // Texte imprimé : sans notes, parties ni résumés, sans marques d'emphase ni de surlignage.
  const body = blocks.filter((b) => !isEmptyBlock(b) && b.type !== 'title' && b.type !== 'pagebreak' && !NOT_PRINTED.has(b.type)).map((b) => ({ ...b, text: printedText(b.text) }));
  const all = body.map((b) => b.text).join(' ');
  const words = wordsOf(all);
  const types = [...new Set(body.map((b) => b.type))].map((t) => {
    const of = body.filter((b) => b.type === t);
    const w = of.reduce((n, b) => n + wordsOf(b.text), 0);
    return { t, count: of.length, words: w, pct: words ? (w / words) * 100 : 0 };
  });
  const group = (key: (sc: SceneInfo) => string) => {
    const m = new Map<string, number>();
    for (const sc of scenes) m.set(key(sc) || 'non précisé', (m.get(key(sc) || 'non précisé') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const chars = characterReports(scenes);
  const buckets: Array<[string, number]> = [
    ['Plus de 10 répliques', chars.filter((c) => c.replies > 10).length],
    ['De 1 à 10 répliques', chars.filter((c) => c.replies >= 1 && c.replies <= 10).length],
    ['Sans réplique', chars.filter((c) => c.replies === 0).length],
  ];
  const total = duration;
  const inScenes = scenes.reduce((n, sc) => n + sc.durationSec, 0);
  const dialogue = scenes.reduce((n, sc) => n + sc.dialogueSec, 0);
  const replies = scenes.reduce((n, sc) => n + [...sc.replies.values()].reduce((a, k) => a + k, 0), 0);
  const longest = scenes.reduce((a, sc) => (sc.durationSec > a.durationSec ? sc : a), scenes[0]);
  const mostPresent = chars.reduce((a, c) => (c.total > a.total ? c : a), chars[0]);
  const mostTalk = chars.reduce((a, c) => (c.replies > a.replies ? c : a), chars[0]);
  const table = (title: string, head: string, rows: Array<[string, number]>, of: number) => (
    <>
      <p className={s.h}>{title}</p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{head}</th>
            <th>Nombre</th>
            <th>Part</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, n]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{n}</td>
              <td>
                <Pct v={of ? (n / of) * 100 : 0} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
  return (
    <>
      <div className={s.kpis}>
        <div>
          <b>{mmss(total)}</b>
          <span>Durée</span>
        </div>
        <div>
          <b>{pages}</b>
          <span>Pages</span>
        </div>
        <div>
          <b>{words.toLocaleString('fr-FR')}</b>
          <span>Mots</span>
        </div>
        <div>
          <b>
            {all.length.toLocaleString('fr-FR')} / {all.replace(/\s/g, '').length.toLocaleString('fr-FR')}
          </b>
          <span>Signes avec / sans espaces</span>
        </div>
      </div>
      <div className={s.kpis}>
        <div>
          <b>{scenes.length}</b>
          <span>Séquences</span>
        </div>
        <div>
          <b>{mmss(inScenes / scenes.length)}</b>
          <span>Durée moyenne</span>
        </div>
        <div>
          <b>
            {mmss(longest.durationSec)} <small>séq. {longest.n}</small>
          </b>
          <span>La plus longue</span>
        </div>
        <div>
          <b>{Math.round(total ? (dialogue / total) * 100 : 0)} %</b>
          <span>Part des dialogues</span>
        </div>
        <div>
          <b>{replies}</b>
          <span>Répliques</span>
        </div>
        <div>
          <b>
            {chars.filter((c) => c.replies > 0).length} / {chars.length}
          </b>
          <span>Personnages qui parlent</span>
        </div>
        <div>
          <b>{chars[0] ? mostPresent.name : '—'}</b>
          <span>Le plus présent{chars[0] ? ` (${mostPresent.total} séq.)` : ''}</span>
        </div>
        <div>
          <b>{chars[0] ? mostTalk.name : '—'}</b>
          <span>Le plus bavard{chars[0] ? ` (${mostTalk.replies} répl.)` : ''}</span>
        </div>
      </div>
      <p className={s.h}>Texte</p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Paragraphe</th>
            <th>Nombre</th>
            <th>Mots</th>
            <th>Part</th>
          </tr>
        </thead>
        <tbody>
          {types.map((x) => (
            <tr key={x.t}>
              <td>{blockLabel(x.t)}</td>
              <td>{x.count}</td>
              <td>{x.words}</td>
              <td>
                <Pct v={x.pct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {table('Séquences', 'Moment', group((sc) => sc.effect.toLocaleLowerCase('fr')), scenes.length)}
      {table('Décors', 'Lieu', group((sc) => sc.intExt), scenes.length)}
      {table('Personnages', 'Répliques', buckets, chars.length)}
    </>
  );
}
