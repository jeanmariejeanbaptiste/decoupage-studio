import { TemplatesMenu } from '../grid/TemplatesMenu';
import { AssistantButton } from '../assistant/AssistantButton';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { Moon, Plus, RotateCcw, Sun, X } from 'lucide-react';
import { SENSOR_CROP } from '../../domain/focal';
import { applyFormat, newId } from '../../domain/factory';
import { formatTc, parseTc } from '../../domain/timecode';
import { previewDuration } from '../../domain/timing';
import type { ProjectDoc, ProjectFormat, ProjectSettings, Sensor, ShotCodeFormat } from '../../domain/types';
import { vocabularyFor, type VocabKind } from '../../domain/vocabulary';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { ASSISTANT_MODEL, getApiKey, setApiKey } from '../assistant/aiClient';
import s from './SettingsPage.module.css';

import { conflictOf, comboFromEvent, formatCombo, isReserved, SHORTCUTS, DEFAULT_SHORTCUTS, type ShortcutId } from '../../domain/shortcuts';
import { resetShortcuts, setShortcut, useShortcuts } from '../../store/shortcuts';
import { useUi } from '../../store/uiStore';
import { switchTheme } from '../../ui/themeSwitch';
import { navigate, useLocation } from '../../app/router';

const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) =>
  mutateDoc((d) => {
    d.project.settings[k] = v;
  });

const SECTIONS = [
  ['projet', 'Projet'],
  ['minutage', 'Minutage'],
  ['camera', 'Caméra'],
  ['decoupage', 'Découpage'],
  ['vocabulaire', 'Vocabulaire'],
  ['assistant', 'Assistant IA'],
  ['raccourcis', 'Raccourcis clavier'],
  ['apparence', 'Apparence'],
] as const;
type SectionId = (typeof SECTIONS)[number][0];

const CurrentSection = createContext<SectionId>('projet');

/** Une rubrique n'est affichée que lorsqu'elle est choisie dans la liste de gauche. */
function Section({ id, title, children }: { id: SectionId; title: string; children: ReactNode }) {
  if (useContext(CurrentSection) !== id) return null;
  return (
    <section id={`reglages-${id}`} data-section={id} className={s.section} aria-labelledby={`reglages-${id}-h`}>
      <h2 id={`reglages-${id}-h`} className={s.h2}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Une ligne de réglage : intitulé (et précision éventuelle) à gauche, commande à droite. */
function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className={s.line}>
      <div className={s.lineLabel}>
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {hint && <small>{hint}</small>}
      </div>
      <div className={s.lineCtl}>{children}</div>
    </div>
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

function Num({ label, hint, value, onChange, min = 0.1 }: { label: string; hint?: string; value: number; onChange: (v: number) => void; min?: number }) {
  const id = useId();
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        className={s.num}
        type="number"
        step="any"
        min={min}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= min) onChange(v);
        }}
      />
    </Row>
  );
}

function Text({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <Row label={label} htmlFor={id}>
      <input id={id} className={s.text} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Row>
  );
}

