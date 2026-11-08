import { describe, expect, it } from 'vitest';
import { rankModels } from './modelPick';

describe('choix du modèle le plus rapide disponible', () => {
  it('Anthropic : Haiku le plus récent, puis Sonnet, puis Opus', () => {
    expect(rankModels('anthropic', ['claude-opus-5-5', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-haiku-5-5', 'claude-sonnet-5-5']).slice(0, 3)).toEqual(['claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-5-5']);
  });
  it('OpenAI : GPT mini le plus récent, sans les modèles de voix ni d’images', () => {
    expect(rankModels('openai', ['gpt-image-1', 'gpt-4o-mini-tts', 'gpt-5', 'gpt-5-mini-2025-08-07', 'gpt-5-mini', 'gpt-4.1-mini', 'text-embedding-3-small', 'gpt-5-nano'])[0]).toBe('gpt-5-mini');
  });
  it('Gemini : Flash stable le plus récent avant les préversions et Lite', () => {
    expect(rankModels('gemini', ['models/gemini-2.5-pro', 'models/gemini-2.5-flash-lite', 'models/gemini-2.5-flash', 'models/gemini-3.0-flash-preview-05', 'models/text-embedding-004'])[0]).toBe('gemini-2.5-flash');
  });
  it('Mistral : Small, alias « latest » d’abord', () => {
    expect(rankModels('mistral', ['mistral-large-latest', 'mistral-small-2506', 'mistral-small-latest', 'mistral-embed', 'codestral-latest'])[0]).toBe('mistral-small-latest');
  });
  it('OpenRouter : Claude Haiku, puis Gemini Flash, puis GPT mini', () => {
    expect(rankModels('openrouter', ['openai/gpt-5-mini', 'google/gemini-2.5-flash', 'anthropic/claude-haiku-4.5', 'anthropic/claude-haiku-5.5', 'meta/llama'])[0]).toBe('anthropic/claude-haiku-5.5');
  });
});
