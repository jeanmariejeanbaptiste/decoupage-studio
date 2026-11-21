import { describe, expect, it, vi } from 'vitest';

vi.mock('../../store/db', () => ({
  putBlob: vi.fn(async () => {
    throw Object.assign(new Error('plein'), { name: 'AbortError', inner: { name: 'QuotaExceededError' } });
  }),
}));

import { storeNoteImage } from './noteImage';
import { useUi } from '../../store/uiStore';

describe('image de la note', () => {
  it('stockage refusé : rien n’est ajouté et un seul message le dit', async () => {
    const before = useUi.getState().toasts.length;
    const key = await storeNoteImage('p', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
    expect(key).toBeNull();
    const toasts = useUi.getState().toasts;
    expect(toasts.length).toBe(before + 1);
    expect(toasts[toasts.length - 1]).toMatchObject({ message: 'Stockage du navigateur plein : image non ajoutée.', tone: 'warn' });
  });
});
