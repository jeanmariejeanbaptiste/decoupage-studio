/**
 * Fournisseurs d'IA de l'assistant : Anthropic (SDK officiel), OpenAI, Google Gemini, Mistral,
 * OpenRouter et tout service compatible OpenAI (Ollama, LM Studio…). Chaque fournisseur garde
 * l'historique dans son propre format ; l'assistant ne voit qu'un tour normalisé.
 */
import type { ToolDef } from '../../domain/aiTools';

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'mistral' | 'openrouter' | 'custom';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  models: string[];
  keyLabel: string;
  keyPlaceholder: string;
  /** Adresse de l'API (compatible OpenAI). */
  baseUrl?: string;
  keyOptional?: boolean;
  /** Page du fournisseur où l'on crée sa clé. */
  keyUrl?: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], keyLabel: 'Clé API Anthropic', keyPlaceholder: 'sk-ant-…', keyUrl: 'https://platform.claude.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', models: ['gpt-5-mini', 'gpt-5'], keyLabel: 'Clé API OpenAI', keyPlaceholder: 'sk-…', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro'], keyLabel: 'Clé API Gemini', keyPlaceholder: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'mistral', label: 'Mistral', models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'], keyLabel: 'Clé API Mistral', keyPlaceholder: '', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/home?profile_dialog=api-keys' },
  { id: 'openrouter', label: 'OpenRouter', models: ['anthropic/claude-haiku-5.5', 'google/gemini-2.5-flash', 'openai/gpt-5-mini'], keyLabel: 'Clé API OpenRouter', keyPlaceholder: 'sk-or-…', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'custom', label: 'Autre (compatible OpenAI)', models: [], keyLabel: 'Clé API (facultative)', keyPlaceholder: '', baseUrl: 'http://localhost:11434/v1', keyOptional: true },
];

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

// --- Réglages, gardés dans ce navigateur (jamais dans le projet ni l'export) ---------------------

export interface AiSettings {
  provider: ProviderId;
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  baseUrl?: string;
}

const STORE = 'ds-ai';
const LEGACY_KEY = 'ds-anthropic-key';

export function loadAiSettings(): AiSettings {
  let s: AiSettings = { provider: 'anthropic', keys: {}, models: {} };
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) s = { ...s, ...(JSON.parse(raw) as AiSettings) };
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && !s.keys.anthropic) s.keys.anthropic = legacy;
  } catch {
    /* stockage indisponible */
  }
  return s;
}

export function saveAiSettings(s: AiSettings): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* stockage indisponible : réglages valables pour la session */
  }
}

export const modelOf = (s: AiSettings) => s.models[s.provider]?.trim() || providerInfo(s.provider).models[0] || '';
export const keyOf = (s: AiSettings) => s.keys[s.provider]?.trim() ?? '';
export const isConfigured = (s: AiSettings) => (!!keyOf(s) || !!providerInfo(s.provider).keyOptional) && !!modelOf(s);

// --- Tour de conversation normalisé ----------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface TurnResult {
  text: string;
  calls: ToolCall[];
  stop?: 'refusal' | 'max_tokens';
}

export interface ToolResult {
  id: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface ChatSession {
  provider: ProviderId;
  model: string;
  addUser(text: string): void;
  step(signal?: AbortSignal): Promise<TurnResult>;
  addToolResults(results: readonly ToolResult[]): void;
}

export class AiError extends Error {}

function httpError(status: number, detail: string): AiError {
  if (status === 401 || status === 403) return new AiError('Clé API refusée.');
  if (status === 404) return new AiError(`Modèle ou adresse introuvable. ${detail}`.trim());
  if (status === 429) return new AiError('Limite de requêtes atteinte : réessayez dans un instant.');
  if (status >= 500) return new AiError(`Le service ne répond pas (${status}). Réessayez plus tard.`);
  return new AiError(`Erreur ${status} : ${detail}`.trim());
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AiError('Connexion impossible (réseau, adresse ou autorisation du navigateur).');
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      detail = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? detail;
    } catch {
      /* corps non JSON */
    }
    throw httpError(res.status, detail);
  }
  return JSON.parse(text) as unknown;
}

// --- Anthropic : SDK officiel, chargé à la demande ----------------------------------------------

