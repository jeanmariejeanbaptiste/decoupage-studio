import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Maximize2, Minimize2, Paperclip, RotateCcw, RotateCw, Square, SquarePen, X } from 'lucide-react';
import { navigate } from '../../app/router';
import { undo, useProjectStore } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { askAssistant, newConversation, retryAssistant, stopAssistant, toggleAssistant, useAssistant } from './assistant';
import { acceptsFiles, loadAiSettings, modelOf, type ChatFile } from './providers';
import { useUi } from '../../store/uiStore';
import s from './AssistantPanel.module.css';

const IC = { size: 15, strokeWidth: 1.4 } as const;
/** Taille maximale d'un document joint (au-delà, le service le refuse de toute façon). */
const MAX_FILE = 20 * 1024 * 1024;

function toBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export function AssistantPanel() {
  const open = useAssistant((a) => a.open);
  const entries = useAssistant((a) => a.entries);
  const busy = useAssistant((a) => a.busy);
  const current = useProjectStore((p) => p.doc);
  const full = useAssistant((a) => !!a.full);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<ChatFile[]>([]);
  const picker = useRef<HTMLInputElement>(null);
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
    // Échap : le plein écran se referme d'abord, puis l'assistant.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (useAssistant.getState().full) useAssistant.setState({ full: false });
      else toggleAssistant(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);
  if (!open) return null;

  const settings = loadAiSettings();
  const canAttach = acceptsFiles(settings.provider);
  const send = () => {
    const t = draft.trim() || (files.length ? 'Lis ce document.' : '');
    // Pendant une réponse, le brouillon reste dans le champ : seul « Arrêter » agit.
    if (!t || busy) return;
    setDraft('');
    const sent = files;
    setFiles([]);
    void askAssistant(t, false, sent.length ? sent : undefined);
  };
  const attach = async (list: FileList | null) => {
    const read: ChatFile[] = [];
    for (const f of Array.from(list ?? [])) {
      const type = f.type || (/\.(fountain|md|txt|csv)$/i.test(f.name) ? 'text/plain' : '');
      if (f.size > MAX_FILE) {
        useUi.getState().toast({ message: `« ${f.name} » dépasse 20 Mo : non joint.`, tone: 'warn' });
        continue;
      }
      if (type.startsWith('image/') || type === 'application/pdf') read.push({ name: f.name, mediaType: type, base64: await toBase64(f) });
      else if (type.startsWith('text/') || type === 'application/json') read.push({ name: f.name, mediaType: 'text/plain', text: await f.text() });
      else useUi.getState().toast({ message: `« ${f.name} » : format non lu (PDF, image ou texte).`, tone: 'warn' });
    }
    setFiles((cur) => [...cur, ...read]);
    input.current?.focus();
  };

  return (
    <aside className={[s.panel, full ? s.full : '', 'no-print'].join(' ')} aria-label="Assistant" data-testid="assistant-panel">
      <header className={s.head}>
        <div className={s.title}>
          <strong>Assistant</strong>
          <button type="button" className={s.model} onClick={() => navigate('settings', { section: 'assistant' })} title="Paramètres de l’assistant">
            {modelOf(settings)}
          </button>
        </div>
        <div className={s.headActions}>
          {entries.length > 0 && <Button variant="icon" size="sm" icon={<SquarePen {...IC} />} aria-label="Nouvelle conversation" title="Nouvelle conversation" onClick={newConversation} />}
          <Button
            variant="icon"
            size="sm"
            icon={full ? <Minimize2 {...IC} /> : <Maximize2 {...IC} />}
            aria-label={full ? 'Réduire' : 'Plein écran'}
            title={full ? 'Réduire' : 'Plein écran'}
            aria-pressed={full}
            onClick={() => useAssistant.setState({ full: !full })}
            data-testid="assistant-full"
          />
          <Button variant="icon" size="sm" icon={<X {...IC} />} aria-label="Fermer l’assistant" title="Fermer" onClick={() => toggleAssistant(false)} />
        </div>
      </header>

      <div className={s.list} ref={list} aria-live="polite">
        {entries.map((e) => (
          <div key={e.id} className={[s.msg, s[e.role]].join(' ')} data-testid={`assistant-${e.role}`}>
            {e.files && e.files.length > 0 && (
              <ul className={s.files}>
                {e.files.map((f, i) => (
                  <li key={i}>
                    <FileText size={12} strokeWidth={1.4} aria-hidden="true" /> {f.name}
                  </li>
                ))}
              </ul>
            )}
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

      {files.length > 0 && (
        <ul className={[s.files, s.pending].join(' ')} data-testid="assistant-files">
          {files.map((f, i) => (
            <li key={i}>
              <FileText size={12} strokeWidth={1.4} aria-hidden="true" /> {f.name}
              <button type="button" aria-label={`Retirer ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))}>
                <X size={11} strokeWidth={1.6} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {canAttach && (
          <>
            <Button variant="icon" icon={<Paperclip {...IC} />} aria-label="Joindre un document" title="Joindre un document (PDF, image, texte)" onClick={() => picker.current?.click()} data-testid="assistant-attach" />
            <input
              ref={picker}
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,text/csv,.fountain,.md,.txt,.csv"
              className="visually-hidden"
              tabIndex={-1}
              onChange={(e) => {
                void attach(e.target.files);
                e.target.value = '';
              }}
              data-testid="assistant-file-input"
            />
          </>
        )}
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
          <Button type="submit" variant="icon" icon={<ArrowUp {...IC} />} aria-label="Envoyer" title="Envoyer" disabled={!draft.trim() && !files.length} data-testid="assistant-send" />
        )}
      </form>
    </aside>
  );
}
