import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { produce } from 'immer';
import { CUT_HEADER, aiCutInstructions, applyCut, cutOverlap, cutToMarkdown, parseCutFile, updatePreview } from './cutImport';
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

describe('cutToMarkdown', () => {
  it('se relit sans avertissement et se réimporte à l’identique en mise à jour', () => {
    const doc = buildRav3();
    const md = cutToMarkdown(doc);
    expect(md).toContain('| N° |');
    const cut = parseCutFile(md);
    expect(cut.warnings.filter((w) => !w.includes('pas dans la liste'))).toEqual([]);
    expect(cut.sequences).toHaveLength(doc.project.sequenceIds.length);
    expect(cut.sequences.flatMap((s) => s.rows)).toHaveLength(Object.keys(doc.shots).length);
    expect(cutOverlap(doc, cut)).toBe(doc.project.sequenceIds.length);
    const next = produce(doc, (d) => void applyCut(d, cut, 'update'));
    expect(cutToMarkdown(next)).toBe(md);
  });
});

describe('mise à jour prudente', () => {
  const seq1 = (doc: ReturnType<typeof buildRav3>) => doc.sequences[doc.project.sequenceIds[0]];
  it('retrouve les plans par leur N° : une ligne sautée ne décale rien, une cellule vide ne gomme rien', () => {
    const doc = buildRav3();
    const lines = cutToMarkdown(doc).split('\n');
    const first = lines.findIndex((l) => l.startsWith('| 1.1 |'));
    // L'IA saute 1.2 et rend 1.3 avec un sujet vide et une autre valeur.
    const row13 = lines[first + 2].split(' | ');
    row13[1] = '';
    row13[2] = 'Insert';
    lines.splice(first + 1, 2, row13.join(' | '));
    const before = produce(doc, () => {});
    const cut = parseCutFile(lines.join('\n'));
    expect(updatePreview(doc, cut)).toEqual({ changed: 1, added: 0 });
    const next = produce(doc, (d) => void applyCut(d, cut, 'update'));
    const ids = seq1(next).shotIds;
    expect(ids).toEqual(seq1(before).shotIds);
    expect(next.shots[ids[1]]).toEqual(before.shots[ids[1]]);
    expect(next.shots[ids[2]].subject).toBe(before.shots[ids[2]].subject);
    expect(next.shots[ids[2]].value).toBe('Insert');
  });
  it('séquences mal numérotées par l’IA : l’intitulé fait foi, le numéro est ignoré', () => {
    const doc = buildRav3();
    const md = cutToMarkdown(doc).replace(/^## (\d+)\./gm, (_, n) => `## ${Number(n) + 10}.`);
    const next = produce(doc, (d) => void applyCut(d, parseCutFile(md), 'update'));
    expect(next.project.sequenceIds).toEqual(doc.project.sequenceIds);
    expect(cutToMarkdown(next)).toBe(cutToMarkdown(doc));
  });
});
