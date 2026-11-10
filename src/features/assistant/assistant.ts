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
  /** Erreur d'un tour resté sans effet : la demande à renvoyer. */
  retry?: string;
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

/** Tour en cours : une nouvelle conversation le rend caduc (ses modifications et messages sont écartés). */
let turn = 0;

export function newConversation() {
  turn++;
  useAssistant.getState().abort?.abort();
  useAssistant.setState({ entries: [], session: null, busy: false, abort: null });
}

// Un autre projet ouvert : la conversation parlait de l'ancien (numéros, séquences), on repart de zéro.
let openProject = useProjectStore.getState().doc?.project.id;
useProjectStore.subscribe((st) => {
  const id = st.doc?.project.id;
  if (id === openProject) return;
  openProject = id;
  if (useAssistant.getState().entries.length || useAssistant.getState().busy) newConversation();
});

/** Renvoie la demande d'un tour en échec, à la place de son message d'erreur. */
export function retryAssistant(entryId: number) {
  const st = useAssistant.getState();
  const e = st.entries.find((x) => x.id === entryId);
  if (!e?.retry || st.busy) return;
  useAssistant.setState({ entries: st.entries.filter((x) => x.id !== entryId) });
  void askAssistant(e.retry, true);
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
  calendar: 'Calendrier',
  production: 'Calendrier de production',
  checks: 'Vérifications',
  settings: 'Paramètres',
};

/** Où en est l'utilisateur : page affichée et plan sélectionné (pour « ce plan », « cette séquence »). */
function context(doc: ProjectDoc): string {
  const route = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = [`page : ${ROUTE_LABEL[route] || 'accueil'}`];
  const sel = useUi.getState().selection;
  if (sel && !sel.auto && route === 'grid') {
    const rows = doc.project.sequenceIds.flatMap((id) => doc.sequences[id]?.shotIds ?? []);
    const shotId = rows[sel.focus.row];
    if (shotId && doc.shots[shotId]) parts.push(`plan sélectionné : ${shotCode(doc, shotId)} (${sequenceHeading(doc, doc.shots[shotId].sequenceId)})`);
  }
  return `[Contexte — ${parts.join(' ; ')}]`;
}

/** Envoie un message : le modèle lit et modifie le projet par ses outils, en un seul pas d'annulation. */
export async function askAssistant(text: string, resend = false): Promise<void> {
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
  const mine = ++turn;
  useAssistant.setState({ busy: true, session, abort });
  if (!resend) push({ role: 'user', text: msg });
  const mark = session.size();
  session.addUser(`${context(base)}\n${msg}`);
  let work: ProjectDoc = base;
  const patches: Patch[] = [];
  const changes: string[] = [];
  /** Appels qui ont modifié le brouillon : rejoués si le projet a bougé pendant la réponse. */
  const writes: { name: string; input: unknown }[] = [];
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
        if (p.length) writes.push({ name: c.name, input: c.input });
        if (out.change) changes.push(out.change);
        return { id: c.id, name: c.name, output: out.result, isError: out.isError };
      });
      session.addToolResults(results);
    }
  } catch (e) {
    // Rien n'est arrivé de ce tour : l'historique revient à son état d'avant, la demande peut être renvoyée.
    const empty = reply < 0 && !patches.length;
    if (empty) session.truncate(mark);
    if ((e as Error).name !== 'AbortError' && mine === turn) push({ role: 'error', text: e instanceof AiError ? e.message : `Erreur : ${(e as Error).message}`, retry: empty ? msg : undefined });
  } finally {
    try {
      // Conversation abandonnée (nouvelle conversation, autre projet) : rien n'est versé.
      if (patches.length && mine === turn) {
        const applied = commit(base, patches, writes);
        if (applied) {
          const after = useProjectStore.getState().doc ?? undefined;
          if (reply < 0) reply = push({ role: 'assistant', text: '' });
          patchEntry(reply, { changes: applied === true ? changes : applied, after });
        } else push({ role: 'error', text: 'Projet changé pendant la réponse : modifications non appliquées.' });
      }
    } finally {
      if (mine === turn) useAssistant.setState({ busy: false, abort: null });
    }
  }
}

/**
 * Verse les modifications d'un tour dans le projet, en une étape d'annulation. Projet intact :
 * les patches tels quels (true). Modifié entre-temps : les appels sont rejoués par les opérations du
 * domaine, qui gardent les invariants (liste des modifications recalculée). Autre projet : rien (false).
 */
function commit(base: ProjectDoc, patches: Patch[], writes: { name: string; input: unknown }[]): true | string[] | false {
  const cur = useProjectStore.getState().doc;
  if (!cur || cur.project.id !== base.project.id) return false;
  if (cur === base) {
    mutateDoc((d) => void applyPatches(d, patches));
    return true;
  }
  const changes: string[] = [];
  mutateDoc((d) => {
    for (const w of writes) {
      const out = runAiTool(d, w.name, w.input);
      if (out.change && !out.isError) changes.push(out.change);
    }
  });
  return changes.length ? changes : false;
}
