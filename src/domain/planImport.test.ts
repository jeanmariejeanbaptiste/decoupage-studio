import { describe, expect, it } from 'vitest';
import { PLAN_HEADER, aiPlanInstructions, imageGridH, parsePlanFile, placePlan } from './planImport';

const example = (text: string) => text.slice(text.indexOf('EXEMPLE CONFORME'), text.indexOf('\n\nRAPPEL FINAL') + 1).split('\n').slice(1).join('\n');

describe('import d’un plan de locaux décrit par une IA', () => {
  it('calcule la grille des consignes sur le format de l’image de fond', () => {
    const t = aiPlanInstructions({ ratio: 0.75, pixels: { w: 2000, h: 1500 } });
    expect(imageGridH(0.75)).toBe(750);
    expect(t).toContain('grille: 1000x750');
    expect(t).toContain('2000 × 1500 pixels');
    expect(aiPlanInstructions()).toContain('repere: cm');
    // Le livrable exigé est un fichier téléchargeable, rappelé en tête et en fin.
    expect(t.indexOf('FICHIER TÉLÉCHARGEABLE')).toBeLessThan(t.indexOf('MISSION'));
    expect(t.trimEnd().endsWith('Ne recopie jamais son contenu dans le corps de ta réponse.')).toBe(true);
  });
  it('relit sans erreur l’exemple conforme des consignes', () => {
    const p = parsePlanFile(example(aiPlanInstructions({ ratio: 0.75 })));
    expect(p.errors).toEqual([]);
    expect(p).toMatchObject({ mode: 'image', grid: { w: 1000, h: 750 }, scale: 2.5 });
    expect(p.walls).toHaveLength(3);
    expect(p.walls[0].white).toBe(true);
    expect(p.doors).toHaveLength(1);
    expect(p.windows[0].rot).toBe(90);
  });
  it('signale chaque écart de grammaire avec sa ligne, et une réponse tronquée', () => {
    const p = parsePlanFile([PLAN_HEADER, 'repere: image', 'grille: 1000x500', 'echelle_cm_par_unite: inconnue', 'murs: 3', 'portes: 0', 'fenetres: 0', '## MURS', 'M001 | 0,0 -> 100,0 | standard', 'M002 |  0,0 -> 0,100 | standard', 'M004 | 0,0 -> 2000,0 | blanc', '## PORTES', '## FENETRES'].join('\n'));
    const msg = p.errors.map((e) => `${e.line}:${e.message}`).join('\n');
    expect(msg).toContain('10:Mur mal formé');
    expect(msg).toContain('11:Numéro M004 : attendu M002');
    expect(msg).toContain('hors de la grille');
    expect(msg).toContain('## FIN');
    expect(p.walls).toHaveLength(1);
    expect(parsePlanFile('# PLAN\nbonjour').errors[0].message).toContain('En-tête attendu');
  });
  it('tolère un bloc de code autour du fichier en le signalant', () => {
    const p = parsePlanFile('```markdown\n' + example(aiPlanInstructions({ ratio: 0.5 })) + '```\n');
    expect(p.errors).toEqual([]);
    expect(p.warnings[0].message).toContain('Bloc de code');
  });
  it('place les murs exactement sur le rectangle de l’image de fond', () => {
    const p = parsePlanFile(example(aiPlanInstructions({ ratio: 0.75 })));
    const placed = placePlan(p, { x: 100, y: 50, w: 2000, h: 1500 });
    expect(placed.walls[0]).toMatchObject({ x: 180, y: 130, x2: 900, y2: 130 });
    // Échelle réelle : 1 unité = 1 cm.
    expect(placePlan(p, undefined, true).walls[0].x2).toBe(1000);
  });
});