export function SettingsPage({ doc }: { doc: ProjectDoc }) {
  const st = doc.project.settings;
  const p = doc.project;
  const { params } = useLocation();
  const [sample, setSample] = useState('Elle prend l’affiche de la vedette et la regarde longuement, émue.');
  const action = previewDuration(sample, st);
  const dialogue = previewDuration(sample, st, true);
  const asked = params.get('section') as SectionId | null;
  const current: SectionId = SECTIONS.some(([id]) => id === asked) ? (asked as SectionId) : 'projet';
  const go = (id: SectionId) => navigate('settings', { section: id });

  return (
    <div className={s.page}>
      <nav className={s.nav} aria-label="Rubriques des paramètres">
        <p className={s.navTitle}>Paramètres</p>
        <ul>
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <button type="button" className={current === id ? s.navOn : ''} aria-current={current === id ? 'page' : undefined} onClick={() => go(id)} data-testid={`settings-${id}`}>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <CurrentSection.Provider value={current}>
      <div className={s.body}>
        <Section id="projet" title="Projet">
          <Text label="Titre" value={p.title} onChange={(v) => mutateDoc((d) => void (d.project.title = v))} />
          <Text label="Version" value={p.version} onChange={(v) => mutateDoc((d) => void (d.project.version = v))} />
          <Text label="Réalisation" value={p.director ?? ''} onChange={(v) => mutateDoc((d) => void (d.project.director = v || undefined))} />
          <Text label="Image" value={p.dop ?? ''} placeholder="Directeur ou directrice de la photographie" onChange={(v) => mutateDoc((d) => void (d.project.dop = v || undefined))} />
          <Row label="Format" hint="Règle aussi le mode de minutage.">
            <Radio<ProjectFormat>
              name="Format"
              value={p.format}
              onChange={(v) => {
                // Le format pilote le minutage : clip / pub = TC sur la piste, sinon durée de chaque plan.
                mutateDoc((d) => applyFormat(d, v));
              }}
              options={[
                ['fiction', 'Fiction'],
                ['clip', 'Clip'],
                ['documentaire', 'Documentaire'],
                ['institutionnel', 'Institutionnel'],
                ['pub', 'Publicité'],
              ]}
            />
          </Row>
        </Section>

        <Section id="minutage" title="Minutage">
          <Row label="Mode">
            <Radio name="Mode de TC" value={st.tcMode} onChange={(v) => mutateDoc((d) => void Object.assign(d.project.settings, { tcMode: v, tcModeChosen: true }))} options={[['duree', 'Durée de chaque plan'], ['cumulatif', 'Cumulatif'], ['piste', 'Piste musicale']]} />
          </Row>
          {st.tcMode === 'piste' && (
            <>
              <Text label="Nom de la piste" value={st.audioTrack?.name ?? ''} onChange={(v) => set('audioTrack', { durationSec: st.audioTrack?.durationSec ?? 0, ...st.audioTrack, name: v })} />
              <Row label="Durée de la piste">
                <input
                  className={s.num}
                  aria-label="Durée de la piste"
                  defaultValue={st.audioTrack ? formatTc(st.audioTrack.durationSec) : ''}
                  placeholder="3:01"
                  onBlur={(e) => {
                    const t = parseTc(e.target.value);
                    if (t?.kind === 'sec') set('audioTrack', { name: st.audioTrack?.name ?? 'Piste', ...st.audioTrack, durationSec: t.sec });
                  }}
                />
              </Row>
            </>
          )}
          <Row label="Granularité">
            <Radio name="Granularité" value={st.tcGranularity} onChange={(v) => set('tcGranularity', v)} options={[['sequence', 'Par séquence'], ['action', 'Par action']]} />
          </Row>
          <Num label="Action (mots / s)" value={st.actionWordsPerSecond} onChange={(v) => set('actionWordsPerSecond', v)} />
          <Num label="Dialogue (mots / s)" value={st.dialogueWordsPerSecond} onChange={(v) => set('dialogueWordsPerSecond', v)} />
          <Num label="Minimum par action (s)" value={st.minActionSeconds} min={0} onChange={(v) => set('minActionSeconds', v)} />
          <Row label="Essai" htmlFor="reglages-essai">
            <textarea id="reglages-essai" className={s.text} rows={2} value={sample} onChange={(e) => setSample(e.target.value)} />
            <p className={s.preview} data-testid="timing-preview">
              <Hand>
                ce texte de {action.words} mots = {formatTc(action.sec)}
              </Hand>{' '}
              <span>en action · {formatTc(dialogue.sec)} en dialogue</span>
            </p>
          </Row>
        </Section>

        <Section id="camera" title="Caméra">
          <Row label="Capteur">
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
          </Row>
          <Num label="Facteur de recadrage" hint="Sert aux équivalences de focale." value={st.cropFactor} onChange={(v) => mutateDoc((d) => void Object.assign(d.project.settings, { cropFactor: v, sensor: 'custom' }))} />
        </Section>

        <Section id="decoupage" title="Découpage">
          <Row label="Libellé des valeurs">
            <Radio name="Libellés" value={st.labelStyle} onChange={(v) => set('labelStyle', v)} options={[['court', 'Court (Taille)'], ['long', 'Long (Plan taille)']]} />
          </Row>
          <Row label="Code des plans">
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
          </Row>
          <Row label="Passages du scénario" hint="Où va un passage ajouté depuis le scénario.">
            <Radio
              name="Passages du scénario"
              value={st.scenarioLink ?? 'auto'}
              onChange={(v) => set('scenarioLink', v)}
              options={[
                ['auto', 'Séquence de sa scène'],
                ['free', 'Au choix'],
              ]}
            />
          </Row>
          <Row label="Modèles" hint="Ajoute des séquences types au découpage.">
            <TemplatesMenu doc={doc} variant="outline" />
          </Row>
        </Section>

        <VocabularySection doc={doc} />
        <AssistantSection doc={doc} />
        <ShortcutsSection />
        <AppearanceSection />
      </div>
      </CurrentSection.Provider>
    </div>
  );
}

