import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { ALL_COLUMNS, RETIRED_COLUMNS } from './columns';
import { CSV_COLUMNS, decodeText, detectDelimiter, guessMapping, importRows, parseDelimited, tcModeOfColumn, toCsv } from './csv';
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

  it('une réplique répétée sur des lignes liées reste une seule réplique', () => {
    const rows = [1, 2, 3].map(() => ['1, CUISINE', 'Elle entre', '0:30', 'Salut']);
    const doc = produce(createProjectDoc({ title: 'x', format: 'fiction' }), (d) => {
      importRows(d, rows, ['sequence', 'action', 'tc', 'dialogue']);
    });
    const seq = doc.sequences[doc.project.sequenceIds[0]];
    expect(seq.shotIds).toHaveLength(3);
    expect(seq.actionBlockIds).toHaveLength(1);
    expect(doc.blocks[seq.actionBlockIds[0]].dialogue).toBe('Salut');
    expect(doc.blocks[seq.actionBlockIds[0]].text).toBe('Elle entre');
    expect(checkInvariants(doc)).toEqual([]);
  });

  it('aller-retour : la colonne Dialogue et les notes (« Image ») reviennent à l’identique', () => {
    const src = produce(buildRav3(), (d) => {
      const s1 = d.sequences[d.project.sequenceIds[0]];
      d.blocks[d.shots[s1.shotIds[0]].actionBlockId].dialogue = 'Bonjour';
      d.shots[s1.shotIds[1]].notes = 'Contre-jour, raccord regard';
    });
    const cols = [...src.project.settings.exportColumns, 'dialogue', 'notes'] as const;
    const csv = toCsv(src, cols);
    const rows = parseDelimited(csv);
    const mapping = guessMapping(rows[0]);
    expect(mapping).toContain('notes');
    const doc = produce(createProjectDoc({ title: 'Import', format: 'clip' }), (d) => {
      importRows(d, rows.slice(1), mapping);
    });
    expect(toCsv(doc, cols)).toBe(csv);
  });

  it('reconnaît « Image » comme la colonne des notes, pas « Image storyboard »', () => {
    expect(guessMapping(['Image'])).toEqual(['notes']);
    expect(guessMapping(['Image storyboard'])).toEqual([null]);
  });

  it('ne propose pas les colonnes abandonnées', () => {
    expect(CSV_COLUMNS.filter((c) => RETIRED_COLUMNS.includes(c))).toEqual([]);
    expect(ALL_COLUMNS.every((c) => CSV_COLUMNS.includes(c))).toBe(true);
    expect(guessMapping(['Lumière', 'Éclairage', 'Sujet'])).toEqual([null, null, 'subject']);
  });

  it('décode un CSV Windows-1252 comme un CSV UTF-8', () => {
    expect(decodeText(Uint8Array.from([0x53, 0xe9, 0x71]))).toBe('Séq');
    const utf8 = new TextEncoder().encode('\uFEFFSéquence;Léa');
    expect(decodeText(utf8)).toBe('Séquence;Léa');
    expect(decodeText(Uint8Array.from([0xff, 0xfe, 0x53, 0, 0xe9, 0, 0x71, 0]))).toBe('Séq');
    expect(decodeText(Uint8Array.from([0xfe, 0xff, 0, 0x53, 0, 0xe9, 0, 0x71]))).toBe('Séq');
  });

  it('reconnaît une colonne TC en plages de piste', () => {
    expect(tcModeOfColumn(['0:00 - 0:12', '0:12 - 0:30', ''])).toBe('piste');
    expect(tcModeOfColumn(['0:05'])).toBeUndefined();
    expect(tcModeOfColumn([])).toBeUndefined();
    expect(tcModeOfColumn(['TOUT', 'texte'])).toBeUndefined();
  });

  it('aller-retour du TC en piste dans un nouveau projet', () => {
    const src = buildRav3();
    const rows = parseDelimited(toCsv(src));
    const mapping = guessMapping(rows[0]);
    const tc = mapping.indexOf('tc');
    expect(tcModeOfColumn(rows.slice(1).map((r) => r[tc]))).toBe('piste');
    const doc = produce(createProjectDoc({ title: 'Import', format: 'fiction' }), (d) => {
      d.project.settings.tcMode = 'piste';
      importRows(d, rows.slice(1), mapping);
    });
    expect(parseDelimited(toCsv(doc, src.project.settings.exportColumns)).map((r) => r[tc])).toEqual(rows.map((r) => r[tc]));
  });
});
