import { useEffect, useMemo, useRef, useState } from 'react';
import { interviewDocument } from '../../domain/documents';
import { ArrowDown, ArrowUp, Check, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useBlobUrl } from '../../ui/useBlobUrl';
import { getBlob, putBlob } from '../../store/db';
import { newId } from '../../domain/factory';
import { addInterviewee, addSetup, ensureInterview, moveQuestion, maxSetupNumber, placeSetup, questionsFor, setSetupNumber, setupNumber, removeInterviewee, removeSetup, setupShotIds, type Interviewee, type InterviewSetup } from '../../domain/interview';
import { shotCode } from '../../domain/numbering';
import { useUi } from '../../store/uiStore';
import { fileNameFor } from '../../domain/serialize';
import { ExportPanel } from '../export/ExportPanel';
import { exportDocumentPages } from '../export/imageExport';
import type { ID, ProjectDoc } from '../../domain/types';
import { useProjectStore, mutateDoc } from '../../store/projectStore';
import { useReadOnly } from '../../store/share';
import s from './InterviewPanel.module.css';

/**
 * Institutionnel, A-roll : la fiche d'interview. Un intervenant à la fois (onglets si plusieurs),
 * avec ce qui se prépare réellement avant de tourner : dispositif caméra, regard, son, décor et
 * lumière, questions et réponses attendues ; plusieurs cadres possibles par personne.
 */
