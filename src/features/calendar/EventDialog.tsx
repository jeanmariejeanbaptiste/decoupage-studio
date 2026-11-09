import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CALENDAR_KINDS, type CalendarKind, type EventFields } from '../../domain/calendar';
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
}

/** Création ou modification d'un rendez-vous du projet. */
export function EventDialog({ initial, existing, onSave, onDelete, onClose }: Props) {
  const [f, setF] = useState<EventFields>(initial);
  const set = (patch: Partial<EventFields>) => setF((x) => ({ ...x, ...patch }));
  return createPortal(
    <div className={m.backdrop} onMouseDown={onClose}>
      <form
        className={[m.modal, s.dialog].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'Événement' : 'Nouvel événement'}
        data-testid="event-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(f);
        }}
      >
        <input className={s.dTitle} value={f.title} placeholder={existing ? 'Sans titre' : 'Nouvel événement'} aria-label="Titre" autoFocus onChange={(e) => set({ title: e.target.value })} data-testid="event-title" />
        <div className={s.dRow}>
          <span>Date</span>
          <input
            type="date"
            value={f.date}
            required
            aria-label="Date"
            onChange={(e) => e.target.value && set({ date: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })}
            data-testid="event-date"
          />
          <label className={s.dCheck}>
            <input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} data-testid="event-allday" />
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
              <input type="time" value={f.start} aria-label="Début" required onChange={(e) => set({ start: e.target.value })} data-testid="event-start" />
              <span className={s.dDash}>–</span>
              <input type="time" value={f.end} aria-label="Fin" required onChange={(e) => set({ end: e.target.value })} data-testid="event-end" />
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
        <textarea className={s.dNote} rows={3} value={f.note} placeholder="Note" aria-label="Note" onChange={(e) => set({ note: e.target.value })} />
        <div className={[m.actions, s.dActions].join(' ')}>
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
        </div>
      </form>
    </div>,
    document.body,
  );
}
