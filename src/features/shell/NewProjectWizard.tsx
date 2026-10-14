import { useState } from 'react';
import { navigate } from '../../app/router';
import { createProjectDoc, defaultSettings } from '../../domain/factory';
import { previewDuration } from '../../domain/timing';
import { formatTc } from '../../domain/timecode';
import type { ProjectFormat, ProjectSettings } from '../../domain/types';
import { openDoc } from '../../store/persistence';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import s from './NewProjectWizard.module.css';

const FORMATS: Array<{ key: ProjectFormat; label: string; hint: string }> = [
  { key: 'fiction', label: 'Fiction', hint: 'minutage cumulatif' },
  { key: 'clip', label: 'Clip', hint: 'TC calé sur la piste' },
  { key: 'documentaire', label: 'Documentaire', hint: 'contrôle des plans larges' },
  { key: 'institutionnel', label: 'Institutionnel', hint: 'interviews' },
  { key: 'pub', label: 'Publicité', hint: 'TC calé sur la musique' },
];

const SAMPLE = 'Elle traverse le hall en tirant une valise cabossée dont une roue grince.';

/** Assistant en deux étapes : titre et format, puis réglages du minutage (§14 P5). */
export function NewProjectWizard({ onCancel }: { onCancel: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState('');
  const [director, setDirector] = useState('');
  const [format, setFormat] = useState<ProjectFormat>('fiction');
  const [timing, setTiming] = useState<Pick<ProjectSettings, 'tcMode' | 'tcGranularity' | 'actionWordsPerSecond' | 'dialogueWordsPerSecond' | 'minActionSeconds'>>(
    () => pick(defaultSettings('fiction')),
  );

  const chooseFormat = (f: ProjectFormat) => {
    setFormat(f);
    setTiming(pick(defaultSettings(f)));
  };

  const create = async () => {
    const doc = createProjectDoc({ title: title.trim() || 'Projet sans titre', format, director: director.trim() || undefined });
    Object.assign(doc.project.settings, timing);
    await openDoc(doc);
    navigate('grid');
  };

  const preview = previewDuration(SAMPLE, { ...defaultSettings(format), ...timing });

  return (
    <form
      noValidate
      className={['card', s.wizard].join(' ')}
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 1) setStep(2);
        else void create();
      }}
      aria-label="Nouveau projet"
      data-testid="wizard"
    >
      <p className={s.step}>
        <Hand>Étape {step} sur 2</Hand>
      </p>
      {step === 1 ? (
        <>
          <h2 className={s.h2}>Titre et format</h2>
          <label className={s.field}>
            <span>Titre du projet</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="La Consigne" name="title" />
          </label>
          <label className={s.field}>
            <span>Réalisation (facultatif)</span>
            <input value={director} onChange={(e) => setDirector(e.target.value)} name="director" />
          </label>
          <fieldset className={s.formats}>
            <legend>Format</legend>
            {FORMATS.map((f) => (
              <label key={f.key} className={[s.format, format === f.key ? s.on : ''].join(' ')}>
                <input type="radio" name="format" value={f.key} checked={format === f.key} onChange={() => chooseFormat(f.key)} />
                <strong>{f.label}</strong>
                <em>{f.hint}</em>
              </label>
            ))}
          </fieldset>
        </>
      ) : (
        <>
          <h2 className={s.h2}>Réglages du minutage</h2>
          <fieldset className={s.row}>
            <legend>Mode de TC</legend>
            <label>
              <input type="radio" checked={timing.tcMode === 'cumulatif'} onChange={() => setTiming({ ...timing, tcMode: 'cumulatif' })} /> Cumulatif
              (in – out enchaînés)
            </label>
            <label>
              <input type="radio" checked={timing.tcMode === 'piste'} onChange={() => setTiming({ ...timing, tcMode: 'piste' })} /> Piste (plages
              dans le morceau)
            </label>
          </fieldset>
          <fieldset className={s.row}>
            <legend>Granularité</legend>
            <label>
              <input type="radio" checked={timing.tcGranularity === 'sequence'} onChange={() => setTiming({ ...timing, tcGranularity: 'sequence' })} />{' '}
              Une plage par séquence
            </label>
            <label>
              <input type="radio" checked={timing.tcGranularity === 'action'} onChange={() => setTiming({ ...timing, tcGranularity: 'action' })} /> Une
              plage par action
            </label>
          </fieldset>
          <div className={s.numbers}>
            <NumberField label="Action (mots / s)" value={timing.actionWordsPerSecond} step={0.1} onChange={(v) => setTiming({ ...timing, actionWordsPerSecond: v })} />
            <NumberField label="Dialogue (mots / s)" value={timing.dialogueWordsPerSecond} step={0.1} onChange={(v) => setTiming({ ...timing, dialogueWordsPerSecond: v })} />
            <NumberField label="Durée minimale (s)" value={timing.minActionSeconds} step={1} onChange={(v) => setTiming({ ...timing, minActionSeconds: v })} />
          </div>
          <p className={s.preview}>
            <Hand>
              ce texte de {preview.words} mots = {formatTc(preview.sec)}
            </Hand>
            <span>« {SAMPLE} »</span>
          </p>
        </>
      )}
      <div className={s.actions}>
        <Button onClick={step === 1 ? onCancel : () => setStep(1)}>{step === 1 ? 'Annuler' : 'Retour'}</Button>
        <Button key={step} type="submit" variant="primary" data-testid="wizard-next" autoFocus={step === 2}>
          {step === 1 ? 'Continuer' : 'Créer le projet'}
        </Button>
      </div>
    </form>
  );
}

function pick(st: ProjectSettings) {
  const { tcMode, tcGranularity, actionWordsPerSecond, dialogueWordsPerSecond, minActionSeconds } = st;
  return { tcMode, tcGranularity, actionWordsPerSecond, dialogueWordsPerSecond, minActionSeconds };
}

export function NumberField({ label, value, step, onChange, min = 0.1 }: { label: string; value: number; step: number; onChange: (v: number) => void; min?: number }) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        step="any"
        data-step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= min) onChange(v);
        }}
      />
    </label>
  );
}
