import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ExternalLink, Plus, RotateCcw, X } from 'lucide-react';
import { SENSOR_CROP } from '../../domain/focal';
import { isMusicalFormat, newId, normalizeTiming } from '../../domain/factory';
import { formatTc, parseTc } from '../../domain/timecode';
import { previewDuration } from '../../domain/timing';
import { chronoOf, type ScriptChrono, type TypeRate } from '../../domain/chronometry';
import type { ProjectDoc, ProjectSettings, Sensor, ShotCodeFormat, VocabEntry } from '../../domain/types';
import { vocabularyFor, type VocabKind } from '../../domain/vocabulary';
import { mutateDoc } from '../../store/projectStore';
import { registerFlush } from '../../store/persistence';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { accessOf, forgetProbe, refreshAiStatus, rememberProbe, verifiedFor } from '../assistant/aiStatus';
import { keyOf, loadAiSettings, probeProvider, providerInfo, PROVIDERS, saveAiSettings, type AiSettings, type ModelEntry, type ProviderId } from '../assistant/providers';
import s from './SettingsPage.module.css';

import { conflictOf, comboFromEvent, formatCombo, isBrowserReserved, isReserved, SHORTCUTS, DEFAULT_SHORTCUTS, type ShortcutId, type ShortcutMap } from '../../domain/shortcuts';
import { setShortcut, useShortcuts } from '../../store/shortcuts';
import { navigate, useLocation } from '../../app/router';

const SECTIONS = [
  ['minutage', 'Minutage'],
  ['scenario', 'Scénario'],
  ['camera', 'Caméra'],
  ['decoupage', 'Découpage'],
  ['vocabulaire', 'Vocabulaire'],
  ['assistant', 'Assistant IA'],
  ['raccourcis', 'Raccourcis clavier'],
] as const;
type SectionId = (typeof SECTIONS)[number][0];

// --- Brouillon : rien n'est appliqué avant « Enregistrer » (ou en quittant la page) ------------------

type Vocab = ProjectDoc['customVocabulary'];

interface Pending {
  settings: Partial<ProjectSettings>;
  vocab: Partial<Vocab>;
  ai?: AiSettings;
  keys: Partial<ShortcutMap>;
}
const EMPTY: Pending = { settings: {}, vocab: {}, keys: {} };

/** Égalité de valeurs (objets comparés clé par clé, sans tenir compte de l'ordre des clés). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Ce qui diffère réellement de l'état enregistré (un réglage remis à sa valeur ne compte plus). */
function effective(p: Pending, doc: ProjectDoc, keys: ShortcutMap): Pending {
  const settings = Object.fromEntries(Object.entries(p.settings).filter(([k, v]) => !same(v, doc.project.settings[k as keyof ProjectSettings])));
  const vocab = Object.fromEntries(Object.entries(p.vocab).filter(([k, v]) => !same(v, doc.customVocabulary[k as VocabKind])));
  const sc = Object.fromEntries(Object.entries(p.keys).filter(([k, v]) => v !== keys[k as ShortcutId]));
  const ai = p.ai && !same(p.ai, loadAiSettings()) ? p.ai : undefined;
  return { settings, vocab, keys: sc, ai };
}
const isEmpty = (p: Pending) => !Object.keys(p.settings).length && !Object.keys(p.vocab).length && !Object.keys(p.keys).length && !p.ai;

/** Applique le brouillon : un seul pas d'annulation pour le projet ; assistant et raccourcis dans ce navigateur. */
function apply(p: Pending) {
  if (Object.keys(p.settings).length || Object.keys(p.vocab).length) {
    mutateDoc((d) => {
      for (const [k, v] of Object.entries(p.settings)) (d.project.settings as unknown as Record<string, unknown>)[k] = structuredClone(v);
      for (const [k, v] of Object.entries(p.vocab)) d.customVocabulary[k as VocabKind] = structuredClone(v);
      // Le format a pu changer entre-temps (menu du projet) : le minutage reste celui du format.
      normalizeTiming(d);
    });
  }
  if (p.ai) {
    saveAiSettings(p.ai);
    refreshAiStatus();
  }
  for (const [id, combo] of Object.entries(p.keys)) setShortcut(id as ShortcutId, combo);
}

