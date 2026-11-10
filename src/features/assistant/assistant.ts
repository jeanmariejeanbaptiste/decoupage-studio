import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { create } from 'zustand';
import { AI_SYSTEM, AI_TOOLS, runAiTool, type ToolOutcome } from '../../domain/aiTools';
import { shotCode, sequenceHeading } from '../../domain/numbering';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { AiError, createSession, isConfigured, loadAiSettings, modelOf, type ChatSession } from './providers';

enablePatches();

export interface ChatEntry {
  id: number;
  role: 'user' | 'assistant' | 'error';
  text: string;
  /** Modifications appliquées au projet pendant ce tour (une seule étape d'annulation). */
  changes?: string[];
  /** Projet juste après ces modifications : « Annuler » n'est proposé que s'il n'a pas changé depuis. */
  after?: ProjectDoc;
}

interface AssistantState {
  open: boolean;
  busy: boolean;
  entries: ChatEntry[];
  session: ChatSession | null;
  abort: AbortController | null;
}

export const useAssistant = create<AssistantState>(() => ({ open: false, busy: false, entries: [], session: null, abort: null }));

let seq = 0;
const push = (e: Omit<ChatEntry, 'id'>) => {
  const id = ++seq;
  useAssistant.setState((s) => ({ entries: [...s.entries, { ...e, id }] }));
  return id;
};
const patchEntry = (id: number, p: Partial<ChatEntry>) => useAssistant.setState((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) }));

export function toggleAssistant(open = !useAssistant.getState().open) {
  useAssistant.setState({ open });
}

export function newConversation() {
  useAssistant.getState().abort?.abort();
  useAssistant.setState({ entries: [], session: null, busy: false, abort: null });
}

export function stopAssistant() {
  useAssistant.getState().abort?.abort();
}

const ROUTE_LABEL: Record<string, string> = {
  intention: 'Note d’intention',
  scenario: 'Scénario',
  breakdown: 'Dépouillement',
  grid: 'Découpage technique',
  storyboard: 'Storyboard',
  floorplan: 'Plan au sol',
  equipment: 'Listes de matériel',
  schedule: 'Plan de travail',
  callsheet: 'Feuille de service',
  export: 'Exporter',
  registry: 'Registre',
};

/** Où en est l'utilisateur : page affichée et plan sélectionné (pour « ce plan », « cette séquence »). */
function context(doc: ProjectDoc): string {
  const route = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = [`page : ${ROUTE_LABEL[route] ?? route ?? 'accueil'}`];
  const sel = useUi.getState().selection;
  if (sel && !sel.auto && route === 'grid') {
    const rows = doc.project.sequenceIds.flatMap((id) => doc.sequences[id]?.shotIds ?? []);
    const shotId = rows[sel.focus.row];
    if (shotId && doc.shots[shotId]) parts.push(`plan sélectionné : ${shotCode(doc, shotId)} (${sequenceHeading(doc, doc.shots[shotId].sequenceId)})`);
  }
  return `[Contexte — ${parts.join(' ; ')}]`;
}

/** Envoie un message : le modèle lit et modifie le projet par ses outils, en un seul pas d'annulation. */
export async function askAssistant(text: string): Promise<void> {
  const msg = text.trim();
  const st = useAssistant.getState();
  if (!msg || st.busy) return;
  const settings = loadAiSettings();
  if (!isConfigured(settings)) {
    push({ role: 'error', text: 'Choisissez un fournisseur et renseignez sa clé.' });
    return;
  }
  const base = useProjectStore.getState().doc;
  if (!base) return;
  let session = st.session;
  if (!session || session.provider !== settings.provider || session.model !== modelOf(settings)) session = createSession(settings, AI_SYSTEM, AI_TOOLS);
  const abort = new AbortController();
  useAssistant.setState({ busy: true, session, abort });
  push({ role: 'user', text: msg });
  session.addUser(`${context(base)}\n${msg}`);
  let work: ProjectDoc = base;
  const patches: Patch[] = [];
  const changes: string[] = [];
  let reply = -1;
  let said = '';
  try {
    for (let round = 0; round < 12; round++) {
      const r = await session.step(abort.signal);
      if (r.text.trim()) {
        said = said ? `${said}\n\n${r.text.trim()}` : r.text.trim();
        if (reply < 0) reply = push({ role: 'assistant', text: said });
        else patchEntry(reply, { text: said });
      }
      if (r.stop === 'refusal') {
        push({ role: 'error', text: 'L’assistant a décliné cette demande.' });
        break;
      }
      if (!r.calls.length) {
        if (r.stop === 'max_tokens') push({ role: 'error', text: 'Réponse tronquée.' });
        break;
      }
      const results = r.calls.map((c) => {
        let out: ToolOutcome = { result: '' };
        const [next, p] = produceWithPatches(work, (d) => {
          out = runAiTool(d as ProjectDoc, c.name, c.input);
        });
        work = next;
        patches.push(...p);
        if (out.change) changes.push(out.change);
        return { id: c.id, name: c.name, output: out.result, isError: out.isError };
      });
      session.addToolResults(results);
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') push({ role: 'error', text: e instanceof AiError ? e.message : `Erreur : ${(e as Error).message}` });
  } finally {
    if (patches.length) {
      mutateDoc((d) => void applyPatches(d, patches));
      const after = useProjectStore.getState().doc ?? undefined;
      if (reply < 0) reply = push({ role: 'assistant', text: '' });
      patchEntry(reply, { changes, after });
    }
    useAssistant.setState({ busy: false, abort: null });
  }
}
