import { Fragment, useCallback, useState } from 'react';
import { setCellText } from '../../../domain/cells';
import { focalScale, focalText, MOVEMENT_TILES, movementKey, movementPhrase, pickZoomFocal, setWay, tileOf, toggleTile } from '../../../domain/phoneCut';
import type { ColumnKey, Focal, ID, ProjectDoc } from '../../../domain/types';
import { isZoom } from '../../../domain/vocabulary';
import { mutateDoc } from '../../../store/projectStore';
import { MovementIcon } from './movementIcons';
import { Sheet, sheetStyles as s } from './Sheet';
import { Options } from './ValueSheet';

/**
 * Feuille Mouvement : la suite des mouvements en toutes lettres, l'échelle des focales dès qu'un zoom
 * est choisi (départ puis arrivée), les pictogrammes numérotés dans l'ordre et, pour un mouvement qui
 * en a, son sens.
 */
export function MovementSheet({ doc, shotId, cols, onClose }: { doc: ProjectDoc; shotId: ID; cols: readonly ColumnKey[]; onClose: () => void }) {
  const shot = doc.shots[shotId];
  const [tokens, setTokens] = useState<string[]>(shot.movement);
  const [focal, setFocal] = useState<Focal>(shot.focal);
  const sep = shot.movementSep ?? ', ';

  const done = useCallback(() => {
    const text = tokens.join(sep);
    mutateDoc((d) => {
      if (text !== shot.movement.join(sep)) setCellText(d, shotId, 'movement', text);
      if (cols.includes('focal') && focalText(focal) !== focalText(shot.focal)) setCellText(d, shotId, 'focal', focalText(focal));
    });
    onClose();
  }, [cols, focal, onClose, sep, shot, shotId, tokens]);

  const phrase = movementPhrase(tokens, sep);
  const zoom = isZoom(tokens) && cols.includes('focal');
  const scale = focalScale(focal);
  const order = (tile: string) => tokens.findIndex((t) => tileOf(t)?.key === tile);
  const withWays = MOVEMENT_TILES.filter((t) => t.ways && order(t.key) >= 0);
  return (
    <Sheet label="Mouvement" onDone={done} testId="sheet-movement">
      <p className={s.chain} data-testid="movement-chain">
        {phrase.length ? (
          phrase.map((p, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {p.joiner && <span>{p.joiner} </span>}
              {p.text}
            </Fragment>
          ))
        ) : (
          <span className={s.none}>—</span>
        )}
      </p>
      {zoom && <FocalRange scale={scale} focal={focal} onPick={(mm) => setFocal(pickZoomFocal(focal, mm))} />}
      <div className={s.grid}>
        {MOVEMENT_TILES.map((t) => {
          const k = order(t.key);
          return (
            <button key={t.key} type="button" className={[s.cell, k >= 0 ? s.on : ''].join(' ')} aria-pressed={k >= 0} onClick={() => setTokens(toggleTile(tokens, t.key))}>
              {k >= 0 && tokens.length > 1 && <em>{k + 1}</em>}
              <MovementIcon tile={t.key} way={k >= 0 ? movementKey(tokens[k]) : undefined} />
              <b>{t.label}</b>
            </button>
          );
        })}
      </div>
      {withWays.map((t) => {
        const current = movementKey(tokens[order(t.key)]);
        return (
          <Options
            key={t.key}
            label={t.label.toLocaleLowerCase('fr')}
            items={t.ways!.map((w) => ({ key: w.key, label: w.label, on: current === w.key }))}
            onPick={(k, on) => setTokens(setWay(tokens, t.key, on ? undefined : k))}
          />
        );
      })}
    </Sheet>
  );
}

/** Échelle des focales d'un zoom : départ et arrivée, reliés par une flèche. */
function FocalRange({ scale, focal, onPick }: { scale: number[]; focal: Focal; onPick: (mm: number) => void }) {
  const a = focal.from !== undefined ? scale.indexOf(focal.from) : -1;
  const b = focal.to !== undefined ? scale.indexOf(focal.to) : -1;
  const at = (i: number) => `${((i + 0.5) / scale.length) * 100}%`;
  return (
    <div className={s.range} role="group" aria-label="Focales du zoom" data-testid="zoom-range">
      <div className={s.scale} style={{ '--n': scale.length } as React.CSSProperties}>
        {scale.map((mm, i) => (
          <button key={mm} type="button" className={i === a || i === b ? s.on : ''} aria-pressed={i === a || i === b} onClick={() => onPick(mm)}>
            {mm}
          </button>
        ))}
        <small>mm</small>
      </div>
      <div className={s.arrow} aria-hidden="true">
        {a >= 0 && b >= 0 && (
          <i className={b < a ? s.back : ''} style={{ left: at(Math.min(a, b)), width: `calc(${at(Math.max(a, b))} - ${at(Math.min(a, b))})` }} />
        )}
      </div>
    </div>
  );
}
