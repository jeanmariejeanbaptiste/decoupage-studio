import { describe, expect, it } from 'vitest';
import { insertEntry } from '../../domain/outline';
import { sequencesWithoutPhrase } from './quickActions';

describe('résumer chaque séquence', () => {
  it('ne retient que les séquences sans phrase', () => {
    let src = '';
    for (const [i, phrase] of ['Léa entre.', '', 'Léa sort.', ''].entries()) src = insertEntry(src, 'end', { intExt: 'INT.', location: `LIEU ${i + 1}`, effect: 'JOUR', phrase }).source;
    expect(sequencesWithoutPhrase({ scenario: src })).toEqual([2, 4]);
    expect(sequencesWithoutPhrase({ scenario: undefined })).toEqual([]);
  });
});
