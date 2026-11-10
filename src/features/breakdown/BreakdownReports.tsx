import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { breakdownCategories, breakdownLabel, type BreakdownCategory } from '../../domain/breakdown';
import { breakdownIndex, sequenceCounts, type BreakdownEntry } from '../../domain/breakdownReport';
import { esc } from '../../domain/documents';
import { mmss } from '../../domain/chronometry';
import { computeTiming } from '../../domain/timing';
import type { ID, ProjectDoc } from '../../domain/types';
import r from '../scenario/ScriptStatsReports.module.css';
import { entryLabel, entryNumbers, type Entry } from './entries';
import s from './BreakdownPage.module.css';
import { exportBase } from '../../domain/serialize';

type Report = 'items' | 'sequences';
type ItemSort = 'film' | 'often' | 'long' | 'alpha';

const REPORT_KEY = 'ds-breakdown-report';
const SORTS: readonly ItemSort[] = ['film', 'often', 'long', 'alpha'];

/** Rapport, catégorie et tri retenus d'une visite à l'autre (une valeur inconnue revient au défaut). */
export function readReportPrefs(raw: string | null, cats: readonly BreakdownCategory[]): { report: Report; cat: BreakdownCategory | ''; sort: ItemSort } {
  let v: { report?: unknown; cat?: unknown; sort?: unknown } = {};
  try {
    v = raw ? (JSON.parse(raw) ?? {}) : {};
  } catch {
    v = {};
  }
  return {
    report: v.report === 'sequences' ? 'sequences' : 'items',
    cat: typeof v.cat === 'string' && cats.includes(v.cat) ? v.cat : '',
    sort: SORTS.includes(v.sort as ItemSort) ? (v.sort as ItemSort) : 'film',
  };
}

const loadPrefs = (cats: readonly BreakdownCategory[]) => {
  try {
    return readReportPrefs(localStorage.getItem(REPORT_KEY), cats);
  } catch {
    return readReportPrefs(null, cats);
  }
};

/** Page imprimable d'un rapport : titre échappé, filtre de catégorie nommé ; les réglages (data-print-hide) ne s'impriment pas. */
export function reportPrintHtml(project: string, title: string, catLabel: string | undefined, body: string): string {
  const css = `body{font-family:Inter,sans-serif;font-size:9.5pt;color:#111318} h1{font-size:15pt;margin:0 0 4pt} table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:3pt 4pt;border-bottom:.5pt solid #d6d8dd;vertical-align:top} th{font-size:7.5pt;text-transform:uppercase;letter-spacing:.08em;color:#6b7079} button{border:0;background:none;padding:0;font:inherit;color:inherit} select,[data-print-hide]{display:none} .pad{height:13mm}`;
  const h1 = `${esc(project)} — Dépouillement, ${esc(title.toLowerCase())}${catLabel ? ` — ${esc(catLabel)}` : ''}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css}</style></head><body><table class="sheet"><thead><tr><td><div class="pad"></div></td></tr></thead><tbody><tr><td style="padding:0 13mm"><h1>${h1}</h1>${body}</td></tr></tbody><tfoot><tr><td><div class="pad"></div></td></tr></tfoot></table></body></html>`;
}

/** Numéros et libellés du dépouillement (ceux du découpage), par séquence. */
interface Numbering {
  no: (seqId: ID) => number | undefined;
  label: (seqId: ID) => string;
}

/**
 * Rapports du dépouillement, sur tout le film : chaque élément et ses séquences (durée à l'écran,
 * jours de tournage), ou chaque séquence et ce qu'elle demande, catégorie par catégorie.
 */