interface DraftApi {
  st: ProjectSettings;
  patch: (p: Partial<ProjectSettings>) => void;
  vocab: Vocab;
  setVocab: (kind: VocabKind, list: VocabEntry[]) => void;
  ai: AiSettings;
  setAi: (v: AiSettings) => void;
  keys: ShortcutMap;
  setKey: (id: ShortcutId, combo: string) => void;
}
const Draft = createContext<DraftApi | null>(null);
const useSettings = () => useContext(Draft)!;

const CurrentSection = createContext<SectionId>('minutage');

/** Une rubrique n'est affichée que lorsqu'elle est choisie dans la liste de gauche. */
function Section({ id, title, children }: { id: SectionId; title: string; children: ReactNode }) {
  if (useContext(CurrentSection) !== id) return null;
  return (
    <section id={`reglages-${id}`} data-section={id} className={s.section} aria-label={title}>
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

/** Nombre saisi librement (effacer, taper « 2, » ou « 0.5 ») ; seule une valeur valide est retenue. */
function Num({ label, hint, value, onChange, min = 0.1 }: { label: string; hint?: string; value: number; onChange: (v: number) => void; min?: number }) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const parse = (t: string) => {
    const v = Number(t.replace(',', '.').trim());
    return t.trim() !== '' && Number.isFinite(v) && v >= min ? v : null;
  };
  const bad = parse(text) === null;
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        className={[s.num, bad ? s.invalid : ''].join(' ')}
        inputMode="decimal"
        value={text}
        aria-invalid={bad || undefined}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          const v = parse(e.target.value);
          if (v !== null) onChange(v);
        }}
        onBlur={() => {
          focused.current = false;
          setText(String(value));
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
  const { params } = useLocation();
  const shortcuts = useShortcuts((x) => x.map);
  const [pending, setPending] = useState<Pending>(EMPTY);
  const [savedAt, setSavedAt] = useState(0);
  const live = useMemo(() => effective(pending, doc, shortcuts), [pending, doc, shortcuts]);
  const dirty = !isEmpty(live);

  // Dernier état connu, pour appliquer le brouillon en quittant la page ou avant un enregistrement (⌘S, export).
  const latest = useRef(live);
  latest.current = live;
  const commit = useCallback(() => {
    const p = latest.current;
    if (isEmpty(p)) return false;
    latest.current = EMPTY;
    apply(p);
    setPending(EMPTY);
    return true;
  }, []);
  useEffect(() => {
    const off = registerFlush(commit);
    return () => {
      off();
      // Quitter la page garde le travail : les réglages modifiés sont appliqués.
      commit();
    };
  }, [commit]);

  // Format changé depuis le menu du projet : le mode de minutage du brouillon ne vaut plus.
  const format = doc.project.format;
  useEffect(() => {
    setPending((x) => {
      const { tcMode, tcModeChosen, tcGranularity, audioTrack, ...settings } = x.settings;
      if (tcMode === undefined && tcModeChosen === undefined && tcGranularity === undefined && audioTrack === undefined) return x;
      return { ...x, settings };
    });
  }, [format]);

  const api: DraftApi = {
    st: { ...doc.project.settings, ...pending.settings },
    patch: (p) => setPending((x) => ({ ...x, settings: { ...x.settings, ...p } })),
    vocab: { ...doc.customVocabulary, ...pending.vocab },
    setVocab: (kind, list) => setPending((x) => ({ ...x, vocab: { ...x.vocab, [kind]: list } })),
    ai: pending.ai ?? loadAiSettings(),
    setAi: (v) => setPending((x) => ({ ...x, ai: v })),
    keys: { ...shortcuts, ...pending.keys },
    setKey: (id, combo) => setPending((x) => ({ ...x, keys: { ...x.keys, [id]: combo } })),
  };

  const asked = params.get('section') as SectionId | null;
  const current: SectionId = SECTIONS.some(([id]) => id === asked) ? (asked as SectionId) : 'minutage';
  const go = (id: SectionId) => navigate('settings', { section: id });
  const save = () => {
    if (commit()) setSavedAt(Date.now());
  };
  const cancel = () => {
    latest.current = EMPTY;
    setPending(EMPTY);
  };

  return (
    <div
      className={s.page}
      onKeyDownCapture={(e) => {
        // ⌘S / Ctrl+S : enregistre les paramètres affichés.
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S') && dirty) {
          e.preventDefault();
          e.stopPropagation();
          save();
        }
      }}
    >
      <nav className={s.nav} aria-label="Rubriques des paramètres">
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

      <Draft.Provider value={api}>
        <CurrentSection.Provider value={current}>
          <div className={s.body}>
            <TimingSection doc={doc} />
            <ScriptTimingSection />
            <CameraSection />
            <CuttingSection />
            <VocabularySection />
            <AssistantSection />
            <ShortcutsSection />

            <div className={s.saveBar} data-testid="settings-savebar">
              <span className={s.saveState} aria-live="polite">
                {dirty ? (
                  'Modifications non enregistrées'
                ) : savedAt ? (
                  <>
                    <Check size={14} strokeWidth={1.5} aria-hidden="true" /> Enregistré
                  </>
                ) : (
                  ''
                )}
              </span>
              <Button variant="ghost" disabled={!dirty} onClick={cancel} data-testid="settings-cancel">
                Annuler
              </Button>
              <Button variant="primary" disabled={!dirty} onClick={save} data-testid="settings-save">
                Enregistrer
              </Button>
            </div>
          </div>
        </CurrentSection.Provider>
      </Draft.Provider>
    </div>
  );
}

