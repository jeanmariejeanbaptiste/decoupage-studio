/**
 * État de l'assistant : il n'est proposé (bouton de la barre du haut, palette, panneau) que si ses
 * réglages ont été essayés et répondent. Le dernier essai réussi est gardé dans ce navigateur, par
 * fournisseur, clé et adresse ; au lancement, l'essai est refait sans bruit.
 */
import { create } from 'zustand';
import { isConfigured, keyOf, loadAiSettings, modelOf, probeProvider, saveAiSettings, tryModel, type AiSettings, type ModelEntry, type ProbeResult } from './providers';

export interface Verified {
  models: ModelEntry[];
  listed: boolean;
  at: number;
}

const STORE = 'ds-ai-status';
/** Accès retenus (un essai par fournisseur suffit à passer de l'un à l'autre sans tout réessayer). */
const KEEP = 6;

/** Empreinte d'un accès (fournisseur, clé, adresse) : la clé elle-même n'est pas recopiée. */
export function accessOf(s: AiSettings): string {
  const text = `${s.provider}\n${keyOf(s)}\n${s.provider === 'custom' ? (s.baseUrl ?? '').trim() : ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${s.provider}:${(h >>> 0).toString(36)}`;
}

function readAll(): Record<string, Verified> {
  try {
    return (JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Verified>) ?? {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Verified>): void {
  const kept = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, KEEP);
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* stockage indisponible : l'essai vaut pour la session */
  }
}

/** Dernier essai réussi pour cet accès. */
export const verifiedFor = (s: AiSettings): Verified | undefined => readAll()[accessOf(s)];

/** Réglages essayés et dont le modèle a répondu. */
export function isReady(s: AiSettings): boolean {
  const v = verifiedFor(s);
  return isConfigured(s) && !!v && v.models.some((m) => m.id === modelOf(s));
}

interface AiStatus {
  ready: boolean;
  /** Vient de devenir disponible : le bouton apparaît avec une courte animation. */
  appear: boolean;
}

export const useAiStatus = create<AiStatus>(() => ({ ready: isReady(loadAiSettings()), appear: false }));

/** Recalcule l'état d'après les réglages enregistrés. */
export function refreshAiStatus(): void {
  const ready = isReady(loadAiSettings());
  const was = useAiStatus.getState().ready;
  if (ready !== was) useAiStatus.setState({ ready, appear: ready });
}

export function rememberProbe(s: AiSettings, r: ProbeResult): void {
  writeAll({ ...readAll(), [accessOf(s)]: { models: r.models, listed: r.listed, at: Date.now() } });
  refreshAiStatus();
}

export function forgetProbe(s: AiSettings): void {
  const all = readAll();
  delete all[accessOf(s)];
  writeAll(all);
  refreshAiStatus();
}

let checking = false;

/**
 * Essai silencieux des réglages enregistrés (au lancement) : le modèle choisi d'abord ; s'il ne répond
 * plus, un essai complet en retient un autre ; sinon l'assistant n'est plus proposé.
 */
export async function recheckAi(): Promise<void> {
  const s = loadAiSettings();
  if (checking || !isConfigured(s)) return refreshAiStatus();
  checking = true;
  try {
    if (isReady(s)) {
      try {
        await tryModel(s, modelOf(s));
        return;
      } catch {
        /* essai complet ci-dessous */
      }
    }
    try {
      const r = await probeProvider(s);
      const now = loadAiSettings();
      if (accessOf(now) !== accessOf(s)) return;
      if (modelOf(now) !== r.model && !r.models.some((m) => m.id === modelOf(now))) saveAiSettings({ ...now, models: { ...now.models, [now.provider]: r.model } });
      rememberProbe(s, r);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') forgetProbe(s);
    }
  } finally {
    checking = false;
  }
}