export function InterviewPanel({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const itw = doc.interview;
  const subjects = itw?.subjects ?? [];
  const [picked, setPicked] = useState<ID | undefined>(subjects[0]?.id);
  const subject = subjects.find((x) => x.id === picked) ?? subjects[0];
  const [pickedSetup, setPickedSetup] = useState<ID | undefined>();
  const setup = subject?.setups?.find((x) => x.id === pickedSetup) ?? subject?.setups?.[0];
  // Ouverture depuis la bande du découpage : cet intervenant, ce cadre.
  const focus = useUi((u) => u.itwFocus);
  useEffect(() => {
    if (!focus) return;
    setPicked(focus.subjectId);
    setPickedSetup(focus.setupId);
    useUi.getState().set({ itwFocus: null });
  }, [focus]);

  // L'interview existe dès qu'on ouvre l'onglet (un intervenant par défaut). Création hors historique :
  // annuler / rétablir ne doivent ni la défaire ni la recréer.
  useEffect(() => {
    if (readOnly || (doc.interview?.subjects?.length && !doc.interview.subjects.some((x) => !Array.isArray(x.setups)))) return;
    const t = useProjectStore.temporal.getState();
    t.pause();
    try {
      mutateDoc((d) => void ensureInterview(d));
    } finally {
      t.resume();
    }
  }, [doc.interview, readOnly]);
  if (!itw || !subject || !setup) return null;

  const edit = (fn: (x: Interviewee) => void) => mutateDoc((d) => void fn(d.interview!.subjects.find((x) => x.id === subject.id)!));
  const editSetup = (fn: (x: InterviewSetup) => void) =>
    edit((x) => void fn(x.setups.find((y) => y.id === setup.id)!));
  const questions = questionsFor(itw, subject.id, setup.id);
  // Cadre placé dans le découpage : ses plans (un par caméra), tels que numérotés.
  const placedIds = setupShotIds(doc, setup.id);
  const placedSeq = placedIds.length ? doc.shots[placedIds[0]].sequenceId : undefined;
  const placedNumber = placedIds.length ? setupNumber(doc, setup.id) : undefined;
  const maxNumber = placedSeq ? maxSetupNumber(doc, setup.id, placedSeq) : 1;
  const placedCodes = placedIds.length ? `Plan${placedIds.length > 1 ? 's' : ''} ${placedIds.map((id) => shotCode(doc, id)).join(', ')}` : '';
  const shared = subjects.length > 1;
  const multi = subject.setups.length > 1;
  // Portée d'une question : commune → cet intervenant → ce cadre (si plusieurs cadres) → commune.
  const nextScope = (q: { subjectId?: ID; setupId?: ID }): { subjectId?: ID; setupId?: ID } => {
    if (!q.subjectId) return { subjectId: subject.id };
    if (!q.setupId && multi) return { subjectId: subject.id, setupId: setup.id };
    return shared ? {} : { subjectId: subject.id };
  };
  const scopeLabel = (q: { subjectId?: ID; setupId?: ID }) => (q.setupId ? 'Ce cadre' : q.subjectId ? (shared ? 'Cet intervenant' : 'Tous ses cadres') : 'Commune à tous');
  const canScope = shared || multi;

  return (
    <div className={s.wrap} data-testid="interview">
      <nav className={s.people} aria-label="Intervenants">
        {subjects.map((x, i) => (
          <button key={x.id} type="button" className={x.id === subject.id ? s.on : ''} onClick={() => (setPicked(x.id), setPickedSetup(undefined))}>
            {x.name || `Intervenant ${i + 1}`}
          </button>
        ))}
        {!readOnly && (
          <button type="button" className={s.add} onClick={() => (setPicked(mutateDoc((d) => addInterviewee(d))), setPickedSetup(undefined))} data-testid="add-interviewee">
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
            <Field label="Notes" value={subject.notes ?? ''} multiline onCommit={(v) => edit((x) => void (x.notes = v || undefined))} readOnly={readOnly} />
            {subjects.length > 1 && !readOnly && (
              <button type="button" className={s.ghost} onClick={() => mutateDoc((d) => removeInterviewee(d, subject.id))}>
                <Trash2 size={13} /> Retirer cet intervenant
              </button>
            )}
          </section>

          <section className={s.card}>
            <nav className={s.setups} aria-label="Cadres">
              {subject.setups.map((y) => (
                <button key={y.id} type="button" className={y.id === setup.id ? s.on : ''} onClick={() => setPickedSetup(y.id)}>
                  {y.name}
                </button>
              ))}
              {!readOnly && (
                <button type="button" className={s.add} onClick={() => setPickedSetup(mutateDoc((d) => addSetup(d, subject.id, setup.id)))} data-testid="add-setup">
                  <Plus size={14} /> Cadre
                </button>
              )}
            </nav>
            <Field label="Nom du cadre" value={setup.name} onCommit={(v) => editSetup((x) => void (x.name = v.trim() || x.name))} readOnly={readOnly} placeholder="Au bureau, debout dans l’atelier…" />
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
                  <button key={v} type="button" role="radio" aria-checked={setup.eyeline === v} className={setup.eyeline === v ? s.segOn : ''} disabled={readOnly} onClick={() => editSetup((x) => void (x.eyeline = v))}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {shared && setup.eyeline !== 'camera' && subjects.some((o) => o.id !== subject.id && o.setups.some((y) => y.eyeline === setup.eyeline)) && (
              <p className={s.warn}>Même regard qu’un autre intervenant : ils ne pourront pas se répondre au montage.</p>
            )}
            <div className={s.line}>
              <span>Découpage</span>
            </div>
            <div className={s.place} role="radiogroup" aria-label="Place dans le découpage" data-testid="setup-placement">
              <button type="button" role="radio" aria-checked={!placedSeq} className={!placedSeq ? s.placeOn : ''} disabled={readOnly} onClick={() => mutateDoc((d) => placeSetup(d, setup.id, undefined))}>
                Annexe seule
              </button>
              {doc.project.sequenceIds.map((id, k) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={placedSeq === id}
                  className={placedSeq === id ? s.placeOn : ''}
                  disabled={readOnly}
                  title={doc.sequences[id]?.label ? `Séquence ${k + 1} — ${doc.sequences[id].label.toUpperCase()}` : `Séquence ${k + 1}`}
                  onClick={() => placedSeq !== id && mutateDoc((d) => placeSetup(d, setup.id, id))}
                >
                  Séq. {k + 1}
                </button>
              ))}
              {!readOnly && (
                <button type="button" className={s.placeNew} onClick={() => mutateDoc((d) => placeSetup(d, setup.id, 'new'))} title="Une séquence à part pour ce cadre">
                  <Plus size={13} /> Séquence
                </button>
              )}
            </div>
            {placedSeq && placedNumber !== undefined && (
              <div className={s.line}>
                <span>Plan n°</span>
                <div className={s.stepper}>
                  <button type="button" aria-label="Plan précédent" disabled={readOnly || placedNumber <= 1} onClick={() => mutateDoc((d) => setSetupNumber(d, setup.id, placedNumber - 1))}>
                    −
                  </button>
                  <input
                    key={placedNumber}
                    defaultValue={placedNumber}
                    inputMode="numeric"
                    aria-label="Numéro du plan"
                    data-testid="setup-number"
                    readOnly={readOnly}
                    onBlur={(e) => {
                      const v = Math.max(1, Math.min(maxNumber, Math.round(Number(e.target.value) || placedNumber)));
                      if (v !== placedNumber) mutateDoc((d) => setSetupNumber(d, setup.id, v));
                      else e.target.value = String(placedNumber);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  <button type="button" aria-label="Plan suivant" disabled={readOnly || placedNumber >= maxNumber} onClick={() => mutateDoc((d) => setSetupNumber(d, setup.id, placedNumber + 1))}>
                    +
                  </button>
                </div>
              </div>
            )}
            {placedCodes && <p className={s.placed}>{placedCodes}</p>}
            {multi && !readOnly && (
              <button type="button" className={s.ghost} onClick={() => (mutateDoc((d) => removeSetup(d, subject.id, setup.id)), setPickedSetup(undefined))}>
                <Trash2 size={13} /> Retirer ce cadre
              </button>
            )}
          </section>
        </div>

        <div className={s.col}>
          <section className={s.card}>
            <h3>Dispositif caméra</h3>
            <div className={s.cams}>
              {setup.cameras.map((c, k) => (
                <div key={c.id} className={s.cam}>
                  <span className={s.camName}>{c.name}</span>
                  <Field label="Valeur" value={c.value} onCommit={(v) => editSetup((x) => void (x.cameras[k].value = v))} readOnly={readOnly} />
                  <Field label="Axe" value={c.angle} onCommit={(v) => editSetup((x) => void (x.cameras[k].angle = v))} readOnly={readOnly} />
                  <Field label="Focale (mm)" value={c.focal} onCommit={(v) => editSetup((x) => void (x.cameras[k].focal = v))} readOnly={readOnly} numeric />
                  {!readOnly && setup.cameras.length > 1 && (
                    <button type="button" className={s.iconBtn} aria-label={`Retirer la caméra ${c.name}`} onClick={() => editSetup((x) => void x.cameras.splice(k, 1))}>
                      <X size={13} />
                    </button>
                  )}
                  <CameraFrame projectId={doc.project.id} blobKey={c.frame} readOnly={readOnly} label={`Image du cadre ${c.name}`} onChange={(key) => editSetup((x) => void (x.cameras[k].frame = key))} />
                </div>
              ))}
            </div>
            {!readOnly && (
              <button
                type="button"
                className={s.ghost}
                onClick={() => editSetup((x) => void x.cameras.push({ id: newId(), name: cameraName(x.cameras.length), value: 'Large', angle: 'Face', focal: '24' }))}
              >
                <Plus size={13} /> Caméra
              </button>
            )}
          </section>

          <section className={s.card}>
            <h3>Lieu, lumière, son</h3>
            <Field label="Lieu" value={setup.place} onCommit={(v) => editSetup((x) => void (x.place = v))} readOnly={readOnly} placeholder="Bureau de la direction, 3e étage" />
            <Field label="Arrière-plan" value={setup.background} onCommit={(v) => editSetup((x) => void (x.background = v))} readOnly={readOnly} placeholder="Profondeur, bibliothèque floue, logo discret" />
            <Field label="Lumière" value={setup.light} onCommit={(v) => editSetup((x) => void (x.light = v))} readOnly={readOnly} placeholder="Face douce côté fenêtre, contre-jour léger" />
            <Field label="Son" value={setup.sound} onCommit={(v) => editSetup((x) => void (x.sound = v))} readOnly={readOnly} />
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
                    <Field
                      label="Réponse attendue"
                      value={q.expected ?? ''}
                      multiline
                      readOnly={readOnly}
                      placeholder="Idées clés, chiffre, anecdote…"
                      onCommit={(v) => mutateDoc((d) => void (d.interview!.questions.find((x) => x.id === q.id)!.expected = v.trim() || undefined))}
                    />
                    {canScope && !readOnly && (
                      <button
                        type="button"
                        className={s.scope}
                        onClick={() => mutateDoc((d) => void Object.assign(d.interview!.questions.find((x) => x.id === q.id)!, { subjectId: undefined, setupId: undefined }, nextScope(q)))}
                        title="Portée de la question"
                      >
                        {scopeLabel(q)}
                      </button>
                    )}
                  </div>
                  {!readOnly && (
                    <span className={s.qTools}>
                      <button type="button" aria-label="Monter" disabled={k === 0} onClick={() => mutateDoc((d) => moveQuestion(d.interview!, subject.id, q.id, -1, setup.id))}>
                        <ArrowUp size={13} />
                      </button>
                      <button type="button" aria-label="Descendre" disabled={k === questions.length - 1} onClick={() => mutateDoc((d) => moveQuestion(d.interview!, subject.id, q.id, 1, setup.id))}>
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
          </section>

        </div>
      </div>
    </div>
  );
}

/** A, B… Z, puis AA, AB… */
function cameraName(i: number): string {
  return (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
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

const orientationOf = (doc: ProjectDoc) => doc.project.settings.exportPrefs?.interview?.orientation ?? 'landscape';

/** Export de la fiche d'interview (annexe du découpage) : PDF ou images, en paysage ou en portrait. */
export function InterviewExport({ doc }: { doc: ProjectDoc }) {
  const base = fileNameFor(doc).replace(/\.decoupage$/, '');
  return (
    <ExportPanel
      doc={doc}
      id="interview"
      title="Exporter la fiche d’interview"
      onExport={async ({ format, orientation, numbers }) => {
        try {
          const cur = useProjectStore.getState().doc ?? doc;
          await exportDocumentPages(await withFrames(interviewDocument(cur, orientation).html), `${base}-interview-A4-${orientation === 'portrait' ? 'portrait' : 'paysage'}`, { format: format as 'pdf' | 'images', orientation, numbers });
        } catch (err) {
          useUi.getState().toast({ message: `Export impossible : ${(err as Error).message}`, tone: 'warn' });
        }
      }}
    />
  );
}

/** Aperçu de la fiche d'interview, telle qu'elle sera exportée (document isolé, hauteur ajustée). */
export function InterviewPreview({ doc }: { doc: ProjectDoc }) {
  const orientation = orientationOf(doc);
  const raw = useMemo(() => interviewDocument(doc, orientation).html, [doc, orientation]);
  const [html, setHtml] = useState(raw);
  useEffect(() => {
    let alive = true;
    void withFrames(raw).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [raw]);
  const ref = useRef<HTMLIFrameElement>(null);
  const fit = () => {
    const f = ref.current;
    const h = f?.contentDocument?.documentElement.scrollHeight;
    if (f && h) f.style.height = `${h}px`;
  };
  useEffect(fit, [html]);
  return <iframe ref={ref} className={[s.preview, orientation === 'portrait' ? s.previewPortrait : ''].join(' ')} srcDoc={html} title="Fiche d’interview" onLoad={fit} data-testid="interview-preview" />;
}

/** Storyboard du cadre : une image par caméra (déposée ou choisie), reprise dans la fiche exportée. */
function CameraFrame({ projectId, blobKey, readOnly, label, onChange }: { projectId: string; blobKey?: string; readOnly: boolean; label: string; onChange: (key: string | undefined) => void }) {
  const url = useBlobUrl(blobKey);
  const input = useRef<HTMLInputElement>(null);
  const take = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    onChange(await putBlob(projectId, file.name, file));
  };
  return (
    <div className={s.frame}>
      <button
        type="button"
        className={s.frameBox}
        disabled={readOnly}
        aria-label={label}
        title={url ? 'Changer l’image (ou déposer un fichier)' : 'Choisir une image (ou déposer un fichier)'}
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void take(e.dataTransfer.files[0]);
        }}
        data-testid="camera-frame"
      >
        {url ? <img src={url} alt="" /> : (
          <>
            <ImagePlus size={14} strokeWidth={1.3} /> Image du cadre
          </>
        )}
      </button>
      {url && !readOnly && (
        <button type="button" className={s.frameDel} aria-label={`Retirer ${label.toLowerCase()}`} onClick={() => onChange(undefined)}>
          <X size={11} />
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void take(e.target.files?.[0])} />
    </div>
  );
}

/** Images des cadres (clés de la base) remplacées par leur contenu, pour l'aperçu et l'export. */
async function withFrames(html: string): Promise<string> {
  let out = html;
  for (const key of new Set([...html.matchAll(/data-blob="([^"]+)"/g)].map((m) => m[1]))) {
    const b = await getBlob(key);
    if (!b) continue;
    const data = await new Promise<string>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.readAsDataURL(b);
    });
    out = out.split(`data-blob="${key}"`).join(`src="${data}"`);
  }
  return out;
}
