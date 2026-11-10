import { useEffect, useRef, useState } from 'react';
import { ArrowUp, RotateCcw, RotateCw, Square, SquarePen, X } from 'lucide-react';
import { navigate } from '../../app/router';
import { undo, useProjectStore } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { askAssistant, newConversation, retryAssistant, stopAssistant, toggleAssistant, useAssistant } from './assistant';
import { loadAiSettings, modelOf } from './providers';
import s from './AssistantPanel.module.css';

const IC = { size: 15, strokeWidth: 1.4 } as const;

export function AssistantPanel() {
  const open = useAssistant((a) => a.open);
  const entries = useAssistant((a) => a.entries);
  const busy = useAssistant((a) => a.busy);
  const current = useProjectStore((p) => p.doc);
  const [draft, setDraft] = useState('');
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
    // Pendant une réponse, le brouillon reste dans le champ : seul « Arrêter » agit.
    if (!t || busy) return;
    setDraft('');
    void askAssistant(t);
  };

  return (
    <aside className={[s.panel, 'no-print'].join(' ')} aria-label="Assistant" data-testid="assistant-panel">
      <header className={s.head}>
        <div className={s.title}>
          <strong>Assistant</strong>
          <button type="button" className={s.model} onClick={() => navigate('settings', { section: 'assistant' })} title="Paramètres de l’assistant">
            {modelOf(settings)}
          </button>
        </div>
        <div className={s.headActions}>
          {entries.length > 0 && <Button variant="icon" size="sm" icon={<SquarePen {...IC} />} aria-label="Nouvelle conversation" title="Nouvelle conversation" onClick={newConversation} />}
          <Button variant="icon" size="sm" icon={<X {...IC} />} aria-label="Fermer l’assistant" title="Fermer" onClick={() => toggleAssistant(false)} />
        </div>
      </header>

      <div className={s.list} ref={list} aria-live="polite">
        {entries.map((e) => (
          <div key={e.id} className={[s.msg, s[e.role]].join(' ')} data-testid={`assistant-${e.role}`}>
            {e.text && <p>{e.text}</p>}
            {e.retry && !busy && (
              <button type="button" className={s.undo} onClick={() => retryAssistant(e.id)} data-testid="assistant-retry">
                <RotateCw size={12} strokeWidth={1.5} /> Réessayer
              </button>
            )}
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
    </aside>
  );
}
