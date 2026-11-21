import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFiction } from '../../../seed/fiction';
import { paragraphMarks, SceneText, type Paragraph } from './SceneText';

afterEach(cleanup);

describe('texte du dépouillement', () => {
  const doc = buildFiction();
  const seqId = doc.project.sequenceIds[0];
  const paragraphs: Paragraph[] = [{ key: 'p', type: 'action', text: 'Léa traverse le hall en tirant une valise cabossée.' }];

  it('lecture seule : aucune suggestion soulignée', () => {
    expect(paragraphMarks(doc, seqId, paragraphs).flat().some((m) => m.suggested)).toBe(true);
    expect(paragraphMarks(doc, seqId, paragraphs, true).flat().some((m) => m.suggested)).toBe(false);
    const ro = render(<SceneText doc={doc} seqId={seqId} paragraphs={paragraphs} onTag={vi.fn()} onUntag={vi.fn()} readOnly />);
    expect(ro.queryAllByTestId('tag-suggestion')).toHaveLength(0);
    expect(ro.getAllByTestId('tag-mark')).toHaveLength(1);
  });

  it('un repère déduit des plans n’ouvre pas de menu', () => {
    const view = render(<SceneText doc={doc} seqId={seqId} paragraphs={paragraphs} onTag={vi.fn()} onUntag={vi.fn()} />);
    expect(view.getAllByTestId('tag-suggestion').length).toBeGreaterThan(0);
    fireEvent.click(view.getByText('Léa'));
    expect(view.container.querySelector('[data-tag-pop]')).toBeNull();
  });
});
