import { useState } from 'react';
import { navigate } from '../../app/router';
import { createProjectDoc } from '../../domain/factory';
import { openDoc } from '../../store/persistence';
import { Button } from '../../ui/Button';
import s from './NewProjectWizard.module.css';

/** Nouveau projet : le titre seulement ; format fiction et réglages par défaut (modifiables dans Paramètres). */
export function NewProjectWizard({ onCancel }: { onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const create = async () => {
    const doc = createProjectDoc({ title: title.trim() || 'Projet sans titre', format: 'fiction' });
    await openDoc(doc);
    navigate('grid');
  };
  return (
    <form
      noValidate
      className={['card', s.wizard].join(' ')}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      aria-label="Nouveau projet"
      data-testid="wizard"
    >
      <label className={s.field}>
        <span>Titre du projet</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} name="title" autoFocus />
      </label>
      <div className={s.actions}>
        <Button onClick={onCancel}>Annuler</Button>
        <Button type="submit" variant="primary" data-testid="wizard-next">
          Créer le projet
        </Button>
      </div>
    </form>
  );
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
