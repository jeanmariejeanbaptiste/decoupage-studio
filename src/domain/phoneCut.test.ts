import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { setCellText } from './cells';
import { addShot } from './ops';
import {
  angleParts,
  focalLabel,
  focalScale,
  focalText,
  insertAtCaret,
  markRanges,
  movementLabel,
  movementPhrase,
  pickFocal,
  pickZoomFocal,
  scriptPieces,
  setAnglePart,
  setWay,
  shotCodeAt,
  tileOf,
  toggleTile,
} from './phoneCut';

describe('feuille Mouvement', () => {
  it('rattache chaque jeton à sa case, sens compris', () => {
    expect(tileOf('Trav arrière')?.key).toBe('trav_arriere');
    expect(tileOf('travelling arrière')?.key).toBe('trav_arriere');
    expect(tileOf('Pano droite')?.key).toBe('pano');
    expect(tileOf('Tilt down')?.key).toBe('tilt');
    expect(tileOf('Boom up')?.key).toBe('trav_vertical');
    expect(tileOf('Roll')).toBeUndefined();
    expect(tileOf('n’importe quoi')).toBeUndefined();
  });
  it('ajoute dans l’ordre, retire au second toucher ; Fixe exclut le reste', () => {
    let t = toggleTile([], 'trav_arriere');
    t = toggleTile(t, 'zoom_avant');
    expect(t).toEqual(['Trav arrière', 'Zoom avant']);
    expect(toggleTile(t, 'trav_arriere')).toEqual(['Zoom avant']);
    expect(toggleTile(t, 'fixe')).toEqual(['Fixe']);
    expect(toggleTile(['Fixe'], 'drone')).toEqual(['Drone']);
    // Un jeton libre reste.
    expect(toggleTile(['Roll'], 'grue')).toEqual(['Roll', 'Grue']);
    // Une variante compte pour sa case.
    expect(toggleTile(['Pano gauche', 'Zoom avant'], 'pano')).toEqual(['Zoom avant']);
  });
  it('choisit le sens à la même place', () => {
    expect(setWay(['Zoom avant', 'Pano'], 'pano', 'pano_droite')).toEqual(['Zoom avant', 'Pano droite']);
    expect(setWay(['Pano droite'], 'pano', undefined)).toEqual(['Pano']);
    expect(setWay(['Tilt'], 'tilt', 'tilt_up')).toEqual(['Tilt up']);
  });
  it('se lit en toutes lettres, « puis » entre deux mouvements successifs', () => {
    expect(movementLabel('Trav arrière')).toBe('Travelling arrière');
    expect(movementLabel('Pano')).toBe('Panoramique');
    expect(movementLabel('Glissé maison')).toBe('Glissé maison');
    expect(movementPhrase(['Trav arrière', 'Zoom avant'])).toEqual([{ text: 'Travelling arrière' }, { joiner: 'puis', text: 'zoom avant' }]);
    expect(movementPhrase(['Trav avant', 'Zoom avant'], ' + ')[1].joiner).toBe('+');
    expect(movementPhrase([])).toEqual([]);
  });
});

describe('focales', () => {
  it('échelle usuelle complétée par celles du plan', () => {
    expect(focalScale({})).toEqual([18, 24, 35, 50, 70, 85, 135]);
    expect(focalScale({ from: 40, to: 200 })).toEqual([18, 24, 35, 40, 50, 70, 85, 135, 200]);
  });
  it('zoom : départ, arrivée, puis on recommence', () => {
    expect(pickZoomFocal({}, 50)).toEqual({ from: 50 });
    expect(pickZoomFocal({ from: 50 }, 85)).toEqual({ from: 50, to: 85 });
    expect(pickZoomFocal({ from: 50 }, 50)).toEqual({ from: 50 });
    expect(pickZoomFocal({ from: 50, to: 85 }, 24)).toEqual({ from: 24 });
  });
  it('focale fixe : choisie, ou effacée au second toucher', () => {
    expect(pickFocal({}, 35)).toEqual({ from: 35 });
    expect(pickFocal({ from: 35 }, 35)).toEqual({});
    expect(pickFocal({ from: 50, to: 85 }, 35)).toEqual({ from: 35, to: 85 });
    expect(pickFocal({ from: 50, to: 85 }, 85)).toEqual({ from: 85 });
  });
  it('texte de cellule relu par setCellText', () => {
    const doc = buildFiction();
    const id = doc.sequences[doc.project.sequenceIds[0]].shotIds[0];
    expect(focalText({ from: 50, to: 85 })).toBe('50 → 85');
    expect(setCellText(doc, id, 'focal', focalText({ from: 50, to: 85 }))).toBe(true);
    expect(doc.shots[id].focal).toEqual({ from: 50, to: 85 });
    expect(focalText({})).toBe('');
    expect(focalLabel({ from: 35 })).toBe('35 mm');
    expect(focalLabel({ from: 50, to: 85 })).toBe('50 → 85 mm');
  });
});

