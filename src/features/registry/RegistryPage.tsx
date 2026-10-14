import { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { navigate, useLocation } from '../../app/router';
import { sequenceCharacterIds, sortedCharacters } from '../../domain/characters';
import { formatFocal } from '../../domain/focal';
import { shotCode, sequenceNumber } from '../../domain/numbering';
import { addCharacter, mergeCharacters } from '../../domain/ops';
import { addDecor, characterStats, decorStats, deleteCharacter, deleteDecor, sequenceProgress, setSequenceDecorByName } from '../../domain/registry';
import { formatTc, parseTc } from '../../domain/timecode';
import { computeTiming, formatGap } from '../../domain/timing';
import { renderTokens } from '../../domain/tokens';
import type { Character, CharacterKind, Decor, Effect, ID, IntExt, ProjectDoc, Sequence, Shot, ShotStatus } from '../../domain/types';
import { isZoom } from '../../domain/vocabulary';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { ask } from '../../ui/dialogStore';
import { rowOfShot } from '../grid/actions';
import s from './RegistryPage.module.css';
import { TabExport } from '../export/TabExport';
import { charactersCsv, decorsCsv, sequencesCsv, shotsCsv } from '../../domain/exports';

type Tab = 'sequences' | 'characters' | 'decors' | 'shots';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'sequences', label: 'Séquences' },
  { key: 'characters', label: 'Personnages' },
  { key: 'decors', label: 'Décors' },
  { key: 'shots', label: 'Plans' },
];

const KINDS: CharacterKind[] = ['principal', 'secondaire', 'figurant', 'silhouette', 'voix off'];
const INT_EXT = [{ value: '', label: '—' }, ...(['INT', 'EXT', 'INT/EXT'] as IntExt[]).map((v) => ({ value: v, label: v }))];
const EFFECTS = [{ value: '', label: '—' }, ...(['JOUR', 'NUIT', 'AUBE', 'CRÉPUSCULE'] as Effect[]).map((v) => ({ value: v, label: v }))];
const STATUSES: ShotStatus[] = ['à tourner', 'tourné', 'abandonné'];

/** Saute au plan dans la grille. */
export function goToShot(doc: ProjectDoc, shotId: ID | undefined) {
  if (!shotId) return navigate('grid');
  const row = rowOfShot(doc, shotId);
  if (row >= 0) useUi.getState().setSelection({ row, col: 'subject' });
  navigate('grid');
}

export function RegistryPage({ doc }: { doc: ProjectDoc }) {
  const { params } = useLocation();
  const tab = (params.get('tab') as Tab | null) ?? 'sequences';
  const [search, setSearch] = useState('');
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const counts: Record<Tab, number> = {
    sequences: doc.project.sequenceIds.length,
    characters: Object.keys(doc.characters).length,
    decors: Object.keys(doc.decors).length,
    shots: Object.keys(doc.shots).length,
  };

  return (
    <div className="page page--wide">
      <header className="page-head">
        <div>
          <p className="page-kicker">Base du projet · Registre</p>
          <h1 className="page-title">
            Les <em>{counts[tab]}</em> {TABS.find((t) => t.key === tab)?.label.toLowerCase()}
          </h1>
        </div>
        <TabExport
          print={true}
          file={{
            label: 'CSV',
            name: `${doc.project.title || 'projet'}-${tab}.csv`,
            content: () => ({ sequences: sequencesCsv, characters: charactersCsv, decors: decorsCsv, shots: shotsCsv })[tab](doc),
          }}
        />
        <label className={s.search}>
          <Search size={15} strokeWidth={1.25} />
          <input type="search" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher dans le registre" />
        </label>
      </header>
      <div className={s.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={[s.tab, tab === t.key ? s.on : ''].join(' ')}
            onClick={() => navigate('registry', { tab: t.key })}
          >
            {t.label} <em>{counts[t.key]}</em>
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'sequences' && <SequencesTab doc={doc} timing={timing} search={search} />}
        {tab === 'characters' && <CharactersTab doc={doc} search={search} />}
        {tab === 'decors' && <DecorsTab doc={doc} timing={timing} search={search} />}
        {tab === 'shots' && <ShotsTab doc={doc} search={search} />}
      </div>
    </div>
  );
}

