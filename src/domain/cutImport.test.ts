import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { CUT_HEADER, aiCutInstructions, applyCut, cutOverlap, parseCutFile } from './cutImport';
import { addSequence, checkInvariants } from './ops';

const COLS = ['sequence', 'number', 'subject', 'value', 'angle', 'movement', 'focal', 'action', 'tc', 'sound'] as const;

describe('découpage écrit par une IA externe', () => {
  it('donne des consignes sur les colonnes du projet, et relit son propre exemple', () => {
    const t = aiCutInstructions([...COLS]);
    expect(t).toContain(CUT_HEADER);
    expect(t).toContain('| Sujet | Valeur | Angle | Mouvement de caméra | Focale | Action | Son |');
    expect(t).toContain('exactement 7 cellules');
    expect(t).toContain('Gros plan | Très GP | Insert');
    expect(t).not.toContain('| N° |');
    expect(t).not.toContain('Ouverture');
    const ex = t.slice(t.indexOf('EXEMPLE CONFORME\n') + 17);
    const p = parseCutFile(ex);
    expect(p.warnings).toEqual([]);
    expect(p.sequences).toHaveLength(2);
    expect(p.sequences[0].rows[0]).toMatchObject({ subject: 'Léa', focal: '50mm', sound: 'Pluie sur la vitre' });
    expect(p.sequences[1].rows[0]).toMatchObject({ movement: 'Trav arrière + Steadicam', action: 'Paul court vers la caméra.\nIl s’arrête net.' });
  });

  it('lit un fichier tolérant (bloc de code, colonne courte, barre échappée, <br>)', () => {
    const p = parseCutFile(['```markdown', CUT_HEADER, '', '## EXT. RUE - NUIT', '| Sujet | Mouvement | Action | Inconnue |', '|---|---|---|---|', '| Paul | Travelling | Il court.<br>Il tombe \\| se relève. | x |', '```'].join('\n'));
    expect(p.sequences[0].rows[0]).toEqual({ subject: 'Paul', movement: 'Travelling', action: 'Il court.\nIl tombe | se relève.' });
    expect(p.warnings.join()).toContain('Inconnue');
  });

  it('signale précisément chaque écart : cellules en trop, terme hors liste, texte hors tableau', () => {
    const p = parseCutFile([CUT_HEADER, 'Voici le découpage :', '## INT. SALON - NUIT', '| Sujet | Valeur | Mouvement de caméra |', '|---|---|---|', '| Léa | Plan serré | Fixe, Envol |', '| Paul | Gros plan | Fixe | en trop |'].join('\n'));
    const w = p.warnings.join('\n');
    expect(w).toContain('Ligne 2 : texte hors tableau');
    expect(w).toContain('« Plan serré » n’est pas dans la liste Valeur');
    expect(w).toContain('« Envol » n’est pas dans la liste Mouvement de caméra');
    expect(w).toContain('Ligne 7 : 4 cellules au lieu de 3');
    expect(p.sequences[0].rows).toHaveLength(2);
  });

  it('refuse un fichier sans en-tête', () => {
    expect(() => parseCutFile('| a | b |')).toThrow(/première ligne/);
  });

  it('ajoute les séquences et les plans à la fin du projet, sans casser les invariants', () => {
    const doc = buildRav3();
    const n = doc.project.sequenceIds.length;
    const r = applyCut(doc, parseCutFile([CUT_HEADER, '## INT. CUISINE - JOUR', '| Sujet | Valeur | Action |', '|---|---|---|', '| Léa | Gros plan | Elle boit. |', '| Tasse | Insert | Vapeur. |', '## EXT. JARDIN - NUIT'].join('\n')));
    expect(r).toMatchObject({ sequences: 2, merged: 0, shots: 2 });
    expect(doc.project.sequenceIds).toHaveLength(n + 2);
    const seq = doc.sequences[doc.project.sequenceIds[n]];
    expect(seq).toMatchObject({ label: 'CUISINE', intExt: 'INT' });
    expect(seq.shotIds.map((id) => doc.shots[id].subject)).toEqual(['Léa', 'Tasse']);
    expect(doc.blocks[doc.shots[seq.shotIds[0]].actionBlockId].text).toBe('Elle boit.');
    expect(doc.sequences[doc.project.sequenceIds[n + 1]].shotIds).toHaveLength(1);
    expect(checkInvariants(doc)).toEqual([]);
  });

  it('s’empile : un second import complète la séquence de même intitulé, sans rien effacer', () => {
    const doc = buildRav3();
    const n = doc.project.sequenceIds.length;
    applyCut(doc, parseCutFile([CUT_HEADER, '## INT. CUISINE - JOUR', '| Sujet | Action |', '|---|---|', '| Léa | Elle boit. |'].join('\n')));
    const r = applyCut(doc, parseCutFile([CUT_HEADER, '## INT. CUISINE - JOUR', '| Sujet | Action |', '|---|---|', '| Paul | Il entre. |', '## EXT. JARDIN - NUIT', '| Sujet |', '|---|', '| Chat |'].join('\n')));
    expect(r).toMatchObject({ sequences: 1, merged: 1, shots: 2 });
    expect(doc.project.sequenceIds).toHaveLength(n + 2);
    const cuisine = doc.sequences[doc.project.sequenceIds[n]];
    expect(cuisine.shotIds.map((id) => doc.shots[id].subject)).toEqual(['Léa', 'Paul']);
    expect(checkInvariants(doc)).toEqual([]);
  });

  it('remplace le plan vierge d’une séquence existante (créée depuis le scénario)', () => {
    const doc = buildRav3();
    const id = addSequence(doc, undefined, { label: 'SALON', intExt: 'INT' });
    applyCut(doc, parseCutFile([CUT_HEADER, '## INT. SALON', '| Sujet |', '|---|', '| Léa |', '| Paul |'].join('\n')));
    expect(doc.sequences[id].shotIds.map((s) => doc.shots[s].subject)).toEqual(['Léa', 'Paul']);
    expect(checkInvariants(doc)).toEqual([]);
  });

  it('mise à jour : une nouvelle version reformule les plans en place, sans doublon ni perte', () => {
    const doc = buildRav3();
    applyCut(doc, parseCutFile([CUT_HEADER, '## INT. CUISINE - JOUR', '| Sujet | Valeur | Action |', '|---|---|---|', '| Léa | Gros plan | Elle boit. |', '| Tasse | Insert | Vapeur. |'].join('\n')));
    const seqId = doc.project.sequenceIds.at(-1)!;
    const ids = [...doc.sequences[seqId].shotIds];
    doc.shots[ids[0]].storyboard = { blobKey: 'p:image' };
    const v2 = parseCutFile([CUT_HEADER, '## INT. CUISINE - JOUR', '| Sujet | Action |', '|---|---|', '| Léa | Elle boit son café, pensive. |', '| Tasse | La vapeur monte doucement. |', '| Fenêtre | La pluie tombe. |'].join('\n'));
    expect(cutOverlap(doc, v2)).toBe(1);
    const r = applyCut(doc, v2, 'update');
    expect(r).toMatchObject({ merged: 1, updated: 2, shots: 1 });
    const now = doc.sequences[seqId].shotIds;
    expect(now.slice(0, 2)).toEqual(ids);
    expect(now.map((id) => doc.blocks[doc.shots[id].actionBlockId].text)).toEqual(['Elle boit son café, pensive.', 'La vapeur monte doucement.', 'La pluie tombe.']);
    // Colonne absente du tableau (Valeur) et image du plan : inchangées.
    expect(doc.shots[ids[0]]).toMatchObject({ value: 'Gros plan', storyboard: { blobKey: 'p:image' } });
    expect(checkInvariants(doc)).toEqual([]);
  });
});