function anthropicSession(key: string, model: string, system: string, tools: readonly ToolDef[]): ChatSession {
  type Msg = { role: 'user' | 'assistant'; content: unknown };
  const messages: Msg[] = [];
  return {
    provider: 'anthropic',
    model,
    addUser: (text) => messages.push({ role: 'user', content: text }),
    addToolResults: (results) =>
      messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output, ...(r.isError ? { is_error: true } : {}) })) }),
    async step(signal) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
      // Repli automatique du serveur en cas de refus (Opus et Sonnet) ; Haiku n'en a pas.
      const fallback = /^claude-(opus|sonnet)-5/.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {};
      try {
        const r = await client.beta.messages.create(
          {
            model,
            max_tokens: 16000,
            system,
            // Sans outils (essai de la clé) : ni liste vide ni choix d'outil, que l'API refuserait.
            ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as { type: 'object' } })), tool_choice: { type: 'auto' as const } } : {}),
            messages: messages as never,
            ...(/^claude-(opus|haiku)-5-5/.test(model) ? { output_config: { effort: 'medium' as const } } : {}),
            ...fallback,
          },
          { signal },
        );
        // Réponse renvoyée telle quelle (blocs de réflexion compris) : l'historique ne se réécrit jamais.
        messages.push({ role: 'assistant', content: r.content });
        const text = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
        const calls = r.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []));
        return { text, calls, stop: r.stop_reason === 'refusal' ? 'refusal' : r.stop_reason === 'max_tokens' ? 'max_tokens' : undefined };
      } catch (e) {
        if (e instanceof Anthropic.APIUserAbortError) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('Clé API refusée.');
        if (e instanceof Anthropic.NotFoundError) throw new AiError(`Modèle introuvable : ${model}.`);
        if (e instanceof Anthropic.RateLimitError) throw new AiError('Limite de requêtes atteinte : réessayez dans un instant.');
        if (e instanceof Anthropic.APIConnectionError) throw new AiError('Connexion à l’API impossible.');
        if (e instanceof Anthropic.APIError) throw new AiError(`Erreur de l’API (${e.status}) : ${e.message}`);
        throw e;
      }
    },
  };
}

// --- OpenAI et compatibles (Mistral, OpenRouter, Ollama…) ----------------------------------------

function openAiSession(provider: ProviderId, baseUrl: string, key: string, model: string, system: string, tools: readonly ToolDef[]): ChatSession {
  type Msg = Record<string, unknown>;
  const messages: Msg[] = [{ role: 'system', content: system }];
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    provider,
    model,
    addUser: (text) => messages.push({ role: 'user', content: text }),
    addToolResults: (results) => results.forEach((r) => messages.push({ role: 'tool', tool_call_id: r.id, content: r.output })),
    async step(signal) {
      const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
      if (provider === 'openrouter') headers['x-title'] = 'Découpage Studio';
      const json = (await postJson(
        url,
        headers,
        {
          model,
          messages,
          ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })), tool_choice: 'auto' } : {}),
        },
        signal,
      )) as { choices?: Array<{ message?: Msg & { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }> };
      const choice = json.choices?.[0];
      const msg = choice?.message;
      if (!msg) throw new AiError('Réponse vide du service.');
      messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
      const calls = (msg.tool_calls ?? []).map((c) => {
        let input: unknown = {};
        try {
          input = JSON.parse(c.function.arguments || '{}');
        } catch {
          input = {};
        }
        return { id: c.id, name: c.function.name, input };
      });
      const stop = choice?.finish_reason === 'length' ? 'max_tokens' : choice?.finish_reason === 'content_filter' ? 'refusal' : undefined;
      return { text: typeof msg.content === 'string' ? msg.content : '', calls, stop };
    },
  };
}

// --- Google Gemini ---------------------------------------------------------------------------------

/** Gemini n'accepte qu'un sous-ensemble du schéma JSON : sans `additionalProperties`. */
function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) if (k !== 'additionalProperties') out[k] = geminiSchema(v);
  return out;
}

