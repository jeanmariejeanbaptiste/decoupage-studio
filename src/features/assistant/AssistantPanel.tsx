import { useEffect, useRef, useState } from 'react';
import { ArrowUp, RotateCcw, Square, SquarePen, X } from 'lucide-react';
import { undo, useProjectStore } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { askAssistant, newConversation, stopAssistant, toggleAssistant, useAssistant } from './assistant';
import { PROVIDERS, isConfigured, loadAiSettings, modelOf, providerInfo, saveAiSettings, type AiSettings, type ProviderId } from './providers';
import s from './AssistantPanel.module.css';

const IC = { size: 15, strokeWidth: 1.4 } as const;

interface FormProps {
  onSaved?: () => void;
  compact?: boolean;
  /** Formulaire piloté de l'extérieur (page Paramètres) : pas de bouton propre, l'enregistrement est commun. */
  value?: AiSettings;
  onChange?: (v: AiSettings) => void;
}

/** Réglages de l'assistant : fournisseur, clé et modèle (gardés dans ce navigateur). */
export function AiSettingsForm({ onSaved, compact = false, value, onChange }: FormProps) {
  const [own, setOwn] = useState<AiSettings>(loadAiSettings);
  const [saved, setSaved] = useState(false);
  const draft = value ?? own;
  const info = providerInfo(draft.provider);
  const set = (p: Partial<AiSettings>) => {
    if (onChange) onChange({ ...draft, ...p });
    else setOwn((d) => ({ ...d, ...p }));
    setSaved(false);
  };
  const setFor = (field: 'keys' | 'models', v: string) => set({ [field]: { ...draft[field], [draft.provider]: v } } as Partial<AiSettings>);
  return (
    <form
      className={[s.form, compact ? s.compact : ''].join(' ')}
      onSubmit={(e) => {
        e.preventDefault();
        if (onChange) return;
        saveAiSettings(draft);
        setSaved(true);
        onSaved?.();
      }}
      data-testid="ai-settings"
    >
      <label>
        <span>Fournisseur</span>
        <select value={draft.provider} onChange={(e) => set({ provider: e.target.value as ProviderId })} aria-label="Fournisseur">
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {draft.provider === 'custom' && (
        <label>
          <span>Adresse de l’API</span>
          <input value={draft.baseUrl ?? info.baseUrl ?? ''} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" aria-label="Adresse de l’API" />
        </label>
      )}
      <label>
        <span>{info.keyLabel}</span>
        <input type="password" autoComplete="off" value={draft.keys[draft.provider] ?? ''} onChange={(e) => setFor('keys', e.target.value)} placeholder={info.keyPlaceholder} aria-label={info.keyLabel} />
      </label>
      <label>
        <span>Modèle</span>
        <input list={`ai-models-${draft.provider}`} value={draft.models[draft.provider] ?? ''} placeholder={info.models[0] ?? 'nom du modèle'} onChange={(e) => setFor('models', e.target.value)} aria-label="Modèle" />
        <datalist id={`ai-models-${draft.provider}`}>
          {info.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      {!onChange && (
        <div className={s.formActions}>
          <Button type="submit" variant="primary" size="sm">
            Enregistrer
          </Button>
          {saved && <span className={s.ok}>{isConfigured(draft) ? `Prêt · ${modelOf(draft)}` : 'Clé manquante'}</span>}
        </div>
      )}
    </form>
  );
}

export function AssistantPanel() {
  const open = useAssistant((a) => a.open);
  const entries = useAssistant((a) => a.entries);
  const busy = useAssistant((a) => a.busy);
  const current = useProjectStore((p) => p.doc);
  const [draft, setDraft] = useState('');
  const [configured, setConfigured] = useState(() => isConfigured(loadAiSettings()));
  const [setup, setSetup] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [entries]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && toggleAssistant(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);
  if (!open) return null;

  const settings = loadAiSettings();
  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    void askAssistant(t);
  };
  const showSetup = !configured || setup;

  return (
    <aside className={[s.panel, 'no-print'].join(' ')} aria-label="Assistant" data-testid="assistant-panel">
      <header className={s.head}>
        <div className={s.title}>
          <strong>Assistant</strong>
          {configured && (
            <button type="button" className={s.model} onClick={() => setSetup(!setup)} title="Fournisseur et modèle">
              {modelOf(settings)}
            </button>
          )}
        </div>
        <div className={s.headActions}>
          {entries.length > 0 && <Button variant="icon" size="sm" icon={<SquarePen {...IC} />} aria-label="Nouvelle conversation" title="Nouvelle conversation" onClick={newConversation} />}
          <Button variant="icon" size="sm" icon={<X {...IC} />} aria-label="Fermer l’assistant" title="Fermer" onClick={() => toggleAssistant(false)} />
        </div>
      </header>

      {showSetup ? (
        <div className={s.setup}>
          <AiSettingsForm
            compact
            onSaved={() => {
              const ok = isConfigured(loadAiSettings());
              setConfigured(ok);
              if (ok) setSetup(false);
              newConversation();
            }}
          />
        </div>
      ) : (
        <div className={s.list} ref={list} aria-live="polite">
          {entries.map((e) => (
            <div key={e.id} className={[s.msg, s[e.role]].join(' ')} data-testid={`assistant-${e.role}`}>
              {e.text && <p>{e.text}</p>}
              {e.changes && e.changes.length > 0 && (
                <div className={s.changes}>
                  <ul>
                    {e.changes.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                  {e.after && e.after === current && (
                    <button type="button" className={s.undo} onClick={() => undo()} data-testid="assistant-undo">
                      <RotateCcw size={12} strokeWidth={1.5} /> Annuler ces modifications
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <p className={s.busy} aria-label="Réponse en cours">…</p>}
        </div>
      )}

      {!showSetup && (
        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={input}
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Demander, analyser, modifier le projet…"
            aria-label="Message à l’assistant"
            data-testid="assistant-input"
          />
          {busy ? (
            <Button variant="icon" icon={<Square {...IC} />} aria-label="Arrêter" title="Arrêter" onClick={stopAssistant} />
          ) : (
            <Button type="submit" variant="icon" icon={<ArrowUp {...IC} />} aria-label="Envoyer" title="Envoyer" disabled={!draft.trim()} data-testid="assistant-send" />
          )}
        </form>
      )}
    </aside>
  );
}
