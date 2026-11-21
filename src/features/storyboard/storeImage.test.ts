import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const putBlob = vi.fn();
vi.mock('../../store/db', () => ({ putBlob: (...a: unknown[]) => putBlob(...a) }));

const { isQuota, storeImage } = await import('./storeImage');
const { useUi } = await import('../../store/uiStore');

const file = () => new File([new Uint8Array(16)], 'a.png', { type: 'image/png' });

describe('storeImage', () => {
  beforeEach(() => {
    putBlob.mockReset();
    useUi.setState({ toasts: [] });
  });

  it('range une petite image telle quelle', async () => {
    putBlob.mockResolvedValue('p:k');
    const f = file();
    expect(await storeImage('p', f)).toBe('p:k');
    expect(putBlob).toHaveBeenCalledWith('p', 'a.png', f);
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it('stockage plein : un seul message, aucune clé', async () => {
    putBlob.mockRejectedValue(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
    expect(await storeImage('p', file())).toBeUndefined();
    const t = useUi.getState().toasts;
    expect(t).toHaveLength(1);
    expect(t[0].message).toContain('Stockage du navigateur plein');
  });

  it('autre refus du navigateur : message distinct', async () => {
    putBlob.mockRejectedValue(new Error('x'));
    expect(await storeImage('p', file())).toBeUndefined();
    expect(useUi.getState().toasts[0].message).toContain('n’a pas pu');
  });

  it('reconnaît le stockage plein de Firefox et celui enveloppé par Dexie', () => {
    expect(isQuota({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuota({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(true);
    expect(isQuota(new Error('x'))).toBe(false);
    expect(isQuota(null)).toBe(false);
  });
});

/** Image et canevas simulés (jsdom ne décode ni ne dessine) : 6000 × 4000, rendu de `outSize` octets. */
function fakeImaging(outSize: number) {
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: vi.fn() };
  canvas.toBlob.mockImplementation((cb: (b: Blob | null) => void, type: string) => cb(new Blob([new Uint8Array(outSize)], { type })));
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      naturalWidth = 6000;
      naturalHeight = 4000;
      decode = () => Promise.resolve();
    },
  );
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : create(tag))) as typeof document.createElement);
  return canvas;
}

describe('storeImage : grande image', () => {
  const big = (type: string) => new File([new Uint8Array(700 * 1024)], 'photo', { type });
  beforeEach(() => {
    putBlob.mockReset();
    putBlob.mockResolvedValue('p:k');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('photo réduite à 2400 px, en JPEG', async () => {
    const canvas = fakeImaging(1000);
    await storeImage('p', big('image/jpeg'));
    expect([canvas.width, canvas.height]).toEqual([2400, 1600]);
    const stored = putBlob.mock.calls[0][2] as Blob;
    expect(stored.type).toBe('image/jpeg');
    expect(stored.size).toBe(1000);
  });

  it('autre image (transparence possible) : PNG', async () => {
    fakeImaging(1000);
    await storeImage('p', big('image/webp'));
    expect((putBlob.mock.calls[0][2] as Blob).type).toBe('image/png');
  });

  it('rendu plus lourd que l’original : l’original est gardé', async () => {
    fakeImaging(800 * 1024);
    const f = big('image/png');
    await storeImage('p', f);
    expect(putBlob.mock.calls[0][2]).toBe(f);
  });
});
