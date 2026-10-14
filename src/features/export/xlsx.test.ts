import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../../seed/rav3';
import { buildWorkbook } from './xlsx';

describe('export Excel', () => {
  it('reproduit les fusions verticales, couleurs et le registre', async () => {
    const wb = await buildWorkbook(buildRav3());
    const ws = wb.getWorksheet('Découpage')!;
    // titre (1) + en-tête (2), puis séquence 1 en lignes 3 à 8, ligne d'espacement 9.
    const a3 = ws.getCell('A3');
    expect(a3.value).toBe('1, CHAMBRE ADMIRATRICE');
    expect(ws.getCell('A8').isMerged).toBe(true);
    expect(ws.getCell('A8').master.address).toBe('A3');
    expect(ws.getCell('B4').isMerged).toBe(false);
    expect(ws.getCell('H5').master.address).toBe('H3'); // action [1-3]
    expect(ws.getCell('I8').master.address).toBe('I3'); // TC 0:00 - 0:35
    expect(ws.getCell('G8').master.address).toBe('G3'); // 16mm
    expect((ws.getCell('A9').fill as { fgColor: { argb: string } }).fgColor.argb).toBe('FFDFA6D3');
    expect((ws.getCell('E3').font.color as { argb: string }).argb).toBe('FF7A2E1F');
    expect((ws.getCell('B3').font.color as { argb: string }).argb).toBe('FFC42B2B');
    expect(ws.getCell('A10').value).toBe('2, PARC DES COQUELICOTS');
    const reg = wb.getWorksheet('Registre')!;
    expect(reg.getCell('B2').value).toBe('CHAMBRE ADMIRATRICE');
    expect(reg.getCell('G8').value).toBe(15);
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(5000);
  });
});
