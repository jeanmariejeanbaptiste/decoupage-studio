import { ASSISTANT_SYSTEM, buildUserPrompt, parseProposal, proposalSchema, type ProposedShot } from '../../domain/assistant';
import type { ID, ProjectDoc } from '../../domain/types';

const KEY = 'ds-anthropic-key';
export const ASSISTANT_MODEL = 'claude-opus-5-5';

/** La clé reste dans ce navigateur (localStorage) : jamais dans le projet, donc jamais exportée. */
export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(KEY, key.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** Demande un découpage de départ pour une séquence (SDK chargé à la demande). */
export async function proposeShots(doc: ProjectDoc, seqId: ID): Promise<ProposedShot[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Aucune clé API : renseignez-la dans les Réglages.');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    const response = await client.beta.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: proposalSchema() } },
      system: ASSISTANT_SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(doc, seqId) }],
    });
    if (response.stop_reason === 'refusal') throw new Error('L’assistant a décliné cette demande.');
    if (response.stop_reason === 'max_tokens') throw new Error('Réponse tronquée : réessayez avec une séquence plus courte.');
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return parseProposal(JSON.parse(text));
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Clé API refusée.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Limite de requêtes atteinte : réessayez plus tard.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Connexion à l’API impossible.');
    if (e instanceof Anthropic.APIError) throw new Error(`Erreur de l’API (${e.status}).`);
    throw e;
  }
}