function TimingSection({ doc }: { doc: ProjectDoc }) {
  const { st, patch } = useSettings();
  const musical = isMusicalFormat(doc.project.format);
  const [sample, setSample] = useState('Elle prend l’affiche de la vedette et la regarde longuement, émue.');
  const action = previewDuration(sample, st);
  const dialogue = previewDuration(sample, st, true);
  const trackSec = st.audioTrack?.durationSec;
  const [trackText, setTrackText] = useState(trackSec !== undefined ? formatTc(trackSec) : '');
  // La saisie suit la durée effective (Annuler, Enregistrer, format changé), sauf pendant la frappe.
  const trackFocused = useRef(false);
  useEffect(() => {
    if (!trackFocused.current) setTrackText(trackSec !== undefined ? formatTc(trackSec) : '');
  }, [trackSec]);
  return (
    <Section id="minutage" title="Minutage">
      {/* Le mode dépend du format : piste musicale pour un clip ou une publicité, sinon durée ou cumul. */}
      {musical ? (
        <Row label="Mode" hint="Clip : chaque action se cale sur la musique.">
          <span className={s.status}>Piste musicale</span>
        </Row>
      ) : (
        <Row label="Mode">
          <Radio
            name="Mode de TC"
            value={st.tcMode}
            onChange={(v) => patch({ tcMode: v, tcModeChosen: true })}
            options={[
              ['duree', 'Durée de chaque plan'],
              ['cumulatif', 'Cumulatif'],
            ]}
          />
        </Row>
      )}
      {st.tcMode === 'piste' && (
        <>
          <Text label="Nom de la piste" value={st.audioTrack?.name ?? ''} onChange={(v) => patch({ audioTrack: { durationSec: st.audioTrack?.durationSec ?? 0, ...st.audioTrack, name: v } })} />
          <Row label="Durée de la piste">
            <input
              className={s.num}
              aria-label="Durée de la piste"
              value={trackText}
              placeholder="3:01"
              onChange={(e) => {
                setTrackText(e.target.value);
                const t = parseTc(e.target.value);
                if (t?.kind === 'sec') patch({ audioTrack: { name: st.audioTrack?.name ?? 'Piste', ...st.audioTrack, durationSec: t.sec } });
              }}
              onFocus={() => (trackFocused.current = true)}
              onBlur={() => {
                trackFocused.current = false;
                setTrackText(trackSec !== undefined ? formatTc(trackSec) : '');
              }}
            />
          </Row>
        </>
      )}
      {st.tcMode === 'cumulatif' && (
        <Row label="Granularité" hint="Le TC cumulé s'affiche par séquence ou par action.">
          <Radio name="Granularité" value={st.tcGranularity} onChange={(v) => patch({ tcGranularity: v })} options={[['sequence', 'Par séquence'], ['action', 'Par action']]} />
        </Row>
      )}
      <Num label="Action (mots / s)" value={st.actionWordsPerSecond} onChange={(v) => patch({ actionWordsPerSecond: v })} />
      <Num label="Dialogue (mots / s)" value={st.dialogueWordsPerSecond} onChange={(v) => patch({ dialogueWordsPerSecond: v })} />
      <Num label="Minimum par action (s)" value={st.minActionSeconds} min={0} onChange={(v) => patch({ minActionSeconds: v })} />
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
  );
}