export function BreakdownReports({ doc, entries: scenes, onGo }: { doc: ProjectDoc; entries: readonly Entry[]; onGo: (seqId: ID) => void }) {
  const entries = useMemo(() => breakdownIndex(doc, computeTiming(doc)), [doc]);
  const numbering = useMemo<Numbering>(() => {
    const { byKey, bySeq } = entryNumbers(doc, scenes);
    return {
      no: (id) => bySeq.get(id),
      label: (id) => {
        const e = scenes.find((x) => x.seqId === id);
        return e ? entryLabel(doc, e, byKey.get(e.key)) : '';
      },
    };
  }, [doc, scenes]);
  const [prefs] = useState(() => loadPrefs(breakdownCategories(doc)));
  const [report, setReport] = useState<Report>(prefs.report);
  const [rawCat, setCat] = useState<BreakdownCategory | ''>(prefs.cat);
  const [sort, setSort] = useState<ItemSort>(prefs.sort);
  const box = useRef<HTMLDivElement>(null);
  const used = breakdownCategories(doc).filter((c) => entries.some((e) => e.cat === c));
  // Une catégorie retenue qui n'a plus rien (ou supprimée) : toutes.
  const cat = rawCat && used.includes(rawCat) ? rawCat : '';
  useEffect(() => {
    try {
      localStorage.setItem(REPORT_KEY, JSON.stringify({ report, cat: rawCat, sort }));
    } catch {
      /* préférence non retenue */
    }
  }, [report, rawCat, sort]);
  const bare = scenes.filter((sc) => !sc.seqId || !entries.some((e) => e.seqIds.includes(sc.seqId!))).length;
  const title = report === 'items' ? 'Éléments' : 'Séquences';

  const print = async () => {
    const { exportDocumentPages } = await import('../export/imageExport');
    const html = reportPrintHtml(doc.project.title, title, report === 'items' && cat ? breakdownLabel(cat) : undefined, box.current?.innerHTML ?? '');
    await exportDocumentPages(html, `${exportBase(doc)}-depouillement-${title}`, { format: 'pdf', orientation: report === 'sequences' ? 'landscape' : 'portrait', numbers: true });
  };

  return (
    <div className={[r.wrap, s.reports].join(' ')} data-testid="breakdown-reports">
      <div className={r.kpis}>
        <div>
          <b>{entries.length}</b>
          <span>Éléments</span>
        </div>
        <div>
          <b>{used.length}</b>
          <span>Catégories employées</span>
        </div>
        <div>
          <b>{entries.filter((e) => e.seqIds.length > 1).length}</b>
          <span>Dans plusieurs séquences</span>
        </div>
        <div>
          <b>{bare}</b>
          <span>Séquences sans élément</span>
        </div>
      </div>
      <div className={r.bar}>
        <select value={report} onChange={(e) => setReport(e.target.value as Report)} aria-label="Rapport" data-view>
          <option value="items">Éléments et leurs séquences</option>
          <option value="sequences">Séquences et leurs éléments</option>
        </select>
        <button type="button" className={r.icon} onClick={() => void print()} aria-label="Exporter ce rapport en PDF" title="Exporter en PDF" data-view data-export>
          <Printer size={15} strokeWidth={1.3} />
        </button>
      </div>
      <div ref={box}>
        {report === 'items' ? (
          <ItemsReport numbering={numbering} entries={entries} cats={used} cat={cat} setCat={setCat} sort={sort} setSort={setSort} onGo={onGo} />
        ) : (
          <SequencesReport doc={doc} scenes={scenes} entries={entries} cats={used} onGo={onGo} />
        )}
      </div>
    </div>
  );
}

function ItemsReport({
  numbering,
  entries,
  cats,
  cat,
  setCat,
  sort,
  setSort,
  onGo,
}: {
  numbering: Numbering;
  entries: BreakdownEntry[];
  cats: BreakdownCategory[];
  cat: BreakdownCategory | '';
  setCat: (c: BreakdownCategory | '') => void;
  sort: ItemSort;
  setSort: (s: ItemSort) => void;
  onGo: (seqId: ID) => void;
}) {
  const rank = new Map(cats.map((c, i) => [c, i]));
  const shown = entries
    .filter((e) => !cat || e.cat === cat)
    .slice()
    .sort((a, b) => {
      if (sort === 'often') return b.seqIds.length - a.seqIds.length || a.item.localeCompare(b.item, 'fr');
      if (sort === 'long') return b.totalSec - a.totalSec;
      if (sort === 'alpha') return a.item.localeCompare(b.item, 'fr');
      return (rank.get(a.cat) ?? 0) - (rank.get(b.cat) ?? 0);
    });
  const grouped = sort === 'film' && !cat;
  return (
    <>
      <div className={r.opts} data-view data-print-hide>
        <label className={r.sort}>
          <span>Catégorie</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)} data-testid="breakdown-report-cat">
            <option value="">Toutes</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {breakdownLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className={r.sort}>
          <span>Trier</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as ItemSort)}>
            <option value="film">Par catégorie, dans l’ordre du film</option>
            <option value="often">Les plus fréquents</option>
            <option value="long">Le plus à l’écran</option>
            <option value="alpha">Par nom</option>
          </select>
        </label>
      </div>
      {shown.length ? (
        <table className={r.table}>
          <thead>
            <tr>
              <th>Élément</th>
              {!grouped && !cat && <th>Catégorie</th>}
              <th>Séquences</th>
              <th>Nb</th>
              <th>À l’écran</th>
              <th>Jours</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <ItemRow key={`${e.cat}|${e.item}`} numbering={numbering} e={e} head={grouped && shown[i - 1]?.cat !== e.cat ? breakdownLabel(e.cat) : undefined} withCat={!grouped && !cat} onGo={onGo} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className={r.empty}>Rien de dépouillé.</p>
      )}
    </>
  );
}

