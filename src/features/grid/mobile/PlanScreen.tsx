import { Fragment, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Copy, List, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { activeColumns, COLUMN_DEFS, shortLabel, tcLast } from '../../../domain/columns';
import { editableText, isEditable } from '../../../domain/cells';
import { aspectRatio } from '../../../domain/aspect';
import { cropStyle } from '../../../domain/keyframes';
import { sequenceNumber, shotCode } from '../../../domain/numbering';
import { BEAT_COLUMNS } from '../../../domain/oneshot';
import { focalLabel, movementKey, movementPhrase, tileOf } from '../../../domain/phoneCut';
import { formatTc } from '../../../domain/timecode';
import { shotOwnSec, type Timing } from '../../../domain/timing';
import type { ColumnKey, ID, ProjectDoc } from '../../../domain/types';
import { useBlobUrl } from '../../../ui/useBlobUrl';
import { MovementIcon } from './movementIcons';
import s from './MobileCut.module.css';

/** Champs portés par le titre et la ligne grise (les autres ont chacun leur ligne). */
const HEAD_COLS: readonly ColumnKey[] = ['value', 'subject', 'angle', 'focal'];
/** Jamais sur l'écran du plan : le numéro est dans l'en-tête, le TC au bout des tirets, la séquence en tête. */
const HIDDEN: readonly ColumnKey[] = ['number', 'tc', 'sequence', 'characters', 'grip', 'shotDuration'];

export type SheetKind = { kind: 'value' | 'movement' | 'action' | 'sequence' } | { kind: 'text'; col: ColumnKey; label: string };

/** Libellé d'un champ sur téléphone (« Mouvement de caméra » → « Mouvement »). */
export const fieldLabel = (c: ColumnKey) => (c === 'movement' ? shortLabel(COLUMN_DEFS[c]) : COLUMN_DEFS[c].label);

/**
 * Écran d'un plan : la séquence et le numéro en tête, l'image du storyboard s'il y en a une, la
 * position dans la séquence et la durée, la valeur en titre, puis une ligne par champ affiché ;
 * chacune s'ouvre dans sa feuille du bas.
 */
export function PlanScreen({
  doc,
  shotId,
  order,
  timing,
  readOnly,
  onGo,
  onOverview,
  onOpen,
  onAdd,
  onDuplicate,
  onDelete,
}: {
  doc: ProjectDoc;
  shotId: ID;
  order: ID[];
  timing: Timing;
  readOnly: boolean;
  onGo: (id: ID) => void;
  onOverview: () => void;
  onOpen: (sheet: SheetKind) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const shot = doc.shots[shotId];
  const seq = doc.sequences[shot.sequenceId];
  const [menu, setMenu] = useState(false);
  const img = useBlobUrl(shot.storyboard?.blobKey);
  const cols = activeColumns(tcLast(doc.project.settings.gridColumns));
  const shown = (c: ColumnKey) => cols.includes(c);
  // Plan d'interview (réglé dans sa fiche) ou temps d'un plan-séquence : rien ne s'écrit ici.
  const editable = (c: ColumnKey) => !readOnly && isEditable(c) && !shot.interview && !(shot.oneShot && BEAT_COLUMNS.includes(c));
  const i = order.indexOf(shotId);
  const prev = order[i - 1];
  const next = order[i + 1];
  // Durée du plan (sa part de l'action qu'il couvre, ou la sienne en mode durée).
  const sec = shotOwnSec(doc, timing, shotId);
  const tc = sec > 0 ? formatTc(Math.round(sec)) : '';
  const code = shotCode(doc, shotId);

  // Titre : la valeur, à défaut le sujet si la valeur n'est pas affichée.
  const titleCol: ColumnKey = shown('value') || !shown('subject') ? 'value' : 'subject';
  const title = editableText(doc, shotId, titleCol);
  const len = title.length > 16 ? 'l' : title.length > 12 ? 'm' : undefined;
  const openHead = (c: ColumnKey) => (c === 'subject' ? onOpen({ kind: 'text', col: 'subject', label: 'Sujet' }) : onOpen({ kind: 'value' }));

  // Ligne grise : sujet · axe · hauteur · focale.
  const sub: ReactNode[] = [];
  const subItem = (c: ColumnKey, text: string, cls = '', key: string = c) =>
    sub.push(
      <button key={key} type="button" className={[cls, text ? '' : s.empty].join(' ')} disabled={!editable(c)} onClick={() => openHead(c)} data-field={key === c ? c : undefined}>
        {text || fieldLabel(c)}
      </button>,
    );
  if (titleCol !== 'subject' && shown('subject')) subItem('subject', shot.subject, s.who);
  if (shown('angle')) {
    if (shot.angle.length) shot.angle.forEach((t, k) => subItem('angle', t, '', k ? `angle${k}` : 'angle'));
    else subItem('angle', '');
  }
  if (shown('focal')) subItem('focal', focalLabel(shot.focal));

  const rows = cols.filter((c) => !HEAD_COLS.includes(c) && !HIDDEN.includes(c));
  const block = doc.blocks[shot.actionBlockId];
  const ticks = seq?.shotIds ?? [];
  return (
    <>
      <header className={s.top}>
        <button type="button" className={s.seq} disabled={readOnly} onClick={() => onOpen({ kind: 'sequence' })} aria-label={`Séquence ${sequenceNumber(doc, shot.sequenceId)}, plan ${code}`} data-testid="mobile-seq">
          <b>{sequenceNumber(doc, shot.sequenceId)}</b>
          {seq?.label.trim() && (
            <>
              <span className={s.d}>·</span>
              <b className={s.label}>{seq.label}</b>
            </>
          )}
          <span className={s.d}>·</span>
          <span className={s.pn} data-testid="mobile-code">
            {code}
          </span>
        </button>
        <div className={s.icons}>
          <button type="button" className={s.btn} onClick={onOverview} aria-label="Vue d’ensemble" data-testid="mobile-overview">
            <List size={22} strokeWidth={1.4} />
          </button>
          {!readOnly && (
            <button type="button" className={s.btn} onClick={() => setMenu(!menu)} aria-label="Plus" aria-expanded={menu} data-testid="mobile-more">
              <MoreHorizontal size={22} strokeWidth={1.4} />
            </button>
          )}
          {menu && (
            <>
              <div className={s.menuScrim} onClick={() => setMenu(false)} aria-hidden="true" />
              <div className={s.menu} role="menu">
                <button type="button" role="menuitem" onClick={() => (setMenu(false), onDuplicate())}>
                  <Copy size={18} strokeWidth={1.4} /> Dupliquer le plan
                </button>
                <button type="button" role="menuitem" onClick={() => (setMenu(false), onDelete())}>
                  <Trash2 size={18} strokeWidth={1.4} /> Supprimer le plan
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {img && (
        <div className={s.frame} style={{ aspectRatio: String(aspectRatio(doc.project.settings.storyboardAspect)) }}>
          <img src={img} alt="" style={shot.storyboard ? cropStyle(shot.storyboard) : undefined} />
        </div>
      )}
      <div className={s.pos} aria-label={tc ? `Plan ${ticks.indexOf(shotId) + 1} sur ${ticks.length}, ${tc}` : undefined}>
        {ticks.map((id) => (
          <u key={id} className={id === shotId ? s.on : ''} />
        ))}
        {tc && <em>{tc}</em>}
      </div>

      <section className={s.lead}>
        <button
          type="button"
          className={[s.title, title ? '' : s.empty].join(' ')}
          data-len={len}
          disabled={!editable(titleCol)}
          onClick={() => openHead(titleCol)}
          data-mobile-title
          data-field={titleCol}
        >
          {title || fieldLabel(titleCol)}
        </button>
        {sub.length > 0 && (
          <p className={s.sub}>
            {/* Le point reste avec ce qui le suit : jamais seul en bout de ligne. */}
            {sub.map((node, k) => (
              <Fragment key={k}>
                {k > 0 && ' '}
                <span className={s.nw}>
                  {k > 0 && <span className={s.s}>·</span>}
                  {node}
                </span>
              </Fragment>
            ))}
          </p>
        )}
      </section>

      <div className={s.fields}>
        {rows.map((c) => (
          <button
            key={c}
            type="button"
            className={s.field}
            disabled={!editable(c)}
            data-field={c}
            onClick={() => onOpen(c === 'movement' ? { kind: 'movement' } : c === 'action' ? { kind: 'action' } : { kind: 'text', col: c, label: fieldLabel(c) })}
          >
            <span className={s.dt}>{fieldLabel(c)}</span>
            {c === 'movement' ? (
              <Movement tokens={shot.movement} sep={shot.movementSep} />
            ) : (
              <span className={[s.dd, c === 'action' && block?.scenarioAnchor && block.text ? s.quote : ''].join(' ')}>{editableText(doc, shotId, c) || <span className={s.empty}>—</span>}</span>
            )}
          </button>
        ))}
      </div>

      <footer className={s.foot}>
        <button type="button" className={s.nav} disabled={!prev} onClick={() => prev && onGo(prev)} aria-label="Plan précédent" data-testid="mobile-prev">
          <ChevronLeft size={22} strokeWidth={1.4} />
          {prev && shotCode(doc, prev)}
        </button>
        {!readOnly && (
          <button type="button" className={s.add} onClick={onAdd} aria-label="Nouveau plan" data-testid="mobile-add-shot">
            <Plus size={22} strokeWidth={1.3} />
          </button>
        )}
        <button type="button" className={[s.nav, s.r].join(' ')} disabled={!next} onClick={() => next && onGo(next)} aria-label="Plan suivant" data-testid="mobile-next">
          <ChevronRight size={22} strokeWidth={1.4} />
          {next && shotCode(doc, next)}
        </button>
      </footer>
    </>
  );
}

/** Mouvement : en toutes lettres (« Travelling arrière, puis zoom avant »), ses pictogrammes au bout. */
function Movement({ tokens, sep }: { tokens: string[]; sep?: string }) {
  const phrase = movementPhrase(tokens, sep);
  return (
    <span className={[s.dd, s.mv].join(' ')}>
      <span>
        {phrase.length
          ? phrase.map((p, k) => (
              <Fragment key={k}>
                {p.joiner === 'puis' ? ', ' : p.joiner ? ' ' : ''}
                {p.joiner && <i>{p.joiner} </i>}
                {p.text}
              </Fragment>
            ))
          : <span className={s.empty}>—</span>}
      </span>
      <b>
        {tokens.map((t, k) => {
          const tile = tileOf(t);
          return tile ? <MovementIcon key={k} tile={tile.key} way={movementKey(t)} className={s.icon} /> : null;
        })}
      </b>
    </span>
  );
}