function SequencesTab({ doc, timing, search }: { doc: ProjectDoc; timing: ReturnType<typeof computeTiming>; search: string }) {
  const rows = doc.project.sequenceIds.map((id) => doc.sequences[id]).filter((x): x is Sequence => !!x);
  const decorName = (q: Sequence) => (q.decorId ? (doc.decors[q.decorId]?.name ?? '') : '');
  const chars = sortedCharacters(doc);
  const columns: Column<Sequence>[] = [
    {
      key: 'n',
      label: 'N°',
      width: '48px',
      render: (q) => (
        <button type="button" className={s.jump} onClick={() => goToShot(doc, q.shotIds[0])} title="Ouvrir dans la grille">
          {sequenceNumber(doc, q.id)}
        </button>
      ),
      sort: (q) => sequenceNumber(doc, q.id),
    },
    {
      key: 'label',
      label: 'Libellé',
      render: (q) => q.label.toUpperCase(),
      text: (q) => q.label,
      edit: { get: (q) => q.label, set: (q, v) => mutateDoc((d) => void (d.sequences[q.id].label = v.trim())) },
    },
    {
      key: 'decor',
      label: 'Décor',
      render: decorName,
      text: decorName,
      edit: { get: decorName, set: (q, v) => mutateDoc((d) => setSequenceDecorByName(d, q.id, v)) },
    },
    {
      key: 'ie',
      label: 'INT/EXT',
      render: (q) => q.intExt ?? '—',
      text: (q) => q.intExt ?? '',
      edit: { get: (q) => q.intExt ?? '', options: INT_EXT, set: (q, v) => mutateDoc((d) => void (d.sequences[q.id].intExt = (v || undefined) as IntExt | undefined)) },
    },
    {
      key: 'effect',
      label: 'Effet',
      render: (q) => q.effect ?? '—',
      text: (q) => q.effect ?? '',
      edit: { get: (q) => q.effect ?? '', options: EFFECTS, set: (q, v) => mutateDoc((d) => void (d.sequences[q.id].effect = (v || undefined) as Effect | undefined)) },
    },
    {
      key: 'chars',
      label: 'Personnages',
      text: (q) => sequenceCharacterIds(doc, q.id).map((id) => doc.characters[id]?.name).join(' '),
      render: (q) => {
        const ids = sequenceCharacterIds(doc, q.id);
        const others = chars.filter((c) => !ids.includes(c.id));
        return (
          <span className={s.chips}>
            {ids.map((id) => (
              <span key={id} className={s.chip} style={{ borderColor: doc.characters[id]?.color }}>
                {doc.characters[id]?.name}
              </span>
            ))}
            {others.length > 0 && (
              <select
                className={s.addChip}
                value=""
                aria-label="Ajouter un personnage à la séquence"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) mutateDoc((d) => void d.sequences[q.id].characterIds.push(v));
                }}
              >
                <option value="">+</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </span>
        );
      },
    },
    { key: 'shots', label: 'Plans', align: 'right', render: (q) => q.shotIds.length, sort: (q) => q.shotIds.length },
    {
      key: 'est',
      label: 'Estimée',
      align: 'right',
      render: (q) => <span className="mono">{q.estimatedSec !== undefined ? formatTc(q.estimatedSec) : '—'}</span>,
      sort: (q) => q.estimatedSec ?? -1,
      edit: {
        get: (q) => (q.estimatedSec !== undefined ? formatTc(q.estimatedSec) : ''),
        set: (q, v) => {
          const p = parseTc(v);
          mutateDoc((d) => void (d.sequences[q.id].estimatedSec = p?.kind === 'sec' ? p.sec : undefined));
        },
      },
    },
    {
      key: 'calc',
      label: 'Calculée',
      align: 'right',
      render: (q) => <span className="mono">{formatTc(timing.sequences.get(q.id)?.durationSec ?? 0)}</span>,
      sort: (q) => timing.sequences.get(q.id)?.durationSec ?? 0,
    },
    {
      key: 'gap',
      label: 'Écart',
      align: 'right',
      render: (q) => {
        const g = timing.sequences.get(q.id)?.gap;
        return g ? <span className={[s.gap, s[g.level]].join(' ')}>{formatGap(g)}</span> : '—';
      },
      sort: (q) => Math.abs(timing.sequences.get(q.id)?.gap?.pct ?? -1),
    },
    {
      key: 'progress',
      label: 'Avancement',
      render: (q) => {
        const p = sequenceProgress(doc, q.id);
        return (
          <span className={s.progress} title={`${p.done} plan(s) tourné(s) sur ${p.total}`}>
            <span className={s.bar}>
              <span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
            </span>
            {p.done}/{p.total}
          </span>
        );
      },
      sort: (q) => {
        const p = sequenceProgress(doc, q.id);
        return p.total ? p.done / p.total : 0;
      },
    },
  ];
  return <DataTable label="Séquences" rows={rows} columns={columns} rowKey={(q) => q.id} search={search} empty="Aucune séquence." />;
}

