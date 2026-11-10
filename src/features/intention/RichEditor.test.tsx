import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

let release: (b: Blob) => void = () => undefined;
vi.mock('../../store/db', () => ({
  getBlob: () => new Promise<Blob>((ok) => (release = ok)),
  putBlob: vi.fn(),
}));

import { RichEditor } from './RichEditor';

describe('éditeur de la note', () => {
  afterEach(cleanup);

  it('une image qui arrive après la fermeture ne crée aucune adresse', async () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const view = render(<RichEditor html={'<p><img data-blob="p:1" alt=""></p>'} projectId="p" onChange={() => undefined} />);
    view.unmount();
    release(new Blob(['x'], { type: 'image/png' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(create).not.toHaveBeenCalled();
  });
});
