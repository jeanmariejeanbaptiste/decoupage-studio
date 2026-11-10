import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { autoEndDate, CALENDAR_KINDS, shiftStart, type CalendarKind, type EventFields } from '../../domain/calendar';
import { daysBetween } from '../../domain/production';
import { Button } from '../../ui/Button';
import m from '../../ui/Modal.module.css';
import s from './CalendarPage.module.css';

interface Props {
  initial: EventFields;
  /** Rendez-vous existant : on peut le supprimer. */
  existing?: boolean;
  onSave: (f: EventFields) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** Lecture seule : la fenêtre se lit (horaire, note), rien ne s'écrit. */
  readOnly?: boolean;
}

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';
const same = (a: EventFields, b: EventFields) => (Object.keys(a) as Array<keyof EventFields>).every((k) => a[k] === b[k]);

/** Création ou modification d'un rendez-vous du projet. */
export function EventDialog({ initial, existing, onSave, onDelete, onClose, readOnly }: Props) {
  const [f, setF] = useState<EventFields>(initial);
  const set = (patch: Partial<EventFields>) => setF((x) => ({ ...x, ...patch }));
  const form = useRef<HTMLFormElement>(null);
  // À la fermeture, le focus revient là d'où la fenêtre a été ouverte (lu avant le focus du titre).
  const [back] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    if (readOnly) form.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (back?.isConnected) back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Tab et Maj+Tab restent dans la fenêtre.
  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !form.current) return;
    const list = [...form.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const inside = form.current.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    // Un clic à côté ne fait pas perdre une saisie : il ne ferme que la fenêtre restée telle quelle.
    // Le focus reste dans la fenêtre (Échap y reste actif).
    <div
      className={m.backdrop}
      onMouseDown={(e) => {
        e.preventDefault();
        if (readOnly || same(f, initial)) onClose();
      }}
    >
      <form
        ref={form}
        className={[m.modal, s.dialog].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'Événement' : 'Nouvel événement'}
        data-testid="event-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          trap(e);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!readOnly) onSave(f);
        }}
      >
        <fieldset className={s.dFields} disabled={readOnly}>
          <input className={s.dTitle} value={f.title} placeholder={existing ? 'Sans titre' : 'Nouvel événement'} aria-label="Titre" autoFocus={!readOnly} onChange={(e) => set({ title: e.target.value })} data-testid="event-title" />
          <div className={s.dRow}>
            <span>Date</span>
            <input type="date" value={f.date} required aria-label="Date" onChange={(e) => e.target.value && setF((x) => shiftStart(x, { date: e.target.value }))} data-testid="event-date" />
            <label className={s.dCheck}>
              <input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked, endDate: e.target.checked ? f.date : autoEndDate(f.date, f.start, f.end) })} data-testid="event-allday" />
              Journée entière
            </label>
          </div>
          <div className={s.dRow}>
            {f.allDay ? (
              <>
                <span>Jusqu’au</span>
                <input type="date" value={f.endDate} min={f.date} aria-label="Dernier jour" onChange={(e) => set({ endDate: e.target.value || f.date })} />
              </>
            ) : (
              <>
                <span>Horaire</span>
                <input type="time" value={f.start} aria-label="Début" required onChange={(e) => e.target.value && setF((x) => shiftStart(x, { start: e.target.value }))} data-testid="event-start" />
                <span className={s.dDash}>–</span>
                <input type="time" value={f.end} aria-label="Fin" required onChange={(e) => set({ end: e.target.value, endDate: autoEndDate(f.date, f.start, e.target.value) })} data-testid="event-end" />
                {f.endDate > f.date && (
                  <span className={s.dDash} data-testid="event-next-day">
                    +{daysBetween(f.date, f.endDate)} j
                  </span>
                )}
              </>
            )}
          </div>
          <div className={s.dRow}>
            <span>Type</span>
            <select value={f.kind} aria-label="Type" onChange={(e) => set({ kind: e.target.value as CalendarKind })}>
              {CALENDAR_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          {(!readOnly || f.note) && <textarea className={s.dNote} rows={3} value={f.note} placeholder="Note" aria-label="Note" onChange={(e) => set({ note: e.target.value })} />}
        </fieldset>
        <div className={[m.actions, s.dActions].join(' ')}>
          {readOnly ? (
            <Button variant="ghost" onClick={onClose} data-testid="event-close">
              Fermer
            </Button>
          ) : (
            <>
              {existing && onDelete && (
                <Button variant="ghost" className={s.dDelete} onClick={onDelete} data-testid="event-delete">
                  Supprimer
                </Button>
              )}
              <Button variant="ghost" onClick={onClose}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" data-testid="event-save">
                {existing ? 'Enregistrer' : 'Ajouter'}
              </Button>
            </>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