function ShortcutsSection() {
  const map = useShortcuts((x) => x.map);
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);
  const [error, setError] = useState<{ id: ShortcutId; text: string } | null>(null);
  const changed = SHORTCUTS.some((d) => map[d.id] !== d.combo);

  const capture = (id: ShortcutId) => (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return setCapturing(null);
    const combo = comboFromEvent(e.nativeEvent);
    if (!combo) return;
    if (isReserved(combo)) return setError({ id, text: `${formatCombo(combo)} sert déjà à la saisie.` });
    const other = conflictOf(map, id, combo);
    if (other) return setError({ id, text: `${formatCombo(combo)} est déjà pris par « ${other.label} ».` });
    setShortcut(id, combo);
    setError(null);
    setCapturing(null);
  };

  const groups = [...new Set(SHORTCUTS.map((d) => d.group))];
  return (
    <Section id="raccourcis" title="Raccourcis clavier">
      {groups.map((g) => (
        <div key={g} className={s.keyGroup}>
          <p className={s.groupTitle}>{g}</p>
          {SHORTCUTS.filter((d) => d.group === g).map((d) => (
            <Row key={d.id} label={d.label}>
              <div className={s.keyCtl}>
                <button
                  type="button"
                  className={[s.kbd, capturing === d.id ? s.capturing : ''].join(' ')}
                  onClick={() => {
                    setError(null);
                    setCapturing(capturing === d.id ? null : d.id);
                  }}
                  onKeyDown={capturing === d.id ? capture(d.id) : undefined}
                  onBlur={() => capturing === d.id && setCapturing(null)}
                  aria-label={`Raccourci : ${d.label}`}
                  data-testid={`shortcut-${d.id}`}
                >
                  {capturing === d.id ? 'Appuyez sur les touches…' : formatCombo(map[d.id])}
                </button>
                {map[d.id] !== DEFAULT_SHORTCUTS[d.id] && (
                  <button type="button" className={s.reset} onClick={() => resetShortcuts(d.id)} aria-label={`Rétablir ${formatCombo(DEFAULT_SHORTCUTS[d.id])}`} title={`Rétablir ${formatCombo(DEFAULT_SHORTCUTS[d.id])}`}>
                    <RotateCcw size={13} strokeWidth={1.4} />
                  </button>
                )}
              </div>
              {error?.id === d.id && <p className={s.error}>{error.text}</p>}
            </Row>
          ))}
        </div>
      ))}
      <p className={s.foot}>
        <span>⌘ = Ctrl sous Windows et Linux.</span>
        {changed && (
          <Button size="sm" variant="ghost" onClick={() => resetShortcuts()}>
            Tout rétablir
          </Button>
        )}
      </p>
    </Section>
  );
}

function AppearanceSection() {
  const theme = useUi((u) => u.theme);
  return (
    <Section id="apparence" title="Apparence">
      <Row label="Thème">
        <div className={s.seg} role="radiogroup" aria-label="Thème">
          {(
            [
              ['papier', 'Papier', <Sun key="s" size={13} strokeWidth={1.4} />],
              ['encre', 'Encre', <Moon key="m" size={13} strokeWidth={1.4} />],
            ] as const
          ).map(([v, label, icon]) => (
            <label key={v} className={theme === v ? s.on : ''}>
              <input type="radio" name="Thème" checked={theme === v} onChange={() => theme !== v && switchTheme()} />
              {icon} {label}
            </label>
          ))}
        </div>
      </Row>
    </Section>
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
    <Section id="vocabulaire" title="Vocabulaire">
      <Radio name="Liste" value={kind} onChange={setKind} options={[['value', 'Valeurs'], ['angle', 'Angles'], ['movement', 'Mouvements']]} />
      <p className={s.note}>
        {vocabularyFor(kind).length - custom.length} termes intégrés · {custom.length} personnalisé{custom.length > 1 ? 's' : ''}, proposés dans les suggestions de la grille.
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

function AssistantSection({ doc }: { doc: ProjectDoc }) {
  const [key, setKey] = useState(getApiKey());
  const [saved, setSaved] = useState(!!getApiKey());
  return (
    <Section id="assistant" title="Assistant IA">
      <p className={s.note}>Propose un découpage de départ pour une séquence. La clé reste dans ce navigateur : jamais enregistrée dans le projet ni exportée.</p>
      <Row label="Clé API Anthropic" htmlFor="reglages-cle">
        <form
          className={s.inline}
          onSubmit={(e) => {
            e.preventDefault();
            setApiKey(key);
            setSaved(!!key.trim());
          }}
        >
          <input id="reglages-cle" className={s.text} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="Clé API Anthropic" />
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
        <p className={s.status}>{saved ? `Assistant actif (modèle ${ASSISTANT_MODEL}).` : 'Assistant désactivé.'}</p>
      </Row>
      <Row label="Proposer un découpage" hint="Pour la séquence sélectionnée dans la grille.">
        <AssistantButton doc={doc} />
      </Row>
    </Section>
  );
}
