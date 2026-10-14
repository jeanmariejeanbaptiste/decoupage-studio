import { describe, expect, it } from 'vitest';
import { formatRange, formatTc, parseRange, parseTc, unionLength } from './timecode';

describe('timecode', () => {
  it('formate m:ss et h:mm:ss', () => {
    expect(formatTc(30)).toBe('0:30');
    expect(formatTc(60)).toBe('1:00');
    expect(formatTc(600)).toBe('10:00');
    expect(formatTc(3599)).toBe('59:59');
    expect(formatTc(3600)).toBe('1:00:00');
    expect(formatTc(3723)).toBe('1:02:03');
    expect(formatTc(-4)).toBe('0:00');
  });
  it.each([
    ['30', 30],
    ['130', 90],
    ['1:30', 90],
    ['90s', 90],
    ['1m30', 90],
    ['1m', 60],
    ["2'15", 135],
    ['1h2m3s', 3723],
    ['1:02:03', 3723],
    [' 5 ', 5],
  ])('lit « %s » comme %i s', (input, sec) => {
    expect(parseTc(input)).toEqual({ kind: 'sec', sec });
  });
  it('reconnaît TOUT et rejette le reste', () => {
    expect(parseTc('tout')).toEqual({ kind: 'all' });
    expect(parseTc('TOUT')).toEqual({ kind: 'all' });
    expect(parseTc('')).toBeNull();
    expect(parseTc('abc')).toBeNull();
    expect(parseTc('1:75')).toBeNull();
    expect(parseTc('175')).toBeNull();
    expect(parseTc('1:70:00')).toBeNull();
  });
  it('lit et écrit des plages', () => {
    expect(parseRange('0:20 - 0:36')).toEqual({ in: 20, out: 36 });
    expect(parseRange('36 → 20')).toEqual({ in: 20, out: 36 });
    expect(parseRange('tout')).toEqual({ all: true });
    expect(parseRange('1:34')).toEqual({ in: 94 });
    expect(parseRange('')).toEqual({});
    expect(parseRange('x - y')).toBeNull();
    expect(parseRange('n’importe')).toBeNull();
    expect(formatRange({ in: 0, out: 35 })).toBe('0:00 - 0:35');
    expect(formatRange({ all: true })).toBe('TOUT');
    expect(formatRange({ in: 94 })).toBe('1:34');
    expect(formatRange({})).toBe('');
    expect(formatRange(undefined)).toBe('');
  });
  it('calcule la longueur d’une union de plages', () => {
    expect(unionLength([[0, 10], [5, 20], [30, 40], [40, 45]])).toBe(35);
    expect(unionLength([])).toBe(0);
    expect(unionLength([[5, 5]])).toBe(0);
  });
});