/** Minutage du scénario : les trois méthodes de KIT Scenarist (chronomètre, rapports et statistiques). */
function ScriptTimingSection() {
  const { st, patch } = useSettings();
  const c = chronoOf(st.scriptChrono);
  const set = (p: Partial<ScriptChrono>) => patch({ scriptChrono: { ...st.scriptChrono, ...p } });
  const rate = (key: 'heading' | 'action' | 'dialogue', label: string) => (
    <>
      <Num label={`${label} : par paragraphe (s)`} value={c[key].paragraph} min={0} onChange={(v) => set({ [key]: { ...c[key], paragraph: v } as TypeRate })} />
      <Num label={`${label} : par 50 caractères (s)`} value={c[key].per50} min={0} onChange={(v) => set({ [key]: { ...c[key], per50: v } as TypeRate })} />
    </>
  );
  return (
    <Section id="scenario" title="Scénario">
      <Row label="Méthode">
        <Radio
          name="Minutage du scénario"
          value={c.method}
          onChange={(v) => set({ method: v })}
          options={[
            ['pages', 'Par pages'],
            ['characters', 'Par caractères'],
            ['configurable', 'Par type de paragraphe'],
          ]}
        />
      </Row>
      {c.method === 'pages' && <Num label="Secondes par page" value={c.pageSec} min={1} onChange={(v) => set({ pageSec: v })} />}
      {c.method === 'characters' && (
        <>
          <Num label="Caractères" value={c.chars} min={1} onChange={(v) => set({ chars: v })} />
          <Num label="Valent (s)" value={c.charsSec} min={1} onChange={(v) => set({ charsSec: v })} />
          <Row label="Espaces">
            <Radio name="Espaces" value={c.spaces ? 'oui' : 'non'} onChange={(v) => set({ spaces: v === 'oui' })} options={[['non', 'Non comptées'], ['oui', 'Comptées']]} />
          </Row>
        </>
      )}
      {c.method === 'configurable' && (
        <>
          {rate('heading', 'En-tête')}
          {rate('action', 'Action')}
          {rate('dialogue', 'Réplique')}
        </>
      )}
    </Section>
  );
}

function CameraSection() {
  const { st, patch } = useSettings();
  return (
    <Section id="camera" title="Caméra">
      <Row label="Capteur">
        <Radio<Sensor>
          name="Capteur"
          value={st.sensor}
          onChange={(v) => patch(v === 'custom' ? { sensor: v } : { sensor: v, cropFactor: SENSOR_CROP[v] })}
          options={[
            ['FF', 'Plein format'],
            ['S35', 'Super 35'],
            ['APSC', 'APS-C'],
            ['M43', 'Micro 4/3'],
            ['custom', 'Autre'],
          ]}
        />
      </Row>
      <Num label="Facteur de recadrage" hint="Sert aux équivalences de focale." value={st.cropFactor} onChange={(v) => patch({ cropFactor: v, sensor: 'custom' })} />
    </Section>
  );
}

