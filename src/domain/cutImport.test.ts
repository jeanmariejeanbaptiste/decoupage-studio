import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { CUT_HEADER, aiCutInstructions, applyCut, parseCutFile } from './cutImport';
import { checkInvariants } from './ops';

const COLS = ['sequence', 'number', 'subject', 'value', 'angle', 'movement', 'focal', 'action', 'tc', 'sound'] as const;

describe('découpage écrit par une IA externe', () => {
  it('donne des consignes sur les colonnes du projet, et relit son propre exemple', () => {
    const t = aiCutInstructions([...COLS]);
    expect(t).toContain(CUT_HEADER);
    expect(t).toContain('| Sujet | Valeur | Angle | Mouvement de caméra | Focale | Action | Son |');
    expect(t).not.toContain('| N° |');
    const ex = t.slice(t.indexOf('EXEMPLE\n') + 8);
    const p = parseCutFile(ex);
    expect(p.warnings).toEqual([]);
    expect(p.sequences).toHaveLength(1);
    expect(p.sequences[0].rows[0]).toMatchObject({ subject: 'Léa', focal: '50mm', sound: 'Pluie' });
  });

  it('lit un fichier tolérant (bloc de code, colonne courte, barre échappée, <br>)', () => {
    const p = parseCutFile(['```markdown', CUT_HEADER, '', '## EXT. RUE - NUIT', '| Sujet | Mouvement | Action | Inconnue |', '|---|---|---|---|', '| Paul | Travelling | Il court.<br>Il tombe \\| se relève. | x |', '```'].join('\n'));
    expect(p.sequences[0].rows[0]).toEqual({ subject: 'Paul', movement: 'Travelling', action: 'Il court.\nIl tombe | se relève.' });
    expect(p.warnings.join()).toContain('Inconnue');
  });

  it('refuse un fichier sans en-tête', () => {
    expect(() => parseCutFile('| a | b |')).toThrow(/première ligne/);
  });

  it('ajoute les séquences et les plans à la fin du projet, sans casser les invariants', () => {
    const doc = buildRav3();
    const n = doc.project.sequenceIds.length;
    const r = applyCut(doc, parseCutFile([CUT_HEADER, '## INT. CUISINE - JOUR', '| Sujet | Valeur | Action |', '|---|---|---|', '| Léa | Gros plan | Elle boit. |', '| Tasse | Insert | Vapeur. |', '## EXT. JARDIN - NUIT'].join('\n')));
    expect(r).toMatchObject({ sequences: 2, shots: 2 });
    expect(doc.project.sequenceIds).toHaveLength(n + 2);
    const seq = doc.sequences[doc.project.sequenceIds[n]];
    expect(seq).toMatchObject({ label: 'CUISINE', intExt: 'INT' });
    expect(seq.shotIds.map((id) => doc.shots[id].subject)).toEqual(['Léa', 'Tasse']);
    expect(doc.blocks[doc.shots[seq.shotIds[0]].actionBlockId].text).toBe('Elle boit.');
    expect(doc.sequences[doc.project.sequenceIds[n + 1]].shotIds).toHaveLength(1);
    expect(checkInvariants(doc)).toEqual([]);
  });
});