function ItemRow({ numbering, e, head, withCat, onGo }: { numbering: Numbering; e: BreakdownEntry; head?: string; withCat: boolean; onGo: (seqId: ID) => void }) {
  const cols = withCat ? 6 : 5;
  return (
    <>
      {head && (
        <tr className={r.barRow}>
          <td colSpan={cols}>{head}</td>
        </tr>
      )}
      <tr data-testid="breakdown-report-item">
        <td className={e.manualSeqIds.length ? '' : s.fromCut}>{e.item}</td>
        {withCat && <td className={r.muted}>{breakdownLabel(e.cat)}</td>}
        <td>
          <span className={s.seqLinks} data-view>
            {[...e.seqIds]
              .sort((a, b) => (numbering.no(a) ?? 0) - (numbering.no(b) ?? 0))
              .map((id) => (
                <button key={id} type="button" className={r.link} onClick={() => onGo(id)} title={numbering.label(id)}>
                  {numbering.no(id)}
                </button>
              ))}
          </span>
        </td>
        <td>{e.seqIds.length}</td>
        <td>{mmss(Math.round(e.totalSec))}</td>
        <td className={r.muted}>{e.days.map((d) => `J${d}`).join(', ') || '–'}</td>
      </tr>
    </>
  );
}

function SequencesReport({ doc, scenes, entries, cats, onGo }: { doc: ProjectDoc; scenes: readonly Entry[]; entries: BreakdownEntry[]; cats: BreakdownCategory[]; onGo: (seqId: ID) => void }) {
  const { byKey } = entryNumbers(doc, scenes);
  const rows = scenes.map((sc) => {
    const counts = sc.seqId ? sequenceCounts(entries, sc.seqId) : new Map<BreakdownCategory, number>();
    return { sc, counts, total: [...counts.values()].reduce((a, b) => a + b, 0) };
  });
  return (
    <table className={r.table}>
      <thead>
        <tr>
          <th>Séquence</th>
          {cats.map((c) => (
            <th key={c} title={breakdownLabel(c)}>
              {breakdownLabel(c).replace(/,.*$/, '')}
            </th>
          ))}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ sc, counts, total }) => (
          <tr key={sc.key} data-testid="breakdown-report-seq">
            <td>
              {sc.seqId ? (
                <button type="button" className={r.link} onClick={() => onGo(sc.seqId!)} data-view>
                  {entryLabel(doc, sc, byKey.get(sc.key))}
                </button>
              ) : (
                <span className={r.muted}>{entryLabel(doc, sc, byKey.get(sc.key))}</span>
              )}
            </td>
            {cats.map((c) => (
              <td key={c} className={counts.get(c) ? '' : r.muted}>
                {counts.get(c) ?? '·'}
              </td>
            ))}
            <td>
              <b>{total}</b>
            </td>
          </tr>
        ))}
        <tr className={r.barRow}>
          <td>Éléments distincts</td>
          {cats.map((c) => (
            <td key={c}>{entries.filter((e) => e.cat === c).length}</td>
          ))}
          <td>{entries.length}</td>
        </tr>
      </tbody>
    </table>
  );
}
