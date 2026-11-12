import { describe, expect, it } from 'vitest';
import { packJson, unpackJson } from './linkPayload';

describe('données portées par un lien', () => {
  it('compresse et relit à l’identique, en caractères sûrs pour une adresse', async () => {
    const v = { titre: 'Séquence « Gare » — été', plans: Array.from({ length: 200 }, (_, i) => ({ n: i, action: 'Léa traverse le hall.' })) };
    const s = await packJson(v);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeLessThan(JSON.stringify(v).length / 4);
    expect(await unpackJson(s)).toEqual(v);
  });
  it('refuse un contenu abîmé', async () => {
    await expect(unpackJson('pas-un-lien')).rejects.toThrow();
  });
});