function geminiSession(key: string, model: string, system: string, tools: readonly ToolDef[]): ChatSession {
  type Content = { role: 'user' | 'model'; parts: Array<Record<string, unknown>> };
  const contents: Content[] = [];
  let seq = 0;
  return {
    provider: 'gemini',
    model,
    addUser: (text) => contents.push({ role: 'user', parts: [{ text }] }),
    addToolResults: (results) =>
      contents.push({ role: 'user', parts: results.map((r) => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.output } : { result: r.output } } })) }),
    async step(signal) {
      const json = (await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': key },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents,
          ...(tools.length
            ? {
                tools: [
                  {
                    functionDeclarations: tools.map((t) => {
                      const props = (t.schema as { properties?: Record<string, unknown> }).properties ?? {};
                      return Object.keys(props).length ? { name: t.name, description: t.description, parameters: geminiSchema(t.schema) } : { name: t.name, description: t.description };
                    }),
                  },
                ],
              }
            : {}),
        },
        signal,
      )) as { candidates?: Array<{ content?: Content; finishReason?: string }>; promptFeedback?: { blockReason?: string } };
      if (json.promptFeedback?.blockReason) return { text: '', calls: [], stop: 'refusal' };
      const cand = json.candidates?.[0];
      const parts = cand?.content?.parts ?? [];
      // Réponse conservée telle quelle (signatures de réflexion comprises).
      contents.push({ role: 'model', parts });
      const text = parts.map((p) => (typeof p.text === 'string' && !p.thought ? p.text : '')).join('');
      const calls = parts.flatMap((p) => {
        const fc = p.functionCall as { name?: string; args?: unknown; id?: string } | undefined;
        return fc?.name ? [{ id: fc.id ?? `call-${++seq}`, name: fc.name, input: fc.args ?? {} }] : [];
      });
      const stop = cand?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : cand?.finishReason === 'SAFETY' ? 'refusal' : undefined;
      return { text, calls, stop };
    },
  };
}

export function createSession(s: AiSettings, system: string, tools: readonly ToolDef[]): ChatSession {
  const info = providerInfo(s.provider);
  const key = keyOf(s);
  const model = modelOf(s);
  if (s.provider === 'anthropic') return anthropicSession(key, model, system, tools);
  if (s.provider === 'gemini') return geminiSession(key, model, system, tools);
  const base = s.provider === 'custom' ? s.baseUrl?.trim() || info.baseUrl! : info.baseUrl!;
  return openAiSession(s.provider, base, key, model, system, tools);
}

// --- Une question sur une image (vision), sans outils ---------------------------------------------

export interface ImageInput {
  /** image/png, image/jpeg, image/webp ou image/gif. */
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  base64: string;
}

/**
 * Pose une question sur une image au fournisseur réglé et renvoie le texte de la réponse
 * (par exemple : relever les murs d'un plan de locaux). Le modèle doit savoir lire les images.
 */
export async function askWithImage(s: AiSettings, prompt: string, image: ImageInput, signal?: AbortSignal): Promise<string> {
  const key = keyOf(s);
  const model = modelOf(s);
  if (s.provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    try {
      // Réponse longue possible (un mur par ligne) : flux, réponse complète attendue.
      const stream = client.messages.stream(
        {
          model,
          max_tokens: 32000,
          ...(/^claude-(opus|haiku)-5-5/.test(model) ? { output_config: { effort: 'high' as const } } : {}),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
                { type: 'text', text: prompt },
              ],
            },
          ],
        },
        { signal },
      );
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new AiError('Le modèle a refusé la demande.');
      if (msg.stop_reason === 'max_tokens') throw new AiError('Réponse trop longue, interrompue avant la fin.');
      return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('Clé API refusée.');
      if (e instanceof Anthropic.NotFoundError) throw new AiError(`Modèle introuvable : ${model}.`);
      if (e instanceof Anthropic.RateLimitError) throw new AiError('Limite de requêtes atteinte : réessayez dans un instant.');
      if (e instanceof Anthropic.APIConnectionError) throw new AiError('Connexion à l’API impossible.');
      if (e instanceof Anthropic.APIError) throw new AiError(`Erreur de l’API (${e.status}) : ${e.message}`);
      throw e;
    }
  }
  if (s.provider === 'gemini') {
    const json = (await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': key },
      { contents: [{ role: 'user', parts: [{ inline_data: { mime_type: image.mediaType, data: image.base64 } }, { text: prompt }] }] },
      signal,
    )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>; promptFeedback?: { blockReason?: string } };
    if (json.promptFeedback?.blockReason) throw new AiError('Le modèle a refusé la demande.');
    const cand = json.candidates?.[0];
    if (cand?.finishReason === 'MAX_TOKENS') throw new AiError('Réponse trop longue, interrompue avant la fin.');
    return (cand?.content?.parts ?? []).map((p) => (typeof p.text === 'string' && !p.thought ? p.text : '')).join('');
  }
  const info = providerInfo(s.provider);
  const base = s.provider === 'custom' ? s.baseUrl?.trim() || info.baseUrl! : info.baseUrl!;
  const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
  if (s.provider === 'openrouter') headers['x-title'] = 'Découpage Studio';
  const json = (await postJson(
    `${base.replace(/\/+$/, '')}/chat/completions`,
    headers,
    {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } },
          ],
        },
      ],
    },
    signal,
  )) as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };
  const choice = json.choices?.[0];
  if (choice?.finish_reason === 'length') throw new AiError('Réponse trop longue, interrompue avant la fin.');
  if (choice?.finish_reason === 'content_filter') throw new AiError('Le modèle a refusé la demande.');
  return choice?.message?.content ?? '';
}

