import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { setCellText } from '../../../domain/cells';
import { AXIS_CHOICES, HEIGHT_CHOICES, angleParts, focalScale, focalText, pickFocal, sameTerm, setAnglePart } from '../../../domain/phoneCut';
import type { ColumnKey, Focal, ID, ProjectDoc } from '../../../domain/types';
import { ANGLES, matchVocab, vocabularyFor } from '../../../domain/vocabulary';
import { mutateDoc } from '../../../store/projectStore';
import { Sheet, sheetStyles as s } from './Sheet';

const ROW = 50;

/**
 * Feuille Valeur : la roue des valeurs de cadre (du plus large au plus serré), puis l'angle (axe,
 * hauteur) et la focale, chacun seulement si sa colonne est affichée. Tout est écrit en une fois.
 */
export function ValueSheet({ doc, shotId, cols, onClose }: { doc: ProjectDoc; shotId: ID; cols: readonly ColumnKey[]; onClose: () => void }) {
  const shot = doc.shots[shotId];
  const [value, setValue] = useState(shot.value);
  const [angle, setAngle] = useState<string[]>(shot.angle);
  const [focal, setFocal] = useState<Focal>(shot.focal);
  const values = useMemo(() => {
    const list = vocabularyFor('value', doc.customVocabulary).map((e) => e.short);
    // Une valeur saisie hors vocabulaire garde sa place dans la roue (en fin de liste).
    const known = matchVocab(shot.value, vocabularyFor('value', doc.customVocabulary));
    return shot.value.trim() && !known ? [...list, shot.value.trim()] : list;
  }, [doc.customVocabulary, shot.value]);
  const custom = vocabularyFor('value', doc.customVocabulary);
  const index = values.findIndex((v) => v === value || (matchVocab(value, custom) && matchVocab(value, custom)?.short === v));

  const done = useCallback(() => {
    const angleText = angle.join(', ');
    mutateDoc((d) => {
      if (value !== shot.value) setCellText(d, shotId, 'value', value);
      if (cols.includes('angle') && angleText !== shot.angle.join(', ')) setCellText(d, shotId, 'angle', angleText);
      if (cols.includes('focal') && focalText(focal) !== focalText(shot.focal)) setCellText(d, shotId, 'focal', focalText(focal));
    });
    onClose();
  }, [angle, cols, focal, onClose, shot, shotId, value]);

  const parts = angleParts(angle);
  return (
    <Sheet label="Valeur" onDone={done} testId="sheet-value">
      <Wheel values={values} index={index} onPick={(i) => setValue(i < 0 ? '' : values[i])} />
      {cols.includes('angle') && (
        <>
          <Options
            label="angle"
            items={AXIS_CHOICES.map((e) => ({ key: e.key, label: e.short, on: sameTerm(parts.axis, e, ANGLES) }))}
            onPick={(k, on) => setAngle(setAnglePart(angle, 'axis', on ? undefined : AXIS_CHOICES.find((e) => e.key === k)!.short))}
          />
          <Options
            label="hauteur"
            items={HEIGHT_CHOICES.map((e) => ({ key: e.key, label: e.short, on: sameTerm(parts.height, e, ANGLES) }))}
            onPick={(k, on) => setAngle(setAnglePart(angle, 'height', on ? undefined : HEIGHT_CHOICES.find((e) => e.key === k)!.short))}
          />
        </>
      )}
      {cols.includes('focal') && (
        <Options
          label="focale"
          mm
          items={focalScale(focal).map((mm) => ({ key: String(mm), label: String(mm), on: mm === focal.from || mm === focal.to }))}
          onPick={(k) => setFocal(pickFocal(focal, Number(k)))}
        />
      )}
    </Sheet>
  );
}

/** Rangée d'options à toucher ; la choisie se souligne. */
export function Options({ label, items, onPick, mm }: { label: string; items: Array<{ key: string; label: string; on: boolean }>; onPick: (key: string, on: boolean) => void; mm?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // L'option choisie se montre à l'ouverture, même au bout de la rangée.
  useLayoutEffect(() => {
    const on = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (on && ref.current && on.offsetLeft + on.offsetWidth > ref.current.clientWidth - 40) ref.current.scrollLeft = on.offsetLeft - 60;
  }, []);
  return (
    <div className={s.opt} role="group" aria-label={label}>
      <span>{label}</span>
      <div ref={ref} className={[s.row, mm ? s.mm : ''].join(' ')}>
        {items.map((it) => (
          <button key={it.key} type="button" className={it.on ? s.on : ''} aria-pressed={it.on} onClick={() => onPick(it.key, it.on)}>
            {it.label}
          </button>
        ))}
        {mm && <small>mm</small>}
      </div>
    </div>
  );
}

/**
 * Roue typographique : la valeur au centre, grande ; les voisines s'effacent. On la fait tourner du
 * doigt (elle s'arrête sur une valeur) ou on touche une valeur. Toucher celle du centre l'efface.
 */
function Wheel({ values, index, onPick }: { values: string[]; index: number; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const timer = useRef<number>();
  // Sans valeur, la roue s'ouvre au milieu de l'échelle, rien n'étant choisi.
  const start = index >= 0 ? index : Math.floor(values.length / 2);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = start * ROW;
    // À l'ouverture seulement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onScroll = () => {
    if (!touched.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ROW)));
      if (i !== index) onPick(i);
    }, 90);
  };
  const user = () => (touched.current = true);
  return (
    <div className={s.wheelBox}>
      <div ref={ref} className={s.wheel} onScroll={onScroll} onTouchStart={user} onWheel={user} onPointerDown={user} role="listbox" aria-label="Valeur">
        {values.map((v, i) => {
          const d = index < 0 ? 3 : Math.abs(i - index);
          return (
            <button
              key={v}
              type="button"
              role="option"
              aria-selected={i === index}
              className={d === 0 ? s.on : d === 1 ? s.n1 : d === 2 ? s.n2 : ''}
              onClick={() => {
                touched.current = false;
                if (i === index) return onPick(-1);
                onPick(i);
                ref.current?.scrollTo({ top: i * ROW, behavior: 'smooth' });
              }}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div className={s.band} aria-hidden="true" />
    </div>
  );
}
