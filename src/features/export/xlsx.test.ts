import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../../seed/rav3';
import { buildWorkbook } from './xlsx';
import { addSequence } from '../../domain/ops';

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
    expect((ws.getCell('A9').fill as { fgColor: { argb: string } }).fgColor.argb).toBe('FFF1F3F6');
    expect((ws.getCell('E3').font.color as { argb: string }).argb).toBe('FF111111');
    expect((ws.getCell('B3').font.color as { argb: string }).argb).toBe('FF111111');
    expect(ws.getCell('A10').value).toBe('2, PARC DES COQUELICOTS');
    const reg = wb.getWorksheet('Registre')!;
    expect(reg.getCell('B2').value).toBe('CHAMBRE ADMIRATRICE');
    expect(reg.getCell('G8').value).toBe(15);
    expect(String(ws.getCell('A1').value)).toContain('RAV3 · V3');
    expect(ws.getCell('B3').value).toBe(1);
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(5000);
  });

  it('une séquence sans plan ne s’exporte pas ; la suivante garde son numéro, le registre la garde', async () => {
    const doc = buildRav3();
    const first = doc.project.sequenceIds[0];
    addSequence(doc, 1, { label: 'Couloir' }, false);
    const wb = await buildWorkbook(doc);
    const ws = wb.getWorksheet('Découpage')!;
    const labels: string[] = [];
    ws.eachRow((row) => {
      const v = String(row.getCell(1).value ?? '');
      if (/^\d+, /.test(v) && !labels.includes(v)) labels.push(v);
    });
    expect(labels.slice(0, 2)).toEqual([`1, ${doc.sequences[first].label.toUpperCase()}`, '3, PARC DES COQUELICOTS']);
    expect(labels.some((l) => l.includes('COULOIR'))).toBe(false);
    expect(wb.getWorksheet('Registre')!.getCell('B3').value).toBe('Couloir');
  });
});
