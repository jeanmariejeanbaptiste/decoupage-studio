import { describe, expect, it } from 'vitest';
import { buildPdf, sliceLinks } from './pdf';

describe('PDF interne', () => {
  it('assemble une image par page A4, sans marge, avec une table xref valide', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = buildPdf([{ jpeg, width: 10, height: 14 }, { jpeg, width: 10, height: 14 }], { w: 210, h: 297 });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    // Chaque entrée xref pointe bien sur « n 0 obj ».
    const entries = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    entries.forEach((off, i) => expect(text.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});

describe('liens du PDF', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  it('ajoute une annotation URI par lien, rectangle en points depuis le bas', () => {
    const url = 'https://www.openstreetmap.org/directions?route=%3B48.85%2C2.35#map=16/48.85/2.35';
    const bytes = buildPdf([{ jpeg, width: 10, height: 14, links: [{ x: 0.5, y: 0.25, w: 0.1, h: 0.01, url }] }, { jpeg, width: 10, height: 14 }], { w: 210, h: 297 });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.match(/\/Subtype \/Link/g)).toHaveLength(1);
    expect(text).toContain(`/URI (${url})`);
    expect(text).toContain('/Annots [9 0 R]');
    expect(text).toContain('/Rect [297.64 623.00 357.17 631.42]');
    // Table xref toujours juste, annotation comprise.
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(9);
    entries.forEach((off, i) => expect(text.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('écarte ce qui n’est pas un lien web, échappe parenthèses et caractères non ASCII', () => {
    const bytes = buildPdf([{ jpeg, width: 10, height: 14, links: [{ x: 0, y: 0, w: 0.1, h: 0.1, url: 'javascript:alert(1)' }, { x: 0, y: 0, w: 0.1, h: 0.1, url: 'https://ex.org/a(b)é' }] }], { w: 210, h: 297 });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.match(/\/Subtype \/Link/g)).toHaveLength(1);
    expect(text).toContain('/URI (https://ex.org/a\\(b\\)%C3%A9)');
  });

  it('répartit les liens par page, sous la marge du haut', () => {
    const links = [
      { left: 100, top: 50, width: 40, height: 10, url: 'https://a' },
      { left: 0, top: 1150, width: 80, height: 12, url: 'https://b' },
    ];
    const pages = sliceLinks(links, [[0, 1000], [1000, 1800]], { contentWidth: 800, pageWidth: 800, pageHeight: 1100, margin: 50 });
    expect(pages[0]).toEqual([{ x: 0.125, y: 100 / 1100, w: 0.05, h: 10 / 1100, url: 'https://a' }]);
    expect(pages[1]).toEqual([{ x: 0, y: 200 / 1100, w: 0.1, h: 12 / 1100, url: 'https://b' }]);
  });
});
