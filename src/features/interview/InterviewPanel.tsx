import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, Trash2, X } from 'lucide-react';
import { newId } from '../../domain/factory';
import { addInterviewee, CHECKLIST, ensureInterview, moveQuestion, questionsFor, removeInterviewee, type Interviewee } from '../../domain/interview';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { useReadOnly } from '../../store/share';
import s from './InterviewPanel.module.css';

/**
 * Institutionnel, A-roll : la fiche d'interview. Un intervenant à la fois (onglets si plusieurs),
 * avec ce qui se prépare réellement avant de tourner : dispositif caméra, regard, son, décor et
 * lumière, questions, vérifications.
 */
export function InterviewPanel({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const itw = doc.interview;
  const subjects = itw?.subjects ?? [];
  const [picked, setPicked] = useState<ID | undefined>(subjects[0]?.id);
  const subject = subjects.find((x) => x.id === picked) ?? subjects[0];

  // L'interview existe dès qu'on ouvre l'onglet : un intervenant par défaut.
  useEffect(() => {
    if (!doc.interview?.subjects.length && !readOnly) mutateDoc((d) => void ensureInterview(d));
  }, [doc.interview, readOnly]);
  if (!itw || !subject) return null;

  const edit = (fn: (x: Interviewee) => void) => mutateDoc((d) => void fn(d.interview!.subjects.find((x) => x.id === subject.id)!));
  const questions = questionsFor(itw, subject.id);
  const shared = subjects.length > 1;

  return (
    <div className={s.wrap} data-testid="interview">
      <nav className={s.people} aria-label="Intervenants">
        {subjects.map((x, i) => (
          <button key={x.id} type="button" className={x.id === subject.id ? s.on : ''} onClick={() => setPicked(x.id)}>
            {x.name || `Intervenant ${i + 1}`}
          </button>
        ))}
        {!readOnly && (
          <button type="button" className={s.add} onClick={() => setPicked(mutateDoc((d) => addInterviewee(d)))} data-testid="add-interviewee">
            <Plus size={14} /> Intervenant
          </button>
        )}
      </nav>

      <div className={s.columns}>
        <div className={s.col}>
          <section className={s.card}>
            <h3>Intervenant</h3>
            <Field label="Nom" value={subject.name} onCommit={(v) => edit((x) => void (x.name = v))} readOnly={readOnly} placeholder="Prénom Nom" />
            <Field label="Fonction (synthé)" value={subject.role} onCommit={(v) => edit((x) => void (x.role = v))} readOnly={readOnly} placeholder="Directrice de la communication" />
            <div className={s.line}>
              <span>Regard</span>
              <div className={s.seg} role="radiogroup" aria-label="Regard">
                {(
                  [
                    ['gauche', 'À gauche'],
                    ['camera', 'Caméra'],
                    ['droite', 'À droite'],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={subject.eyeline === v} className={subject.eyeline === v ? s.segOn : ''} disabled={readOnly} onClick={() => edit((x) => void (x.eyeline = v))}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {shared && subject.eyeline !== 'camera' && subjects.some((o) => o.id !== subject.id && o.eyeline === subject.eyeline) && (
              <p className={s.warn}>Même regard qu’un autre intervenant : ils ne pourront pas se répondre au montage.</p>
            )}
            {subjects.length > 1 && !readOnly && (
              <button type="button" className={s.ghost} onClick={() => mutateDoc((d) => removeInterviewee(d, subject.id))}>
                <Trash2 size={13} /> Retirer cet intervenant
              </button>
            )}
          </section>

          <section className={s.card}>
            <h3>Dispositif caméra</h3>
            <div className={s.cams}>
              {subject.cameras.map((c, k) => (
                <div key={c.id} className={s.cam}>
                  <span className={s.camName}>{c.name}</span>
                  <Field label="Valeur" value={c.value} onCommit={(v) => edit((x) => void (x.cameras[k].value = v))} readOnly={readOnly} />
                  <Field label="Axe" value={c.angle} onCommit={(v) => edit((x) => void (x.cameras[k].angle = v))} readOnly={readOnly} />
                  <Field label="Focale (mm)" value={c.focal} onCommit={(v) => edit((x) => void (x.cameras[k].focal = v))} readOnly={readOnly} numeric />
                  {!readOnly && subject.cameras.length > 1 && (
                    <button type="button" className={s.iconBtn} aria-label={`Retirer la caméra ${c.name}`} onClick={() => edit((x) => void x.cameras.splice(k, 1))}>
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!readOnly && subject.cameras.length < 4 && (
              <button
                type="button"
                className={s.ghost}
                onClick={() => edit((x) => void x.cameras.push({ id: newId(), name: String.fromCharCode(65 + x.cameras.length), value: 'Large', angle: 'Face', focal: '24' }))}
              >
                <Plus size={13} /> Caméra
              </button>
            )}
          </section>

          <section className={s.card}>
            <h3>Lieu, lumière, son</h3>
            <Field label="Lieu" value={subject.place} onCommit={(v) => edit((x) => void (x.place = v))} readOnly={readOnly} placeholder="Bureau de la direction, 3e étage" />
            <Field label="Arrière-plan" value={subject.background} onCommit={(v) => edit((x) => void (x.background = v))} readOnly={readOnly} placeholder="Profondeur, bibliothèque floue, logo discret" />
            <Field label="Lumière" value={subject.light} onCommit={(v) => edit((x) => void (x.light = v))} readOnly={readOnly} placeholder="Face douce côté fenêtre, contre-jour léger" />
            <Field label="Son" value={subject.sound} onCommit={(v) => edit((x) => void (x.sound = v))} readOnly={readOnly} />
            <Field label="Notes" value={subject.notes ?? ''} multiline onCommit={(v) => edit((x) => void (x.notes = v || undefined))} readOnly={readOnly} />
          </section>
        </div>

        <div className={s.col}>
          <section className={s.card}>
            <h3>
              Questions <span className={s.count}>{questions.length}</span>
            </h3>
            <ol className={s.questions}>
              {questions.map((q, k) => (
                <li key={q.id} className={q.asked ? s.asked : ''}>
                  <button
                    type="button"
                    className={s.tick}
                    aria-pressed={!!q.asked}
                    aria-label={q.asked ? 'Question posée' : 'Marquer comme posée'}
                    disabled={readOnly}
                    onClick={() => mutateDoc((d) => void (d.interview!.questions.find((x) => x.id === q.id)!.asked = !q.asked))}
                  >
                    {q.asked ? <Check size={13} /> : k + 1}
                  </button>
                  <div className={s.qBody}>
                    <Field
                      label=""
                      value={q.text}
                      multiline
                      readOnly={readOnly}
                      onCommit={(v) => mutateDoc((d) => void (d.interview!.questions.find((x) => x.id === q.id)!.text = v))}
                    />
                    {shared && !readOnly && (
                      <button
                        type="button"
                        className={s.scope}
                        onClick={() => mutateDoc((d) => void (d.interview!.questions.find((x) => x.id === q.id)!.subjectId = q.subjectId ? undefined : subject.id))}
                        title="Commune : posée à tous les intervenants"
                      >
                        {q.subjectId ? 'Pour cet intervenant' : 'Commune à tous'}
                      </button>
                    )}
                  </div>
                  {!readOnly && (
                    <span className={s.qTools}>
                      <button type="button" aria-label="Monter" disabled={k === 0} onClick={() => mutateDoc((d) => moveQuestion(d.interview!, subject.id, q.id, -1))}>
                        <ArrowUp size={13} />
                      </button>
                      <button type="button" aria-label="Descendre" disabled={k === questions.length - 1} onClick={() => mutateDoc((d) => moveQuestion(d.interview!, subject.id, q.id, 1))}>
                        <ArrowDown size={13} />
                      </button>
                      <button type="button" aria-label="Supprimer la question" onClick={() => mutateDoc((d) => void (d.interview!.questions = d.interview!.questions.filter((x) => x.id !== q.id)))}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {!readOnly && (
              <button
                type="button"
                className={s.addQuestion}
                onClick={() => mutateDoc((d) => void d.interview!.questions.push({ id: newId(), text: '', subjectId: shared ? subject.id : undefined }))}
                data-testid="add-question"
              >
                <Plus size={14} /> Question
              </button>
            )}
            <p className={s.tip}>Des questions ouvertes (« Racontez… », « Comment… ») ; l’intervenant reprend la question dans sa réponse.</p>
          </section>

          <section className={s.card}>
            <h3>Avant de tourner</h3>
            <ul className={s.checklist}>
              {CHECKLIST.map(([key, label]) => {
                const on = subject.checked.includes(key);
                return (
                  <li key={key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={readOnly}
                        onChange={() => edit((x) => void (x.checked = on ? x.checked.filter((c) => c !== key) : [...x.checked, key]))}
                      />
                      {label}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Champ saisi d'un trait, enregistré en quittant le champ (une seule étape d'annulation). */
function Field({
  label,
  value,
  onCommit,
  readOnly,
  multiline,
  placeholder,
  numeric,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  readOnly?: boolean;
  multiline?: boolean;
  placeholder?: string;
  numeric?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const common = {
    value: draft,
    readOnly,
    placeholder: readOnly ? '' : placeholder,
    'aria-label': label || 'Question',
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (draft !== value) onCommit(draft);
    },
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
  };
  return (
    <label className={s.field}>
      {label && <span>{label}</span>}
      {multiline ? <textarea rows={Math.max(1, Math.ceil(draft.length / 60))} {...common} /> : <input {...common} inputMode={numeric ? 'decimal' : undefined} />}
    </label>
  );
}