function CharactersTab({ doc, search }: { doc: ProjectDoc; search: string }) {
  const stats = useMemo(() => characterStats(doc), [doc]);
  const rows = sortedCharacters(doc);
  const [dragId, setDragId] = useState<ID | null>(null);
  const [overId, setOverId] = useState<ID | null>(null);

  const merge = async (from: ID, into: ID) => {
    if (from === into) return;
    const a = doc.characters[from];
    const b = doc.characters[into];
    const res = await ask({
      title: `Fusionner « ${a.name} » dans « ${b.name} » ?`,
      body: `Les plans de « ${a.name} » seront rattachés à « ${b.name} », qui gardera « ${a.name} » comme alias.`,
      confirmLabel: 'Fusionner',
    });
    if (res.ok) mutateDoc((d) => mergeCharacters(d, from, into));
  };

  const columns: Column<Character>[] = [
    {
      key: 'name',
      label: 'Nom',
      text: (c) => [c.name, ...(c.aliases ?? [])].join(' '),
      render: (c) => (
        <span className={s.name}>
          <span className={s.grip} aria-hidden="true">⋮⋮</span>
          {c.name}
          {c.aliases?.length ? <em className={s.alias}>alias {c.aliases.join(', ')}</em> : null}
        </span>
      ),
      edit: { get: (c) => c.name, set: (c, v) => v.trim() && mutateDoc((d) => void (d.characters[c.id].name = v.trim())) },
    },
    {
      key: 'kind',
      label: 'Type',
      render: (c) => c.kind,
      text: (c) => c.kind,
      edit: { get: (c) => c.kind, options: KINDS.map((k) => ({ value: k, label: k })), set: (c, v) => mutateDoc((d) => void (d.characters[c.id].kind = v as CharacterKind)) },
    },
    { key: 'color', label: 'Couleur', width: '70px', render: () => null, edit: { type: 'color', get: (c) => c.color ?? '', set: (c, v) => mutateDoc((d) => void (d.characters[c.id].color = v)) } },
    {
      key: 'actor',
      label: 'Comédien·ne',
      render: (c) => c.actor || '—',
      text: (c) => c.actor ?? '',
      edit: { get: (c) => c.actor ?? '', set: (c, v) => mutateDoc((d) => void (d.characters[c.id].actor = v.trim() || undefined)) },
    },
    { key: 'nseq', label: 'Séquences', align: 'right', render: (c) => stats.get(c.id)?.sequenceIds.length ?? 0, sort: (c) => stats.get(c.id)?.sequenceIds.length ?? 0 },
    { key: 'nshots', label: 'Plans', align: 'right', render: (c) => stats.get(c.id)?.shotIds.length ?? 0, sort: (c) => stats.get(c.id)?.shotIds.length ?? 0 },
    {
      key: 'list',
      label: 'Liste des séquences',
      render: (c) => (
        <span className={s.chips}>
          {(stats.get(c.id)?.sequenceIds ?? []).map((id) => (
            <button key={id} type="button" className={s.seqLink} onClick={() => goToShot(doc, doc.sequences[id]?.shotIds[0])}>
              {sequenceNumber(doc, id)}
            </button>
          ))}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '150px',
      render: (c) => (
        <span className={s.rowActions}>
          <select className={s.mergeSel} value="" aria-label={`Fusionner ${c.name} dans…`} onChange={(e) => e.target.value && void merge(c.id, e.target.value)}>
            <option value="">Fusionner dans…</option>
            {rows
              .filter((o) => o.id !== c.id)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
          <Button
            variant="icon"
            size="sm"
            aria-label={`Supprimer ${c.name}`}
            icon={<Trash2 size={13} strokeWidth={1.25} />}
            onClick={async () => {
              const r = await ask({ title: `Supprimer « ${c.name} » ?`, body: 'Les plans gardent leur sujet ; seule la fiche disparaît.', confirmLabel: 'Supprimer', danger: true });
              if (r.ok) mutateDoc((d) => deleteCharacter(d, c.id));
            }}
          />
        </span>
      ),
    },
  ];
  return (
    <>
      <div className={s.toolbar}>
        <Button
          icon={<Plus size={15} strokeWidth={1.25} />}
          onClick={() => mutateDoc((d) => addCharacter(d, { name: `Personnage ${Object.keys(d.characters).length + 1}`, kind: 'secondaire' }))}
        >
          Ajouter un personnage
        </Button>
        <span className="hand">glisser un personnage sur un autre pour fusionner les doublons</span>
      </div>
      <DataTable
        label="Personnages"
        rows={rows}
        columns={columns}
        rowKey={(c) => c.id}
        search={search}
        empty="Aucun personnage."
        rowProps={(c) => ({
          draggable: true,
          className: overId === c.id && dragId !== c.id ? s.dropTarget : undefined,
          onDragStart: (e: React.DragEvent) => {
            setDragId(c.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', c.id);
          },
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            setOverId(c.id);
          },
          onDragLeave: () => setOverId(null),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const from = e.dataTransfer.getData('text/plain') || dragId;
            setDragId(null);
            setOverId(null);
            if (from) void merge(from, c.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setOverId(null);
          },
          'data-testid': 'character-row',
        })}
      />
    </>
  );
}

function DecorsTab({ doc, timing, search }: { doc: ProjectDoc; timing: ReturnType<typeof computeTiming>; search: string }) {
  const stats = useMemo(() => decorStats(doc, timing), [doc, timing]);
  const rows = Object.values(doc.decors).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const columns: Column<Decor>[] = [
    { key: 'name', label: 'Nom', render: (d) => d.name, text: (d) => d.name, edit: { get: (d) => d.name, set: (d, v) => v.trim() && mutateDoc((x) => void (x.decors[d.id].name = v.trim())) } },
    {
      key: 'ie',
      label: 'INT/EXT',
      render: (d) => d.intExt ?? '—',
      text: (d) => d.intExt ?? '',
      edit: { get: (d) => d.intExt ?? '', options: INT_EXT, set: (d, v) => mutateDoc((x) => void (x.decors[d.id].intExt = (v || undefined) as IntExt | undefined)) },
    },
    {
      key: 'address',
      label: 'Adresse',
      render: (d) => d.address || '—',
      text: (d) => d.address ?? '',
      edit: { get: (d) => d.address ?? '', set: (d, v) => mutateDoc((x) => void (x.decors[d.id].address = v.trim() || undefined)) },
    },
    {
      key: 'seqs',
      label: 'Séquences',
      render: (d) => (
        <span className={s.chips}>
          {(stats.get(d.id)?.sequenceIds ?? []).map((id) => (
            <button key={id} type="button" className={s.seqLink} onClick={() => goToShot(doc, doc.sequences[id]?.shotIds[0])}>
              {sequenceNumber(doc, id)}
            </button>
          ))}
        </span>
      ),
      sort: (d) => stats.get(d.id)?.sequenceIds.length ?? 0,
    },
    {
      key: 'total',
      label: 'Durée à tourner',
      align: 'right',
      render: (d) => <span className="mono">{formatTc(stats.get(d.id)?.totalSec ?? 0)}</span>,
      sort: (d) => stats.get(d.id)?.totalSec ?? 0,
    },
    {
      key: 'actions',
      label: '',
      width: '44px',
      render: (d) => (
        <Button variant="icon" size="sm" aria-label={`Supprimer ${d.name}`} icon={<Trash2 size={13} strokeWidth={1.25} />} onClick={() => mutateDoc((x) => deleteDecor(x, d.id))} />
      ),
    },
  ];
  return (
    <>
      <div className={s.toolbar}>
        <Button icon={<Plus size={15} strokeWidth={1.25} />} onClick={() => mutateDoc((d) => addDecor(d, { name: `Décor ${Object.keys(d.decors).length + 1}` }))}>
          Ajouter un décor
        </Button>
      </div>
      <DataTable label="Décors" rows={rows} columns={columns} rowKey={(d) => d.id} search={search} empty="Aucun décor." />
    </>
  );
}

interface ShotRow {
  shot: Shot;
  code: string;
  seq: Sequence;
}

function ShotsTab({ doc, search }: { doc: ProjectDoc; search: string }) {
  const [f, setF] = useState({ value: '', focal: '', movement: '', character: '', decor: '', status: '', day: '' });
  const all: ShotRow[] = useMemo(
    () =>
      doc.project.sequenceIds.flatMap((seqId) =>
        (doc.sequences[seqId]?.shotIds ?? []).map((id) => ({ shot: doc.shots[id], code: shotCode(doc, id), seq: doc.sequences[seqId] })),
      ),
    [doc],
  );
  const distinct = (fn: (r: ShotRow) => string[]) => [...new Set(all.flatMap(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  const focalOf = (r: ShotRow) => formatFocal(r.shot.focal, isZoom(r.shot.movement));
  const options = {
    value: distinct((r) => [r.shot.value]),
    focal: distinct((r) => [focalOf(r)]),
    movement: distinct((r) => r.shot.movement.map((m) => m.toLowerCase())),
    character: sortedCharacters(doc).map((c) => c.name),
    decor: Object.values(doc.decors).map((d) => d.name).sort(),
    status: STATUSES,
    day: distinct((r) => (r.shot.shootingDay !== undefined ? [`J${r.shot.shootingDay}`] : [])),
  };
  const rows = all.filter(
    (r) =>
      (!f.value || r.shot.value === f.value) &&
      (!f.focal || focalOf(r) === f.focal) &&
      (!f.movement || r.shot.movement.some((m) => m.toLowerCase() === f.movement)) &&
      (!f.character || r.shot.characterIds.some((id) => doc.characters[id]?.name === f.character)) &&
      (!f.decor || (r.seq.decorId && doc.decors[r.seq.decorId]?.name === f.decor)) &&
      (!f.status || r.shot.status === f.status) &&
      (!f.day || `J${r.shot.shootingDay}` === f.day),
  );
  const columns: Column<ShotRow>[] = [
    {
      key: 'code',
      label: 'Plan',
      width: '60px',
      render: (r) => (
        <button type="button" className={s.jump} onClick={() => goToShot(doc, r.shot.id)}>
          {r.code}
        </button>
      ),
      sort: (r) => doc.project.sequenceIds.indexOf(r.seq.id) * 1000 + r.seq.shotIds.indexOf(r.shot.id),
      text: (r) => r.code,
    },
    { key: 'seq', label: 'Séquence', render: (r) => r.seq.label.toUpperCase(), text: (r) => r.seq.label },
    { key: 'subject', label: 'Sujet', render: (r) => r.shot.subject, text: (r) => r.shot.subject },
    { key: 'value', label: 'Valeur', render: (r) => r.shot.value, text: (r) => r.shot.value },
    { key: 'angle', label: 'Angle', render: (r) => renderTokens(r.shot.angle), text: (r) => r.shot.angle.join(' ') },
    { key: 'movement', label: 'Mouvement', render: (r) => renderTokens(r.shot.movement, r.shot.movementSep), text: (r) => r.shot.movement.join(' ') },
    { key: 'focal', label: 'Focale', render: focalOf, sort: (r) => r.shot.focal.from ?? 0, text: focalOf },
    { key: 'action', label: 'Action', render: (r) => doc.blocks[r.shot.actionBlockId]?.text ?? '', text: (r) => doc.blocks[r.shot.actionBlockId]?.text ?? '' },
    {
      key: 'status',
      label: 'Statut',
      render: (r) => <span className={[s.status, s[`st_${r.shot.status.replace(/\s|à/g, '')}`]].join(' ')}>{r.shot.status}</span>,
      text: (r) => r.shot.status,
      edit: { get: (r) => r.shot.status, options: STATUSES.map((v) => ({ value: v, label: v })), set: (r, v) => mutateDoc((d) => void (d.shots[r.shot.id].status = v as ShotStatus)) },
    },
    {
      key: 'day',
      label: 'Jour',
      align: 'right',
      render: (r) => (r.shot.shootingDay !== undefined ? `J${r.shot.shootingDay}` : '—'),
      sort: (r) => r.shot.shootingDay ?? 999,
      edit: {
        get: (r) => (r.shot.shootingDay !== undefined ? String(r.shot.shootingDay) : ''),
        set: (r, v) => {
          const m = /(\d+)/.exec(v);
          mutateDoc((d) => void (d.shots[r.shot.id].shootingDay = m ? Number(m[1]) : undefined));
        },
      },
    },
  ];
  const FILTERS: Array<[keyof typeof f, string]> = [
    ['value', 'Valeur'],
    ['focal', 'Focale'],
    ['movement', 'Mouvement'],
    ['character', 'Personnage'],
    ['decor', 'Décor'],
    ['status', 'Statut'],
    ['day', 'Jour'],
  ];
  return (
    <>
      <div className={s.filters}>
        {FILTERS.map(([k, label]) => (
          <label key={k}>
            <span>{label}</span>
            <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={`Filtrer par ${label.toLowerCase()}`}>
              <option value="">Tous</option>
              {options[k].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ))}
        <span className={s.count}>
          {rows.length} / {all.length} plans
        </span>
      </div>
      <DataTable label="Plans" rows={rows} columns={columns} rowKey={(r) => r.shot.id} search={search} empty="Aucun plan ne correspond aux filtres." />
    </>
  );
}