// --- Vérification de la clé et choix du modèle ------------------------------------------------------

export interface ProbeResult {
  /** Modèle qui a répondu à l'essai (le plus rapide disponible, sauf choix déjà fait et valable). */
  model: string;
  /** Modèles de conversation donnés par la clé, du plus conseillé au moins conseillé. */
  models: string[];
}

const baseOf = (s: AiSettings) => (s.provider === 'custom' ? s.baseUrl || providerInfo('custom').baseUrl! : providerInfo(s.provider).baseUrl ?? '').replace(/\/+$/, '');

async function getJson(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AiError('Connexion impossible (réseau, adresse ou autorisation du navigateur).');
  }
  const text = await res.text();
  if (!res.ok) throw httpError(res.status, text.slice(0, 200));
  return JSON.parse(text) as unknown;
}

/** Modèles que cette clé donne réellement, selon le fournisseur. */
async function listModels(s: AiSettings, signal?: AbortSignal): Promise<string[]> {
  const key = keyOf(s);
  if (s.provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    try {
      const ids: string[] = [];
      for await (const m of client.models.list({ limit: 100 }, { signal })) ids.push(m.id);
      return ids;
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('Clé API refusée.');
      if (e instanceof Anthropic.APIConnectionError) throw new AiError('Connexion à l’API impossible.');
      throw e;
    }
  }
  if (s.provider === 'gemini') {
    const json = (await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': key }, signal)) as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
    };
    return (json.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  }
  const json = (await getJson(`${baseOf(s)}/models`, key ? { authorization: `Bearer ${key}` } : {}, signal)) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id);
}

/** Essai réel et minimal : le modèle répond-il avec cette clé ? */
async function tryModel(s: AiSettings, model: string, signal?: AbortSignal): Promise<void> {
  const session = createSession({ ...s, models: { ...s.models, [s.provider]: model } }, 'Réponds en un mot.', []);
  session.addUser('Réponds « ok ».');
  await session.step(signal);
}

/**
 * Vérifie la clé et choisit le modèle : liste des modèles accessibles, classés du meilleur des plus
 * rapides au plus lent, puis un essai réel (le suivant prend le relais si l'un ne répond pas). Le modèle
 * déjà choisi est gardé s'il est disponible et répond.
 */
export async function probeProvider(s: AiSettings, signal?: AbortSignal): Promise<ProbeResult> {
  if (!keyOf(s) && !providerInfo(s.provider).keyOptional) throw new AiError('Clé manquante.');
  const { rankModels } = await import('./modelPick');
  let models: string[] = [];
  try {
    models = rankModels(s.provider, await listModels(s, signal));
  } catch (e) {
    // Liste indisponible (proxy, serveur local) : les modèles connus sont essayés tels quels.
    if (e instanceof AiError && /refusée/.test(e.message)) throw e;
    if ((e as Error).name === 'AbortError') throw e;
  }
  const chosen = s.models[s.provider]?.trim();
  const candidates = [...new Set([...(chosen && (!models.length || models.includes(chosen)) ? [chosen] : []), ...(models.length ? models : providerInfo(s.provider).models)])].slice(0, 4);
  if (!candidates.length) throw new AiError('Aucun modèle de conversation disponible avec cette clé.');
  let last: unknown;
  for (const model of candidates) {
    try {
      await tryModel(s, model, signal);
      return { model, models };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      if (e instanceof AiError && /refusée/.test(e.message)) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new AiError('Aucun modèle ne répond.');
}

