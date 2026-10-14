import { formatTc } from '../../domain/timecode';
import { formatGap, type Timing } from '../../domain/timing';
import s from './GridFooter.module.css';

interface Props {
  sequences: number;
  shots: number;
  timing: Timing;
  mode: 'cumulatif' | 'piste';
}

/** Ligne de total permanente (§4.6). */
export function GridFooter({ sequences, shots, timing, mode }: Props) {
  const gap = timing.totalGap;
  return (
    <div className={s.footer} data-testid="grid-footer">
      <span>
        <b>{sequences}</b> séquence{sequences > 1 ? 's' : ''}
      </span>
      <span className={s.dot}>·</span>
      <span>
        <b>{shots}</b> plan{shots > 1 ? 's' : ''}
      </span>
      <span className={s.dot}>·</span>
      <span>
        {mode === 'piste' ? 'piste' : 'durée calculée'} <b className={s.tc} data-testid="total-calc">{formatTc(timing.totalSec)}</b>
      </span>
      {mode === 'piste' && timing.coveragePct !== undefined && (
        <>
          <span className={s.dot}>·</span>
          <span>
            couverture <b className={s.tc}>{Math.round(timing.coveragePct)} %</b>
          </span>
        </>
      )}
      <span className={s.dot}>·</span>
      <span>
        estimée <b className={s.tc}>{timing.totalEstimatedSec ? formatTc(timing.totalEstimatedSec) : '—'}</b>
      </span>
      {gap && (
        <>
          <span className={s.dot}>·</span>
          <span className={[s.gap, s[gap.level]].join(' ')}>écart {formatGap(gap)}</span>
        </>
      )}
    </div>
  );
}
