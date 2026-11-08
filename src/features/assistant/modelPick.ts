/**
 * Choix du modèle : parmi les modèles qu'une clé donne réellement, le meilleur des plus rapides
 * (Claude Haiku, GPT mini, Gemini Flash, Mistral Small), la version la plus récente et stable d'abord.
 */
import type { ProviderId } from './providers';

/** Modèles qui ne servent pas à converser (images, voix, vecteurs, modération…). */
const NOT_CHAT = /embed|tts|whisper|dall-?e|image|audio|realtime|moderation|transcri|search|ocr|guard|aqa|imagen|veo|learnlm|computer-use|codex|instruct$/i;

/** Version numérique d'un nom (« 2.5 », « 5-5 », « 4.1 ») ; 0 si aucune. */
function version(text: string): number {
  const m = /(\d+)(?:[.-](\d{1,2})(?!\d))?/.exec(text);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0) : 0;
}

interface Scored {
  id: string;
  /** Gamme : 0 = la plus rapide. */
  tier: number;
  /** 1 = préversion ou expérimental (après les versions stables). */
  preview: number;
  version: number;
  /** 1 = variante datée d'un alias (après l'alias). */
  dated: number;
}

function anthropicScore(id: string): Scored | null {
  const m = /^claude-(haiku|sonnet|opus)-(\d+(?:-\d{1,2})?)(?:-\d{8})?$/.exec(id) ?? /^claude-(\d+(?:-\d)?)-(haiku|sonnet|opus)(?:-\d{8})?$/.exec(id);
  if (!m) return null;
  const family = /haiku|sonnet|opus/.exec(id)![0];
  return { id, tier: ['haiku', 'sonnet', 'opus'].indexOf(family), preview: 0, version: version(id.replace(/-\d{8}$/, '').replace(/^claude-/, '').replace(/haiku|sonnet|opus/, '')), dated: /-\d{8}$/.test(id) ? 1 : 0 };
}

function openAiScore(id: string): Scored | null {
  const m = /^(?:openai\/)?gpt-(\d+(?:\.\d+)?)(?:-(mini|nano))?(-\d{4}-\d{2}-\d{2}|-latest)?$/.exec(id);
  if (!m) return null;
  return { id, tier: m[2] === 'mini' ? 0 : m[2] ? 2 : 1, preview: 0, version: Number(m[1]), dated: m[3] ? 1 : 0 };
}

function geminiScore(id: string): Scored | null {
  const m = /^(?:google\/)?gemini-(\d+(?:\.\d+)?)-(flash|pro)(-lite)?(-(?:preview|exp)[\w.-]*|-\d{3})?$/.exec(id);
  if (!m) return null;
  return { id, tier: m[2] === 'flash' && !m[3] ? 0 : m[2] === 'pro' ? 1 : 2, preview: m[4] && !/^-\d{3}$/.test(m[4]) ? 1 : 0, version: Number(m[1]), dated: m[4] ? 1 : 0 };
}

function mistralScore(id: string): Scored | null {
  const m = /^(?:mistralai\/)?(mistral-(small|medium|large)|ministral-\w+|magistral-(small|medium))(-latest|-\d{4})?$/.exec(id);
  if (!m) return null;
  const size = m[2] ?? (m[1].startsWith('ministral') ? 'mini' : `magistral-${m[3]}`);
  const tier = { small: 0, medium: 1, large: 2, 'magistral-small': 3, 'magistral-medium': 4, mini: 5 }[size] ?? 6;
  return { id, tier, preview: 0, version: m[4] && m[4] !== '-latest' ? Number(m[4].slice(1)) : 9999, dated: 0 };
}

const byScore = (a: Scored, b: Scored) => a.tier - b.tier || a.preview - b.preview || b.version - a.version || a.dated - b.dated || a.id.localeCompare(b.id);

/** Modèles de conversation, du plus conseillé au moins conseillé. */
export function rankModels(provider: ProviderId, ids: readonly string[]): string[] {
  const chat = [...new Set(ids.map((x) => x.replace(/^models\//, '').trim()))].filter((x) => x && !NOT_CHAT.test(x));
  if (provider === 'custom') return chat;
  if (provider === 'openrouter') {
    // Les familles rapides des grands fournisseurs (Claude Haiku, Gemini Flash, GPT mini), puis le reste.
    const haiku = chat.filter((x) => /^anthropic\/claude-haiku-[\d.]+$/.test(x)).sort((a, b) => version(b.slice(21)) - version(a.slice(21)));
    const flash = rank(chat.filter((x) => x.startsWith('google/')), geminiScore).filter((x) => /-flash$/.test(x));
    const mini = rank(chat.filter((x) => x.startsWith('openai/')), openAiScore).filter((x) => /-mini$/.test(x));
    return [...new Set([...haiku, ...flash, ...mini, ...chat])];
  }
  const score = provider === 'anthropic' ? anthropicScore : provider === 'openai' ? openAiScore : provider === 'gemini' ? geminiScore : mistralScore;
  const known = rank(chat, score);
  return [...known, ...chat.filter((x) => !known.includes(x))];
}

function rank(ids: readonly string[], score: (id: string) => Scored | null): string[] {
  return ids
    .map((id) => score(id))
    .filter((x): x is Scored => !!x)
    .sort(byScore)
    .map((x) => x.id);
}