function CuttingSection() {
  const { st, patch } = useSettings();
  return (
    <Section id="decoupage" title="Découpage">
      <Row label="Libellé des valeurs">
        <Radio name="Libellés" value={st.labelStyle} onChange={(v) => patch({ labelStyle: v })} options={[['court', 'Court (Taille)'], ['long', 'Long (Plan taille)']]} />
      </Row>
      <Row label="Code des plans">
        <Radio<ShotCodeFormat>
          name="Code des plans"
          value={st.shotCodeFormat}
          onChange={(v) => patch({ shotCodeFormat: v })}
          options={[
            ['{seq}.{shot}', '3.4'],
            ['{seq}-{shot}', '3-4'],
            ['{seq}{letter}', '3D'],
          ]}
        />
      </Row>
    </Section>
  );
}

/**
 * Assistant : fournisseur et clé ; la clé saisie est essayée d'office et seuls les modèles qui répondent
 * sont proposés (gratuits et payants séparés quand le fournisseur publie ses prix).
 */
function AssistantSection() {
  const { ai, setAi } = useSettings();
  const ids = { provider: useId(), url: useId(), key: useId(), model: useId() };
  const info = providerInfo(ai.provider);
  const key = keyOf(ai);
  const chosen = ai.models[ai.provider]?.trim() ?? '';
  const access = accessOf(ai);
  const [, setTick] = useState(0);
  const verified = verifiedFor(ai);
  const needsProbe = !verified || (!!chosen && !verified.models.some((m) => m.id === chosen));
  const [probe, setProbe] = useState<{ busy: boolean; text: string } | null>(null);
  const latest = useRef({ ai, setAi });
  latest.current = { ai, setAi };
  const setFor = (field: 'keys' | 'models', v: string) => setAi({ ...ai, [field]: { ...ai[field], [ai.provider]: v } });

  useEffect(() => {
    setProbe(null);
    if (!needsProbe || (!info.keyOptional && key.length < 12)) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      const tried = latest.current.ai;
      setProbe({ busy: true, text: 'Essai des modèles…' });
      probeProvider(tried, ctrl.signal)
        .then((r) => {
          rememberProbe(tried, r);
          const { ai: now, setAi: set } = latest.current;
          if (accessOf(now) === accessOf(tried) && now.models[now.provider] !== r.model) set({ ...now, models: { ...now.models, [now.provider]: r.model } });
          setProbe(null);
          setTick((x) => x + 1);
        })
        .catch((e: Error) => {
          if (e.name === 'AbortError') return;
          forgetProbe(tried);
          setProbe({ busy: false, text: e.message });
        });
    }, 600);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [access, needsProbe ? chosen : '']); // eslint-disable-line react-hooks/exhaustive-deps

  const models = verified?.models ?? [];
  const priced = models.some((m) => m.free !== undefined);
  const groups: Array<[string, ModelEntry[]]> = priced
    ? ([
        ['Gratuits', models.filter((m) => m.free)],
        ['Payants', models.filter((m) => !m.free)],
      ] as Array<[string, ModelEntry[]]>).filter(([, list]) => list.length)
    : [];
  const freeText = ai.provider === 'custom' && !verified?.listed;
  const status = probe ? probe.text : verified && !needsProbe ? `Connecté · ${models.length} ${models.length > 1 ? 'modèles disponibles' : 'modèle disponible'}` : '';

  return (
    <Section id="assistant" title="Assistant IA">
      <p className={s.note}>Fournisseur, clé et modèle restent dans ce navigateur : jamais enregistrés dans le projet ni exportés.</p>
      <div data-testid="ai-settings">
        <Row label="Fournisseur" htmlFor={ids.provider}>
          <select id={ids.provider} className={s.text} value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value as ProviderId })}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Row>
        {ai.provider === 'custom' && (
          <Row label="Adresse de l’API" htmlFor={ids.url}>
            <input id={ids.url} className={s.text} value={ai.baseUrl ?? info.baseUrl ?? ''} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
          </Row>
        )}
        <Row label={info.keyLabel} htmlFor={ids.key}>
          <input id={ids.key} className={s.text} type="password" autoComplete="off" value={ai.keys[ai.provider] ?? ''} onChange={(e) => setFor('keys', e.target.value)} placeholder={info.keyPlaceholder} />
          {(status || info.keyUrl) && (
            <div className={s.aiMeta}>
              <span className={[probe && !probe.busy ? s.error : s.status].join(' ')} role="status" data-testid="ai-probe">
                {status}
              </span>
              {info.keyUrl && (
                <a href={info.keyUrl} target="_blank" rel="noopener noreferrer" className={s.keyLink}>
                  Obtenir une clé
                  <ExternalLink size={12} strokeWidth={1.4} aria-hidden="true" />
                </a>
              )}
            </div>
          )}
        </Row>
        {freeText ? (
          <Row label="Modèle" htmlFor={ids.model}>
            <input id={ids.model} className={s.text} value={chosen} onChange={(e) => setFor('models', e.target.value)} placeholder="nom du modèle" />
          </Row>
        ) : (
          models.length > 0 && (
            <Row label="Modèle" htmlFor={ids.model}>
              <select id={ids.model} className={s.text} value={chosen} onChange={(e) => setFor('models', e.target.value)}>
                {priced
                  ? groups.map(([label, list]) => (
                      <optgroup key={label} label={label}>
                        {list.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.id}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
              </select>
            </Row>
          )
        )}
      </div>
    </Section>
  );
}

function ShortcutsSection() {
  const { keys: map, setKey } = useSettings();
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
    if (isBrowserReserved(combo)) return setError({ id, text: `${formatCombo(combo)} est réservé par le navigateur.` });
    const other = conflictOf(map, id, combo);
    if (other) return setError({ id, text: `${formatCombo(combo)} est déjà pris par « ${other.label} ».` });
    setKey(id, combo);
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
                  <button
                    type="button"
                    className={s.reset}
                    onClick={() => {
                      // Le raccourci d'origine a pu être donné à une autre action entre-temps.
                      const other = conflictOf(map, d.id, DEFAULT_SHORTCUTS[d.id]);
                      if (other) return setError({ id: d.id, text: `${formatCombo(DEFAULT_SHORTCUTS[d.id])} est déjà pris par « ${other.label} ».` });
                      setError(null);
                      setKey(d.id, DEFAULT_SHORTCUTS[d.id]);
                    }}
                    aria-label={`Rétablir ${formatCombo(DEFAULT_SHORTCUTS[d.id])}`}
                    title={`Rétablir ${formatCombo(DEFAULT_SHORTCUTS[d.id])}`}
                  >
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
          <Button size="sm" variant="ghost" onClick={() => SHORTCUTS.forEach((d) => setKey(d.id, DEFAULT_SHORTCUTS[d.id]))}>
            Tout rétablir
          </Button>
        )}
      </p>
    </Section>
  );
}

