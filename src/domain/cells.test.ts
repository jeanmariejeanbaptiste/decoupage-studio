import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { editableText, isEditable, parseTsv, setCellText, toTsv } from './cells';
import type { ColumnKey, ProjectDoc } from './types';

const first = (d: ProjectDoc, seq = 0, shot = 0) => d.sequences[d.project.sequenceIds[seq]].shotIds[shot];

function roundTrip(doc: ProjectDoc, col: ColumnKey, text: string) {
  const id = first(doc);
  let ok = false;
  const next = produce(doc, (d) => {
    ok = setCellText(d, id, col, text);
  });
  return { ok, next, id, text: editableText(next, id, col) };
}

describe('édition de cellules', () => {
  const rav = buildRav3();
  const fic = buildFiction();

  it('lit le texte brut de chaque colonne', () => {
    const id = first(rav);
    expect(editableText(rav, id, 'sequence')).toBe('CHAMBRE ADMIRATRICE');
    expect(editableText(rav, id, 'angle')).toBe('Face, Hauteur regard');
    expect(editableText(rav, id, 'movement')).toBe('Tilt haut, trav avant');
    expect(editableText(rav, id, 'focal')).toBe('16');
    expect(editableText(rav, id, 'tc')).toBe('0:00 - 0:35');
    expect(editableText(rav, id, 'status')).toBe('à tourner');
    expect(editableText(rav, id, 'number')).toBe('');
    expect(editableText(rav, 'absent', 'subject')).toBe('');
    expect(isEditable('number')).toBe(false);
    expect(isEditable('subject')).toBe(true);
  });

  it.each<[ColumnKey, string, string]>([
    ['sequence', ' Loge bis ', 'Loge bis'],
    ['subject', 'Candice', 'Candice'],
    ['value', 'Gros plan', 'Gros plan'],
    ['angle', '3/4 face,hauteur regard', '3/4 face, hauteur regard'],
    ['angle', '-', '-'],
    ['movement', 'Trav circulaire + suivi', 'Trav circulaire + suivi'],
    ['focal', '24 → 70', '24 → 70'],
    ['focal', '35mm', '35'],
    ['action', 'Elle sort.', 'Elle sort.'],
    ['dialogue', 'Bonjour.', 'Bonjour.'],
    ['tc', 'tout', 'TOUT'],
    ['tc', '0:10-0:20', '0:10 - 0:20'],
    ['tc', '', ''],
    ['sound', 'IN', 'IN'],
    ['light', 'Contre-jour', 'Contre-jour'],
    ['notes', 'raccord', 'raccord'],
    ['status', 'tourné', 'tourné'],
    ['status', 'ab', 'abandonné'],
    ['status', '', 'à tourner'],
    ['shootingDay', 'J3', '3'],
    ['shootingDay', '', ''],
  ])('%s ← « %s »', (col, input, out) => {
    const r = roundTrip(rav, col, input);
    expect(r.ok).toBe(true);
    expect(r.text).toBe(out);
  });

  it('reconnaît le personnage saisi en sujet', () => {
    const r = roundTrip(rav, 'subject', 'Vedette');
    expect(r.next.shots[r.id].characterIds).toHaveLength(1);
  });

  it('rejette les saisies invalides', () => {
    expect(roundTrip(rav, 'focal', 'abc').ok).toBe(false);
    expect(roundTrip(rav, 'tc', 'n’importe').ok).toBe(false);
    expect(roundTrip(rav, 'status', 'xyz').ok).toBe(false);
    expect(roundTrip(rav, 'shootingDay', 'jour').ok).toBe(false);
    expect(roundTrip(rav, 'number', '3').ok).toBe(false);
    expect(roundTrip(fic, 'tc', 'tout').ok).toBe(false);
  });

  it('vider la focale conserve la valeur d’arrivée masquée', () => {
    const id = first(rav);
    const next = produce(rav, (d) => {
      d.shots[id].focal = { from: 24, to: 70 };
      setCellText(d, id, 'focal', '');
    });
    expect(next.shots[id].focal).toEqual({ to: 70 });
    const cleared = produce(rav, (d) => void setCellText(d, id, 'focal', ''));
    expect(cleared.shots[id].focal).toEqual({});
  });

  it('TC manuel en mode cumulatif (séquence puis action)', () => {
    const r = roundTrip(fic, 'tc', '1:30');
    expect(r.next.sequences[r.next.project.sequenceIds[0]].overrideSec).toBe(90);
    expect(r.text).toBe('1:30');
    const back = produce(r.next, (d) => void setCellText(d, r.id, 'tc', ''));
    expect(back.sequences[back.project.sequenceIds[0]].overrideSec).toBeUndefined();
    const byAction = produce(fic, (d) => {
      d.project.settings.tcGranularity = 'action';
      setCellText(d, r.id, 'tc', '45');
    });
    expect(byAction.blocks[byAction.shots[r.id].actionBlockId].overrideSec).toBe(45);
    expect(editableText(byAction, r.id, 'tc')).toBe('0:45');
    const clearAction = produce(byAction, (d) => void setCellText(d, r.id, 'tc', ''));
    expect(clearAction.blocks[clearAction.shots[r.id].actionBlockId].overrideSec).toBeUndefined();
    expect(editableText(clearAction, r.id, 'tc')).toBe('');
  });

  it('analyse et produit du TSV', () => {
    expect(parseTsv('a\tb\nc\t"d\te"\r\n"x""y"\t')).toEqual([['a', 'b'], ['c', 'd\te'], ['x"y', '']]);
    expect(parseTsv('')).toEqual([]);
    expect(toTsv([['a', 'b\tc'], ['"q"', '']])).toBe('a\t"b\tc"\n"""q"""\t');
  });
});