describe('angle', () => {
  it('sépare l’axe et la hauteur', () => {
    expect(angleParts(['3/4 Face', 'Hauteur regard'])).toEqual({ axis: '3/4 Face', height: 'Hauteur regard' });
    expect(angleParts(['Subjectif'])).toEqual({ height: 'Subjectif' });
  });
  it('remplace à sa place, ajoute l’axe en tête et la hauteur après, retire', () => {
    expect(setAnglePart(['3/4 Face', 'Hauteur regard'], 'axis', 'Profil')).toEqual(['Profil', 'Hauteur regard']);
    expect(setAnglePart(['Hauteur regard'], 'axis', 'Face')).toEqual(['Face', 'Hauteur regard']);
    expect(setAnglePart(['Face'], 'height', 'Plongée')).toEqual(['Face', 'Plongée']);
    expect(setAnglePart(['Face', 'Plongée'], 'height', undefined)).toEqual(['Face']);
    // Deux axes saisis (conflit) : le premier est remplacé, le second s'en va.
    expect(setAnglePart(['Face', 'Dos', 'Plongée'], 'axis', 'Profil')).toEqual(['Profil', 'Plongée']);
  });
});

describe('texte', () => {
  it('insère au curseur avec les espaces qu’il faut', () => {
    expect(insertAtCaret('', 0, 'Léa entre.')).toEqual({ text: 'Léa entre.', caret: 10, start: 0, end: 10 });
    expect(insertAtCaret('Elle sort.', 0, 'Léa entre.')).toMatchObject({ text: 'Léa entre. Elle sort.', caret: 10 });
    expect(insertAtCaret('Elle sort.', 10, 'Il pleut.')).toMatchObject({ text: 'Elle sort. Il pleut.', start: 11, end: 20, caret: 20 });
    expect(insertAtCaret('A B', 2, 'x')).toMatchObject({ text: 'A x B' });
  });
  it('repère les passages, sans chevauchement', () => {
    expect(markRanges('Léa entre. Il pleut. Léa entre.', ['Léa entre.'])).toEqual([
      [0, 10],
      [21, 31],
    ]);
    expect(markRanges('abc', ['abc', 'b'])).toEqual([[0, 3]]);
    expect(markRanges('abc', ['', '  '])).toEqual([]);
  });
});

describe('scénario d’une séquence', () => {
  it('en-tête, phrases une à une, répliques entières', () => {
    const doc = buildFiction();
    const seq1 = scriptPieces(doc, doc.project.sequenceIds[0]);
    expect(seq1[0].kind).toBe('heading');
    const sentences = seq1.filter((p) => p.kind === 'sentence');
    expect(sentences[0].text).toBe('Le hall bruisse, les annonces se succèdent.');
    // Chaque phrase se retrouve telle quelle dans le scénario.
    for (const p of sentences) expect(doc.scenario!.slice(p.start, p.end)).toContain(p.text.slice(0, 10));
    const seq2 = scriptPieces(doc, doc.project.sequenceIds[1]);
    const reply = seq2.find((p) => p.kind === 'reply');
    expect(reply?.who).toBeTruthy();
    expect(reply?.text.length).toBeGreaterThan(5);
  });
  it('rien sans scène liée', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[0];
    doc.sequences[seqId].scenarioAnchor = undefined;
    expect(scriptPieces(doc, seqId)).toEqual([]);
  });
});

describe('numéro à venir', () => {
  it('celui qu’aurait un plan inséré à cette place', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[0];
    expect(shotCodeAt(doc, seqId, 0)).toBe('1.1');
    expect(shotCodeAt(doc, seqId, 4)).toBe('1.5');
    const id = addShot(doc, seqId, { index: 4 });
    expect(doc.sequences[seqId].shotIds.indexOf(id)).toBe(4);
    doc.project.settings.shotCodeFormat = '{seq}{letter}';
    expect(shotCodeAt(doc, doc.project.sequenceIds[1], 2)).toBe('2C');
  });
  it('les caméras d’un cadre d’interview comptent pour un', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[0];
    const [a, b] = doc.sequences[seqId].shotIds;
    doc.shots[a].interview = { setupId: 's1', cameraId: 'A' } as never;
    doc.shots[b].interview = { setupId: 's1', cameraId: 'B' } as never;
    expect(shotCodeAt(doc, seqId, 2)).toBe('1.2');
  });
});
