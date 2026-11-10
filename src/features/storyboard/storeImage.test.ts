import { beforeEach, describe, expect, it, vi } from 'vitest';

const putBlob = vi.fn();
vi.mock('../../store/db', () => ({ putBlob: (...a: unknown[]) => putBlob(...a) }));

const { storeImage } = await import('./storeImage');
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
});
