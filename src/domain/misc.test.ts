import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { recognizeCharacters, sequenceCharacterIds, sortedCharacters } from './characters';
import { columnWidths, COLUMN_DEFS } from './columns';
import { diagonalFov, formatFocal, fullFrameEquivalent, horizontalFov, parseFocalInput } from './focal';
import { formatShotCode, letterCode, sequenceHeading, sequenceNumber, shotCode, shotNumber } from './numbering';
import { cellText, shotDurationSec } from './rows';
import { computeTiming } from './timing';
import { DEFAULT_COLUMNS, OPTIONAL_COLUMNS } from './types';

describe('numérotation', () => {
  it('codes de plan', () => {
    expect(formatShotCode(3, 4, '{seq}.{shot}')).toBe('3.4');
    expect(formatShotCode(3, 4, '{seq}-{shot}')).toBe('3-4');
    expect(formatShotCode(3, 4, '{seq}{letter}')).toBe('3D');
    expect(letterCode(27)).toBe('AA');
    expect(letterCode(52)).toBe('AZ');
  });
  it('dérive séquence et plan', () => {
    const doc = buildRav3();
    const s3 = doc.project.sequenceIds[2];
    const shot = doc.sequences[s3].shotIds[3];
    expect(sequenceNumber(doc, s3)).toBe(3);
    expect(shotNumber(doc, shot)).toBe(4);
    expect(shotCode(doc, shot)).toBe('3.4');
    expect(sequenceHeading(doc, s3)).toBe('3, JARDIN SQY');
    expect(shotNumber(doc, 'x')).toBe(0);
    expect(shotCode(doc, 'x')).toBe('');
  });
});

describe('personnages', () => {
  const doc = buildRav3();
  const chars = Object.values(doc.characters);
  it('reconnaît noms et alias en mot entier', () => {
    const candice = chars.find((c) => c.name === 'Candice')!;
    expect(recognizeCharacters('Main candice', chars)).toEqual([candice.id]);
    expect(recognizeCharacters('Candi', chars)).toEqual([candice.id]);
    expect(recognizeCharacters('Candidat', chars)).toEqual([]);
    expect(recognizeCharacters('', chars)).toEqual([]);
  });
  it('liste les personnages d’une séquence et trie', () => {
    const s7 = doc.project.sequenceIds[6];
    expect(sequenceCharacterIds(doc, s7).map((id) => doc.characters[id].name).sort()).toEqual(['Admiratrice', 'Vedette']);
    expect(sequenceCharacterIds(doc, 'x')).toEqual([]);
    expect(sortedCharacters(doc).map((c) => c.name)).toEqual(['Admiratrice', 'Candice', 'Maquilleuse', 'Vedette']);
  });
});

describe('focale', () => {
  it('formate fixe et zoom', () => {
    expect(formatFocal({ from: 50 }, false)).toBe('50mm');
    expect(formatFocal({ from: 24, to: 70 }, true)).toBe('24 → 70mm');
    expect(formatFocal({ from: 24, to: 70 }, false)).toBe('24mm');
    expect(formatFocal({ to: 70 }, true)).toBe('→ 70mm');
    expect(formatFocal({}, false)).toBe('');
  });
  it('angles de champ de contrôle (plein format)', () => {
    expect(diagonalFov(24)).toBeCloseTo(84, 0);
    expect(horizontalFov(50)).toBeCloseTo(39.6, 1);
    expect(diagonalFov(50)).toBeCloseTo(46.8, 0);
    expect(diagonalFov(105)).toBeCloseTo(23.3, 0);
    expect(diagonalFov(200)).toBeCloseTo(12.3, 0);
    expect(horizontalFov(50, 1.6)).toBeLessThan(horizontalFov(50));
    expect(fullFrameEquivalent(50, 1.6)).toBe(80);
  });
  it('lit une saisie numérique', () => {
    expect(parseFocalInput('35mm')).toBe(35);
    expect(parseFocalInput('12,5')).toBe(12.5);
    expect(parseFocalInput('abc')).toBeUndefined();
    expect(parseFocalInput('0')).toBeUndefined();
  });
});

describe('colonnes et cellules', () => {
  it('largeurs normalisées', () => {
    const w = columnWidths(DEFAULT_COLUMNS);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(w.sequence).toBeCloseTo(16, 6);
    const w2 = columnWidths([...DEFAULT_COLUMNS, 'notes']);
    expect(w2.sequence).toBeLessThan(16);
    expect(columnWidths([])).toEqual({});
    expect(COLUMN_DEFS.number.label).toBe('N°');
  });
  it('rend toutes les colonnes optionnelles', () => {
    const doc = buildRav3();
    const t = computeTiming(doc);
    const shot = doc.shots[doc.sequences[doc.project.sequenceIds[0]].shotIds[0]];
    shot.sound = 'IN';
    shot.light = 'contre-jour';
    shot.notes = 'raccord robe';
    shot.shootingDay = 2;
    const cells = Object.fromEntries(OPTIONAL_COLUMNS.map((c) => [c, cellText(doc, t, shot, c, 0)]));
    expect(cells).toMatchObject({ characters: 'Admiratrice', sound: 'IN', light: 'contre-jour', status: 'à tourner', notes: 'raccord robe', shootingDay: 'J2', dialogue: '' });
    expect(cells.grip).toContain('Rails');
    expect(cells.shotDuration).toMatch(/^\d+:\d\d$/);
    expect(shotDurationSec(doc, t, shot)).toBeCloseTo(35 / 3, 5);
    doc.project.settings.labelStyle = 'long';
    expect(cellText(doc, t, shot, 'value', 0)).toBe('Plan taille');
  });
});

describe('info-bulle de focale', () => {
  it('donne angles horizontal et diagonal, et l’équivalent plein format', async () => {
    const { focalTooltip } = await import('./focal');
    expect(focalTooltip({ from: 50 }, 'FF', 1)).toBe('50 mm : angle horizontal 39,6° · diagonal 46,8° (plein format)');
    const aps = focalTooltip({ from: 50 }, 'APSC', 1.6);
    expect(aps).toContain('équivalent plein format 80 mm (× 1,6)');
    expect(focalTooltip({ from: 24, to: 70 }, 'FF', 1).split('\n')).toHaveLength(2);
    expect(focalTooltip({}, 'FF', 1)).toBe('');
  });
});
