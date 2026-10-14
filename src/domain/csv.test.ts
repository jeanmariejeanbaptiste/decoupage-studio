import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { detectDelimiter, guessMapping, importRows, parseDelimited, toCsv } from './csv';
import { createProjectDoc } from './factory';
import { checkInvariants } from './ops';

describe('CSV', () => {
  it('exporte une ligne par plan, sans fusion', () => {
    const csv = toCsv(buildRav3());
    const rows = parseDelimited(csv);
    expect(rows).toHaveLength(54);
    expect(rows[0]).toEqual(['Code', 'SÉQUENCE', 'N°', 'Sujet', 'Valeur', 'Angle', 'Mouvement de caméra', 'Focale', 'Action', 'TC MIN']);
    expect(rows[1]).toEqual(['1.1', '1, CHAMBRE ADMIRATRICE', '1', 'Admiratrice', 'Taille', 'Face, Hauteur regard', 'Tilt haut, trav avant', '16mm', 'Admiratrice assise sur le lit, pensive', '0:00 - 0:35']);
    expect(rows[2][8]).toBe('Admiratrice assise sur le lit, pensive');
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('détecte le séparateur et gère les guillemets', () => {
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a\tb')).toBe('\t');
    expect(detectDelimiter('a,b')).toBe(',');
    expect(detectDelimiter('seul')).toBe(';');
    expect(parseDelimited('a;"b;c"\n"d""e";\n\n')).toEqual([['a', 'b;c'], ['d"e', '']]);
    expect(parseDelimited('x,"multi\nligne"', ',')).toEqual([['x', 'multi\nligne']]);
  });

  it('devine la correspondance des colonnes', () => {
    expect(guessMapping(['Séquence', 'N°', 'Sujet', 'Valeur', 'Angle', 'Mouvement de caméra', 'Focale', 'Action', 'TC MIN', 'Inconnu'])).toEqual([
      'sequence', 'number', 'subject', 'value', 'angle', 'movement', 'focal', 'action', 'tc', null,
    ]);
  });

  it('réimporte un export : séquences, plans et actions liées', () => {
    const src = buildRav3();
    const rows = parseDelimited(toCsv(src));
    const mapping = guessMapping(rows[0]);
    const doc = produce(createProjectDoc({ title: 'Import', format: 'clip' }), (d) => {
      importRows(d, rows.slice(1), mapping);
    });
    expect(doc.project.sequenceIds).toHaveLength(7);
    expect(Object.keys(doc.shots)).toHaveLength(53);
    const s1 = doc.sequences[doc.project.sequenceIds[0]];
    expect(s1.label).toBe('CHAMBRE ADMIRATRICE');
    expect(s1.actionBlockIds).toHaveLength(4);
    expect(doc.shots[s1.shotIds[0]].angle).toEqual(['Face', 'Hauteur regard']);
    expect(doc.shots[s1.shotIds[0]].focal).toEqual({ from: 16 });
    expect(checkInvariants(doc)).toEqual([]);
  });

  it('importe sans colonne séquence dans une seule séquence', () => {
    const doc = produce(createProjectDoc({ title: 'x', format: 'fiction' }), (d) => {
      expect(importRows(d, [['Léa', 'Taille'], ['Marc', 'Insert']], ['subject', 'value'])).toBe(2);
    });
    expect(doc.project.sequenceIds).toHaveLength(1);
    expect(checkInvariants(doc)).toEqual([]);
  });
});
