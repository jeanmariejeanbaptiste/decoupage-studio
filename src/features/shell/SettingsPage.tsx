import { useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { SENSOR_CROP } from '../../domain/focal';
import { defaultSettings, newId } from '../../domain/factory';
import { useUi } from '../../store/uiStore';
import { formatTc, parseTc } from '../../domain/timecode';
import { previewDuration } from '../../domain/timing';
import type { ProjectDoc, ProjectFormat, ProjectSettings, Sensor, ShotCodeFormat } from '../../domain/types';
import { vocabularyFor, type VocabKind } from '../../domain/vocabulary';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { ASSISTANT_MODEL, getApiKey, setApiKey } from '../assistant/aiClient';
import s from './SettingsPage.module.css';

const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) =>
  mutateDoc((d) => {
    d.project.settings[k] = v;
  });

function Section({ title, kicker, children }: { title: string; kicker?: string; children: ReactNode }) {
  return (
    <section className={['card', s.section].join(' ')}>
      {kicker && <Hand>{kicker}</Hand>}
      <h2 className={s.h2}>{title}</h2>
      {children}
    </section>
  );
}

function Radio<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className={s.seg} role="radiogroup" aria-label={name}>
      {options.map(([v, label]) => (
        <label key={v} className={value === v ? s.on : ''}>
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </div>
  );
}

function Num({ label, value, onChange, step = 0.1, min = 0.1 }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      <input
        type="number"
        step="any"
        min={min}
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

export function SettingsPage({ doc }: { doc: ProjectDoc }) {
  const st = doc.project.settings;
  const p = doc.project;
  const [sample, setSample] = useState('Elle prend l’affiche de la vedette et la regarde longuement, émue.');
  const action = previewDuration(sample, st);
  const dialogue = previewDuration(sample, st, true);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">Paramètres du projet</p>
          <h1 className="page-title">Réglages</h1>
        </div>
      </header>
      <div className={s.grid}>
        <Section title="Projet">
          <label className={s.field}>
            <span>Titre</span>
            <input value={p.title} onChange={(e) => mutateDoc((d) => void (d.project.title = e.target.value))} />
          </label>
          <div className={s.row}>
            <label className={s.field}>
              <span>Version</span>
              <input value={p.version} onChange={(e) => mutateDoc((d) => void (d.project.version = e.target.value))} />
            </label>
            <label className={s.field}>
              <span>Réalisation</span>
              <input value={p.director ?? ''} onChange={(e) => mutateDoc((d) => void (d.project.director = e.target.value || undefined))} />
            </label>
            <label className={s.field}>
              <span>Image</span>
              <input value={p.dop ?? ''} onChange={(e) => mutateDoc((d) => void (d.project.dop = e.target.value || undefined))} />
            </label>
          </div>
          <div className={s.field}>
            <span>Format</span>
            <Radio<ProjectFormat>
              name="Format"
              value={p.format}
              onChange={(v) => {
                // Le format pilote le minutage : clip / pub = TC sur la piste, sinon cumulatif.
                mutateDoc((d) => {
                  const def = defaultSettings(v);
                  d.project.format = v;
                  d.project.settings.tcMode = def.tcMode;
                  d.project.settings.tcGranularity = def.tcGranularity;
                });
                useUi.getState().toast({ message: `Projet passé en ${v} : minutage ${v === 'clip' || v === 'pub' ? 'calé sur la piste' : 'cumulatif'}.` });
              }}
              options={[
                ['fiction', 'Fiction'],
                ['clip', 'Clip'],
                ['documentaire', 'Documentaire'],
                ['institutionnel', 'Institutionnel'],
                ['pub', 'Publicité'],
              ]}
            />
          </div>
        </Section>

        <Section title="Minutage" kicker="TC MIN">
          <div className={s.field}>
            <span>Mode</span>
            <Radio name="Mode de TC" value={st.tcMode} onChange={(v) => set('tcMode', v)} options={[['cumulatif', 'Cumulatif'], ['piste', 'Piste musicale']]} />
          </div>
          <div className={s.field}>
            <span>Granularité</span>
            <Radio name="Granularité" value={st.tcGranularity} onChange={(v) => set('tcGranularity', v)} options={[['sequence', 'Par séquence'], ['action', 'Par action']]} />
          </div>
          <div className={s.row}>
            <Num label="Action (mots / s)" value={st.actionWordsPerSecond} onChange={(v) => set('actionWordsPerSecond', v)} />
            <Num label="Dialogue (mots / s)" value={st.dialogueWordsPerSecond} onChange={(v) => set('dialogueWordsPerSecond', v)} />
            <Num label="Minimum par action (s)" value={st.minActionSeconds} step={1} min={0} onChange={(v) => set('minActionSeconds', v)} />
          </div>
          <label className={s.field}>
            <span>Aperçu</span>
            <textarea rows={2} value={sample} onChange={(e) => setSample(e.target.value)} />
          </label>
          <p className={s.preview} data-testid="timing-preview">
            <Hand>
              ce texte de {action.words} mots = {formatTc(action.sec)}
            </Hand>{' '}
            <span>en action · {formatTc(dialogue.sec)} en dialogue</span>
          </p>
          {st.tcMode === 'piste' && (
            <div className={s.row}>
              <label className={s.field}>
                <span>Nom de la piste</span>
                <input
                  value={st.audioTrack?.name ?? ''}
                  onChange={(e) => set('audioTrack', { durationSec: st.audioTrack?.durationSec ?? 0, ...st.audioTrack, name: e.target.value })}
                />
              </label>
              <label className={s.field}>
                <span>Durée de la piste</span>
                <input
                  defaultValue={st.audioTrack ? formatTc(st.audioTrack.durationSec) : ''}
                  placeholder="3:01"
                  onBlur={(e) => {
                    const t = parseTc(e.target.value);
                    if (t?.kind === 'sec') set('audioTrack', { name: st.audioTrack?.name ?? 'Piste', ...st.audioTrack, durationSec: t.sec });
                  }}
                />
              </label>
            </div>
          )}
        </Section>

        <Section title="Image">
          <div className={s.field}>
            <span>Capteur</span>
            <Radio<Sensor>
              name="Capteur"
              value={st.sensor}
              onChange={(v) =>
                mutateDoc((d) => {
                  d.project.settings.sensor = v;
                  if (v !== 'custom') d.project.settings.cropFactor = SENSOR_CROP[v];
                })
              }
              options={[
                ['FF', 'Plein format'],
                ['S35', 'Super 35'],
                ['APSC', 'APS-C'],
                ['M43', 'Micro 4/3'],
                ['custom', 'Autre'],
              ]}
            />
          </div>
          <Num label="Facteur de recadrage" value={st.cropFactor} onChange={(v) => mutateDoc((d) => void Object.assign(d.project.settings, { cropFactor: v, sensor: 'custom' }))} />
        </Section>

        <Section title="Grille et libellés">
          <div className={s.field}>
            <span>Libellé des valeurs</span>
            <Radio name="Libellés" value={st.labelStyle} onChange={(v) => set('labelStyle', v)} options={[['court', 'Court (Taille)'], ['long', 'Long (Plan taille)']]} />
          </div>
          <div className={s.field}>
            <span>Code des plans</span>
            <Radio<ShotCodeFormat>
              name="Code des plans"
              value={st.shotCodeFormat}
              onChange={(v) => set('shotCodeFormat', v)}
              options={[
                ['{seq}.{shot}', '3.4'],
                ['{seq}-{shot}', '3-4'],
                ['{seq}{letter}', '3D'],
              ]}
            />
          </div>
        </Section>

        <VocabularySection doc={doc} />
        <AssistantSection />
      </div>
    </div>
  );
}

const KIND_LABEL: Record<VocabKind, string> = { value: 'Valeurs', angle: 'Angles', movement: 'Mouvements' };

function VocabularySection({ doc }: { doc: ProjectDoc }) {
  const [kind, setKind] = useState<VocabKind>('movement');
  const [short, setShort] = useState('');
  const [long, setLong] = useState('');
  const [aliases, setAliases] = useState('');
  const custom = doc.customVocabulary[kind];
  const add = () => {
    const sh = short.trim();
    if (!sh) return;
    mutateDoc((d) => {
      d.customVocabulary[kind].push({
        key: `custom-${newId()}`,
        short: sh,
        long: long.trim() || sh,
        aliases: aliases
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
      });
    });
    setShort('');
    setLong('');
    setAliases('');
  };
  return (
    <Section title="Vocabulaire" kicker="vos propres termes">
      <Radio name="Liste" value={kind} onChange={setKind} options={[['value', 'Valeurs'], ['angle', 'Angles'], ['movement', 'Mouvements']]} />
      <p className={s.note}>
        {vocabularyFor(kind).length - custom.length} termes intégrés · {custom.length} personnalisé{custom.length > 1 ? 's' : ''}. Ils apparaissent dans les suggestions de la
        grille.
      </p>
      <ul className={s.vocab}>
        {custom.map((e) => (
          <li key={e.key}>
            <strong>{e.short}</strong>
            {e.long !== e.short && <em>{e.long}</em>}
            {e.aliases.length > 0 && <span>alias : {e.aliases.join(', ')}</span>}
            <Button
              variant="icon"
              size="sm"
              aria-label={`Retirer ${e.short}`}
              icon={<X size={12} />}
              onClick={() => mutateDoc((d) => void (d.customVocabulary[kind] = d.customVocabulary[kind].filter((x) => x.key !== e.key)))}
            />
          </li>
        ))}
      </ul>
      <form
        className={s.vocabForm}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        aria-label={`Ajouter un terme (${KIND_LABEL[kind]})`}
      >
        <input placeholder="Libellé court" value={short} onChange={(e) => setShort(e.target.value)} aria-label="Libellé court" />
        <input placeholder="Libellé long" value={long} onChange={(e) => setLong(e.target.value)} aria-label="Libellé long" />
        <input placeholder="Alias, séparés par des virgules" value={aliases} onChange={(e) => setAliases(e.target.value)} aria-label="Alias" />
        <Button type="submit" variant="outline" icon={<Plus size={14} />}>
          Ajouter
        </Button>
      </form>
    </Section>
  );
}

function AssistantSection() {
  const [key, setKey] = useState(getApiKey());
  const [saved, setSaved] = useState(!!getApiKey());
  return (
    <Section title="Assistant IA" kicker="facultatif">
      <p className={s.note}>
        Propose un découpage de départ pour une séquence, dans le vocabulaire de l’application. La clé reste dans ce navigateur : elle n’est jamais
        enregistrée dans le projet ni exportée. Sans clé, l’assistant est désactivé.
      </p>
      <form
        className={s.row}
        onSubmit={(e) => {
          e.preventDefault();
          setApiKey(key);
          setSaved(!!key.trim());
        }}
      >
        <label className={s.field}>
          <span>Clé API Anthropic</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="Clé API Anthropic" />
        </label>
        <Button type="submit" variant="outline">
          {saved ? 'Mettre à jour' : 'Enregistrer'}
        </Button>
        {saved && (
          <Button
            onClick={() => {
              setApiKey('');
              setKey('');
              setSaved(false);
            }}
          >
            Oublier la clé
          </Button>
        )}
      </form>
      <p className={s.note}>{saved ? `Assistant actif (modèle ${ASSISTANT_MODEL}).` : 'Assistant désactivé.'}</p>
    </Section>
  );
}
