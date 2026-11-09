import { describe, expect, it } from 'vitest';
import { boundedBlob, TooLargeError } from './reviewDrive';

describe('fichiers nommés par un relecteur', () => {
  it('lus jusqu’à une taille bornée, coupés au-delà', async () => {
    const bytes = new Uint8Array(3000);
    expect((await boundedBlob(new Response(bytes, { headers: { 'content-type': 'image/png' } }), 5000)).size).toBe(3000);
    await expect(boundedBlob(new Response(bytes), 1000)).rejects.toBeInstanceOf(TooLargeError);
    // Taille annoncée trop grande : rien n'est lu.
    await expect(boundedBlob(new Response(bytes, { headers: { 'content-length': '999999' } }), 5000)).rejects.toBeInstanceOf(TooLargeError);
  });
});