const KIND_LABEL: Record<VocabKind, string> = { value: 'Valeurs', angle: 'Angles', movement: 'Mouvements' };

function VocabularySection() {
  const { vocab, setVocab } = useSettings();
  const [kind, setKind] = useState<VocabKind>('movement');
  const [short, setShort] = useState('');
  const [long, setLong] = useState('');
  const [aliases, setAliases] = useState('');
  const custom = vocab[kind];
  const add = () => {
    const sh = short.trim();
    if (!sh) return;
    setVocab(kind, [
      ...custom,
      {
        key: `custom-${newId()}`,
        short: sh,
        long: long.trim() || sh,
        aliases: aliases
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
      },
    ]);
    setShort('');
    setLong('');
    setAliases('');
  };
  return (
    <Section id="vocabulaire" title="Vocabulaire">
      <Radio name="Liste" value={kind} onChange={setKind} options={[['value', 'Valeurs'], ['angle', 'Angles'], ['movement', 'Mouvements']]} />
      <p className={s.note}>
        {vocabularyFor(kind).length} termes intégrés · {custom.length} personnalisé{custom.length > 1 ? 's' : ''}, proposés dans les suggestions de la grille.
      </p>
      <ul className={s.vocab}>
        {custom.map((e) => (
          <li key={e.key}>
            <strong>{e.short}</strong>
            {e.long !== e.short && <em>{e.long}</em>}
            {e.aliases.length > 0 && <span>alias : {e.aliases.join(', ')}</span>}
            <Button variant="icon" size="sm" aria-label={`Retirer ${e.short}`} icon={<X size={12} />} onClick={() => setVocab(kind, custom.filter((x) => x.key !== e.key))} />
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
