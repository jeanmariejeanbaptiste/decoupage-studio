import { afterEach, describe, expect, it, vi } from 'vitest';
import { blocksFromSource } from '../../domain/screenplay';
import { readScenarioFile } from './readScenarioFile';
import { scriptDocx } from './scriptExport';

describe('aller-retour Word', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('un .docx exporté puis réimporté garde sa page de garde (titre et auteur seuls)', async () => {
    // Polices du .docx : le contenu importe peu ici.
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(64)));
    const source = 'Title: Long essai\nAuthor: Test\n\nINT. LIEU 0 - JOUR\n\nUne action.\n\nLÉA\nUne réplique.\n\nEXT. LIEU 1 - NUIT\n\nLa suite.\n';
    const blob = await scriptDocx(source, { title: 'Long essai' });
    // Le Blob de jsdom n'a pas arrayBuffer() : lecture par FileReader.
    const buf = await new Promise<ArrayBuffer>((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(r.result as ArrayBuffer);
      r.onerror = () => ko(r.error);
      r.readAsArrayBuffer(blob);
    });
    const file = { name: 'long.docx', arrayBuffer: async () => buf } as unknown as File;
    const back = await readScenarioFile(file);
    const blocks = blocksFromSource(back).blocks;
    const title = blocks.find((b) => b.type === 'title');
    expect(title?.text).toMatch(/Title: LONG ESSAI/i);
    expect(title?.text).toMatch(/Author: Test/);
    // Le film commence à la première séquence, sans action ajoutée devant.
    const body = blocks.filter((b) => b.type !== 'title' && b.text.trim());
    expect(body[0]).toMatchObject({ type: 'heading', text: 'INT. LIEU 0 - JOUR' });
    expect(body.map((b) => b.type)).toEqual(blocksFromSource(source).blocks.filter((b) => b.type !== 'title' && b.text.trim()).map((b) => b.type));
  });
});
