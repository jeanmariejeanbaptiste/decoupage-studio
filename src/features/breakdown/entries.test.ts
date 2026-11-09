import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../../seed/fiction';
import { breakdownCsv } from '../../domain/exports';
import { entriesOf, entryLabel, entryNumbers } from './entries';

describe('numéros du dépouillement', () => {
  it('ceux du découpage, même après déplacement d’une séquence, comme l’export', () => {
    const doc = produce(buildFiction(), (d) => {
      const ids = d.project.sequenceIds;
      ids.unshift(ids.pop()!);
    });
    const entries = entriesOf(doc);
    const { bySeq } = entryNumbers(doc, entries);
    const csvRows = breakdownCsv(doc).split(/\r?\n/).slice(1).filter(Boolean);
    doc.project.sequenceIds.forEach((id, i) => {
      expect(bySeq.get(id)).toBe(i + 1);
      expect(csvRows[i].replace(/^\W*/, '')).toMatch(new RegExp(`^${i + 1}, `));
    });
    const moved = entries.find((e) => e.seqId === doc.project.sequenceIds[0])!;
    expect(entryLabel(doc, moved, bySeq.get(moved.seqId!))).toMatch(/^1, /);
  });

  it('une scène sans séquence n’a pas de numéro et ne décale pas les suivantes', () => {
    const doc = produce(buildFiction(), (d) => {
      d.scenario = `INT. CAVE - NUIT\n\nUne cave.\n\n${d.scenario ?? ''}`;
    });
    const entries = entriesOf(doc);
    const { byKey, bySeq } = entryNumbers(doc, entries);
    const orphan = entries.find((e) => !e.seqId)!;
    expect(orphan).toBeDefined();
    expect(byKey.get(orphan.key)).toBeUndefined();
    expect(entryLabel(doc, orphan, byKey.get(orphan.key))).toMatch(/^–, /);
    doc.project.sequenceIds.forEach((id, i) => expect(bySeq.get(id)).toBe(i + 1));
  });
});
