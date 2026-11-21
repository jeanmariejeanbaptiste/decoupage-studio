import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, createSession, parseJson, probeProvider, type AiSettings } from './providers';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const OPENROUTER = {
  data: [
    { id: 'google/gemini-2.5-flash:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
    { id: 'meta-llama/llama-4-maverick:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
    { id: 'mistralai/mistral-7b:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['temperature'] },
    { id: 'anthropic/claude-haiku-5.5', pricing: { prompt: '0.000001', completion: '0.000005' }, supported_parameters: ['tools'] },
    { id: 'openai/gpt-5-mini', pricing: { prompt: '0.0000003', completion: '0.000002' }, supported_parameters: ['tools'] },
    { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
  ],
};

/** OpenRouter simulé : la liste, puis un essai par modèle (les modèles « occupés » répondent 429). */
function route(busy: string[]) {
  const tried: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return json(OPENROUTER);
      const model = (JSON.parse(String(init.body)) as { model: string }).model;
      tried.push(model);
      return busy.includes(model) ? json({ error: { message: 'Rate limited' } }, 429) : json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    }),
  );
  return tried;
}

const settings: AiSettings = { provider: 'openrouter', keys: { openrouter: 'sk-or-test-1234567890' }, models: {} };

afterEach(() => vi.unstubAllGlobals());

describe('essai de la clé', () => {
  it('ne garde que les modèles qui répondent, gratuits à part, et retient le meilleur gratuit', async () => {
    const tried = route(['meta-llama/llama-4-maverick:free']);
    const r = await probeProvider(settings);
    // Sans outils (assistant inutilisable) ou à prix variable : pas essayés.
    expect(tried.sort()).toEqual(['anthropic/claude-haiku-5.5', 'google/gemini-2.5-flash:free', 'meta-llama/llama-4-maverick:free', 'openai/gpt-5-mini']);
    expect(r.models).toEqual([
      { id: 'anthropic/claude-haiku-5.5', free: false },
      { id: 'google/gemini-2.5-flash:free', free: true },
      { id: 'openai/gpt-5-mini', free: false },
    ]);
    expect(r.model).toBe('google/gemini-2.5-flash:free');
    expect(r.listed).toBe(true);
  });

  it('garde le modèle déjà choisi s’il répond ; sinon le meilleur payant quand aucun gratuit ne répond', async () => {
    route([]);
    expect((await probeProvider({ ...settings, models: { openrouter: 'openai/gpt-5-mini' } })).model).toBe('openai/gpt-5-mini');
    route(['google/gemini-2.5-flash:free', 'meta-llama/llama-4-maverick:free']);
    expect((await probeProvider(settings)).model).toBe('anthropic/claude-haiku-5.5');
  });

  it('aucun modèle ne répond : l’erreur du fournisseur', async () => {
    route(OPENROUTER.data.map((m) => m.id));
    await expect(probeProvider(settings)).rejects.toThrow('Limite de requêtes');
  });
});

describe('réponse illisible', () => {
  it('une page HTML au lieu de JSON : une erreur en français, pas une exception technique', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><html>Portail Wi-Fi</html>', { status: 200 })));
    const session = createSession({ ...settings, models: { openrouter: 'openai/gpt-5-mini' } }, 'système', []);
    session.addUser('Bonjour');
    await expect(session.step()).rejects.toThrow(new AiError('Réponse illisible du service (adresse ou réseau à vérifier).'));
    expect(() => parseJson('<html>')).toThrow(AiError);
  });

  it('revient en arrière dans l’historique après un tour en échec', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
      }),
    );
    const session = createSession({ ...settings, models: { openrouter: 'openai/gpt-5-mini' } }, 'système', []);
    const mark = session.size();
    session.addUser('Perdu');
    session.truncate(mark);
    session.addUser('Bonjour');
    await session.step();
    const messages = (bodies[0] as { messages: Array<{ role: string; content: string }> }).messages;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1].content).toBe('Bonjour');
  });
});
